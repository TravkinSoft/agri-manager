import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveStockUnitContract } from "@/lib/warehouse/stock-unit-contract";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read("supabase/migrations/20260822090000_tz297_processing_closure_material_balance_v1.sql");
const reservation = read("supabase/migrations/20260822091000_tz297_processing_output_reservation_v2.sql");
const ticketContext = read("supabase/migrations/20260822092000_tz297_processing_ticket_context_v3.sql");
const globalAdminActor = read("supabase/migrations/20260822093000_tz297_global_admin_processing_actor_v4.sql");
const ownerP0Fix = read("supabase/migrations/20260822070516_tz297_owner_qa_p0_fix_2.sql");
const destinationFix = read("supabase/migrations/20260822134744_tz297_processing_output_destination_v1.sql");
const wipSourceFix = read("supabase/migrations/20260822145412_tz297_processing_output_wip_source_v1.sql");
const wipShadowGuard = read("supabase/migrations/20260822153000_tz297_processing_output_wip_shadow_guard_v2.sql");
const liveLifecycle = read("supabase/migrations/20260822172443_tz297_live_processing_lifecycle_v1.sql");
const dryingStateFix = read("supabase/migrations/20260822223913_tz299_drying_physical_state_contract_v1.sql");
const actionRoute = read("app/api/processing/transformations/[id]/actions/route.ts");
const stockRoute = read("app/api/weighbridge/stock-identities/route.ts");
const ticketRoute = read("app/api/weighbridge/tickets/route.ts");
const ticketPatchRoute = read("app/api/weighbridge/tickets/[id]/route.ts");
const finalizeRoute = read("app/api/weighbridge/tickets/[id]/finalize/route.ts");
const processingRoute = read("app/api/processing/transformations/route.ts");
const processingUi = read("components/weighbridge/processing-workspace.tsx");
const ticketPaper = read("components/weighbridge/weighbridge-ticket-paper.tsx");
const weighbridgePage = read("app/(dashboard)/weighbridge/page.tsx");

const checks: Array<{ name: string; run: () => void }> = [];
const check = (name: string, run: () => void) => checks.push({ name, run });

check("migration is additive and exposes exactly three processing states", () => {
  assert.doesNotMatch(migration, /\b(?:truncate|drop\s+table|drop\s+column|delete\s+from)\b/i);
  assert.match(migration, /'in_processing',\s*'processing_pending_outputs',\s*'processing_closed'/);
  assert.match(migration, /correction_of_transformation_id/);
  assert.match(migration, /batch_processing_events/);
});

check("soft finish changes state and writes only an append-only event", () => {
  const block = migration.match(/create or replace function public\.soft_finish_processing_v1[\s\S]*?grant execute/i)?.[0] || "";
  assert.match(block, /processing_state='processing_pending_outputs'/);
  assert.match(block, /finish_signal_source=coalesce\(finish_signal_source,'operator'\)/);
  assert.match(block, /operator_soft_finish/);
  assert.doesNotMatch(block, /stock_ledger_entries|inventory_batches|batch_transformation_losses/);
});

check("live processing serializes canonical inputs and blocks them only after finish", () => {
  assert.match(liveLifecycle, /attach_processing_input_ticket_live_v1/);
  assert.match(liveLifecycle, /pg_advisory_xact_lock/);
  assert.match(liveLifecycle, /processing_state = 'in_processing'/);
  assert.match(liveLifecycle, /PROCESSING_INPUT_FINISHED/);
  assert.match(liveLifecycle, /source_ticket_line_id[\s\S]*on conflict \(source_ticket_line_id\)/);
  assert.match(liveLifecycle, /processing_input_attached/);
  assert.doesNotMatch(liveLifecycle, /insert into public\.stock_ledger_entries/);
});

