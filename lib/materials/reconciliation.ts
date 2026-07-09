export const MATERIAL_QTY_EPS = 0.000001;

export type MaterialReconciliationStatus =
  | "not_required"
  | "pending"
  | "prepared"
  | "issued"
  | "received"
  | "in_progress"
  | "return_required"
  | "shortage"
  | "return_declared"
  | "return_received"
  | "loss_review"
  | "reconciled"
  | "blocked"
  | "cancelled";

export type MaterialSubstitutionStatus = "none" | "proposed" | "approved" | "rejected";

export interface MaterialPackageInput {
  plannedQuantity: number;
  packageSize?: number | null;
}

export interface MaterialPackagePlan {
  packageCount: number | null;
  preparedQuantity: number;
}

export interface MaterialReconciliationInput {
  plannedQuantity: number;
  plannedAreaHa?: number | null;
  actualCompletedAreaHa?: number | null;
  issuedQuantity?: number | null;
  consumedQuantity?: number | null;
  returnedQuantity?: number | null;
  returnReceivedQuantity?: number | null;
  lossQuantity?: number | null;
  packageSize?: number | null;
  substitutionStatus?: MaterialSubstitutionStatus | string | null;
  plannedProductId?: string | null;
  actualProductId?: string | null;
}

export interface MaterialReconciliationResult {
  packageCount: number | null;
  preparedQuantity: number;
  expectedConsumedQuantity: number;
  expectedReturnQuantity: number;
  shortageQuantity: number;
  reconciliationStatus: MaterialReconciliationStatus;
  closeBlockingReasons: string[];
  canClose: boolean;
}

export function toMaterialQuantity(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function roundMaterialQuantity(value: number, precision = 4): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(precision));
}

export function calculatePackagePlan(input: MaterialPackageInput): MaterialPackagePlan {
  const plannedQuantity = Math.max(toMaterialQuantity(input.plannedQuantity), 0);
  const packageSize = input.packageSize == null ? null : toMaterialQuantity(input.packageSize);

  if (!packageSize || packageSize <= MATERIAL_QTY_EPS) {
    return {
      packageCount: null,
      preparedQuantity: roundMaterialQuantity(plannedQuantity),
    };
  }

  const packageCount = Math.ceil(plannedQuantity / packageSize);
  return {
    packageCount,
    preparedQuantity: roundMaterialQuantity(packageCount * packageSize),
  };
}

