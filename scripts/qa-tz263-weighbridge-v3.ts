import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { calculateHarvestLotAccounting } from "../lib/weighbridge/harvest-lot-accounting";
import { validateHarvestWeights } from "../lib/weighbridge/harvest-contract";
import { parseStrictWeightKg, requiresTareConfirmation, tareDifferencePercent } from "../lib/weighbridge/weight-input";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const operatorMigration = read("supabase/migrations/20260811144655_tz263_weighbridge_operator_shift_sessions_v1.sql");
const lotMigration = read("supabase/migrations/20260811144709_tz263_aggregate_harvest_lots_v1.sql");
const lotIdentityMigration = read("supabase/migrations/20260811171237_tz263_harvest_lot_identity_without_field_v2.sql");
const correctionMigration = read("supabase/migrations/20260811233956_tz263_weighbridge_ticket_correction_v1.sql");
const auth = read("app/api/weighbridge/_auth.ts");
const operatorRoute = read("app/api/weighbridge/operator-session/route.ts");
const ticketRoute = read("app/api/weighbridge/tickets/route.ts");
const ticketPatch = read("app/api/weighbridge/tickets/[id]/route.ts");
const finalizeRoute = read("app/api/weighbridge/tickets/[id]/finalize/route.ts");
const shiftsRoute = read("app/api/weighbridge/shifts/route.ts");
const batchRoute = read("app/api/weighbridge/harvest-batches/route.ts");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const warehouses = read("app/(dashboard)/warehouses/page.tsx");
const lotDialog = read("components/warehouses/harvest-batch-dialog.tsx");
const ticketPreview = read("components/weighbridge/ticket-preview-dialog.tsx");
const ticketPaper = read("components/weighbridge/weighbridge-ticket-paper.tsx");
const correctionRoute = read("app/api/weighbridge/tickets/[id]/correction/route.ts");
const printPage = read("app/(dashboard)/weighbridge/[id]/print/page.tsx");

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

