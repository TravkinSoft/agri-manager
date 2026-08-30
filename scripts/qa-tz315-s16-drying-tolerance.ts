import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PROCESSING_BALANCE_ABSOLUTE_TOLERANCE_KG,
  PROCESSING_BALANCE_RELATIVE_TOLERANCE_PERCENT,
  PROCESSING_MASS_EPSILON_KG,
  processingBalanceTolerance,
  processingMassSnapshot,
  processingWorkState,
} from "@/lib/weighbridge/processing-work-state";
import type { BatchTransformationRow } from "@/lib/services/processing";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read("supabase/migrations/20260830204809_tz315_s16_drying_balance_tolerance_v1.sql");
const sourceDebitMigration = read("supabase/migrations/20260830211041_tz315_processing_output_source_debit_v1.sql");
const route = read("app/api/processing/transformations/route.ts");
const actionRoute = read("app/api/processing/transformations/[id]/actions/route.ts");
const workspace = read("components/weighbridge/processing-workspace.tsx");

const checks: Array<{ name: string; run: () => void }> = [];
const check = (name: string, run: () => void) => checks.push({ name, run });

const dryingRow = (balanceDeltaKg: number): BatchTransformationRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  company_id: "00000000-0000-4000-8000-000000000002",
  transformation_type: "drying",
  processing_method: "MECHANICAL_DRYING",
  status: "completed",
  processing_state: "processing_pending_outputs",
  processing_node_id: null,
  processing_node_name: "Сушилка",
  source_ticket_id: null,
  started_at: null,
  completed_at: null,
  created_at: "2026-08-30T00:00:00.000Z",
  note: null,
  input_label: "Пшеница",
  input_weight_kg: 27_000,
  input_total_kg: 27_000,
  main_output_kg: 26_050,
  byproduct_kg: 0,
  stock_waste_kg: 0,
  approved_process_loss_kg: 0,
  moisture_loss_kg: 941.8604651162791,
  balance_delta_kg: balanceDeltaKg,
  input_moisture_percent: 17,
  output_moisture_percent: 14,
  input_moisture_coverage_kg: 27_000,
  output_moisture_coverage_kg: 26_050,
  source_warehouse_name: "Сушилка",
  outputs: [],
});

check("S16 exact wet-basis calculation produces the reported deviation", () => {
  const inputKg = 27_000;
  const theoreticalOutputKg = inputKg * (100 - 17) / (100 - 14);
  const expectedMoistureLossKg = inputKg - theoreticalOutputKg;
  const actualShrinkKg = inputKg - 26_050;
  const deviationKg = actualShrinkKg - expectedMoistureLossKg;
  assert.ok(Math.abs(theoreticalOutputKg - 26_058.13953488372) < 1e-9);
  assert.ok(Math.abs(expectedMoistureLossKg - 941.8604651162791) < 1e-9);
  assert.equal(actualShrinkKg, 950);
  assert.equal(Number(deviationKg.toFixed(3)), 8.14);
});

check("drying tolerance combines the approved absolute and relative limits", () => {
  assert.equal(PROCESSING_BALANCE_ABSOLUTE_TOLERANCE_KG, 10);
  assert.equal(PROCESSING_BALANCE_RELATIVE_TOLERANCE_PERCENT, 0.05);
  const tolerance = processingBalanceTolerance(27_000, true);
  assert.equal(tolerance.absoluteToleranceKg, 10);
  assert.equal(tolerance.relativeToleranceKg, 13.5);
  assert.equal(tolerance.toleranceKg, 13.5);
});

check("reported S16 deviation closes within tolerance but remains visible", () => {
  const mass = processingMassSnapshot(dryingRow(8.14));
  assert.equal(mass.balanceDeltaKg, 8.14);
  assert.equal(mass.withinTolerance, true);
  assert.equal(processingWorkState(dryingRow(8.14)), "ready");
});

check("outside-tolerance drying deviation still requires reconciliation", () => {
  const boundary = processingBalanceTolerance(27_000, true).toleranceKg;
  assert.equal(processingWorkState(dryingRow(boundary)), "ready");
  assert.equal(processingWorkState(dryingRow(boundary + 0.001)), "reconciliation");
});

check("non-drying processing keeps the exact legacy epsilon", () => {
  const tolerance = processingBalanceTolerance(27_000, false);
  assert.equal(tolerance.toleranceKg, PROCESSING_MASS_EPSILON_KG);
  assert.equal(tolerance.relativeToleranceKg, 0);
});

