import type {
  AssistantIntent,
  AssistantSessionState,
  AssistantToolOutput,
  AssistantUiContext,
  AssistantWorkingMemoryEntityType,
} from "@/lib/assistant/engine/types";

export const EMPTY_ASSISTANT_SESSION_STATE: AssistantSessionState = {
  lastEntity: null,
  lastCrop: null,
  lastVariety: null,
  lastBatchClass: null,
  lastWarehouse: null,
  lastWarehouseId: null,
  lastWarehouseLabel: null,
  lastField: null,
  lastFieldId: null,
  lastFieldLabel: null,
  lastOperation: null,
  lastOperationId: null,
  lastOperationLabel: null,
  lastTicket: null,
  lastTicketId: null,
  lastTicketLabel: null,
  lastCropStructureSection: null,
  lastCropStructureSectionId: null,
  lastCropStructureSectionLabel: null,
  lastBatch: null,
  lastBatchId: null,
  lastBatchLabel: null,
  lastSeason: null,
  lastModule: null,
  lastToolSource: null,
  lastAnswerType: null,
  lastIntent: null,
  lastResultContext: null,
  lastWarehouseCount: null,
  lastInventoryTotalKg: null,
  lastCropStructureAreaHa: null,
  lastFieldsAreaHa: null,
  lastDetectedInconsistency: null,
  lastInconsistencyAt: null,
  focusEntityType: null,
  focusEntityId: null,
  focusEntityLabel: null,
  focusModule: null,
  focusRoute: null,
  focusSource: null,
  focusUpdatedAt: null,
  pendingActionType: null,
  pendingActionSummary: null,
  pendingActionRoute: null,
  pendingActionPayloadJson: null,
  pendingActionUpdatedAt: null,
  lastActionType: null,
  lastActionSummary: null,
  lastActionAt: null,
};

