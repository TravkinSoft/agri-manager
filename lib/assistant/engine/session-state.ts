import type { AssistantIntent, AssistantSessionState, AssistantToolOutput } from "@/lib/assistant/engine/types";

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
  };
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

  return {
    ...previous,
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
    lastField: findValue(rows, ["field_name"]) || previous.lastField,
    lastFieldId: nextFieldId || previous.lastFieldId,
    lastFieldLabel: nextFieldLabel || previous.lastFieldLabel,
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
