/**
 * A1: arithmetic for new treatment plans only. Never apply this to historical
 * rows on read. Units of dose and persisted quantity are independent.
 */
export const OPERATION_CALCULATION_VERSION = 2 as const;
export const PLAN_RATE_BASES = ["per_ha", "per_l_water", "per_l_solution", "per_1000_l_solution", "manual"] as const;
export type PlanRateBasis = (typeof PLAN_RATE_BASES)[number];
export type PlanDoseUnit = "l" | "ml" | "kg" | "g";
export type PlanQuantityUnit = "l" | "kg";
export type PlanCalculationMaterial = {
  product_id: string;
  dose_unit: PlanDoseUnit;
  quantity_unit: PlanQuantityUnit;
  rate_basis: PlanRateBasis;
  planned_rate: number | null;
  manual_quantity?: number | null;
  manual_reason?: string | null;
};
export type PlanCalculationInput = {
  area_ha: number;
  solution_rate_l_ha: number;
  materials: PlanCalculationMaterial[];
};
export type PlanCalculationResult = {
  total_solution_l: number;
  liquid_products_l: number;
  water_l: number;
  liquid_products_percent_vv: number;
  dry_products_g_l: number;
  materials: Array<PlanCalculationMaterial & {
    planned_quantity: number;
    exact_quantity: number;
    dose_quantity: number;
  }>;
};
export type PlanCalculationSnapshot = {
  calculation_version: 2;
  model: "additive-liquid-volumes";
  input: PlanCalculationInput;
  result: PlanCalculationResult;
  provenance: { source: "operation-plan"; calculated_at: string; actor_id: string | null };
};
export class PlanCalculationError extends Error {
  constructor(message: string) { super(message); this.name = "PlanCalculationError"; }
}
const UNIT_FACTOR: Record<PlanDoseUnit, number> = { l: 1, ml: 0.001, kg: 1, g: 0.001 };
export function quantityUnitForDose(unit: PlanDoseUnit): PlanQuantityUnit {
  return unit === "l" || unit === "ml" ? "l" : "kg";
}
export function strictPlanNumber(value: unknown, label: string, allowZero = false): number {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim()) ||
      (typeof value !== "number" && typeof value !== "string")) {
    throw new PlanCalculationError(`Укажите ${label}.`);
  }
  const text = typeof value === "string" ? value.trim().replace(",", ".") : value;
  if (typeof text === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    throw new PlanCalculationError(`Некорректное число: ${label}.`);
  }
  const n = Number(text);
  if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) {
    throw new PlanCalculationError(`Значение «${label}» должно быть ${allowZero ? "неотрицательным" : "больше нуля"}.`);
  }
  return n;
}
export function formatPlanRateUnit(unit: PlanDoseUnit, basis: PlanRateBasis): string {
  const u = { l: "л", ml: "мл", kg: "кг", g: "г" }[unit];
  const suffix = { per_ha: "/га", per_l_water: "/л воды", per_l_solution: "/л раствора", per_1000_l_solution: "/1000 л раствора", manual: "" }[basis];
  return u + suffix;
}
export function calculateOperationPlan(input: PlanCalculationInput): PlanCalculationResult {
  const area = strictPlanNumber(input.area_ha, "площадь");
  const solutionRate = strictPlanNumber(input.solution_rate_l_ha, "норму готового раствора");
  if (area >= 100000000 || solutionRate >= 100000000 || Number(area.toFixed(3)) !== area || Number(solutionRate.toFixed(4)) !== solutionRate) {
    throw new PlanCalculationError("Площадь: до 3 знаков после запятой; норма раствора: до 4. Значения должны помещаться в учётные поля.");
  }
  const volume = Number((area * solutionRate).toFixed(7));
  if (!Number.isFinite(volume) || volume >= 100000000) throw new PlanCalculationError("Объём раствора вне допустимого диапазона.");
  if (!Array.isArray(input.materials) || input.materials.length === 0 || input.materials.length > 100) throw new PlanCalculationError("Укажите от 1 до 100 препаратов.");
  const seen = new Set<string>();
  const rows = input.materials.map((m) => {
    if (!m.product_id || seen.has(m.product_id)) throw new PlanCalculationError("Препарат не выбран или повторяется.");
    seen.add(m.product_id);
    if (!Object.hasOwn(UNIT_FACTOR, m.dose_unit)) throw new PlanCalculationError("Неизвестная единица дозы.");
    if (m.quantity_unit !== quantityUnitForDose(m.dose_unit)) throw new PlanCalculationError("Массу нельзя переводить в объём без отдельного подтверждённого основания.");
    if (!(PLAN_RATE_BASES as readonly string[]).includes(m.rate_basis)) throw new PlanCalculationError("Выберите базу нормы.");
    const rate = m.rate_basis === "manual" ? null : strictPlanNumber(m.planned_rate, "норму препарата");
    const factor = UNIT_FACTOR[m.dose_unit];
    let fixed = 0;
    if (m.rate_basis === "manual") {
      if (!m.manual_reason?.trim()) throw new PlanCalculationError("Для ручного количества укажите причину.");
      fixed = strictPlanNumber(m.manual_quantity, "ручное количество");
    } else if (m.rate_basis === "per_ha") fixed = rate! * area * factor;
    else if (m.rate_basis === "per_l_solution") fixed = rate! * volume * factor;
    else if (m.rate_basis === "per_1000_l_solution") fixed = rate! * volume * factor / 1000;
    return { material: m, fixed, perWater: m.rate_basis === "per_l_water" ? rate! * factor : 0 };
  });
  const fixedLiquid = rows.reduce((sum, r) => sum + (r.material.quantity_unit === "l" ? r.fixed : 0), 0);
  const waterCoefficient = rows.reduce((sum, r) => sum + (r.material.quantity_unit === "l" ? r.perWater : 0), 0);
  if (!Number.isFinite(fixedLiquid) || fixedLiquid > volume + 1e-9 || !Number.isFinite(waterCoefficient)) {
    throw new PlanCalculationError("Сумма жидких препаратов превышает объём готового раствора.");
  }
  const exactWater = Math.max(volume - fixedLiquid, 0) / (1 + waterCoefficient);
  const materials = rows.map(({ material, fixed, perWater }) => {
    const exact = fixed + perWater * exactWater;
    if (!Number.isFinite(exact) || exact <= 0 || exact >= 100000000) throw new PlanCalculationError("Количество препарата вне допустимого диапазона.");
    const quantity = Math.round((exact + Number.EPSILON * exact) * 10000) / 10000;
    if (quantity <= 0 || quantity >= 100000000) throw new PlanCalculationError("Доза вне точности складского учёта (0,0001 л/кг) или диапазона. Уточните дозу или площадь; она не будет сохранена как ноль.");
    return { ...material, planned_quantity: quantity, exact_quantity: exact, dose_quantity: quantity / UNIT_FACTOR[material.dose_unit] };
  });
  const liquid = materials.reduce((sum, m) => sum + (m.quantity_unit === "l" ? Math.round(m.planned_quantity * 10000) : 0), 0) / 10000;
  if (liquid > volume + 1e-9) throw new PlanCalculationError("Округлённые количества превышают объём раствора.");
  const dryKg = materials.reduce((sum, m) => sum + (m.quantity_unit === "kg" ? Math.round(m.planned_quantity * 10000) : 0), 0) / 10000;
  return {
    total_solution_l: volume,
    liquid_products_l: liquid,
    water_l: Math.max(Number((volume - liquid).toFixed(7)), 0),
    liquid_products_percent_vv: liquid / volume * 100,
    dry_products_g_l: dryKg * 1000 / volume,
    materials,
  };
}
export function snapshotOperationPlan(input: PlanCalculationInput, actorId: string | null, calculatedAt: string): PlanCalculationSnapshot {
  return {
    calculation_version: OPERATION_CALCULATION_VERSION,
    model: "additive-liquid-volumes",
    input: structuredClone(input),
    result: calculateOperationPlan(input),
    provenance: { source: "operation-plan", calculated_at: calculatedAt, actor_id: actorId },
  };
}