function cleanString(value: unknown): string | null {
  const raw = String(value || "").trim();
  return raw.length > 0 ? raw : null;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeSessionState(input: Partial<AssistantSessionState> | null | undefined): AssistantSessionState {
  return {
    lastEntity: cleanString(input?.lastEntity),
    lastCrop: cleanString(input?.lastCrop),
    lastVariety: cleanString(input?.lastVariety),
    lastBatchClass: cleanString(input?.lastBatchClass),
    lastWarehouse: cleanString(input?.lastWarehouse),
    lastWarehouseId: cleanString(input?.lastWarehouseId),
    lastWarehouseLabel: cleanString(input?.lastWarehouseLabel),
    lastField: cleanString(input?.lastField),
    lastFieldId: cleanString(input?.lastFieldId),
    lastFieldLabel: cleanString(input?.lastFieldLabel),
    lastOperation: cleanString(input?.lastOperation),
    lastOperationId: cleanString(input?.lastOperationId),
    lastOperationLabel: cleanString(input?.lastOperationLabel),
    lastTicket: cleanString(input?.lastTicket),
    lastTicketId: cleanString(input?.lastTicketId),
    lastTicketLabel: cleanString(input?.lastTicketLabel),
    lastCropStructureSection: cleanString(input?.lastCropStructureSection),
    lastCropStructureSectionId: cleanString(input?.lastCropStructureSectionId),
    lastCropStructureSectionLabel: cleanString(input?.lastCropStructureSectionLabel),
    lastBatch: cleanString(input?.lastBatch),
    lastBatchId: cleanString(input?.lastBatchId),
    lastBatchLabel: cleanString(input?.lastBatchLabel),
    lastSeason: cleanString(input?.lastSeason),
    lastModule: cleanString(input?.lastModule),
    lastToolSource: cleanString(input?.lastToolSource),
    lastAnswerType: cleanString(input?.lastAnswerType),
    lastIntent: input?.lastIntent || null,
    lastResultContext: cleanString(input?.lastResultContext),
    lastWarehouseCount:
      Number.isFinite(Number(input?.lastWarehouseCount)) ? Number(input?.lastWarehouseCount) : null,
    lastInventoryTotalKg:
      Number.isFinite(Number(input?.lastInventoryTotalKg)) ? Number(input?.lastInventoryTotalKg) : null,
    lastCropStructureAreaHa:
      Number.isFinite(Number(input?.lastCropStructureAreaHa)) ? Number(input?.lastCropStructureAreaHa) : null,
    lastFieldsAreaHa:
      Number.isFinite(Number(input?.lastFieldsAreaHa)) ? Number(input?.lastFieldsAreaHa) : null,
    lastDetectedInconsistency: cleanString(input?.lastDetectedInconsistency),
    lastInconsistencyAt: cleanString(input?.lastInconsistencyAt),
    focusEntityType: normalizeFocusEntityType(input?.focusEntityType),
    focusEntityId: cleanString(input?.focusEntityId),
    focusEntityLabel: cleanString(input?.focusEntityLabel),
    focusModule: cleanString(input?.focusModule),
    focusRoute: cleanString(input?.focusRoute),
    focusSource:
      input?.focusSource === "tool_output" ||
      input?.focusSource === "page_context" ||
      input?.focusSource === "user_text" ||
      input?.focusSource === "action"
        ? input.focusSource
        : null,
    focusUpdatedAt: cleanString(input?.focusUpdatedAt),
    pendingActionType:
      input?.pendingActionType === "navigate" ||
      input?.pendingActionType === "open_entity" ||
      input?.pendingActionType === "create_draft" ||
      input?.pendingActionType === "fill_form" ||
      input?.pendingActionType === "confirm_required"
        ? input.pendingActionType
        : null,
    pendingActionSummary: cleanString(input?.pendingActionSummary),
    pendingActionRoute: cleanString(input?.pendingActionRoute),
    pendingActionPayloadJson: cleanString(input?.pendingActionPayloadJson),
    pendingActionUpdatedAt: cleanString(input?.pendingActionUpdatedAt),
    lastActionType:
      input?.lastActionType === "navigate" ||
      input?.lastActionType === "open_entity" ||
      input?.lastActionType === "create_draft" ||
      input?.lastActionType === "fill_form" ||
      input?.lastActionType === "confirm_required"
        ? input.lastActionType
        : null,
    lastActionSummary: cleanString(input?.lastActionSummary),
    lastActionAt: cleanString(input?.lastActionAt),
  };
}

function normalizeFocusEntityType(value: unknown): AssistantWorkingMemoryEntityType | null {
  const raw = cleanString(value);
  if (
    raw === "field" ||
    raw === "warehouse" ||
    raw === "operation" ||
    raw === "ticket" ||
    raw === "crop_structure_line" ||
    raw === "batch" ||
    raw === "crop" ||
    raw === "module"
  ) {
    return raw;
  }
  return null;
}

function findValue(rows: Array<Record<string, unknown>>, keys: string[]): string | null {
  for (const row of rows) {
    for (const key of keys) {
      const value = cleanString(row[key]);
      if (value && value !== "-" && value !== "—") return value;
    }
  }
  return null;
}

function hasLargestFieldQuestion(intent: AssistantIntent): boolean {
  const text = [
    cleanString(intent.parameters.query),
    cleanString(intent.parameters.entityQuery),
    cleanString(intent.parameters.field),
    cleanString(intent.parameters.field_alias),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text) return false;

  const mentionsField = /(?:\u043f\u043e\u043b\u0435|\u043f\u043e\u043b\u044f|field|fields|РїРѕР»Рµ|РїРѕР»СЏ)/i.test(text);
  const asksLargest =
    /(?:\u0441\u0430\u043c\w*\s+\u0431\u043e\u043b\u044c\u0448|\u043d\u0430\u0438\u0431\u043e\u043b\u044c\u0448|\u043a\u0440\u0443\u043f\u043d|\u043c\u0430\u043a\u0441|\u0431\u043e\u043b\u044c\u0448\u0435\s+\u0432\u0441\u0435\u0433\u043e|largest|biggest|max(?:imum)?|СЃР°Рј\w*\s+Р±РѕР»СЊС€|РЅР°РёР±РѕР»СЊС€|РєСЂСѓРїРЅ|РјР°РєСЃ|Р±РѕР»СЊС€Рµ\s+РІСЃРµРіРѕ)/i.test(
      text
    );
  return mentionsField && asksLargest;
}

function extractFieldReferenceFromText(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const afterLabel = text.match(/(?:\u043f\u043e\u043b\u0435|\u043f\u043e\u043b\u044f|field)\s*([0-9]{1,3}(?:-[0-9]{1,3}){0,2})/i);
  if (afterLabel?.[1]) return afterLabel[1];
  const beforeLabel = text.match(/([0-9]{1,3}(?:-[0-9]{1,3}){0,2})\s*(?:\u043f\u043e\u043b\u0435|\u043f\u043e\u043b\u044f|field)/i);
  if (beforeLabel?.[1]) return beforeLabel[1];
  return null;
}

function pickLargestFieldCandidate(rows: Array<Record<string, unknown>>): {
  fieldId: string | null;
  fieldLabel: string | null;
  areaHa: number;
} | null {
  let best: { fieldId: string | null; fieldLabel: string | null; areaHa: number } | null = null;
  rows.forEach((row) => {
    const areaHa = asNumber(row.area_ha ?? row.area);
    const fieldId = cleanString(row.field_id) || cleanString(row.fieldId) || cleanString(row.id);
    const fieldLabel =
      cleanString(row.field_name) || cleanString(row.field_label) || cleanString(row.name) || fieldId;
    if (!fieldLabel && !fieldId) return;
    if (!best || areaHa > best.areaHa) {
      best = { fieldId, fieldLabel, areaHa };
    }
  });
  return best;
}

function pickMarkedFieldCandidate(rows: Array<Record<string, unknown>>): {
  fieldId: string | null;
  fieldLabel: string | null;
  areaHa: number;
} | null {
  const row = rows.find((item) => {
    const focus = cleanString(item.assistant_focus);
    const reason = cleanString(item.assistant_focus_reason);
    return focus === "field" || reason === "largest_field_by_area";
  });
  if (!row) return null;

  const fieldId = cleanString(row.field_id) || cleanString(row.fieldId) || cleanString(row.id);
  const fieldLabel = cleanString(row.field_name) || cleanString(row.field_label) || cleanString(row.name) || fieldId;
  if (!fieldLabel && !fieldId) return null;

  return {
    fieldId,
    fieldLabel,
    areaHa: asNumber(row.area_ha ?? row.area),
  };
}

function buildFocusPatch(params: {
  entityType: AssistantWorkingMemoryEntityType;
  entityId?: string | null;
  entityLabel?: string | null;
  module?: string | null;
  route?: string | null;
  source: "tool_output" | "page_context" | "user_text" | "action";
}): Partial<AssistantSessionState> {
  const entityId = cleanString(params.entityId);
  const entityLabel = cleanString(params.entityLabel);
  return {
    focusEntityType: params.entityType,
    focusEntityId: entityId,
    focusEntityLabel: entityLabel || entityId,
    focusModule: cleanString(params.module),
    focusRoute: cleanString(params.route),
    focusSource: params.source,
    focusUpdatedAt: new Date().toISOString(),
  };
}

export function updateSessionStateFromRuntimeContext(
  previous: AssistantSessionState,
  runtimeContext: AssistantUiContext
): AssistantSessionState {
  const route = cleanString(runtimeContext.currentRoute);
  const moduleName = cleanString(runtimeContext.currentModule);
  const entity = runtimeContext.entity;

  const candidates: Array<{
    entityType: AssistantWorkingMemoryEntityType;
    entityId: string | null;
    entityLabel: string | null;
  }> = [
    {
      entityType: "field",
      entityId: cleanString(runtimeContext.selectedFieldId),
      entityLabel: cleanString(runtimeContext.selectedFieldLabel),
    },
    {
      entityType: "warehouse",
      entityId: cleanString(runtimeContext.selectedWarehouseId),
      entityLabel: cleanString(runtimeContext.selectedWarehouseLabel),
    },
    {
      entityType: "operation",
      entityId: cleanString(runtimeContext.selectedOperationId),
      entityLabel: cleanString(runtimeContext.selectedOperationLabel),
    },
    {
      entityType: "ticket",
      entityId: cleanString(runtimeContext.selectedTicketId),
      entityLabel: cleanString(runtimeContext.selectedTicketLabel),
    },
    {
      entityType: "crop_structure_line",
      entityId: cleanString(runtimeContext.selectedCropStructureSectionId),
      entityLabel: cleanString(runtimeContext.selectedCropStructureSectionLabel),
    },
    {
      entityType: "batch",
      entityId: cleanString(runtimeContext.selectedBatchId),
      entityLabel: cleanString(runtimeContext.selectedBatchLabel),
    },
  ];

  const selected = candidates.find((candidate) => candidate.entityId || candidate.entityLabel);
  if (selected) {
    return {
      ...previous,
      ...(selected.entityType === "field"
        ? { lastFieldId: selected.entityId || previous.lastFieldId, lastFieldLabel: selected.entityLabel || previous.lastFieldLabel, lastField: selected.entityLabel || previous.lastField }
        : {}),
      ...(selected.entityType === "warehouse"
        ? {
            lastWarehouseId: selected.entityId || previous.lastWarehouseId,
            lastWarehouseLabel: selected.entityLabel || previous.lastWarehouseLabel,
            lastWarehouse: selected.entityLabel || previous.lastWarehouse,
          }
        : {}),
      ...(selected.entityType === "operation"
        ? {
            lastOperationId: selected.entityId || previous.lastOperationId,
            lastOperationLabel: selected.entityLabel || previous.lastOperationLabel,
            lastOperation: selected.entityLabel || previous.lastOperation,
          }
        : {}),
      ...(selected.entityType === "ticket"
        ? {
            lastTicketId: selected.entityId || previous.lastTicketId,
            lastTicketLabel: selected.entityLabel || previous.lastTicketLabel,
            lastTicket: selected.entityLabel || previous.lastTicket,
          }
        : {}),
      ...(selected.entityType === "crop_structure_line"
        ? {
            lastCropStructureSectionId: selected.entityId || previous.lastCropStructureSectionId,
            lastCropStructureSectionLabel: selected.entityLabel || previous.lastCropStructureSectionLabel,
            lastCropStructureSection: selected.entityLabel || previous.lastCropStructureSection,
          }
        : {}),
      ...(selected.entityType === "batch"
        ? {
            lastBatchId: selected.entityId || previous.lastBatchId,
            lastBatchLabel: selected.entityLabel || previous.lastBatchLabel,
            lastBatch: selected.entityLabel || previous.lastBatch,
          }
        : {}),
      ...buildFocusPatch({
        entityType: selected.entityType,
        entityId: selected.entityId,
        entityLabel: selected.entityLabel,
        module: moduleName,
        route,
        source: "page_context",
      }),
    };
  }

  if (entity?.type && entity?.id) {
    const entityType = normalizeFocusEntityType(entity.type);
    if (entityType) {
      const entityId = cleanString(entity.id);
      const entityLabel = cleanString(entity.label) || entityId;
      return {
        ...previous,
        ...(entityType === "field"
          ? { lastFieldId: entityId || previous.lastFieldId, lastFieldLabel: entityLabel || previous.lastFieldLabel, lastField: entityLabel || previous.lastField }
          : {}),
        ...(entityType === "warehouse"
          ? {
              lastWarehouseId: entityId || previous.lastWarehouseId,
              lastWarehouseLabel: entityLabel || previous.lastWarehouseLabel,
              lastWarehouse: entityLabel || previous.lastWarehouse,
            }
          : {}),
        ...(entityType === "operation"
          ? {
              lastOperationId: entityId || previous.lastOperationId,
              lastOperationLabel: entityLabel || previous.lastOperationLabel,
              lastOperation: entityLabel || previous.lastOperation,
            }
          : {}),
        ...(entityType === "ticket"
          ? {
              lastTicketId: entityId || previous.lastTicketId,
              lastTicketLabel: entityLabel || previous.lastTicketLabel,
              lastTicket: entityLabel || previous.lastTicket,
            }
          : {}),
        ...(entityType === "crop_structure_line"
          ? {
              lastCropStructureSectionId: entityId || previous.lastCropStructureSectionId,
              lastCropStructureSectionLabel: entityLabel || previous.lastCropStructureSectionLabel,
              lastCropStructureSection: entityLabel || previous.lastCropStructureSection,
            }
          : {}),
        ...(entityType === "batch"
          ? {
              lastBatchId: entityId || previous.lastBatchId,
              lastBatchLabel: entityLabel || previous.lastBatchLabel,
              lastBatch: entityLabel || previous.lastBatch,
            }
          : {}),
        ...buildFocusPatch({
          entityType,
          entityId,
          entityLabel,
          module: moduleName,
          route,
          source: "page_context",
        }),
      };
    }
  }

  if (runtimeContext.selectedCrop) {
    return {
      ...previous,
      lastCrop: cleanString(runtimeContext.selectedCrop) || previous.lastCrop,
      ...buildFocusPatch({
        entityType: "crop",
        entityLabel: runtimeContext.selectedCrop,
        module: moduleName,
        route,
        source: "page_context",
      }),
    };
  }

  if (moduleName || route) {
    return {
      ...previous,
      focusModule: moduleName || previous.focusModule,
      focusRoute: route || previous.focusRoute,
    };
  }

  return previous;
}

export function updateSessionStateFromToolOutput(params: {
  previous: AssistantSessionState;
  intent: AssistantIntent;
  output: AssistantToolOutput | null;
  seasonFromContext?: string | null;
}): AssistantSessionState {
  const { previous, intent, output, seasonFromContext } = params;
  const rows = output?.rows || [];
  const outputTable = String(output?.source.tableOrView || "").toLowerCase();
  const inventoryTotalKg = rows.reduce((acc, row) => acc + asNumber(row.quantity), 0);
  const cropAreaHa = rows.reduce((acc, row) => acc + asNumber(row.area_ha), 0);
  const fieldsAreaHa = outputTable.includes("land_bank_summary")
    ? asNumber(rows[0]?.total_area_ha)
    : rows.reduce((acc, row) => acc + asNumber(row.area_ha), 0);
  const warehouseCount =
    rows.length && Number.isFinite(Number(rows[0]?.warehouses_total))
      ? Number(rows[0]?.warehouses_total)
      : rows.length;
  const markedFieldCandidate = pickMarkedFieldCandidate(rows);
  const largestFieldCandidate = markedFieldCandidate || (hasLargestFieldQuestion(intent) ? pickLargestFieldCandidate(rows) : null);
  const nextFieldId = findValue(rows, ["field_id", "fieldId"]);
  const nextFieldLabel = findValue(rows, ["field_name", "field_label"]);
  const selectedFieldId = largestFieldCandidate?.fieldId || nextFieldId;
  const selectedFieldLabel = largestFieldCandidate?.fieldLabel || nextFieldLabel;
  const nextWarehouseId = findValue(rows, ["warehouse_id", "warehouse_from_id", "warehouse_to_id", "warehouseId"]);
  const nextWarehouseLabel = findValue(rows, ["warehouse_name", "warehouse_from_name", "warehouse_to_name", "warehouse_label"]);
  const nextOperationId = findValue(rows, ["operation_id"]);
  const nextOperationLabel = findValue(rows, ["operation_type", "operation_name", "title"]);
  const nextTicketId = findValue(rows, ["ticket_id"]);
  const nextTicketLabel = findValue(rows, ["ticket_no", "ticket_number"]);
  const nextCropStructureId = findValue(rows, ["crop_structure_id", "crop_structure_line_id", "structure_line_id"]);
  const nextCropStructureLabel = findValue(rows, ["crop_structure_label", "structure_label"]);
  const nextBatchId = findValue(rows, ["batch_id"]);
  const nextBatchLabel = findValue(rows, ["batch_number", "lot_number", "batch_name"]);
  const materialCentricOutput =
    outputTable.includes("field_material") ||
    outputTable.includes("operation_material") ||
    outputTable.includes("ledger") ||
    outputTable.includes("inventory") ||
    outputTable.includes("ticket");
  const nextCropName = materialCentricOutput
    ? null
    : findValue(rows, ["crop_name", "crop_label", "culture_name", "culture"]);
  const requestedWarehouse =
    cleanString(intent.parameters.warehouse_alias) ||
    cleanString(intent.parameters.warehouse) ||
    cleanString(intent.parameters.entityQuery);
  const varietyAliases = new Set(["gala", "soraya", "baltic rose", "azilit", "colombo", "impala"]);
  const requestedCropRaw =
    cleanString(intent.parameters.crop_alias) ||
    cleanString(intent.parameters.crop) ||
    cleanString(intent.parameters.product);
  const requestedVariety =
    cleanString(intent.parameters.variety) ||
    (requestedCropRaw && varietyAliases.has(requestedCropRaw.toLowerCase()) ? requestedCropRaw : null);
  const requestedCrop =
    requestedCropRaw && !varietyAliases.has(requestedCropRaw.toLowerCase()) ? requestedCropRaw : null;
  const resolvedAnswerType = cleanString(intent.parameters.output_type);
  const hasSingleRow = rows.length === 1;
  const explicitFieldRequest =
    cleanString(intent.parameters.field_id) ||
    cleanString(intent.parameters.field_number) ||
    cleanString(intent.parameters.field) ||
    cleanString(intent.parameters.field_alias) ||
    extractFieldReferenceFromText(intent.parameters.query) ||
    extractFieldReferenceFromText(intent.parameters.entityQuery);
  const shouldUpdateFieldMemory =
    Boolean(largestFieldCandidate) ||
    Boolean(explicitFieldRequest) ||
    outputTable.includes("field_card") ||
    (hasSingleRow && Boolean(nextFieldId || nextFieldLabel) && !outputTable.includes("operation"));
  const explicitWarehouseRequest = requestedWarehouse || cleanString(intent.parameters.warehouse_id);
  const focusPatch = (() => {
    const moduleName = cleanString(output?.source.module);
    const tableName = outputTable;
    const fieldCentricOutput =
      Boolean(explicitFieldRequest) &&
      (moduleName === "fields" ||
        tableName.includes("field_card") ||
        tableName.includes("field_timeline") ||
        tableName.includes("field_material"));
    if (fieldCentricOutput && (selectedFieldId || selectedFieldLabel || explicitFieldRequest)) {
      return buildFocusPatch({
        entityType: "field",
        entityId: selectedFieldId,
        entityLabel: explicitFieldRequest || selectedFieldLabel || selectedFieldId,
        module: moduleName,
        source: "tool_output",
      });
    }
    if (nextOperationId && (hasSingleRow || tableName.includes("operation"))) {
      return buildFocusPatch({
        entityType: "operation",
        entityId: nextOperationId,
        entityLabel: nextOperationLabel || nextOperationId,
        module: moduleName,
        source: "tool_output",
      });
    }
    if (nextTicketId && (hasSingleRow || tableName.includes("ticket"))) {
      return buildFocusPatch({
        entityType: "ticket",
        entityId: nextTicketId,
        entityLabel: nextTicketLabel || nextTicketId,
        module: moduleName,
        source: "tool_output",
      });
    }
    if (nextCropStructureId && (hasSingleRow || tableName.includes("crop_structure"))) {
      return buildFocusPatch({
        entityType: "crop_structure_line",
        entityId: nextCropStructureId,
        entityLabel: nextCropStructureLabel || nextCropStructureId,
        module: moduleName,
        source: "tool_output",
      });
    }
    if (largestFieldCandidate && (selectedFieldId || selectedFieldLabel)) {
      return buildFocusPatch({
        entityType: "field",
        entityId: selectedFieldId,
        entityLabel: selectedFieldLabel || selectedFieldId,
        module: moduleName,
        source: "tool_output",
      });
    }
    if (nextFieldId && (hasSingleRow || Boolean(explicitFieldRequest) || tableName.includes("field_card"))) {
      return buildFocusPatch({
        entityType: "field",
        entityId: nextFieldId,
        entityLabel: explicitFieldRequest || nextFieldLabel || nextFieldId,
        module: moduleName,
        source: "tool_output",
      });
    }
    if (nextWarehouseId && (hasSingleRow || Boolean(explicitWarehouseRequest) || tableName.includes("warehouse"))) {
      return buildFocusPatch({
        entityType: "warehouse",
        entityId: nextWarehouseId,
        entityLabel: nextWarehouseLabel || explicitWarehouseRequest || nextWarehouseId,
        module: moduleName,
        source: "tool_output",
      });
    }
    if (nextBatchId && (hasSingleRow || tableName.includes("batch"))) {
      return buildFocusPatch({
        entityType: "batch",
        entityId: nextBatchId,
        entityLabel: nextBatchLabel || nextBatchId,
        module: moduleName,
        source: "tool_output",
      });
    }
    if (explicitFieldRequest) {
      return buildFocusPatch({
        entityType: "field",
        entityLabel: explicitFieldRequest,
        module: moduleName,
        source: "user_text",
      });
    }
    if (explicitWarehouseRequest) {
      return buildFocusPatch({
        entityType: "warehouse",
        entityLabel: explicitWarehouseRequest,
        module: moduleName,
        source: "user_text",
      });
    }
    if (requestedCrop || requestedVariety) {
      return buildFocusPatch({
        entityType: "crop",
        entityLabel: requestedVariety || requestedCrop,
        module: moduleName,
        source: "user_text",
      });
    }
    return {};
  })();

  return {
    ...previous,
    ...focusPatch,
    lastIntent: intent.name,
    lastEntity: findValue(rows, ["id", "ticket_id", "field_id", "warehouse_id", "batch_id"]) || previous.lastEntity,
    lastCrop: nextCropName || requestedCrop || (outputTable.includes("field_card") ? null : previous.lastCrop),
    lastVariety: findValue(rows, ["variety_name"]) || requestedVariety || previous.lastVariety,
    lastBatchClass: findValue(rows, ["batch_class"]) || previous.lastBatchClass,
    lastWarehouse:
      findValue(rows, ["warehouse_name", "warehouse_from_name", "warehouse_to_name"]) ||
      requestedWarehouse ||
      previous.lastWarehouse,
    lastWarehouseId: nextWarehouseId || previous.lastWarehouseId,
    lastWarehouseLabel: nextWarehouseLabel || requestedWarehouse || previous.lastWarehouseLabel,
    lastOperation: nextOperationLabel || previous.lastOperation,
    lastOperationId: nextOperationId || previous.lastOperationId,
    lastOperationLabel: nextOperationLabel || previous.lastOperationLabel,
    lastTicket: nextTicketLabel || previous.lastTicket,
    lastTicketId: nextTicketId || previous.lastTicketId,
    lastTicketLabel: nextTicketLabel || previous.lastTicketLabel,
    lastCropStructureSection: nextCropStructureLabel || previous.lastCropStructureSection,
    lastCropStructureSectionId: nextCropStructureId || previous.lastCropStructureSectionId,
    lastCropStructureSectionLabel: nextCropStructureLabel || previous.lastCropStructureSectionLabel,
    lastBatch: nextBatchLabel || previous.lastBatch,
    lastBatchId: nextBatchId || previous.lastBatchId,
    lastBatchLabel: nextBatchLabel || previous.lastBatchLabel,
    lastField: shouldUpdateFieldMemory ? explicitFieldRequest || selectedFieldLabel || previous.lastField : previous.lastField,
    lastFieldId: shouldUpdateFieldMemory ? selectedFieldId || previous.lastFieldId : previous.lastFieldId,
    lastFieldLabel: shouldUpdateFieldMemory
      ? explicitFieldRequest || selectedFieldLabel || previous.lastFieldLabel
      : previous.lastFieldLabel,
    lastSeason: cleanString(seasonFromContext) || findValue(rows, ["season_year", "season"]) || previous.lastSeason,
    lastModule: cleanString(output?.source.module) || previous.lastModule,
    lastToolSource: cleanString(output?.source.tableOrView) || previous.lastToolSource,
    lastAnswerType: resolvedAnswerType || previous.lastAnswerType,
    lastResultContext: output?.title || previous.lastResultContext,
    lastWarehouseCount:
      intent.name === "warehouse_count" ? warehouseCount : previous.lastWarehouseCount,
    lastInventoryTotalKg:
      intent.name === "inventory_balance" ? Number(inventoryTotalKg.toFixed(3)) : previous.lastInventoryTotalKg,
    lastCropStructureAreaHa:
      intent.name === "crop_structure_area" ||
      intent.name === "crop_structure_overview" ||
      outputTable.includes("crop_structure")
        ? Number(cropAreaHa.toFixed(3))
        : previous.lastCropStructureAreaHa,
    lastFieldsAreaHa:
      intent.name === "field_total_area"
        ? outputTable.includes("land_bank_summary")
          ? Number(fieldsAreaHa.toFixed(3))
          : previous.lastFieldsAreaHa
        : intent.name === "fields_overview"
        ? Number(fieldsAreaHa.toFixed(3))
        : previous.lastFieldsAreaHa,
  };
}
