import type { HarvestBatchSummary } from "../types/weighbridge";

export const formatMoisturePercent = (value: number) =>
  `${value.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

// Presentation only: use the existing warehouse accounting, never source-trip totals.
export function warehouseFlowSummary(batch: HarvestBatchSummary) {
  const adjustment = batch.otherAdjustmentKg || 0;
  const incomingKg = batch.receivedKg + (batch.processingOutputKg || 0)
    + (batch.transferInKg || 0) + Math.max(adjustment, 0);
  const outgoingKg = (batch.removedKg || 0) + (batch.processingInputKg || 0)
    + (batch.transferOutKg || 0) + (batch.writeoffKg || 0)
    + (batch.issueKg || 0) + Math.max(-adjustment, 0);
  return { incomingKg, outgoingKg, expectedKg: Number((incomingKg - outgoingKg).toFixed(3)) };
}