check("PIN hashes live only in private schema", () => assert.match(operatorMigration, /private\.weighbridge_operator_credentials[\s\S]*pin_hash text not null/));
check("PIN uses bcrypt cost 12", () => assert.match(operatorMigration, /gen_salt\('bf', 12\)/));
check("five wrong attempts lock for fifteen minutes", () => assert.match(operatorMigration, /v_failures >= 5[\s\S]*interval '15 minutes'/));
check("failed PIN returns without transaction rollback", () => assert.match(operatorMigration, /return jsonb_build_object\([\s\S]*'invalid_pin'/));
check("raw operator token is never stored", () => assert.match(operatorMigration, /token_hash[\s\S]*digest\(v_token, 'sha256'\)/));
check("operator session lasts twelve hours", () => assert.match(operatorMigration, /interval '12 hours'/));
check("one open shift is enforced per company", () => assert.match(operatorMigration, /weighbridge_shifts_one_open_per_company_idx[\s\S]*where status = 'open'/));
check("shift stores human operator identity", () => assert.match(operatorMigration, /operator_person_id uuid references public\.company_people/));
check("weighings store human operator and shift", () => assert.match(operatorMigration, /ticket_weighings[\s\S]*operator_person_id[\s\S]*weighbridge_shift_id/));
check("handover links old and new shifts", () => assert.match(operatorMigration, /handover_from_shift_id[\s\S]*close_reason = 'handover'/));
check("handover does not rewrite tickets", () => assert.doesNotMatch(operatorMigration, /update public\.tickets[\s\S]*shift_id/));
check("lock revokes session without closing shift", () => {
  const lockBody = operatorMigration.match(/create or replace function public\.lock_weighbridge_operator_session_v1[\s\S]*?\$function\$;/)?.[0] || "";
  assert.match(lockBody, /status = 'revoked'/);
  assert.doesNotMatch(lockBody, /status = 'closed'/);
});
check("F5 and tab close have no shift close handler", () => assert.doesNotMatch(page, /beforeunload|unload|visibilitychange[\s\S]*closeShift/));
check("operator cookie is HttpOnly", () => assert.match(operatorRoute, /httpOnly: true/));
check("operator cookie is not returned in JSON", () => assert.match(operatorRoute, /delete safePayload\.token/));
check("PIN mutation returns the canonical unlocked session state", () => {
  assert.match(operatorRoute, /weighbridge_operator_session_state_v1[\s\S]*p_session_token: token/);
});
check("server requires PIN session for weighed writes", () => assert.match(auth, /requireWeighbridgeOperatorSession/));
check("legacy shift open cannot bypass PIN", () => assert.match(shiftsRoute, /Смена открывается после выбора весовщика и ввода PIN/));
check("manual close stores human operator", () => assert.match(shiftsRoute, /closed_by_person_id: operatorSession\.operator\.id/));
check("manual warehouse flows do not require operator PIN", () => assert.match(ticketRoute, /operatorSession = isDirectWarehouseTransfer \|\| isDirectFieldIssue \|\| isDirectSupplierReceipt/));
check("gross stores human operator", () => assert.match(ticketRoute, /operator_person_id: operatorSession\?\.operator\.id/));
check("tare stores human operator", () => assert.match(ticketPatch, /operator_person_id: operatorSession\?\.operator\.id/));
check("finalize stores human operator", () => assert.match(finalizeRoute, /finalized_by_person_id: operatorSession\.operator\.id/));
check("weighbridge has compact operator control", () => assert.match(page, /operatorState\.operator\?\.name \|\| "Введите PIN"/));
check("weighbridge supports controlled handover", () => assert.match(page, /handoverWeighbridgeOperator/));
check("PIN mutation preserves operator options returned by session bootstrap", () => {
  assert.match(page, /operators: Array\.isArray\(nextState\.operators\) \? nextState\.operators : operatorState\.operators/);
});
check("no new mandatory ticket field was added", () => assert.doesNotMatch(page, /Бурт \*|Номер партии \*|Оператор \*/));
check("gross form always creates a new ticket", () => {
  assert.doesNotMatch(page, /openVehicleTicket/);
  assert.match(page, /onClick=\{\(\) => void create\(\)\}[\s\S]*Открыть талон/);
});
check("open ticket queue stays oldest first", () => assert.match(page, /visibleActiveTickets\]\.sort\(\(a, b\) => new Date\(a\.created_at \|\| 0\)\.getTime\(\) - new Date\(b\.created_at \|\| 0\)\.getTime\(\)\)/));
check("tare is opened only from the selected queue ticket", () => assert.match(page, /key=\{`open-\$\{t\.id\}`\}[\s\S]*onClick=\{\(\) => setActiveTicket\(t\)\}/));
check("aggregate lot tables exist", () => assert.match(lotMigration, /create table if not exists public\.harvest_lots[\s\S]*create table if not exists public\.harvest_lot_batches/));
check("technical batch belongs to one aggregate lot", () => assert.match(lotMigration, /unique \(inventory_batch_id\)/));
check("confirmed identity groups matching trips", () => assert.match(lotMigration, /harvest_lots_confirmed_identity_idx/));
check("unknown identity creates a per-trip provisional lot", () => assert.match(lotMigration, /'provisional:' \|\| v_batch\.id::text/));
check("provisional lot is resolution locked", () => assert.match(lotMigration, /resolution_locked[\s\S]*not v_confirmed/));
check("identity clarification cannot auto-reassign existing trip", () => assert.match(lotMigration, /after insert on public\.inventory_batches/));
check("lot reassignment is explicit and audited", () => assert.match(lotMigration, /reassign_harvest_batch_lot_v1[\s\S]*controlled_reassignment/));
check("confirmed lot identity excludes field", () => {
  assert.match(lotIdentityMigration, /concat_ws\('\|', 'crop', v_batch\.company_id, v_season_id, v_batch\.crop_id, v_batch\.variety_id, v_batch\.reproduction_id\)/);
  assert.doesNotMatch(lotIdentityMigration, /concat_ws\('\|', 'crop', v_batch\.company_id, v_season_id, v_field_id/);
});
check("existing field-split lots are reconciled without deleting technical trips", () => {
  assert.match(lotIdentityMigration, /update public\.harvest_lot_batches[\s\S]*canonical_lot_id/);
  assert.match(lotIdentityMigration, /status = 'merged'/);
  assert.doesNotMatch(lotIdentityMigration, /delete from public\.(inventory_batches|tickets|ticket_weighings)/);
});
check("unknown variety or reproduction remains provisional", () => {
  assert.match(lotIdentityMigration, /missing_variety/);
  assert.match(lotIdentityMigration, /missing_reproduction/);
  assert.match(lotIdentityMigration, /'provisional:' \|\| v_batch\.id::text/);
});
check("lot stock uses signed ledger quantity", () => assert.match(lotMigration, /sum\(delta_qty_signed\)/));
check("new harvest ledger rows get technical batch id", () => assert.match(lotMigration, /zz_populate_harvest_inventory_batch_ledger_v1/));
check("legacy harvest ledger is resolved without physical backfill", () => {
  assert.match(lotMigration, /with resolved_ledger as/);
  assert.doesNotMatch(lotMigration, /update public\.stock_ledger_entries sle\s+set inventory_batch_id/);
});
check("warehouse requests aggregate view only", () => assert.match(warehouses, /aggregateLots: true/));
check("weighbridge keeps technical batch route by default", () => assert.match(batchRoute, /aggregateLots[\s\S]*if \(aggregateLots\)/));
check("warehouse shows aggregate harvest as one stock row", () => {
  assert.match(warehouses, /selectedSummary\.batches\.map/);
  assert.match(warehouses, /batch\.cleanMassKg/);
  assert.match(warehouses, /selectedHarvestProductIds/);
  assert.match(warehouses, /Остатки/);
  assert.doesNotMatch(warehouses, /Партии урожая/);
});
check("warehouse lot exposes field totals and individual trip batches", () => {
  assert.match(batchRoute, /fieldSummaries/);
  assert.match(lotDialog, /Происхождение и рейсы/);
  assert.match(lotDialog, /fieldSummaries/);
  assert.match(lotDialog, /tripBatches/);
  assert.match(lotDialog, /vehicleName[\s\S]*driverName/);
  assert.doesNotMatch(lotDialog, /batchCode|HAR-/);
});
check("field totals use accepted active trips without proportional allocation", () => {
  assert.match(batchRoute, /trip\.status !== "voided"/);
  assert.match(batchRoute, /current\.netWeightKg \+= trip\.netWeightKg/);
  assert.doesNotMatch(batchRoute, /currentWeight \* field\.netWeightKg|allocatedWeight/);
});
check("lot dialog explains physical accounting without calling processing an impurity", () => {
  assert.match(lotDialog, /Остаток на этом складе/);
  assert.match(lotDialog, /Принято на этот склад/);
  assert.match(lotDialog, /Принято по всей партии/);
  assert.match(lotDialog, /Примеси/);
  assert.match(lotDialog, /Передано в переработку/);
  assert.match(lotDialog, /Физический остаток/);
});
check("accounting A: three accepted trips total 36,500 kg", () => {
  const result = calculateHarvestLotAccounting({
    receivedKg: 12_000 + 13_000 + 11_500,
    currentKg: 36_500,
    ledgerEntries: [],
  });
  assert.equal(result.receivedKg, 36_500);
  assert.equal(result.physicalKg, 36_500);
  assert.equal(result.reconciliationDeltaKg, 0);
});
check("accounting B: voided 13,000 kg remains history and active receipt is 23,500 kg", () => {
  const result = calculateHarvestLotAccounting({
    receivedKg: 23_500,
    voidedKg: 13_000,
    currentKg: 23_500,
    ledgerEntries: [
      { delta_qty_signed: 13_000, reason_type: "harvest_incoming_in" },
      { delta_qty_signed: -13_000, reason_type: "storno_harvest_incoming_in" },
    ],
  });
  assert.equal(result.receivedKg, 23_500);
  assert.equal(result.voidedKg, 13_000);
  assert.equal(result.physicalKg, 23_500);
  assert.equal(result.reconciliationDeltaKg, 0);
});
check("accounting C: 3,500 kg impurities reduce physical stock to 20,000 kg", () => {
  const result = calculateHarvestLotAccounting({
    receivedKg: 23_500,
    currentKg: 20_000,
    ledgerEntries: [{ delta_qty_signed: -3_500, reason_type: "WEIGHBRIDGE_IMPURITIES" }],
  });
  assert.equal(result.impurityKg, 3_500);
  assert.equal(result.physicalKg, 20_000);
  assert.equal(result.reconciliationDeltaKg, 0);
});
check("accounting D: transfer preserves 20,000 kg company total and splits warehouses 15,000/5,000", () => {
  const warehouseA = calculateHarvestLotAccounting({
    receivedKg: 23_500,
    currentKg: 15_000,
    ledgerEntries: [
      { delta_qty_signed: -3_500, reason_type: "WEIGHBRIDGE_IMPURITIES" },
      { delta_qty_signed: -5_000, reason_type: "transfer_between_warehouses" },
    ],
  });
  const warehouseB = calculateHarvestLotAccounting({
    receivedKg: 0,
    currentKg: 5_000,
    ledgerEntries: [{ delta_qty_signed: 5_000, reason_type: "transfer_between_warehouses" }],
  });
  const company = calculateHarvestLotAccounting({
    receivedKg: 23_500,
    currentKg: 20_000,
    ledgerEntries: [
      { delta_qty_signed: -3_500, reason_type: "WEIGHBRIDGE_IMPURITIES" },
      { delta_qty_signed: -5_000, reason_type: "transfer_between_warehouses" },
      { delta_qty_signed: 5_000, reason_type: "transfer_between_warehouses" },
    ],
  });
  assert.deepEqual([warehouseA.physicalKg, warehouseB.physicalKg, company.physicalKg], [15_000, 5_000, 20_000]);
  assert.deepEqual([warehouseA.reconciliationDeltaKg, warehouseB.reconciliationDeltaKg, company.reconciliationDeltaKg], [0, 0, 0]);
});
check("accounting E: reserve changes available stock but not physical stock", () => {
  const result = calculateHarvestLotAccounting({
    receivedKg: 23_500,
    currentKg: 20_000,
    reservedKg: 4_000,
    ledgerEntries: [{ delta_qty_signed: -3_500, reason_type: "WEIGHBRIDGE_IMPURITIES" }],
  });
  assert.equal(result.physicalKg, 20_000);
  assert.equal(result.reservedKg, 4_000);
  assert.equal(result.availableKg, 16_000);
  assert.equal(result.reconciliationDeltaKg, 0);
});
check("live refresh watches canonical lot accounting sources", () => {
  const liveRefresh = read("hooks/use-live-refresh.ts");
  assert.match(liveRefresh, /stock_ledger_entries/);
  assert.match(liveRefresh, /inventory_batches/);
  assert.match(liveRefresh, /tickets/);
});
check("review lot is explained without technical codes", () => assert.match(lotDialog, /Требуется уточнение[\s\S]*не объединяется с подтверждёнными партиями автоматически/));
check("potato harvest hides irrelevant moisture", () => assert.match(lotDialog, /!\/картоф\/i\.test\(batch\.cropName\)/));
check("live refresh invalidates targeted warehouse data", () => {
  assert.match(warehouses, /useLiveRefresh/);
  assert.match(warehouses, /loadWarehouseList[\s\S]*loadWarehouseDetails/);
});
check("every outgoing lot movement exposes a canonical source document", () => {
  assert.match(batchRoute, /outgoingDocuments/);
  assert.match(batchRoute, /sourceType/);
  assert.match(batchRoute, /weighbridge_ticket/);
  assert.match(batchRoute, /processing_document/);
  assert.match(batchRoute, /missing/);
  assert.match(batchRoute, /movementTicketsResult/);
  assert.match(batchRoute, /batch_transformations/);
});
check("stornoed outgoing movements are excluded from active source documents", () => {
  assert.match(batchRoute, /stornoTargetEntryIds/);
  assert.match(batchRoute, /!stornoTargetEntryIds\.has\(String\(entry\.id \|\| ""\)\)/);
});
check("impurity movement opens its existing weighbridge ticket", () => {
  assert.match(batchRoute, /movementLabel[\s\S]*reason\.includes\("impurit"\)/);
  assert.match(batchRoute, /movementTicketIds[\s\S]*entry\.ticket_id/);
  assert.match(lotDialog, /sourceType === "weighbridge_ticket"[\s\S]*openTicketPreview\(document\.ticketId/);
});
check("internal processing opens a processing document without a fake transport ticket", () => {
  assert.match(batchRoute, /processing_id \|\| entry\.reason_ref_id/);
  assert.match(lotDialog, /Документ переработки/);
  assert.match(lotDialog, /processing\.outputs\.map/);
  assert.doesNotMatch(lotDialog, /processingDocument[\s\S]{0,400}Транспорт не указан/);
});
check("each incoming trip opens the existing ticket over the warehouse lot", () => {
  assert.match(lotDialog, /trip\.ticketId[\s\S]*openTicketPreview\(trip\.ticketId/);
  assert.match(lotDialog, /<TicketPreviewDialog/);
  assert.doesNotMatch(lotDialog, /\/weighbridge\?ticket=/);
  assert.match(ticketPreview, /getTicketDetails\(ticketId,/);
});
check("closing ticket preview restores the exact lot scroll position", () => {
  assert.match(lotDialog, /savedScrollTopRef\.current = scrollRef\.current\?\.scrollTop/);
  assert.match(lotDialog, /scrollRef\.current\.scrollTop = savedScrollTopRef\.current/);
});
check("warehouse ticket PDF is generated only from its explicit button", () => {
  assert.match(ticketPreview, /onClick=\{\(\) => void downloadTicketPdf\(ticket\.id\)\}/);
  assert.equal((ticketPreview.match(/downloadTicketPdf\(/g) || []).length, 1);
});
check("deep-linked historical QA tickets bypass only the list filter, not RLS", () => {
  assert.match(page, /getTicketDetails/);
  assert.match(ticketPatch, /resolveWeighbridgeSession[\s\S]*\.eq\("company_id", companyId\)/);
});
check("ticket deep-link waits for the authenticated actor before its first request", () => {
  assert.match(page, /if \(!profile\?\.id \|\| notificationDeepLinkHandledRef\.current\) return/);
});
check("ticket deep-link uses the canonical journal row before endpoint fallback", () => {
  assert.match(page, /const cachedTicket = tickets\.find[\s\S]*if \(cachedTicket\)[\s\S]*setHistoryPreviewTicket\(cachedTicket\)/);
  assert.match(page, /if \(ticketsLoading\) return/);
});
check("ticket card keeps PDF lazy and shows the canonical human operator", () => {
  assert.match(ticketPaper, /ticketOperatorFacts\(ticket\)/);
  assert.doesNotMatch(ticketPaper, /ticket\.created_by_name_snapshot/);
  assert.match(page, /downloadTicketPdf\(historyPreviewTicket\.id/);
  assert.doesNotMatch(page, /useEffect[\s\S]{0,500}downloadTicketPdf/);
});
check("voided ticket card shows the recorded reason", () => {
  assert.match(ticketPaper, /ticket\.status === "voided"[\s\S]*ticket\.void_reason/);
});
check("outgoing transport fields are hidden when they do not apply", () => {
  assert.match(lotDialog, /document\.vehicleName \|\| document\.driverName/);
  assert.doesNotMatch(lotDialog, /document\.(vehicleName|driverName) \|\| "Не указано"/);
});
check("burts are not introduced", () => assert.doesNotMatch(`${operatorMigration}\n${lotMigration}\n${page}\n${warehouses}`, /\bburts?\b|\bбунт\b|\bбурт\b/i));

check("strict kilogram input accepts numbers and rejects human text", () => {
  assert.deepEqual(parseStrictWeightKg("25000"), { ok: true, value: 25_000, normalized: "25000" });
  assert.equal(parseStrictWeightKg("25 тонн").ok, false);
  assert.equal(parseStrictWeightKg("25т").ok, false);
  assert.equal(parseStrictWeightKg("25000 🚚").ok, false);
});
check("impossible gross tare and net values are blocked", () => {
  assert.deepEqual(validateHarvestWeights(25_000, 12_000), { ok: true, net: 13_000 });
  assert.equal(validateHarvestWeights(0, 12_000).ok, false);
  assert.deepEqual(validateHarvestWeights(25_000, 0), { ok: true, net: 25_000 });
  assert.equal(validateHarvestWeights(25_000, 25_000).ok, false);
  assert.equal(validateHarvestWeights(25_000, 50_000).ok, false);
});
check("tare variance warns at twenty percent in both directions", () => {
  assert.equal(requiresTareConfirmation(12_000, 14_300), false);
  assert.equal(requiresTareConfirmation(12_000, 14_400), true);
  assert.equal(requiresTareConfirmation(12_000, 9_600), true);
  assert.equal(tareDifferencePercent(12_000, 14_400), 20);
  assert.equal(tareDifferencePercent(12_000, 9_600), -20);
});
check("ticket correction links are additive and preserve both documents", () => {
  assert.match(correctionMigration, /correction_of_ticket_id uuid references public\.tickets\(id\) on delete restrict/);
  assert.match(correctionMigration, /replacement_ticket_id uuid references public\.tickets\(id\) on delete restrict/);
  assert.doesNotMatch(correctionMigration, /delete from public\.tickets/);
});
check("open ticket correction updates one ticket and writes audit history", () => {
  assert.match(correctionMigration, /create or replace function public\.update_open_weighbridge_ticket_v1/);
  assert.match(correctionMigration, /update public\.tickets[\s\S]*where id = p_ticket_id/);
  assert.match(correctionMigration, /insert into public\.audit_log/);
});
check("tare baseline uses the last valid finalized ticket", () => {
  assert.match(correctionMigration, /order by t\.finalized_at desc nulls last, t\.updated_at desc/);
  assert.match(correctionMigration, /coalesce\(t\.is_voided, false\) = false/);
  assert.match(correctionMigration, /is_voided = true[\s\S]*replacement_ticket_id = v_new\.id/);
});
check("unusual tare requires and records explicit confirmation", () => {
  assert.match(correctionMigration, /abs\(v_difference_percent\) >= 20 and not p_tare_variance_confirmed/);
  assert.match(correctionMigration, /tare_variance_confirmation_required/);
  assert.match(correctionMigration, /'tare_variance_confirmed', coalesce\(p_tare_variance_confirmed, false\)/);
});
check("finalized correction clones a replacement and links it to the old ticket", () => {
  assert.match(correctionMigration, /create or replace function public\.start_weighbridge_ticket_correction_v1/);
  assert.match(correctionMigration, /insert into public\.tickets[\s\S]*correction_of_ticket_id/);
  assert.match(correctionMigration, /insert into public\.ticket_lines/);
});
check("finalized correction reverses old accounting before canonical finalize", () => {
  assert.match(correctionMigration, /storno_of_entry_id/);
  assert.match(correctionMigration, /set current_weight_kg = 0/);
  assert.match(correctionMigration, /perform public\.finalize_weighbridge_ticket_for_session_v1\(v_new\.id\)/);
  assert.match(correctionMigration, /replacement_ticket_id = v_new\.id/);
});
check("downstream-used harvest blocks simple correction", () => {
  assert.match(correctionMigration, /private\.weighbridge_ticket_has_downstream_dependencies_v1/);
  assert.match(correctionMigration, /if private\.weighbridge_ticket_has_downstream_dependencies_v1\([^)]+\) then[\s\S]{0,250}raise exception/);
  assert.match(correctionRoute, /status === 409/);
});
check("correction authorization is bound to the current human operator or admin", () => {
  assert.match(correctionMigration, /private\.assert_weighbridge_ticket_correction_actor_v1/);
  assert.match(correctionRoute, /requireWeighbridgeOperatorSession/);
  assert.match(auth, /company_admin/);
});
check("server routes repeat strict weight validation", () => {
  assert.match(ticketRoute, /parseStrictWeightKg\(rawTicket\.gross_weight_kg/);
  assert.match(ticketPatch, /parseStrictWeightKg\(body\.tare_weight_kg/);
});
check("warehouse overlay shows correction status and replacement relation", () => {
  assert.match(ticketPaper, /ticket\.replacement_ticket/);
  assert.match(ticketPaper, /ticket\.correction_of_ticket/);
  assert.match(ticketPaper, /ticket\.status === "voided"/);
});

check("one canonical ticket component is shared by weighbridge and history", () => {
  assert.equal((page.match(/<WeighbridgeTicketPaper/g) || []).length, 2);
});
check("warehouse trip overlay uses the canonical ticket component", () => {
  assert.match(ticketPreview, /<WeighbridgeTicketPaper\s+ticket=\{ticket\}/);
});
check("PDF print uses the canonical ticket component", () => {
  assert.match(printPage, /<WeighbridgeTicketPaper ticket=\{ticket\}/);
});
check("harvest ticket has no sowing-row duplicate or technical batch code", () => {
  assert.doesNotMatch(ticketPaper, /Посевная строка|HAR-|lot_id|batch_id/);
});
check("harvest ticket shows its identity facts once", () => {
  assert.equal((ticketPaper.match(/label="Культура"/g) || []).length, 1);
  assert.equal((ticketPaper.match(/label="Сорт"/g) || []).length, 1);
  assert.equal((ticketPaper.match(/label="Репродукция"/g) || []).length, 1);
});
check("potato moisture is hidden from the canonical ticket", () => {
  assert.match(ticketPaper, /isHarvest && !isPotato\(crop\)/);
});
check("empty optional quality and comment facts are omitted", () => {
  assert.match(ticketPaper, /<Fact label="Влажность" value=\{moisture\}/);
  assert.match(ticketPaper, /<Fact label="Комментарий" value=\{first\(ticket\.notes\)\}/);
  assert.doesNotMatch(ticketPaper, /Влажность:\s*[—-]|Примечание:\s*[—-]|Примесь:\s*[—-]/);
});
check("harvest hides product rows while multi-line supplier receipts retain them", () => {
  assert.match(ticketPaper, /!isHarvest && \(isSupplier \? lines\.length > 1 : lines\.length > 0\)/);
});

assert.equal(passed, 93);
console.log(`TZ263 ${passed}/${passed} PASS`);
