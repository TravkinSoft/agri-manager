export type HarvestBatchMetrics = {
  receivedKg: number;
  removedKg: number;
  cleanMassKg: number;
  impurityPercent: number;
  grossYieldTPerHa: number | null;
  cleanYieldTPerHa: number | null;
};

const rounded = (value: number, precision = 6) => {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export function calculateHarvestBatchMetrics(
  receivedKgInput: unknown,
  removedKgInput: unknown,
  harvestedAreaHaInput?: unknown
): HarvestBatchMetrics {
  const receivedKg = Math.max(0, Number(receivedKgInput) || 0);
  const removedKg = Math.max(0, Number(removedKgInput) || 0);
  const harvestedAreaHa = Math.max(0, Number(harvestedAreaHaInput) || 0);
  const cleanMassKg = Math.max(0, receivedKg - removedKg);

  return {
    receivedKg: rounded(receivedKg),
    removedKg: rounded(removedKg),
    cleanMassKg: rounded(cleanMassKg),
    impurityPercent: receivedKg > 0 ? rounded((removedKg / receivedKg) * 100) : 0,
    grossYieldTPerHa: harvestedAreaHa > 0 ? rounded(receivedKg / 1000 / harvestedAreaHa) : null,
    cleanYieldTPerHa: harvestedAreaHa > 0 ? rounded(cleanMassKg / 1000 / harvestedAreaHa) : null,
  };
}
