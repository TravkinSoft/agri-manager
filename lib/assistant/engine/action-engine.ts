import type {
  AssistantIntent,
  AssistantNavigationAction,
  AssistantPendingActionType,
  AssistantSessionState,
  AssistantUiContext,
} from "@/lib/assistant/engine/types";
import { isDateOnly, todayDateOnlyLocal } from "@/lib/dates/date-only";

export type AssistantActionPlan = {
  type: AssistantPendingActionType;
  summary: string;
  route: string | null;
  payload: Record<string, unknown>;
  requiresConfirmation: boolean;
};

type AssistantDraftKind =
  | "operation"
  | "weighbridge_ticket"
  | "warehouse"
  | "field"
  | "meal_order"
  | "transfer"
  | "fuel_issue"
  | "field_task"
  | "material_issue";

type AssistantActionRequirement = {
  field: string;
  label: string;
  required: boolean;
};

const DRAFT_REQUIREMENTS: Record<AssistantDraftKind, AssistantActionRequirement[]> = {
  operation: [
    { field: "field", label: "поле", required: true },
    { field: "crop_structure", label: "участок структуры", required: true },
    { field: "operation_type", label: "тип работы", required: true },
    { field: "area_ha", label: "площадь", required: true },
    { field: "date", label: "дата", required: true },
  ],
  weighbridge_ticket: [
    { field: "movement_type", label: "тип движения", required: true },
    { field: "warehouse", label: "склад", required: true },
    { field: "counterparty_or_source", label: "контрагент или источник", required: false },
    { field: "product_lines", label: "товары/строки документа", required: true },
  ],
  warehouse: [
    { field: "name", label: "название склада", required: true },
    { field: "warehouse_type", label: "тип склада", required: true },
  ],
  field: [
    { field: "name", label: "название поля", required: true },
    { field: "area_ha", label: "площадь", required: true },
  ],
  meal_order: [
    { field: "meal_date", label: "дата питания", required: true },
    { field: "meal_type", label: "тип питания", required: true },
    { field: "people", label: "люди или количество", required: true },
  ],
  transfer: [
    { field: "source_warehouse", label: "склад-источник", required: true },
    { field: "destination_warehouse", label: "склад назначения", required: true },
    { field: "product_lines", label: "товары", required: true },
  ],
  fuel_issue: [
    { field: "fuel_source", label: "источник ГСМ", required: true },
    { field: "vehicle_or_machine", label: "машина/техника", required: true },
    { field: "quantity", label: "количество", required: true },
  ],
  field_task: [
    { field: "field", label: "поле", required: true },
    { field: "task", label: "задача", required: true },
  ],
  material_issue: [
    { field: "operation", label: "операция", required: true },
    { field: "materials", label: "материалы", required: true },
  ],
};

function cleanString(value: unknown): string | null {
  const raw = String(value || "").trim();
  return raw.length > 0 ? raw : null;
}

function safeJson(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return "{}";
  }
}

function isOperationDraftText(value: string): boolean {
  return (
    /(operation|spray|spraying|herbicid|fungicid|insecticid|fertiliz|planting|sowing|harvest|soil|material|rate|l\/ha|kg\/ha|отработ|обработ|заплан|созда[йт]|сдела[йт])/i.test(value) ||
    /(?:операц|обработ|гербицид|фунгицид|инсектицид|сзр|удобрен|посев|посадк|уборк|дисков|культивац|вспаш|борон|почво|материал|норма|л\/га|кг\/га)/i.test(value)
  );
}

function summarizeNavigation(action: AssistantNavigationAction): string {
  if (action.type === "open_entity") {
    return `open ${action.entityType}${action.entityId ? ` ${action.entityId}` : ""}`;
  }
  if (action.type === "open_page_with_filter" || action.type === "apply_filter") {
    return `open ${action.page} with filters`;
  }
  return `open ${action.page}`;
}