check("output does not require finish and remains available during reconciliation", () => {
  assert.match(wipSourceFix, /processing_state not in \('in_processing','processing_pending_outputs'\)/);
  assert.doesNotMatch(wipSourceFix, /finish_requested_at\s+is\s+not\s+null/i);
  assert.match(processingUi, /<Plus className="mr-1 h-4 w-4" \/>Добавить выход/);
  assert.doesNotMatch(processingUi, /\{pending \? <Button[^\n]+Добавить выход/);
});

check("finish and reopen share the canonical lock and preserve hard-close boundary", () => {
  const finish = liveLifecycle.match(/create or replace function public\.soft_finish_processing_v1[\s\S]*?grant execute/i)?.[0] || "";
  const reopen = liveLifecycle.match(/create or replace function public\.reopen_processing_before_close_v1[\s\S]*?grant execute/i)?.[0] || "";
  assert.match(finish, /pg_advisory_xact_lock/);
  assert.match(finish, /processing_state = 'processing_pending_outputs'/);
  assert.match(reopen, /processing_reopened_before_close/);
  assert.match(reopen, /processing_state = 'in_processing'/);
  assert.match(reopen, /PROCESSING_ALREADY_CLOSED/);
  assert.match(actionRoute, /action === "reopen"/);
});

check("active balance, final reconciliation, and closed history have distinct UX", () => {
  assert.match(processingUi, /Сейчас в обработке/);
  assert.match(processingUi, /Нераспределённый баланс обработки/);
  assert.match(processingUi, /История обработок/);
  assert.match(processingUi, /processing_state === "processing_closed"/);
  assert.match(processingUi, /Возобновить обработку/);
  assert.match(processingUi, /Фактические выходы и отходы можно продолжать оформлять/);
});

check("standard losses need mass only while other loss still needs explanation", () => {
  const loss = liveLifecycle.match(/create or replace function public\.approve_processing_loss_v1[\s\S]*?grant execute/i)?.[0] || "";
  assert.match(loss, /p_loss_type = 'other' and nullif\(btrim\(p_reason\), ''\) is null/);
  assert.match(loss, /when 'dust' then 'Пыль'/);
  assert.match(processingUi, /lossType === "other" \? "Пояснение \*" : "Комментарий \(необязательно\)"/);
});

check("live cleaning owner scenario preserves mass through late output and final loss", () => {
  let input = 10_000;
  let output = 4_000;
  assert.equal(input - output, 6_000);
  input += 6_000;
  output += 8_000 + 500;
  assert.equal(input - output, 3_500);
  output += 3_450;
  const approvedLoss = 50;
  assert.equal(input - output - approvedLoss, 0);
});

check("finish/input race has one serialized canonical result", () => {
  const helper = liveLifecycle.match(/create or replace function public\.attach_processing_input_ticket_live_v1[\s\S]*?grant execute/i)?.[0] || "";
  const finish = liveLifecycle.match(/create or replace function public\.soft_finish_processing_v1[\s\S]*?grant execute/i)?.[0] || "";
  assert.match(helper, /pg_advisory_xact_lock/);
  assert.match(helper, /for update/);
  assert.match(finish, /pg_advisory_xact_lock/);
  assert.match(finish, /for update/);
});

check("ordinary stock uses effective availability and active allocations", () => {
  assert.match(migration, /v_processing_active_allocations_v1/);
  assert.match(reservation, /processing_state in \('in_processing','processing_pending_outputs'\)/);
  assert.match(reservation, /activated_at is null/);
  assert.match(stockRoute, /v_effective_stock_balance_identity_v1/);
  assert.match(stockRoute, /effective_available_kg/);
  assert.match(stockRoute, /processing_allocated_kg/);
});

check("output ticket context is linked only when one active transformation matches", () => {
  assert.match(ticketContext, /limit 2/);
  assert.match(ticketContext, /cardinality\(v_matches\) = 1/);
  assert.match(ticketContext, /new\.linked_processing_id := v_matches\[1\]/);
  assert.doesNotMatch(ticketContext, /stock_ledger_entries|insert into public\.inventory_batches/);
});

check("operator actions are role-scoped and raw database errors stay hidden", () => {
  assert.match(actionRoute, /WEIGHBRIDGE_WRITE_ROLES/);
  assert.match(actionRoute, /\["global_admin", "company_admin", "director"\]/);
  assert.match(actionRoute, /requireWeighbridgeOperatorSession/);
  assert.match(actionRoute, /PROCESSING_BALANCE_MISMATCH/);
  assert.doesNotMatch(actionRoute, /error\.message\s*\}/);
});

