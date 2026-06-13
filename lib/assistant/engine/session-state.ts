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
      return {
        ...previous,
        ...buildFocusPatch({
          entityType,
          entityId: entity.id,
          entityLabel: entity.label || entity.id,
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
  const nextFieldId = findValue(rows, ["field_id", "fieldId"]);
  const nextFieldLabel = findValue(rows, ["field_name", "field_label"]);
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
    cleanString(intent.parameters.field_alias);
  const explicitWarehouseRequest = requestedWarehouse || cleanString(intent.parameters.warehouse_id);
  const focusPatch = (() => {
    const moduleName = cleanString(output?.source.module);
    const tableName = outputTable;
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
    if (nextFieldId && (hasSingleRow || Boolean(explicitFieldRequest) || tableName.includes("field_card"))) {
      return buildFocusPatch({
        entityType: "field",
        entityId: nextFieldId,
        entityLabel: nextFieldLabel || explicitFieldRequest || nextFieldId,
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
    lastCrop: findValue(rows, ["crop_name", "product_name"]) || requestedCrop || previous.lastCrop,
    lastVariety: findValue(rows, ["variety_name"]) || requestedVariety || previous.lastVariety,
    lastBatchClass: findValue(rows, ["batch_class"]) || previous.lastBatchClass,
    lastWarehouse:
      findValue(rows, ["warehouse_name", "warehouse_from_name", "warehouse_to_name"]) ||
      requestedWarehouse ||
      previous.lastWarehouse,
    lastWarehouseId: nextWarehouseId || previous.lastWarehouseId,
    lastWarehouseLabel: nextWarehouseLabel || requestedWarehouse || previous.lastWarehouseLabel,
    lastField: findValue(rows, ["field_name"]) || explicitFieldRequest || previous.lastField,
    lastFieldId: nextFieldId || previous.lastFieldId,
    lastFieldLabel: nextFieldLabel || explicitFieldRequest || previous.lastFieldLabel,
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