check("corrective migration is repeat-safe and has no business backfill", () => {
  assert.match(migration, /create or replace function public\.close_processing_material_balance_v1/);
  assert.doesNotMatch(migration, /\b(?:delete\s+from|truncate|drop\s+table|drop\s+column)\b/i);
  assert.doesNotMatch(migration, /update public\.batch_transformations[\s\S]*where processing_state/i);
  assert.match(migration, /v_tolerance_absolute numeric := 10/);
  assert.match(migration, /v_tolerance_relative_percent numeric := 0\.05/);
  assert.match(migration, /greatest\(v_tolerance_absolute,v_tolerance_relative_kg\)/);
  assert.match(migration, /abs\(v_delta\)>v_tolerance_effective_kg/);
});

check("tolerated deviation is audited and never auto-approved as loss", () => {
  assert.match(migration, /'actual_shrink_kg',round\(v_actual_shrink,3\)/);
  assert.match(migration, /'moisture_deviation_kg',v_delta/);
  assert.match(migration, /mass_difference_kg=v_delta,unexplained_variance_kg=v_delta/);
  assert.match(migration, /v_needed_out := round\(v_process_loss,3\)/);
  assert.match(migration, /loss_type,qty_kg,calculation_json/);
  assert.match(migration, /'moisture_loss',round\(v_actual_shrink,3\)/);
  assert.doesNotMatch(migration, /approved_by[\s\S]{0,300}v_actual_shrink/);
  assert.doesNotMatch(migration, /v_needed_out\s*:=\s*round\(v_delta/);
});

check("physical source debit is deferred, ticket-linked and recursion-safe", () => {
  assert.match(sourceDebitMigration, /create constraint trigger trg_processing_output_source_debit_v1/);
  assert.match(sourceDebitMigration, /deferrable initially deferred/);
  assert.match(sourceDebitMigration, /when \([\s\S]*new\.reason_type='processing_output_in'/);
  assert.match(sourceDebitMigration, /'processing_output_source_out'/);
  assert.match(sourceDebitMigration, /values \(\s*v_t\.company_id,new\.ticket_id,v_t\.id/);
  assert.match(sourceDebitMigration, /uq_processing_output_source_effect_v1/);
  assert.doesNotMatch(sourceDebitMigration, /delete\s+from|truncate|drop\s+table|drop\s+column/i);
});

check("source debit reconciles exact multi-input balances and includes storno net effects", () => {
  assert.match(sourceDebitMigration, /group by i\.batch_id,i\.warehouse_from_id/);
  assert.match(sourceDebitMigration, /order by min\(i\.created_at\),i\.batch_id,i\.warehouse_from_id/);
  assert.match(sourceDebitMigration, /storno_of_entry_id in/);
  assert.match(sourceDebitMigration, /reconcile_warehouse_local_batch_balance_v1/);
  assert.match(sourceDebitMigration, /reconcile_harvest_lot_batch_balance_v1/);
  assert.match(sourceDebitMigration, /PROCESSING_OUTPUT_SOURCE_POSTCONDITION/);
});

check("reversal and isolated ticket void use the canonical source effect", () => {
  assert.match(sourceDebitMigration, /processing_output_ticket_trace_valid_v2/);
  assert.match(sourceDebitMigration, /reverse_processing_material_balance_v1/);
  assert.match(sourceDebitMigration, /PROCESSING_OUTPUT_CYCLE_REVERSAL_REQUIRED/);
  assert.match(sourceDebitMigration, /reversal\.storno_of_entry_id=base\.id/);
});

check("outside tolerance returns an explicit reconcile/approval error", () => {
  assert.match(migration, /PROCESSING_BALANCE_TOLERANCE_EXCEEDED/);
  assert.match(actionRoute, /превышает допуск/);
  assert.match(actionRoute, /явную сверку или подтвердите потерю/);
});

check("API and UI expose expected, actual, deviation and tolerance", () => {
  assert.match(route, /theoretical_output_kg/);
  assert.match(route, /actual_shrink_kg/);
  assert.match(route, /moisture_deviation_kg/);
  assert.match(route, /balance_tolerance_kg/);
  assert.match(workspace, /Ожидаемая усушка/);
  assert.match(workspace, /Фактическая усушка/);
  assert.match(workspace, /не становится подтверждённой потерей автоматически/);
  assert.match(workspace, /!manageMass\.withinTolerance/);
});

let failed = 0;
for (const item of checks) {
  try {
    item.run();
    console.log(`PASS ${item.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${item.name}`);
    console.error(error);
  }
}

console.log(`\nTZ315 S16 drying tolerance: ${checks.length - failed}/${checks.length} PASS`);
if (failed > 0) process.exit(1);
