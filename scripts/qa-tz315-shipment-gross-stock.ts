import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveStockOutQuantityAtCreate } from "../lib/weighbridge/stock-out-availability";

const route = readFileSync(resolve("app/api/weighbridge/tickets/route.ts"), "utf8");
const finalizeMigration = readFileSync(
  resolve("supabase/migrations/20260820233817_tz294_warehouse_local_transfer_correction_v1.sql"),
  "utf8",
);

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("gross-only shipment defers quantity comparison until tare", () => {
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
  assert.match(route, /resolveStockOutQuantityAtCreate\([\s\S]*?stockOutQuantityAtCreate != null && available < stockOutQuantityAtCreate/);
  assert.doesNotMatch(route, /if \(isShipment \|\| isDisposal\)[\s\S]{0,500}?available < requiredQty/);
});

check("canonical finalize replaces provisional gross with net before stock RPC", () => {
  const syncIndex = finalizeMigration.indexOf("set quantity = v_ticket.net_weight_kg");
  const finalizeIndex = finalizeMigration.indexOf("perform public.finalize_weighbridge_ticket_v2");
  assert.ok(syncIndex >= 0 && finalizeIndex > syncIndex);
});

console.log(`TZ315 shipment gross stock corrective: ${passed}/7 PASS`);