function inferDraftKind(intent: AssistantIntent): AssistantDraftKind {
  const tool = cleanString(intent.parameters.tool) || cleanString(intent.parameters.draft_type);
  if (tool) {
    if (tool.includes("operation")) return "operation";
    if (tool.includes("weighbridge")) return "weighbridge_ticket";
    if (tool.includes("meal")) return "meal_order";
    if (tool.includes("transfer")) return "transfer";
    if (tool.includes("fuel")) return "fuel_issue";
    if (tool.includes("material")) return "material_issue";
    if (tool.includes("warehouse")) return "warehouse";
    if (tool.includes("field_task")) return "field_task";
    if (tool.includes("field")) return "field";
    return "operation";
  }
  const raw = JSON.stringify(intent.parameters || {}).toLowerCase();
  if (/(weighbridge|ticket|талон|весов)/i.test(raw)) return "weighbridge_ticket";
  if (/(meal|thermos|питан|термос)/i.test(raw)) return "meal_order";
  if (/(transfer|перемещ)/i.test(raw)) return "transfer";
  if (/(fuel|гсм|топлив|азс)/i.test(raw)) return "fuel_issue";
  if (/(warehouse|stock|склад)/i.test(raw)) return "warehouse";
  if (/(field|поле)/i.test(raw) && !isOperationDraftText(raw)) return "field";
  if (isOperationDraftText(raw)) return "operation";
  return "operation";
}

function parseOperationDateFromText(value: string): string | null {
  const lower = value.toLowerCase();
  const date = new Date();
  if (/(сегодня|today)/i.test(lower)) return todayDateOnlyLocal(date);
  if (/(завтра|tomorrow)/i.test(lower)) {
    date.setDate(date.getDate() + 1);
    return todayDateOnlyLocal(date);
  }
  const match = value.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (!match) return null;
  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = match[3] ? (match[3].length === 2 ? `20${match[3]}` : match[3]) : String(new Date().getFullYear());
  const result = `${year}-${month}-${day}`;
  return isDateOnly(result) ? result : null;
}

function applyOperationDraftTextFields(output: Record<string, unknown>, query: string): void {
  if (!isOperationDraftText(query)) return;
  const fieldMatch = query.match(/(?:поле|field)\s*№?\s*([0-9]{1,3}(?:-[0-9]{1,3}){0,2}[а-яa-z]?)/i);
  const areaMatch = query.match(/(?:^|[^\d])(\d+(?:[,.]\d+)?)\s*(?:га|ha)(?=\s|[.,;:]|$)/i);
  const date = parseOperationDateFromText(query);

  if (fieldMatch && output.field == null) output.field = fieldMatch[1];
  if (areaMatch && output.area_ha == null) output.area_ha = Number(areaMatch[1].replace(",", "."));
  if (date && output.date == null) output.date = date;
  if (output.operation_type == null) {
    if (/(гербицид|herbicid)/i.test(query)) output.operation_type = "herbicide_spraying";
    else if (/(фунгицид|fungicid)/i.test(query)) output.operation_type = "fungicide_spraying";
    else if (/(инсектицид|insecticid)/i.test(query)) output.operation_type = "insecticide_spraying";
    else if (/(spray|обработ)/i.test(query)) output.operation_type = "spraying";
    else if (/(удобрен|fertiliz)/i.test(query)) output.operation_type = "fertilizer_application";
    else if (/(посев|посадк|planting|sowing)/i.test(query)) output.operation_type = "planting";
    else if (/(уборк|harvest)/i.test(query)) output.operation_type = "harvesting";
    else if (/(почво|soil|диск|культивац|вспаш|борон)/i.test(query)) output.operation_type = "soil_operation";
  }
}

function applyWeighbridgeDraftTextFields(output: Record<string, unknown>, query: string): void {
  const text = query.toLowerCase();
  if (!/(талон|весов|weighbridge|ticket)/i.test(text)) return;
  if (output.movement_type == null) {
    if (/(постав|приход|receipt)/i.test(text)) output.movement_type = "поставка/приход";
    else if (/(отгруз|shipment)/i.test(text)) output.movement_type = "отгрузка";
    else if (/(перемещ|transfer)/i.test(text)) output.movement_type = "перемещение";
    else if (/(урожай|harvest)/i.test(text)) output.movement_type = "урожай с поля";
  }
  if (output.product_lines == null) {
    const productMatch = query.match(
      /(?:поставк[ауи]?|приход|отгрузк[ауи]?|товар(?:ы)?|материал(?:ы)?)\s+(.+?)(?:\s+(?:на|в)\s+склад|\s+со\s+склада|\s+от\s+|$)/i
    );
    const product = cleanString(productMatch?.[1]);
    if (product) output.product_lines = product;
  }
}

