import type { AssistantIntent, AssistantSessionState, AssistantToolOutput } from "@/lib/assistant/engine/types";

export const EMPTY_ASSISTANT_SESSION_STATE: AssistantSessionState = {
  lastEntity: null,
  lastCrop: null,
  lastVariety: null,
  lastBatchClass: null,
  lastWarehouse: null,
  lastField: null,
  lastSeason: null,
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
    lastField: cleanString(input?.lastField),
    lastSeason: cleanString(input?.lastSeason),
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
      if (value) return value;
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
  const inventoryTotalKg = rows.reduce((acc, row) => acc + asNumber(row.quantity), 0);
  const cropAreaHa = rows.reduce((acc, row) => acc + asNumber(row.area_ha), 0);
  const fieldsAreaHa = rows.reduce((acc, row) => acc + asNumber(row.area_ha), 0);
  const warehouseCount =
    rows.length && Number.isFinite(Number(rows[0]?.warehouses_total))
      ? Number(rows[0]?.warehouses_total)
      : rows.length;

  return {
    ...previous,
    lastIntent: intent.name,
    lastEntity: findValue(rows, ["id", "ticket_id", "field_id", "warehouse_id", "batch_id"]) || previous.lastEntity,
    lastCrop: findValue(rows, ["crop_name", "product_name"]) || previous.lastCrop,
    lastVariety: findValue(rows, ["variety_name"]) || previous.lastVariety,
    lastBatchClass: findValue(rows, ["batch_class"]) || previous.lastBatchClass,
    lastWarehouse: findValue(rows, ["warehouse_name", "warehouse_from_name", "warehouse_to_name"]) || previous.lastWarehouse,
    lastField: findValue(rows, ["field_name"]) || previous.lastField,
    lastSeason: cleanString(seasonFromContext) || findValue(rows, ["season_year", "season"]) || previous.lastSeason,
    lastResultContext: output?.title || previous.lastResultContext,
    lastWarehouseCount:
      intent.name === "warehouse_count" ? warehouseCount : previous.lastWarehouseCount,
    lastInventoryTotalKg:
      intent.name === "inventory_balance" ? Number(inventoryTotalKg.toFixed(3)) : previous.lastInventoryTotalKg,
    lastCropStructureAreaHa:
      intent.name === "crop_structure_area" || intent.name === "crop_structure_overview"
        ? Number(cropAreaHa.toFixed(3))
        : previous.lastCropStructureAreaHa,
    lastFieldsAreaHa:
      intent.name === "field_total_area" || intent.name === "fields_overview"
        ? Number(fieldsAreaHa.toFixed(3))
        : previous.lastFieldsAreaHa,
  };
}
