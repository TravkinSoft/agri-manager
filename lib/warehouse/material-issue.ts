export const MATERIAL_EPSILON = 0.000001;

export type StockLotInput = {
  batchId?: string | null;
  batchIdText?: string | null;
  batchClass: string;
  batchLabel: string;
  availableQuantity: number;
};

export type PreparedStockAllocation = {
  batchId: string | null;
  batchIdText: string | null;
  batchClass: string;
  batchLabel: string;
  quantity: number;
};

export type MaterialIssueValidation = {
  preparedQuantity: number;
  expectedReturnQuantity: number;
  deficitQuantity: number;
  valid: boolean;
  errors: string[];
};

export type MaterialReconciliationResult = {
  valid: boolean;
  difference: number;
};

export function roundMaterialQuantity(value: number): number {
  return Number(value.toFixed(4));
}

export function normalizeMaterialUnit(value: unknown): string {
  const unit = String(value || "").trim().toLowerCase();
  if (["kg", "кг"].includes(unit)) return "kg";
  if (["g", "г"].includes(unit)) return "g";
  if (["l", "л", "liter", "litre"].includes(unit)) return "l";
  if (["ml", "мл"].includes(unit)) return "ml";
  if (["t", "т"].includes(unit)) return "t";
  if (["pcs", "pc", "шт", "шт."].includes(unit)) return "pcs";
  return unit;
}

export function calculateExpectedReturn(
  preparedOrIssuedQuantity: number,
  plannedQuantity: number
): number {
  return roundMaterialQuantity(
    Math.max(preparedOrIssuedQuantity - plannedQuantity, 0)
  );
}

export function calculateMaterialReconciliation(params: {
  issuedQuantity: number;
  consumedQuantity: number;
  returnedQuantity: number;
  lossQuantity: number;
}): MaterialReconciliationResult {
  const difference = roundMaterialQuantity(
    params.issuedQuantity -
      params.consumedQuantity -
      params.returnedQuantity -
      params.lossQuantity
  );
  return {
    valid: Math.abs(difference) <= MATERIAL_EPSILON,
    difference,
  };
}

export function validateMaterialIssue(params: {
  plannedQuantity: number;
  preparedQuantity: number;
  availableQuantity: number;
  unit: string;
}): MaterialIssueValidation {
  const prepared = roundMaterialQuantity(
    Number.isFinite(params.preparedQuantity) ? params.preparedQuantity : 0
  );
  const available = roundMaterialQuantity(
    Math.max(Number(params.availableQuantity) || 0, 0)
  );
  const unit = normalizeMaterialUnit(params.unit);
  const deficit = roundMaterialQuantity(Math.max(prepared - available, 0));
  const errors: string[] = [];

  if (prepared <= MATERIAL_EPSILON) {
    errors.push("Количество к выдаче должно быть больше нуля.");
  }
  if (deficit > MATERIAL_EPSILON) {
    errors.push(
      `Доступно ${available} ${unit}. К выдаче указано ${prepared} ${unit}. Не хватает ${deficit} ${unit}.`
    );
  }

  return {
    preparedQuantity: prepared,
    expectedReturnQuantity: calculateExpectedReturn(
      prepared,
      params.plannedQuantity
    ),
    deficitQuantity: deficit,
    valid: errors.length === 0,
    errors,
  };
}

export function allocateQuantityAcrossLots(params: {
  quantity: number;
  lots: StockLotInput[];
}): {
  allocations: PreparedStockAllocation[];
  availableQuantity: number;
  deficitQuantity: number;
} {
  const requested = roundMaterialQuantity(
    Math.max(Number(params.quantity) || 0, 0)
  );
  let remaining = requested;
  let availableQuantity = 0;
  const allocations: PreparedStockAllocation[] = [];

  for (const lot of params.lots) {
    const available = roundMaterialQuantity(
      Math.max(Number(lot.availableQuantity) || 0, 0)
    );
    availableQuantity += available;
    if (remaining <= MATERIAL_EPSILON || available <= MATERIAL_EPSILON) {
      continue;
    }
    const quantity = roundMaterialQuantity(Math.min(remaining, available));
    allocations.push({
      batchId: lot.batchId || null,
      batchIdText: lot.batchIdText || lot.batchId || null,
      batchClass: lot.batchClass,
      batchLabel: lot.batchLabel,
      quantity,
    });
    remaining = roundMaterialQuantity(remaining - quantity);
  }

  return {
    allocations,
    availableQuantity: roundMaterialQuantity(availableQuantity),
    deficitQuantity: roundMaterialQuantity(Math.max(remaining, 0)),
  };
}

export function materialIssueStatusLabel(params: {
  preparedQuantity: number;
  availableQuantity: number;
  expectedReturnQuantity: number;
  unit: string;
}): string {
  const deficit = roundMaterialQuantity(
    params.preparedQuantity - params.availableQuantity
  );
  if (deficit > MATERIAL_EPSILON) {
    return `Не хватает ${deficit} ${params.unit}`;
  }
  if (params.expectedReturnQuantity > MATERIAL_EPSILON) {
    return `Ожидаемый возврат: ${roundMaterialQuantity(
      params.expectedReturnQuantity
    )} ${params.unit}`;
  }
  return "Готово к выдаче";
}
