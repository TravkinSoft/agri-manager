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
