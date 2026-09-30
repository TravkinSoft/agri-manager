import { PlanCalculationError, strictPlanNumber, type PlanCalculationResult } from "./operation-plan-calculation";
export type ChemistrySource = { product_id: string; formulation: string; source_url: string; checked_date: string };
export type ChemistryPlanInput = { version: 1; capacity_l: string | number; decision_confirmed: boolean; sources: ChemistrySource[] };
export type ChemistryPlan = ChemistryPlanInput & { schedule?: TankPlan };
export function readChemistryPlan(config: unknown): ChemistryPlan | null {
  const candidate = (config as { tank_mix?: { c1?: ChemistryPlan } } | null)?.tank_mix?.c1;
  return candidate?.version === 1 ? candidate : null;
}

export type TankPlan = {
  version: 1; capacity_l: number; full_tanks: number; last_tank_l: number; total_solution_l: number;
  tanks: Array<{ number: number; solution_l: number; area_ha: number; water_l: number;
    materials: Array<{ product_id: string; quantity: number; unit: "l" | "kg" }> }>;
};
export type MixtureInput = {
  prepared_l: unknown; applied_l?: unknown; remaining_l: unknown; loss_l: unknown;
  application_method: "measured" | "residual";
  loading_method: "measured" | "stock_balance";
  homogeneous_confirmed: boolean; measurement_note: string;
  remainder_location?: string; remainder_custodian?: string;
};
export type MixtureResult = {
  version: 1; prepared_l: number; applied_l: number; remaining_l: number; loss_l: number;
  application_method: "measured" | "residual"; loading_method: "measured" | "stock_balance";
  equation: string; measurement_note: string; homogeneous_confirmed: true;
  remainder_location: string | null; remainder_custodian: string | null;
};
const rounded = (n: number, digits: number) => Number(n.toFixed(digits));
// Exact half-up proportional allocation of stock precision units; successive
// cumulative totals conserve every 0.0001 l/kg even at a rounding boundary.
function allocation(quantity: number, cumulative: number, total: number, precision: number): number {
  const q = BigInt(Math.round(quantity * 10 ** precision));
  const c = BigInt(Math.round(cumulative * 1e7)), t = BigInt(Math.round(total * 1e7));
  return Number((q * c * BigInt(2) + t) / (t * BigInt(2))) / 10 ** precision;
}
export function calculateTankPlan(result: PlanCalculationResult, areaHa: number, capacity: unknown): TankPlan {
  const cap = strictPlanNumber(capacity, "полезную ёмкость бака готового раствора");
  if (cap >= 1e8 || rounded(cap, 4) !== cap) throw new PlanCalculationError("Ёмкость бака: до 4 знаков после запятой, меньше 100 млн л.");
  const total = result.total_solution_l;
  const totalUnits = BigInt(Math.round(total * 1e7)), capUnits = BigInt(Math.round(cap * 1e7));
  const full = Number(totalUnits / capUnits), remainder = Number(totalUnits % capUnits) / 1e7;
  const count = full + (remainder > 0 ? 1 : 0);
  if (count < 1 || count > 1000) throw new PlanCalculationError("Разделите работу: допустимо от 1 до 1000 баков.");
  let previousVolume = 0, previousArea = 0;
  const allocated = result.materials.map(() => 0);
  const tanks: TankPlan["tanks"] = [];
  for (let index = 0; index < count; index++) {
    const cumulative = index === count - 1 ? total : rounded((index + 1) * cap, 7);
    const volume = rounded(cumulative - previousVolume, 7);
    const cumulativeArea = allocation(areaHa, cumulative, total, 7);
    const materials = result.materials.map((m, i) => {
      const next = allocation(m.planned_quantity, cumulative, total, 4);
      const quantity = rounded(next - allocated[i], 4); allocated[i] = next;
      if (quantity <= 0) throw new PlanCalculationError("Доза в отдельном баке меньше точности 0,0001 л/кг. Увеличьте бак или разделите план.");
      return { product_id: m.product_id, quantity, unit: m.quantity_unit };
    });
    const liquid = materials.filter(m => m.unit === "l").reduce((sum, m) => sum + m.quantity, 0);
    if (liquid > volume + 1e-9) throw new PlanCalculationError("После округления жидкие препараты превышают объём бака.");
    tanks.push({ number: index + 1, solution_l: volume, area_ha: rounded(cumulativeArea - previousArea, 7), water_l: rounded(volume - liquid, 7), materials });
    previousVolume = cumulative; previousArea = cumulativeArea;
  }
  return { version: 1, capacity_l: cap, full_tanks: full, last_tank_l: remainder, total_solution_l: total, tanks };
}
export function mixtureNumber(value: unknown, name: string): number {
  const number = strictPlanNumber(value, name, true);
  if (number >= 1e8 || rounded(number, 4) !== number) throw new PlanCalculationError(`${name}: до 4 знаков после запятой, меньше 100 млн.`);
  return number;
}
export function calculateMixture(input: MixtureInput): MixtureResult {
  const prepared = mixtureNumber(input.prepared_l, "приготовлено раствора"), remaining = mixtureNumber(input.remaining_l, "остаток раствора"), loss = mixtureNumber(input.loss_l, "потери раствора");
  if (!["measured", "residual"].includes(input.application_method) || !["measured", "stock_balance"].includes(input.loading_method)) throw new PlanCalculationError("Укажите способ определения расхода.");
  if (input.homogeneous_confirmed !== true || !input.measurement_note?.trim()) throw new PlanCalculationError("Подтвердите однородный состав смеси и укажите основание измерений.");
  const residual = rounded(prepared - remaining - loss, 4);
  const applied = input.application_method === "measured" ? mixtureNumber(input.applied_l, "нанесено раствора") : residual;
  if (residual < 0 || Math.abs(applied - residual) > 0.00000001) throw new PlanCalculationError("Баланс раствора не сходится: приготовлено = нанесено + остаток + потери.");
  if (remaining > 0 && (!input.remainder_location?.trim() || !input.remainder_custodian?.trim())) throw new PlanCalculationError("Укажите место и ответственного за остаток готовой смеси.");
  return { version: 1, prepared_l: prepared, applied_l: applied, remaining_l: remaining, loss_l: loss,
    application_method: input.application_method, loading_method: input.loading_method,
    equation: `${prepared} − ${remaining} − ${loss} = ${residual} л`, measurement_note: input.measurement_note.trim(), homogeneous_confirmed: true,
    remainder_location: remaining > 0 ? input.remainder_location!.trim() : null, remainder_custodian: remaining > 0 ? input.remainder_custodian!.trim() : null };
}
export function allocateMixtureProduct(loaded: number, mixture: MixtureResult) {
  mixtureNumber(loaded, "загружено препарата");
  if (mixture.prepared_l === 0) {
    if (loaded !== 0) throw new PlanCalculationError("Без приготовленной смеси загрузка препарата должна быть нулевой.");
    return { applied: 0, remaining: 0, loss: 0 };
  }
  const applied = allocation(loaded, mixture.applied_l, mixture.prepared_l, 4);
  const appliedAndRemaining = allocation(loaded, rounded(mixture.applied_l + mixture.remaining_l, 4), mixture.prepared_l, 4);
  return { applied, remaining: rounded(appliedAndRemaining - applied, 4), loss: rounded(loaded - appliedAndRemaining, 4) };
}