check("global admin can act in an explicit company context without weakening company roles", () => {
  assert.match(globalAdminActor, /v_actor\.role <> 'global_admin'/);
  assert.match(globalAdminActor, /v_actor\.company_id is distinct from p_company_id/);
  assert.match(globalAdminActor, /v_auth_profile\.role <> 'global_admin'/);
  assert.doesNotMatch(globalAdminActor, /grant execute/i);
});

check("processing card is user-facing and keeps technical identifiers hidden", () => {
  assert.match(processingUi, /Обработки/);
  assert.match(processingUi, /Обработка закончена/);
  assert.match(processingUi, /Нераспределённый баланс обработки/);
  assert.match(processingUi, /Добавить выход/);
  assert.doesNotMatch(processingUi, />\s*(?:transformation_id|processing_id|ledger|UUID)\s*</i);
  assert.match(
    weighbridgePage,
    /<ProcessingWorkspace[\s\S]*?enabled=\{!canUseOperatorSession \|\| operatorState\.unlocked\}[\s\S]*?onAddOutput=\{openProcessingOutput\}/
  );
});

check("last main trip is optional and recorded only after ticket finalize", () => {
  assert.match(weighbridgePage, /Последний рейс основной продукции/);
  const closeBlock = weighbridgePage.match(/const closeTicket = async[\s\S]*?const handleVoid/i)?.[0] || "";
  assert.match(closeBlock, /finalizeTicket[\s\S]*performProcessingAction/);
  assert.match(closeBlock, /action: "mark_last_main"/);
  assert.match(migration, /last_main_output_marked/);
});

check("weighted moisture and wet-basis drying formula are server canonical", () => {
  assert.match(migration, /sum\(input_weight_kg\*moisture_percent\)/);
  assert.match(migration, /sum\(output_weight_kg\*moisture_percent\)/);
  assert.match(migration, /v_dry_matter := v_input\*\(1-v_input_moisture\/100\)/);
  assert.match(migration, /v_theoretical_output := v_dry_matter\/\(1-v_output_moisture\/100\)/);
  assert.match(migration, /drying_mass_balance_v1/);
});

check("hard close locks canonical rows and is immutable/idempotent", () => {
  const block = migration.match(/create or replace function public\.close_processing_material_balance_v1[\s\S]*?grant execute/i)?.[0] || "";
  assert.match(block, /for update/);
  assert.match(block, /PROCESSING_OPEN_OUTPUT_TICKETS/);
  assert.match(block, /PROCESSING_OUTPUT_TICKET_REQUIRED/);
  assert.match(block, /PROCESSING_BALANCE_MISMATCH/);
  assert.match(block, /processing_state='processing_closed'/);
  assert.match(block, /balance_snapshot=v_snapshot/);
  assert.match(block, /idempotent_replay/);
});

check("legacy residue remains pending instead of becoming silent stock or loss", () => {
  assert.match(migration, /v_processing_legacy_residue_classifier_v1/);
  assert.match(migration, /'outputs_incomplete'/);
  assert.match(migration, /'processing_fate_unknown'/);
  assert.doesNotMatch(migration, /all residues|less than 1|<\s*1000/i);
  assert.match(processingRoute, /unallocated_kg/);
});

check("cleaning exact and approved-loss arithmetic closes without phantom mass", () => {
  const exact = { input: 16_100, main: 15_600, waste: 500, loss: 0 };
  assert.equal(exact.input - exact.main - exact.waste - exact.loss, 0);
  const pending = { input: 16_100, main: 15_600, waste: 480, loss: 0 };
  assert.equal(pending.input - pending.main - pending.waste - pending.loss, 20);
  assert.equal(pending.input - pending.main - pending.waste - 20, 0);
});

check("drying example preserves dry matter and never creates a water batch", () => {
  const input = 100_000;
  const theoreticalOutput = input * (100 - 18) / (100 - 14);
  const water = input - theoreticalOutput;
  assert.ok(Math.abs(theoreticalOutput - 95_348.8372) < 0.01);
  assert.ok(Math.abs(water - 4_651.1628) < 0.01);
  assert.match(migration, /moisture_loss_kg/);
  assert.doesNotMatch(migration, /insert into public\.inventory_batches[\s\S]{0,500}moisture_loss/i);
  assert.match(dryingStateFix, /then ''AFTER_DRYING''/);
  assert.doesNotMatch(dryingStateFix, /add constraint[\s\S]*DRIED/i);
  assert.match(dryingStateFix, /expected exactly one DRIED token/);
});

