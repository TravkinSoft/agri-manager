export const MATERIAL_EPSILON = 0.000001;

export type MaterialIssueMode = "whole_package" | "measured";
export type PackageSource = "batch" | "product" | "manual" | "measured";

export type PackageAllocationInput = {
  batchId?: string | null;
  batchIdText?: string | null;
  batchClass: string;
  batchLabel: string;
  issueMode: MaterialIssueMode;
  quantity: number;
  availableQuantity: number;
  packageSize?: number | null;
  packageCount?: number | null;
  packageUnit?: string | null;
  packageSource: PackageSource;
  manualPackageReason?: string | null;
};

export type PackageAwareItemResult = {
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

export function calculateWholePackageQuantity(
  plannedQuantity: number,
  packageSize: number
): { packageCount: number; preparedQuantity: number } {
  if (!Number.isFinite(plannedQuantity) || plannedQuantity < 0) {
    throw new Error("Planned quantity must be zero or positive");
  }
  if (!Number.isFinite(packageSize) || packageSize <= 0) {
    throw new Error("Package size must be positive");
  }
  const packageCount = Math.ceil(plannedQuantity / packageSize);
  return {
    packageCount,
    preparedQuantity: roundMaterialQuantity(packageCount * packageSize),
  };
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

export function validatePackageAwareItem(params: {
  plannedQuantity: number;
  itemUnit: string;
  allocations: PackageAllocationInput[];
}): PackageAwareItemResult {
  const errors: string[] = [];
  const itemUnit = normalizeMaterialUnit(params.itemUnit);
  let preparedQuantity = 0;
  let totalAvailable = 0;

  if (!params.allocations.length) {
    errors.push("Выберите хотя бы одну партию.");
  }

  params.allocations.forEach((allocation, index) => {
    const prefix = `Партия ${index + 1}`;
    const quantity = Number(allocation.quantity);
    const available = Math.max(Number(allocation.availableQuantity) || 0, 0);
    preparedQuantity += Number.isFinite(quantity) ? quantity : 0;
    totalAvailable += available;

    if (!allocation.batchLabel.trim()) {
      errors.push(`${prefix}: партия не выбрана.`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`${prefix}: подготовленное количество должно быть больше нуля.`);
    }
    if (quantity > available + MATERIAL_EPSILON) {
      errors.push(
        `${prefix}: не хватает ${roundMaterialQuantity(quantity - available)} ${itemUnit}.`
      );
    }

    if (allocation.issueMode === "whole_package") {
      const packageSize = Number(allocation.packageSize);
      const packageCount = Number(allocation.packageCount);
      const packageUnit = normalizeMaterialUnit(allocation.packageUnit);
      if (!Number.isFinite(packageSize) || packageSize <= 0) {
        errors.push(`${prefix}: укажите размер упаковки.`);
      }
      if (!Number.isInteger(packageCount) || packageCount <= 0) {
        errors.push(`${prefix}: количество упаковок должно быть целым.`);
      }
      if (packageUnit !== itemUnit) {
        errors.push(`${prefix}: единица упаковки не совпадает с единицей заявки.`);
      }
      if (
        Number.isFinite(packageSize) &&
        Number.isInteger(packageCount) &&
        Math.abs(quantity - packageSize * packageCount) > MATERIAL_EPSILON
      ) {
        errors.push(`${prefix}: количество не совпадает с целыми упаковками.`);
      }
      if (
        allocation.packageSource === "manual" &&
        !String(allocation.manualPackageReason || "").trim()
      ) {
        errors.push(`${prefix}: объясните ручной размер упаковки.`);
      }
    }
  });

  const prepared = roundMaterialQuantity(preparedQuantity);
  const deficit = roundMaterialQuantity(Math.max(prepared - totalAvailable, 0));
  return {
    preparedQuantity: prepared,
    expectedReturnQuantity: calculateExpectedReturn(
      prepared,
      params.plannedQuantity
    ),
    deficitQuantity: deficit,
    valid: errors.length === 0 && prepared > MATERIAL_EPSILON,
    errors,
  };
}

export function packageStatusLabel(params: {
  plannedQuantity: number;
  preparedQuantity: number;
  availableQuantity: number;
  expectedReturnQuantity: number;
  issueModes: MaterialIssueMode[];
  unit: string;
}): string {
  const deficit = params.preparedQuantity - params.availableQuantity;
  if (deficit > MATERIAL_EPSILON) {
    return `Не хватает ${roundMaterialQuantity(deficit)} ${params.unit}`;
  }
  if (
    params.expectedReturnQuantity > MATERIAL_EPSILON &&
    params.issueModes.includes("whole_package")
  ) {
    return `Ожидается возврат ${roundMaterialQuantity(
      params.expectedReturnQuantity
    )} ${params.unit}`;
  }
  if (params.issueModes.includes("whole_package")) return "Целая упаковка";
  if (
    Math.abs(params.preparedQuantity - params.plannedQuantity) <=
    MATERIAL_EPSILON
  ) {
    return "По плану";
  }
  return "Отмеренное количество";
}
