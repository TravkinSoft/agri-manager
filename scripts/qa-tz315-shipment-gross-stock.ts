import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveStockOutQuantityAtCreate } from "../lib/weighbridge/stock-out-availability";

const route = readFileSync(resolve("app/api/weighbridge/tickets/route.ts"), "utf8");
const page = readFileSync(resolve("app/(dashboard)/weighbridge/page.tsx"), "utf8");
const finalizeRoute = readFileSync(resolve("app/api/weighbridge/tickets/[id]/finalize/route.ts"), "utf8");
const ticketPaper = readFileSync(resolve("components/weighbridge/weighbridge-ticket-paper.tsx"), "utf8");
const shipmentMigration = readFileSync(
  resolve("supabase/migrations/20260916145647_p0_shipment_tare_first_atomic_v1.sql"),
  "utf8",
);

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("legacy gross-only stock availability remains deferred until tare", () => {
  assert.equal(resolveStockOutQuantityAtCreate({
    lineQuantity: 11_000,
    grossWeightKg: 11_000,
    tareWeightKg: null,
    weighMethod: "scale",
  }), null);
});

check("known gross and tare compare the physical net", () => {
  assert.equal(resolveStockOutQuantityAtCreate({
    lineQuantity: 11_000,
    grossWeightKg: 11_000,
    tareWeightKg: 6_000,
    weighMethod: "scale",
  }), 5_000);
});

check("direct quantity documents compare their explicit quantity", () => {
  assert.equal(resolveStockOutQuantityAtCreate({
    lineQuantity: 5_000,
    grossWeightKg: null,
    tareWeightKg: null,
    weighMethod: "manual_override_with_reason",
  }), 5_000);
});

check("invalid direct quantity is never treated as an available amount", () => {
  assert.equal(resolveStockOutQuantityAtCreate({
    lineQuantity: 0,
    grossWeightKg: null,
    tareWeightKg: null,
    weighMethod: "manual_override_with_reason",
  }), null);
});

check("ticket creation still proves the selected identity exists", () => {
  assert.match(route, /if \(isShipment \|\| isDisposal\)[\s\S]*?selectedStockAvailability\(line\)/);
});

check("ticket creation compares only a quantity known before finalize", () => {
  assert.match(route, /const stockOutQuantityAtCreate = resolveStockOutQuantityAtCreate\(/);
  assert.match(route, /const quantityToCheck = isShipment \? Number\(line\.quantity \|\| 0\) : stockOutQuantityAtCreate/);
  assert.match(route, /quantityToCheck != null && available < quantityToCheck/);
});

check("shipment opens with tare and without gross", () => {
  assert.match(page, /gross_weight_kg: isSupplierDirect \|\| isShipment \? null/);
  assert.match(page, /tare_weight_kg: isShipment \? toNum\(form\.tareKg\)/);
  assert.match(page, /Первое взвешивание отгрузки: тара пустой машины/);
  assert.match(route, /Отгрузка открывается по таре пустой машины\. Брутто вводится после загрузки\./);
});

check("shipment requires the business document fields", () => {
  assert.match(page, /<Label>Партия со склада \*<\/Label>/);
  assert.match(page, /<Label>Контрагент \*<\/Label>/);
  assert.match(page, /<Label>Куда \*<\/Label>/);
  assert.match(page, /<CompactField label=\{isShipment \? "Тара пустой машины \(кг\)" : "Брутто \/ вес \(кг\)"\}/);
});

check("shipment closes through its dedicated gross RPC", () => {
  assert.match(finalizeRoute, /isTareFirstShipmentFinalize[\s\S]*close_shipment_ticket_atomic_v1/);
  assert.match(finalizeRoute, /p_gross_weight_kg: gross/);
  assert.match(finalizeRoute, /shipment_finalize_timeout/);
});

check("atomic close serializes against other ticket processing", () => {
  const gateIndex = shipmentMigration.indexOf("perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id)");
  const ticketLockIndex = shipmentMigration.indexOf("where id = p_ticket_id\n  for update");
  assert.ok(gateIndex >= 0 && ticketLockIndex > gateIndex);
});

check("atomic close writes tare then gross and derives the net", () => {
  assert.match(shipmentMigration, /weighing_no = 1[\s\S]*abs\(tw\.measured_weight_kg - v_tare\)/);
  assert.match(shipmentMigration, /v_net := round\(v_gross - v_tare, 3\)/);
  assert.match(shipmentMigration, /v_ticket\.id, v_ticket\.company_id, 2, v_gross/);
});

check("canonical finalize replaces planned quantity with actual net before stock debit", () => {
  const syncIndex = shipmentMigration.indexOf("set quantity = v_net");
  const finalizeIndex = shipmentMigration.indexOf("perform public.finalize_weighbridge_ticket_for_session_v1");
  assert.ok(syncIndex >= 0 && finalizeIndex > syncIndex);
});

check("postconditions prove exactly two weights and the exact outbound debit", () => {
  assert.match(shipmentMigration, /v_weighing_count <> 2/);
  assert.match(shipmentMigration, /abs\(v_line_total - v_net\) > 0\.001/);
  assert.match(shipmentMigration, /abs\(v_out_total - v_net\) > 0\.001/);
});

check("atomic close is not callable by anonymous users", () => {
  assert.match(shipmentMigration, /revoke all on function public\.close_shipment_ticket_atomic_v1[\s\S]*from public, anon/);
});

check("open shipment paper asks for gross and shows destination", () => {
  assert.match(ticketPaper, /inputKind\?: "tare" \| "gross"/);
  assert.match(ticketPaper, /aria-label="Брутто, кг"/);
  assert.match(ticketPaper, /<Fact label="Куда" value=\{first\(ticket\.destination_text\)\}/);
});

console.log(`P0 shipment tare-first and stock correctness: ${passed}/${passed} PASS`);
