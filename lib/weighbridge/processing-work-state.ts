import type { BatchTransformationRow } from "@/lib/services/processing";

export const PROCESSING_MASS_EPSILON_KG = 0.001;

export type ProcessingWorkState = "active" | "ready" | "reconciliation" | "history" | "empty";

export function processingMassSnapshot(item: BatchTransformationRow) {
  const inputTotalKg = Number(item.input_total_kg || 0);
  const hasCanonicalInput = inputTotalKg > 0;
  const inputKg = hasCanonicalInput
    ? inputTotalKg
    : Number(item.input_weight_kg || 0);
  const outputKg = Number(item.main_output_kg || 0)
    + Number(item.byproduct_kg || 0)
    + Number(item.stock_waste_kg || 0);
  const lossKg = Number(item.approved_process_loss_kg || 0) + Number(item.moisture_loss_kg || 0);
  const explicitBalanceDeltaKg = Number(item.balance_delta_kg);
  const rawBalanceDeltaKg = Number.isFinite(explicitBalanceDeltaKg)
    ? explicitBalanceDeltaKg
    : inputKg - outputKg - lossKg;
  const balanceDeltaKg = Number(rawBalanceDeltaKg.toFixed(3));
  const unallocatedKg = Math.max(balanceDeltaKg, 0);
  const isDrying = item.transformation_type === "drying"
    || ["MECHANICAL_DRYING", "NATURAL_DRYING"].includes(String(item.processing_method || ""));
  const hasRequiredDryingMoisture = !isDrying || (
    item.input_moisture_percent != null
    && item.output_moisture_percent != null
    && Number(item.output_moisture_percent) < 100
  );
  return {
    inputKg,
    outputKg,
    lossKg,
    balanceDeltaKg,
    unallocatedKg,
    hasCanonicalInput,
    hasRequiredDryingMoisture,
  };
}

export function processingWorkState(item: BatchTransformationRow): ProcessingWorkState {
  if (item.status === "voided") return "empty";

  const mass = processingMassSnapshot(item);
  const hasMass = [mass.inputKg, mass.outputKg, mass.lossKg]
    .some((value) => Math.abs(value) > 0);
  if (!hasMass) return "empty";

  if (item.processing_state === "processing_closed") return "history";
  if (item.processing_state === "processing_pending_outputs") {
    return !mass.hasCanonicalInput
      || !mass.hasRequiredDryingMoisture
      || Math.abs(mass.balanceDeltaKg) > PROCESSING_MASS_EPSILON_KG
      ? "reconciliation"
      : "ready";
  }
  return "active";
}

export function isOpenProcessingWorkItem(item: BatchTransformationRow) {
  const state = processingWorkState(item);
  return state === "active" || state === "ready" || state === "reconciliation";
}

const processingStartedAt = (item: BatchTransformationRow) => {
  const value = new Date(item.started_at || item.created_at || 0).getTime();
  return Number.isFinite(value) ? value : 0;
};

const currentCycleRank = (item: BatchTransformationRow) =>
  item.processing_state === "in_processing" ? 0 : 1;

/**
 * The weighbridge shows one current product per physical processing object.
 * Older still-open cycles remain selectable by the ticket/output contracts, but
 * are moved out of the primary card into the compact history section.
 */
export function selectPrimaryProcessingItems(items: BatchTransformationRow[]) {
  const byWarehouse = new Map<string, BatchTransformationRow[]>();
  for (const item of items) {
    if (!isOpenProcessingWorkItem(item)) continue;
    const key = item.node_warehouse_id || `row:${item.id}`;
    const rows = byWarehouse.get(key) || [];
    rows.push(item);
    byWarehouse.set(key, rows);
  }

  const primaryItems: BatchTransformationRow[] = [];
  const previousItems: BatchTransformationRow[] = [];
  for (const rows of Array.from(byWarehouse.values())) {
    rows.sort((left, right) =>
      currentCycleRank(left) - currentCycleRank(right)
      || processingStartedAt(right) - processingStartedAt(left)
      || right.id.localeCompare(left.id)
    );
    primaryItems.push(rows[0]);
    previousItems.push(...rows.slice(1));
  }

  primaryItems.sort((left, right) => processingStartedAt(right) - processingStartedAt(left));
  previousItems.sort((left, right) => processingStartedAt(right) - processingStartedAt(left));
  return { primaryItems, previousItems };
}