export function calculateMaterialReconciliation(
  input: MaterialReconciliationInput
): MaterialReconciliationResult {
  const plannedQuantity = Math.max(toMaterialQuantity(input.plannedQuantity), 0);
  const packagePlan = calculatePackagePlan({
    plannedQuantity,
    packageSize: input.packageSize,
  });
  const issuedQuantity = Math.max(toMaterialQuantity(input.issuedQuantity), 0);
  const consumedKnown = input.consumedQuantity !== null && input.consumedQuantity !== undefined;
  const returnedKnown = input.returnedQuantity !== null && input.returnedQuantity !== undefined;
  const lossKnown = input.lossQuantity !== null && input.lossQuantity !== undefined;
  const consumedQuantity = consumedKnown ? Math.max(toMaterialQuantity(input.consumedQuantity), 0) : null;
  const returnedQuantity = returnedKnown ? Math.max(toMaterialQuantity(input.returnedQuantity), 0) : null;
  const lossQuantity = lossKnown ? Math.max(toMaterialQuantity(input.lossQuantity), 0) : null;
  const returnReceivedQuantity = Math.max(toMaterialQuantity(input.returnReceivedQuantity), 0);
  const plannedAreaHa = Math.max(toMaterialQuantity(input.plannedAreaHa), 0);
  const actualCompletedAreaHa =
    input.actualCompletedAreaHa === null || input.actualCompletedAreaHa === undefined
      ? plannedAreaHa
      : Math.max(toMaterialQuantity(input.actualCompletedAreaHa), 0);
  const expectedConsumedQuantity =
    plannedAreaHa > MATERIAL_QTY_EPS
      ? roundMaterialQuantity((plannedQuantity / plannedAreaHa) * actualCompletedAreaHa)
      : roundMaterialQuantity(plannedQuantity);
  const expectedReturnQuantity = roundMaterialQuantity(Math.max(issuedQuantity - expectedConsumedQuantity, 0));
  const shortageQuantity = roundMaterialQuantity(Math.max(expectedConsumedQuantity - issuedQuantity, 0));
  const plannedProductId = String(input.plannedProductId || "").trim();
  const actualProductId = String(input.actualProductId || "").trim();
  const substitutionStatus = String(input.substitutionStatus || "none");
  const hasSubstitution = Boolean(plannedProductId && actualProductId && plannedProductId !== actualProductId);

  const closeBlockingReasons: string[] = [];

  if (plannedQuantity <= MATERIAL_QTY_EPS && issuedQuantity <= MATERIAL_QTY_EPS) {
    return {
      packageCount: packagePlan.packageCount,
      preparedQuantity: packagePlan.preparedQuantity,
      expectedConsumedQuantity: 0,
      expectedReturnQuantity: 0,
      shortageQuantity: 0,
      reconciliationStatus: "not_required",
      closeBlockingReasons: [],
      canClose: true,
    };
  }

  if (hasSubstitution && substitutionStatus !== "approved") {
    closeBlockingReasons.push("Material substitution must be approved by agronomist before closing.");
  }

  if (issuedQuantity <= MATERIAL_QTY_EPS) {
    closeBlockingReasons.push("Material was planned but not issued by warehouse.");
    return {
      packageCount: packagePlan.packageCount,
      preparedQuantity: packagePlan.preparedQuantity,
      expectedConsumedQuantity,
      expectedReturnQuantity,
      shortageQuantity: expectedConsumedQuantity,
      reconciliationStatus: "pending",
      closeBlockingReasons,
      canClose: false,
    };
  }

  if (!consumedKnown || !returnedKnown) {
    closeBlockingReasons.push("Actual consumed and returned quantities are required before close.");
  }

  const consumed = consumedQuantity ?? 0;
  const returned = returnedQuantity ?? 0;
  const loss = lossQuantity ?? 0;
  const actualTotal = roundMaterialQuantity(consumed + returned + loss);

  if (returned + loss > issuedQuantity + MATERIAL_QTY_EPS) {
    closeBlockingReasons.push("Returned quantity plus loss cannot exceed issued quantity.");
  }

  if (Math.abs(actualTotal - issuedQuantity) > MATERIAL_QTY_EPS) {
    closeBlockingReasons.push("Consumed + returned + loss must equal issued quantity before close.");
  }

  if (shortageQuantity > MATERIAL_QTY_EPS) {
    closeBlockingReasons.push("Actual area requires more material than warehouse issued.");
  }

  if (expectedReturnQuantity > MATERIAL_QTY_EPS && returned + loss < expectedReturnQuantity - MATERIAL_QTY_EPS) {
    closeBlockingReasons.push("Expected return is not declared yet.");
  }

  if (returned > MATERIAL_QTY_EPS && returnReceivedQuantity + MATERIAL_QTY_EPS < returned) {
    closeBlockingReasons.push("Warehouse has not accepted the declared return yet.");
  }

  let reconciliationStatus: MaterialReconciliationStatus = "pending";
  if (closeBlockingReasons.length > 0) {
    if (shortageQuantity > MATERIAL_QTY_EPS) reconciliationStatus = "shortage";
    else if (returned > MATERIAL_QTY_EPS && returnReceivedQuantity + MATERIAL_QTY_EPS < returned) reconciliationStatus = "return_declared";
    else if (expectedReturnQuantity > MATERIAL_QTY_EPS && returned + loss < expectedReturnQuantity - MATERIAL_QTY_EPS) reconciliationStatus = "return_required";
    else reconciliationStatus = "blocked";
  } else if (returned > MATERIAL_QTY_EPS && returnReceivedQuantity >= returned - MATERIAL_QTY_EPS) {
    reconciliationStatus = "return_received";
  } else {
    reconciliationStatus = "reconciled";
  }

  return {
    packageCount: packagePlan.packageCount,
    preparedQuantity: packagePlan.preparedQuantity,
    expectedConsumedQuantity,
    expectedReturnQuantity,
    shortageQuantity,
    reconciliationStatus,
    closeBlockingReasons,
    canClose: closeBlockingReasons.length === 0,
  };
}
