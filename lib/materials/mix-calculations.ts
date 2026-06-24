export type MixRateBasis = "per_ha" | "per_t_solution" | "per_1000_l_solution" | "per_l_water";

export type MixUnit = "l" | "ml" | "kg" | "g" | "pcs";

export type MixMaterialInput = {
  productId?: string | null;
  rate: number;
  rateUnit: string;
  rateBasis: MixRateBasis | string;
};

export type PlannedMaterialResult = {
  plannedQuantity: number | null;
  plannedUnit: MixUnit;
  error: string | null;
};

export type TankMixResult = {
  totalSolutionL: number | null;
  liquidMaterialsL: number;
  dryMaterials: Array<{ quantity: number; unit: "kg" | "g" }>;
  waterL: number | null;
  concentrationPercent: number | null;
  error: string | null;
  materials: PlannedMaterialResult[];
};

const VALID_RATE_BASIS = new Set<MixRateBasis>(["per_ha", "per_t_solution", "per_1000_l_solution", "per_l_water"]);
const PER_L_WATER_ALLOWED_UNITS = new Set<MixUnit>(["l", "ml", "kg", "g"]);

export function toFixedNumber(value: number | null | undefined, precision = 4): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(Number(value).toFixed(precision));
}

export function numeric(value: unknown, fallback = 0): number {
  const next = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(next) ? next : fallback;
}

export function normalizeRateBasis(value: unknown): MixRateBasis {
  const next = String(value || "").trim() as MixRateBasis;
  return VALID_RATE_BASIS.has(next) ? next : "per_ha";
}

export function normalizeMixUnit(value: unknown): MixUnit {
  const unit = String(value || "").trim().toLowerCase();
  if (["l", "lt", "liter", "litre", "л", "л."].includes(unit)) return "l";
  if (["ml", "мл", "мл."].includes(unit)) return "ml";
  if (["kg", "кг", "кг."].includes(unit)) return "kg";
  if (["g", "гр", "г", "г."].includes(unit)) return "g";
  if (["pcs", "pc", "piece", "pieces", "шт", "шт."].includes(unit)) return "pcs";
  return "kg";
}

export function isLiquidUnit(unit: string): boolean {
  const normalized = normalizeMixUnit(unit);
  return normalized === "l" || normalized === "ml";
}

export function convertLiquidToLiters(quantity: number | null | undefined, unit: string): number {
  const normalized = normalizeMixUnit(unit);
  const value = numeric(quantity);
  if (normalized === "l") return value;
  if (normalized === "ml") return value / 1000;
  return 0;
}

export function calculateMaterialPlannedQuantity(input: {
  rate: number;
  rateUnit: string;
  rateBasis: string;
  areaHa: number;
  solutionRateLHa?: number | null;
}): PlannedMaterialResult {
  const rate = numeric(input.rate);
  const rateUnit = normalizeMixUnit(input.rateUnit);
  const rateBasis = normalizeRateBasis(input.rateBasis);
  const areaHa = numeric(input.areaHa);
  const solutionRateLHa = input.solutionRateLHa === null || input.solutionRateLHa === undefined ? null : numeric(input.solutionRateLHa);
  const totalSolutionL = solutionRateLHa && areaHa > 0 ? solutionRateLHa * areaHa : null;

  if (rate < 0) {
    return { plannedQuantity: null, plannedUnit: rateUnit, error: "Норма не может быть отрицательной." };
  }

  if (rateBasis === "per_l_water" && !PER_L_WATER_ALLOWED_UNITS.has(rateUnit)) {
    return { plannedQuantity: null, plannedUnit: rateUnit, error: "Для нормы на литр воды нельзя использовать единицу шт." };
  }

  if (rateBasis === "per_ha") {
    if (areaHa <= 0) return { plannedQuantity: null, plannedUnit: rateUnit, error: "Нет площади для расчёта нормы на гектар." };
    return { plannedQuantity: toFixedNumber(rate * areaHa), plannedUnit: rateUnit, error: null };
  }

  if (!totalSolutionL || totalSolutionL <= 0) {
    return { plannedQuantity: null, plannedUnit: rateUnit, error: "Укажите норму рабочего раствора л/га." };
  }

  if (rateBasis === "per_1000_l_solution" || rateBasis === "per_t_solution") {
    return { plannedQuantity: toFixedNumber((rate * totalSolutionL) / 1000), plannedUnit: rateUnit, error: null };
  }

  if (rateBasis === "per_l_water") {
    return { plannedQuantity: toFixedNumber(rate * totalSolutionL), plannedUnit: rateUnit, error: null };
  }

  return { plannedQuantity: null, plannedUnit: rateUnit, error: "Неизвестная база нормы." };
}

export function calculateTankMix(input: {
  areaHa: number;
  solutionRateLHa?: number | null;
  materials: MixMaterialInput[];
}): TankMixResult {
  const areaHa = numeric(input.areaHa);
  const solutionRateLHa = input.solutionRateLHa === null || input.solutionRateLHa === undefined ? null : numeric(input.solutionRateLHa);
  const totalSolutionL = solutionRateLHa && areaHa > 0 ? toFixedNumber(solutionRateLHa * areaHa, 3) : null;
  const materials = input.materials.map((material) =>
    calculateMaterialPlannedQuantity({
      rate: material.rate,
      rateUnit: material.rateUnit,
      rateBasis: material.rateBasis,
      areaHa,
      solutionRateLHa,
    })
  );
  const firstError = materials.find((material) => material.error)?.error || null;
  const liquidMaterialsL = toFixedNumber(
    materials.reduce((sum, material) => sum + convertLiquidToLiters(material.plannedQuantity, material.plannedUnit), 0),
    3
  ) || 0;
  const dryMaterials = materials
    .filter((material) => material.plannedQuantity !== null && (material.plannedUnit === "kg" || material.plannedUnit === "g"))
    .map((material) => ({ quantity: Number(material.plannedQuantity), unit: material.plannedUnit as "kg" | "g" }));
  const waterL = totalSolutionL === null ? null : toFixedNumber(totalSolutionL - liquidMaterialsL, 3);
  const overfilled = waterL !== null && waterL < 0;
  const concentrationPercent =
    totalSolutionL && totalSolutionL > 0 ? toFixedNumber((liquidMaterialsL / totalSolutionL) * 100, 2) : null;

  return {
    totalSolutionL,
    liquidMaterialsL,
    dryMaterials,
    waterL,
    concentrationPercent,
    error: overfilled ? "Сумма препаратов превышает объём рабочего раствора" : firstError,
    materials,
  };
}