function collectDraftFields(intent: AssistantIntent): Record<string, unknown> {
  const params = intent.parameters || {};
  const output: Record<string, unknown> = {};
  const aliases: Record<string, string[]> = {
    field: ["field", "field_id", "field_label", "fieldNumber", "field_number"],
    crop_structure: ["crop_structure", "crop_structure_id", "cropStructureId", "sectionId"],
    operation_type: ["operation_type", "operationType", "work", "work_type", "subtype"],
    area_ha: ["area_ha", "area", "plan_area_ha"],
    date: ["date", "planned_date", "operation_date"],
    movement_type: ["movement_type", "movementType", "direction"],
    warehouse: ["warehouse", "warehouse_id", "warehouse_alias"],
    counterparty_or_source: ["counterparty", "supplier", "source", "field"],
    product_lines: ["product_lines", "products", "materials", "lines"],
    name: ["name", "title"],
    warehouse_type: ["warehouse_type", "type"],
    meal_date: ["meal_date", "date"],
    meal_type: ["meal_type", "type"],
    people: ["people", "persons", "count"],
    source_warehouse: ["source_warehouse", "from_warehouse"],
    destination_warehouse: ["destination_warehouse", "to_warehouse"],
    fuel_source: ["fuel_source", "source"],
    vehicle_or_machine: ["vehicle", "machine", "tractor"],
    quantity: ["quantity", "qty", "amount"],
    task: ["task", "work", "comment"],
    operation: ["operation", "operation_id"],
    materials: ["materials", "products"],
  };

  Object.entries(aliases).forEach(([target, keys]) => {
    for (const key of keys) {
      const value = params[key];
      const hasValue =
        Array.isArray(value) ? value.length > 0 : cleanString(value) || typeof value === "number" || typeof value === "boolean";
      if (hasValue) {
        output[target] = value;
        break;
      }
    }
  });

  const query = cleanString(params.query);
  if (query) {
    applyWeighbridgeDraftTextFields(output, query);
    applyOperationDraftTextFields(output, query);
  }

  return output;
}

function setIfMissing(output: Record<string, unknown>, key: string, value: unknown): void {
  const current = output[key];
  const hasCurrent = Array.isArray(current)
    ? current.length > 0
    : current !== null && current !== undefined && String(current).trim().length > 0;
  const hasNext = Array.isArray(value)
    ? value.length > 0
    : value !== null && value !== undefined && String(value).trim().length > 0;
  if (!hasCurrent && hasNext) output[key] = value;
}

function enrichDraftFieldsFromContext(params: {
  draftKind: AssistantDraftKind;
  collected: Record<string, unknown>;
  sessionState?: AssistantSessionState | null;
  runtimeContext?: AssistantUiContext | null;
}): Record<string, unknown> {
  const output = { ...params.collected };
  const state = params.sessionState || null;
  const runtime = params.runtimeContext || null;

  if (params.draftKind === "operation" || params.draftKind === "field_task" || params.draftKind === "material_issue") {
    const fieldId =
      cleanString(runtime?.selectedFieldId) ||
      cleanString(state?.lastFieldId) ||
      (state?.focusEntityType === "field" ? cleanString(state.focusEntityId) : null);
    const fieldLabel =
      cleanString(runtime?.selectedFieldLabel) ||
      cleanString(state?.lastFieldLabel) ||
      cleanString(state?.lastField) ||
      (state?.focusEntityType === "field" ? cleanString(state.focusEntityLabel) : null);
    const sectionId =
      cleanString(runtime?.selectedCropStructureSectionId) ||
      cleanString(state?.lastCropStructureSectionId) ||
      (state?.focusEntityType === "crop_structure_line" ? cleanString(state.focusEntityId) : null);
    const sectionLabel =
      cleanString(runtime?.selectedCropStructureSectionLabel) ||
      cleanString(state?.lastCropStructureSectionLabel) ||
      cleanString(state?.lastCropStructureSection) ||
      (state?.focusEntityType === "crop_structure_line" ? cleanString(state.focusEntityLabel) : null);
    const crop = cleanString(runtime?.selectedCrop) || cleanString(state?.lastCrop);

    setIfMissing(output, "field_id", fieldId);
    setIfMissing(output, "field_label", fieldLabel);
    setIfMissing(output, "field", fieldLabel || fieldId);
    setIfMissing(output, "crop_structure_id", sectionId);
    setIfMissing(output, "crop_structure_label", sectionLabel);
    setIfMissing(output, "crop_structure", sectionLabel || sectionId);
    setIfMissing(output, "crop", crop);
  }

  if (
    params.draftKind === "weighbridge_ticket" ||
    params.draftKind === "warehouse" ||
    params.draftKind === "transfer" ||
    params.draftKind === "material_issue"
  ) {
    const warehouseId =
      cleanString(runtime?.selectedWarehouseId) ||
      cleanString(state?.lastWarehouseId) ||
      (state?.focusEntityType === "warehouse" ? cleanString(state.focusEntityId) : null);
    const warehouseLabel =
      cleanString(runtime?.selectedWarehouseLabel) ||
      cleanString(state?.lastWarehouseLabel) ||
      cleanString(state?.lastWarehouse) ||
      (state?.focusEntityType === "warehouse" ? cleanString(state.focusEntityLabel) : null);

    setIfMissing(output, "warehouse_id", warehouseId);
    setIfMissing(output, "warehouse", warehouseLabel || warehouseId);
  }

  return output;
}

