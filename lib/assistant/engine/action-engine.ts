import type {
  AssistantIntent,
  AssistantNavigationAction,
  AssistantPendingActionType,
  AssistantSessionState,
} from "@/lib/assistant/engine/types";

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
  if (raw.includes("weighbridge") || raw.includes("ticket")) return "weighbridge_ticket";
  if (raw.includes("warehouse") || raw.includes("stock")) return "warehouse";
  if (raw.includes("field")) return "field";
  if (raw.includes("meal") || raw.includes("thermos")) return "meal_order";
  return "operation";
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
    const collectedFields = collectDraftFields(params.intent);
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