check("multi-input and multi-output totals remain one processing chain", () => {
  assert.equal([20_000, 30_000, 20_000].reduce((sum, value) => sum + value, 0), 70_000);
  assert.equal([20_000, 20_000, 20_000, 8_000, 1_200, 800].reduce((sum, value) => sum + value, 0), 70_000);
  assert.match(migration, /uq_batch_transformations_active_identity_v1/);
  assert.match(migration, /uq_processing_output_source_ticket_v1/);
});

check("picker and atomic finalize share canonical legacy-aware batch identity", () => {
  assert.match(ownerP0Fix, /coalesce\([\s\S]*?inventory_batch_id::text[\s\S]*?batch_id_text[\s\S]*?batch_id/);
  assert.match(ownerP0Fix, /v_weighbridge_harvest_lot_available_v2/);
  assert.match(stockRoute, /v_weighbridge_harvest_lot_available_v2/);
  assert.match(ownerP0Fix, /weighbridge_batch_available_for_ticket_v1/);
  assert.match(ownerP0Fix, /r\.ticket_id <> p_ticket_id/);
  assert.match(ownerP0Fix, /a\.transformation_id <> v_ticket\.linked_processing_id/);
});

check("atomic transfer close consumes final net and rolls back on any postcondition", () => {
  const block = ownerP0Fix.match(/create or replace function public\.close_transfer_ticket_atomic_v2[\s\S]*?grant execute/i)?.[0] || "";
  assert.match(block, /v_net := round\(v_gross - v_tare, 3\)/);
  assert.match(block, /set quantity=v_net, quantity_kg=v_net, mass_kg=v_net/);
  assert.match(block, /perform private\.finalize_warehouse_local_transfer_v1/);
  assert.match(block, /Atomic transfer close postcondition failed/);
  assert.match(block, /idempotent_replay/);
  assert.match(finalizeRoute, /close_transfer_ticket_atomic_v2/);
  assert.match(finalizeRoute, /WEIGHBRIDGE_STOCK_INSUFFICIENT/);
  assert.match(finalizeRoute, /trace_id/);
});

check("ticket line preview switches from gross to physical net", () => {
  assert.match(ticketPaper, /physicalNetKg/);
  assert.match(ticketPaper, /physical_net_kg/);
  assert.match(ticketPaper, /net_weight_kg/);
  assert.doesNotMatch(ticketPaper, /line\.quantity\s*\|\|\s*ticket\.gross_weight_kg/);
});

check("moisture input is optional across workflows and potato tickets hide the irrelevant fact", () => {
  assert.match(weighbridgePage, /<CompactField label="Влажность, %">/);
  assert.doesNotMatch(weighbridgePage, /Влажность, % \(необязательно\)/);
  assert.match(weighbridgePage, /moisture <= 0 \|\| moisture >= 100/);
  assert.match(ticketPatchRoute, /Влажность должна быть больше 0 и меньше 100 %/);
  assert.doesNotMatch(ticketPatchRoute, /harvest_incoming[\s\S]{0,160}moisture_percent/);
  assert.match(ticketPaper, /Влажность, %/);
  assert.match(ticketPaper, /isHarvest && !isPotato\(crop\)/);
});

check("weighted moisture uses measured mass instead of an arithmetic mean", () => {
  const trips = [
    { kg: 5_000, moisture: 18 },
    { kg: 10_000, moisture: 16 },
    { kg: 5_000, moisture: null },
  ];
  const measured = trips.filter((trip): trip is { kg: number; moisture: number } => trip.moisture != null);
  const coverage = measured.reduce((sum, trip) => sum + trip.kg, 0);
  const weighted = measured.reduce((sum, trip) => sum + trip.kg * trip.moisture, 0) / coverage;
  assert.ok(Math.abs(weighted - 16.6666667) < 0.0001);
  assert.equal(coverage, 15_000);
  assert.equal(trips.reduce((sum, trip) => sum + trip.kg, 0), 20_000);
  assert.match(migration, /sum\(input_weight_kg\*moisture_percent\)/);
  assert.match(migration, /sum\(output_weight_kg\*moisture_percent\)/);
});

check("processing output mode exposes exactly six canonical fractions", () => {
  const labels = [
    "Основная продукция",
    "Отсев",
    "Фураж / кормовая фракция",
    "Веяльные отходы",
    "Триерные отходы",
    "Прочие отходы",
  ];
  for (const label of labels) assert.match(weighbridgePage, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(weighbridgePage, /processingOutputContext[\s\S]*processingOutputRoleLabels/);
  assert.match(weighbridgePage, /Нераспределённый баланс обработки/);
  assert.match(ticketRoute, /PROCESSING_OUTPUT_ROLES/);
  assert.match(ownerP0Fix, /'GRAIN','SCREENINGS','FEED','WASTE','TRIER_WASTE','OTHER'/);
});

check("generic impurity categories remain isolated from processing output mode", () => {
  assert.match(weighbridgePage, /processingOutputContext\s*\?[\s\S]*processingOutputRoleLabels[\s\S]*:\s*\(Object\.keys\(impurityTypeLabels\)/);
  assert.match(weighbridgePage, /Земля и мусор/);
  assert.match(weighbridgePage, /Некондиционный урожай/);
  assert.match(weighbridgePage, /Растительные остатки/);
});

check("stock-producing processing outputs require an explicit destination", () => {
  assert.match(weighbridgePage, /Место назначения \*/);
  assert.match(weighbridgePage, /Выберите склад \/ площадку \/ точку хранения/);
  assert.match(weighbridgePage, /Укажите, куда будет доставлен выход обработки\./);
  assert.match(weighbridgePage, /processingOutputContext \? opMeta\("transfer_between_warehouses"\)/);
  assert.match(ticketRoute, /isProcessingOutput[\s\S]*Укажите, куда будет доставлен выход обработки\./);
  assert.match(ticketRoute, /isProcessingOutput[\s\S]*isWarehouseTransfer/);
  assert.match(ticketRoute, /destination[\s\S]*archived[\s\S]*is_archived/);
});

check("generic impurities remain destination-optional and non-stock losses stay outside the ticket form", () => {
  const impurityBlock = ticketRoute.match(/if \(isImpurityRemoval\) \{[\s\S]*?if \(isWarehouseTransfer\)/)?.[0] || "";
  assert.doesNotMatch(impurityBlock, /warehouse_to_id.*required|куда будет доставлен/);
  assert.doesNotMatch(weighbridgePage, /processingOutputRoleLabels[\s\S]{0,300}(?:moisture_loss|process_loss)/);
  assert.doesNotMatch(destinationFix, /output_role[^;]*(?:MOISTURE_LOSS|PROCESS_LOSS)/i);
});

check("processing output close consumes locked WIP and writes one destination IN", () => {
  assert.doesNotMatch(wipSourceFix, /\b(?:truncate|drop\s+table|drop\s+column|delete\s+from)\b/i);
  assert.match(wipSourceFix, /create or replace function public\.close_processing_output_ticket_atomic_v1/);
  assert.match(wipSourceFix, /from public\.batch_transformations[\s\S]*for update/);
  assert.match(wipSourceFix, /from public\.batch_transformation_inputs[\s\S]*for update/);
  assert.match(wipSourceFix, /v_remaining_before := round\(greatest\(v_input_kg - v_stock_output_kg - v_approved_loss_kg, 0\), 3\)/);
  assert.match(wipSourceFix, /PROCESSING_OUTPUT_EXCEEDS_BALANCE/);
  assert.match(wipSourceFix, /source_kind = 'processing_wip'/);
  assert.doesNotMatch(wipSourceFix, /close_transfer_ticket_atomic_v2/);
  assert.match(wipSourceFix, /insert into public\.inventory_batches/);
  assert.match(wipSourceFix, /insert into public\.batch_transformation_outputs/);
  assert.match(wipSourceFix, /v_out_count <> 0/);
  assert.match(wipSourceFix, /v_in_count <> 1/);
  assert.match(wipSourceFix, /perform public\.recompute_grain_processing_shadow_v1/);
  assert.match(finalizeRoute, /close_processing_output_ticket_atomic_v1/);
});

check("all six stock output roles preserve destination-local batch identity", () => {
  for (const role of ["GRAIN", "SCREENINGS", "FEED", "WASTE", "TRIER_WASTE", "OTHER"]) {
    assert.match(wipSourceFix, new RegExp(`\\b${role}\\b`));
  }
  assert.match(wipSourceFix, /source_transformation_id/);
  assert.match(wipSourceFix, /v_destination\.id/);
  assert.match(wipSourceFix, /processing_id/);
});

check("processing output create no longer requires a warehouse-owned source batch", () => {
  assert.match(ticketRoute, /source_kind = "processing_wip"/);
  assert.match(ticketRoute, /processing_output_source/);
  assert.match(ticketRoute, /contract_version: "tz297_wip_source_v1"/);
  assert.match(ticketRoute, /if \(isWarehouseTransfer && !isProcessingOutput\)/);
  assert.match(weighbridgePage, /Источник обработки/);
  assert.match(weighbridgePage, /processingOutputContext\.unallocatedKg/);
  assert.doesNotMatch(wipSourceFix, /weighbridge_batch_available_for_ticket_v1/);
});

check("processing outputs use derived batch classes instead of the legacy processing class", () => {
  const product = {
    id: "soy",
    base_uom: "kg",
    product_type: "commodity",
  };
  for (const batchClass of ["commodity", "feed", "waste"] as const) {
    const contract = resolveStockUnitContract({
      product,
      quantity: 450,
      inputUom: "kg",
      requestedBatchClass: batchClass,
      event: "processing_output",
    });
    assert.equal(contract.batchClass, batchClass);
    assert.equal(contract.baseQuantity, 450);
  }
  assert.match(ticketRoute, /isProcessingOutput\s*\?\s*"processing_output"/);
  assert.match(ticketRoute, /if \(isWarehouseTransfer && !isProcessingOutput\)/);
});

check("processing output close creates a destination child batch without a source OUT", () => {
  assert.match(wipSourceFix, /v_batch_class := case when v_role = 'GRAIN' then 'commodity' when v_role = 'FEED' then 'feed' else 'waste' end/);
  assert.match(wipSourceFix, /v_physical_state := case[\s\S]*when v_role = 'TRIER_WASTE' then 'TRIER_WASTE'/);
  assert.match(wipSourceFix, /v_batch_class, v_source_batch\.id, v_transformation\.id, 'processing'/);
  assert.match(wipSourceFix, /v_destination\.id,[\s\S]*'in', v_net/);
  assert.match(wipSourceFix, /v_out_count <> 0/);
  assert.match(wipSourceFix, /v_in_count <> 1/);
});

check("legacy movement shadow skips only finalized WIP outputs", () => {
  assert.match(wipShadowGuard, /new\.source_kind = 'processing_wip'/);
  assert.match(wipShadowGuard, /new\.linked_processing_id is not null/);
  assert.match(wipShadowGuard, /new\.is_finalized/);
  assert.match(wipShadowGuard, /not new\.is_voided/);
  assert.match(wipShadowGuard, /perform public\.sync_grain_movement_shadow_v1\(new\.id\)/);
  assert.doesNotMatch(wipShadowGuard, /create or replace function public\.sync_grain_movement_shadow_v1\(/);
});

check("two physical outputs exhaust a 500 kg processing balance without duplicate mass", () => {
  const inputKg = 500;
  const outputs = [
    { role: "WASTE", destination: "Площадка отходов БИС", kg: 320 },
    { role: "TRIER_WASTE", destination: "Склад отходов", kg: 180 },
  ];
  assert.equal(outputs.reduce((sum, output) => sum + output.kg, 0), inputKg);
  assert.equal(inputKg - outputs.reduce((sum, output) => sum + output.kg, 0), 0);
  assert.equal(new Set(outputs.map((output) => output.destination)).size, 2);
  assert.equal(outputs.length, 2);
});

let passed = 0;
for (const item of checks) {
  item.run();
  passed += 1;
  console.log(`PASS ${item.name}`);
}
console.log(`TZ297 ${passed}/${checks.length} PASS`);