function findMissingRequiredFields(kind: AssistantDraftKind, collected: Record<string, unknown>): AssistantActionRequirement[] {
  return (DRAFT_REQUIREMENTS[kind] || []).filter((item) => item.required && collected[item.field] == null);
}

function summarizeDraft(kind: AssistantDraftKind, missing: AssistantActionRequirement[]): string {
  const labelMap: Record<AssistantDraftKind, string> = {
    operation: "operation draft",
    weighbridge_ticket: "weighbridge ticket draft",
    warehouse: "warehouse draft",
    field: "field draft",
    meal_order: "meal order draft",
    transfer: "warehouse transfer draft",
    fuel_issue: "fuel issue draft",
    field_task: "field task draft",
    material_issue: "material issue draft",
  };
  if (!missing.length) return `prepare ${labelMap[kind]}`;
  return `prepare ${labelMap[kind]}: missing ${missing.map((item) => item.label).join(", ")}`;
}

export function buildAssistantActionPlan(params: {
  intent: AssistantIntent;
  navigationActions: AssistantNavigationAction[];
  requestMessage: string;
  sessionState?: AssistantSessionState | null;
  runtimeContext?: AssistantUiContext | null;
}): AssistantActionPlan | null {
  const firstNavigation = params.navigationActions[0] || null;
  if (firstNavigation) {
    const type: AssistantPendingActionType =
      firstNavigation.type === "open_entity" ? "open_entity" : "navigate";
    return {
      type,
      summary: summarizeNavigation(firstNavigation),
      route: firstNavigation.route || null,
      payload: {
        action: firstNavigation,
        requestMessage: params.requestMessage,
      },
      requiresConfirmation: false,
    };
  }

  if (params.intent.name === "create_draft") {
    const draftKind = inferDraftKind(params.intent);
    const collectedFields = enrichDraftFieldsFromContext({
      draftKind,
      collected: collectDraftFields(params.intent),
      sessionState: params.sessionState,
      runtimeContext: params.runtimeContext,
    });
    const missingFields = findMissingRequiredFields(draftKind, collectedFields);
    return {
      type: "create_draft",
      summary: summarizeDraft(draftKind, missingFields),
      route: null,
      payload: {
        draftKind,
        collectedFields,
        missingFields,
        requiredFields: DRAFT_REQUIREMENTS[draftKind] || [],
        parameters: params.intent.parameters || {},
        requestMessage: params.requestMessage,
      },
      requiresConfirmation: true,
    };
  }

  return null;
}

export function applyAssistantActionPlanToSessionState(
  previous: AssistantSessionState,
  plan: AssistantActionPlan | null
): AssistantSessionState {
  if (!plan) return previous;
  const now = new Date().toISOString();
  return {
    ...previous,
    pendingActionType: plan.requiresConfirmation ? plan.type : null,
    pendingActionSummary: plan.requiresConfirmation ? plan.summary : null,
    pendingActionRoute: plan.requiresConfirmation ? plan.route : null,
    pendingActionPayloadJson: plan.requiresConfirmation ? safeJson(plan.payload) : null,
    pendingActionUpdatedAt: plan.requiresConfirmation ? now : null,
    lastActionType: plan.type,
    lastActionSummary: plan.summary,
    lastActionAt: now,
  };
}
