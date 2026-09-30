import {
  PlanCalculationError, snapshotOperationPlan, strictPlanNumber,
  type PlanCalculationInput, type PlanCalculationSnapshot, type PlanDoseUnit,
  type PlanQuantityUnit, type PlanRateBasis,
} from "@/lib/materials/operation-plan-calculation";

export function isVersionedTreatment(slug: string | null | undefined): boolean {
  return slug === "spraying" || slug === "fertigation";
}
/** Boundary parser shared by POST/PATCH. Never infer historical dose units. */
export function calculateTreatmentRequest(input: {
  area: unknown;
  solutionRate: unknown;
  materials: Array<Record<string, unknown>>;
  actorId: string;
  now: string;
}): PlanCalculationSnapshot {
  const calculation: PlanCalculationInput = {
    area_ha: strictPlanNumber(input.area, "площадь"),
    solution_rate_l_ha: strictPlanNumber(input.solutionRate, "норму готового раствора"),
    materials: input.materials.map((m) => {
      if (!m.dose_unit || !m.quantity_unit || !m.rate_basis) {
        throw new PlanCalculationError("Уточните единицу дозы, единицу количества и базу нормы в новом расчёте.");
      }
      const manual = m.rate_basis === "manual";
      return {
        product_id: String(m.product_id || ""),
        dose_unit: m.dose_unit as PlanDoseUnit,
        quantity_unit: m.quantity_unit as PlanQuantityUnit,
        rate_basis: m.rate_basis as PlanRateBasis,
        planned_rate: manual ? null : strictPlanNumber(m.planned_rate, "норму препарата"),
        ...(manual ? {
          manual_quantity: strictPlanNumber(m.manual_quantity, "ручное количество"),
          manual_reason: typeof m.manual_reason === "string" ? m.manual_reason.trim() : "",
        } : {}),
      };
    }),
  };
  return snapshotOperationPlan(calculation, input.actorId, input.now);
}
export function treatmentMaterialNotes(notes: unknown, doseUnit: string, basis: string): string {
  const retained = String(notes || "").split(";").map((s) => s.trim())
    .filter((s) => s && !/^(rate_basis|rate_unit|dose_unit|calculation_version|planned_quantity)\s*:/.test(s));
  return [...retained, "calculation_version:2", `dose_unit:${doseUnit}`, `rate_basis:${basis}`].join("; ");
}

/** Legacy readers conflate dose and quantity units. A nullable legacy rate avoids
 * displaying e.g. 100 ml/ha as 100 l/ha. The v2 snapshot is authoritative. */
export function legacyRateForSnapshot(_rate: number | null): null {
  return null;
}

export function treatmentRows(snapshot: PlanCalculationSnapshot, rows: Array<Record<string, unknown>>) {
  return snapshot.result.materials.map((m) => {
    const row = rows.find((r) => r.product_id === m.product_id)!;
    return { ...row, planned_quantity: m.planned_quantity, unit: m.quantity_unit,
      planned_rate: legacyRateForSnapshot(m.planned_rate),
      notes: treatmentMaterialNotes(row.notes, m.dose_unit, m.rate_basis) };
  });
}
