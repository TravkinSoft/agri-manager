import assert from "node:assert/strict";
import { calculateOperationPlan as calc, formatPlanRateUnit, strictPlanNumber, type PlanCalculationMaterial as M } from "../lib/materials/operation-plan-calculation";
import { calculateTreatmentRequest, treatmentRows } from "../lib/server/treatment-plan-calculation";
import { buildOperationPresentation } from "../lib/operations/operation-presentation";
import type { OperationWithDetails } from "../lib/types/operation";
import { mergeTreatmentPlanContext } from "../lib/server/treatment-plan-context";
const material = (patch: Partial<M> = {}): M => ({ product_id: "a", dose_unit: "ml", quantity_unit: "l", rate_basis: "per_ha", planned_rate: 100, ...patch });
const run = (materials: M[], area = 10, rate = 100) => calc({ area_ha: area, solution_rate_l_ha: rate, materials });
let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`PASS ${name}`); }
test("ml/l and g/kg equivalent quantities", () => {
  assert.equal(run([material()]).materials[0].planned_quantity, 1);
  assert.equal(run([material({ dose_unit: "l", planned_rate: .1 })]).materials[0].planned_quantity, 1);
  assert.equal(run([material({ dose_unit: "g", quantity_unit: "kg" })]).materials[0].planned_quantity, 1);
  assert.equal(run([material({ dose_unit: "kg", quantity_unit: "kg", planned_rate: .1 })]).materials[0].planned_quantity, 1);
});
test("finished solution litre and 1000 litres equivalent", () => {
  assert.equal(run([material({ rate_basis: "per_l_solution", planned_rate: 1 })]).materials[0].planned_quantity, 1);
  assert.equal(run([material({ rate_basis: "per_1000_l_solution", planned_rate: 1000 })]).materials[0].planned_quantity, 1);
});
test("water basis solves simultaneous dilution; it is not solution basis", () => {
  const r = run([material({ rate_basis: "per_l_water", planned_rate: 100 })], 1, 110);
  assert.equal(r.water_l, 100); assert.equal(r.liquid_products_l, 10);
  assert.equal(run([material({ rate_basis: "per_l_solution", planned_rate: 100 })], 1, 110).liquid_products_l, 11);
});
test("mixed fixed, water-dosed liquid, and dry components", () => {
  const r = run([material({ dose_unit: "l", planned_rate: 10 }), material({ product_id: "b", rate_basis: "per_l_water", planned_rate: 100 }), material({ product_id: "c", dose_unit: "g", quantity_unit: "kg", rate_basis: "per_l_water", planned_rate: 1 })], 1, 120);
  assert.equal(r.water_l, 100); assert.deepEqual(r.materials.map(m => m.planned_quantity), [10, 10, .1]);
});
test("manual is explicit, canonical unit and reason required", () => {
  assert.equal(run([material({ rate_basis: "manual", manual_quantity: .5, manual_reason: "Испытание", planned_rate: null })]).liquid_products_l, .5);
  assert.throws(() => run([material({ rate_basis: "manual", manual_quantity: 1 })]));
});
test("negative, NaN, infinity, overflow, cross-family and zero rejected", () => {
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => run([material({ planned_rate: value })]));
  for (const value of [null, undefined, "", "  ", "1x", "Infinity", true, {}, "1e4"]) assert.throws(() => strictPlanNumber(value, "test"));
  assert.equal(strictPlanNumber("0,5", "test"), .5);
  assert.throws(() => run([material({ quantity_unit: "kg" })]));
  assert.throws(() => run([material({ dose_unit: "l", planned_rate: 101 })], 1, 100));
  assert.throws(() => run([material()], 1e100, 1e100));
});
test("small doses retained or explicitly rejected below stock precision", () => {
  assert.equal(run([material({ planned_rate: .1 })], 1).materials[0].planned_quantity, .0001);
  assert.throws(() => run([material({ planned_rate: .001 })], 1));
});
test("duplicate products rejected", () => assert.throws(() => run([material(), material()])));
test("truthful dose labels", () => {
  assert.equal(formatPlanRateUnit("l", "per_l_water"), "л/л воды");
  assert.equal(formatPlanRateUnit("ml", "per_l_water"), "мл/л воды");
});
test("server ignores forged positive quantity and preserves sub-column dose in snapshot", () => {
  const input = [{ ...material({ planned_rate: .00001 }), planned_quantity: 900, unit: "ml", notes: "rate_unit:wrong" }];
  const s = calculateTreatmentRequest({ area: 10000, solutionRate: 1, materials: input, actorId: "test", now: "2026-09-29T00:00:00Z" });
  const rows = treatmentRows(s, input);
  assert.equal(rows[0].planned_quantity, .0001); assert.equal(rows[0].unit, "l");
  assert.equal(rows[0].planned_rate, null); assert.equal(s.input.materials[0].planned_rate, .00001);
  assert.throws(() => calculateTreatmentRequest({ area: 1, solutionRate: 1, materials: [{ product_id: "a", planned_quantity: 1 }], actorId: "x", now: "x" }));
});
test("saved v2 reader uses the snapshot despite stale legacy mix metadata", () => {
  const input = [{ ...material({ rate_basis: "per_l_solution", planned_rate: 100 }), planned_quantity: 999 }];
  const snapshot = calculateTreatmentRequest({ area: 2, solutionRate: 110, materials: input, actorId: "test", now: "test" });
  const operation = {
    id: "saved-v2", operation_type: "Опрыскивание", operation_type_slug: "spraying", operation_category_slug: "spraying",
    planned_area_ha: 2, operation_config: { plan_calculation: snapshot, calculation_revision: 3, tank_mix: { total_solution_l_ha: 999 } },
    operation_params: { tank_mix_calculation: { water_l: 999 } },
    materials: [{ product_id: "a", material_type: "fertilizer", unit: "l", planned_quantity: 22, planned_rate: null }],
  } as unknown as OperationWithDetails;
  const before = JSON.stringify(operation);
  const view = buildOperationPresentation(operation);
  assert.equal(view.materialRows[0].plannedQuantity, 22);
  assert.equal(view.materialRows[0].rateLabel, "100 мл/л раствора");
  assert.match(JSON.stringify(view.details), /198/);
  assert(!JSON.stringify(view.details).includes("999"));
  assert.equal(JSON.stringify(operation), before, "reader must not mutate historical state");
});
test("sparse context merge preserves identity and unrelated nested parameters", () => {
  const old = { season_id: "closed", season_year: 2025, targets: [{ crop_structure_id: "old" }],
    warehouse_workflow: { version: 7 }, unknown_metadata: { preserved: true }, purposes: ["nutrition"],
    operation_params: { season_id: "closed", nested: { pressure: 2, nozzle: "A" }, irrigation_type: "drip" },
    tank_mix: { enabled: true, water_rate_l_ha: 90, total_solution_l_ha: 100 } };
  const saved = JSON.stringify(old);
  const next = mergeTreatmentPlanContext(old, { season_id: "open", targets: [], warehouse_workflow: {},
    operation_params: { season_id: "open", nested: { pressure: 3 } }, tank_mix: { total_solution_l_ha: 110 } });
  assert.equal(next.season_id, "closed"); assert.deepEqual(next.targets, old.targets);
  assert.deepEqual(next.warehouse_workflow, old.warehouse_workflow); assert.deepEqual(next.unknown_metadata, old.unknown_metadata);
  assert.deepEqual(next.purposes, old.purposes); assert.equal(next.operation_params.season_id, "closed");
  assert.deepEqual(next.operation_params.nested, { pressure: 3, nozzle: "A" });
  assert.equal(next.operation_params.irrigation_type, "drip"); assert.equal(next.tank_mix.water_rate_l_ha, 90);
  assert.deepEqual(mergeTreatmentPlanContext(old, undefined), old);
  for (const patch of [null, [], { operation_params: null }, { tank_mix: [] }]) assert.throws(() => mergeTreatmentPlanContext(old, patch));
  assert.equal(JSON.stringify(old), saved);
});
console.log(JSON.stringify({ suite: "A1 arithmetic, request normalization and saved reader", passed }));
