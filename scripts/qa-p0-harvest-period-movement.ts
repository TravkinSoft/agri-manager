import assert from "node:assert/strict";
import { buildHarvestOverview, buildPotatoPeriodMovement, resolveHarvestPeriod } from "../lib/dashboard/harvest-summary";
import type { WeighbridgeTicket } from "../lib/types/weighbridge";

const period = resolveHarvestPeriod({ now: new Date("2026-09-19T20:02:00Z") });
assert.equal(period.start, "2026-09-19T02:00:00.000Z");
let seq = 0;
function row(override: Partial<WeighbridgeTicket> = {}): WeighbridgeTicket {
  return {
    id: `ticket-${++seq}`, op_type: "harvest_incoming", status: "finalized", is_finalized: true, is_voided: false,
    net_weight_kg: 777070, harvest_clean_weight_kg: 698627.344, field_id: "vine", warehouse_to_id: "warehouse",
    created_at: "2026-09-19T05:00:00Z", finalized_at: "2026-09-19T19:36:00Z",
    lines: [{ id: "line", crop_id: "potato", crop_name: "Картофель", product_name: "Картофель", variety_id: "gala", reproduction_id: "r1" }],
    ...override,
  } as WeighbridgeTicket;
}
const receipt = row();
const removal = row({ op_type: "weighbridge_impurities", net_weight_kg: 130380, accepted_weight_kg: 103140, warehouse_from_id: "warehouse" });
const prior = row({ net_weight_kg: 201140, finalized_at: "2026-09-18T15:00:00Z" });
const result = buildPotatoPeriodMovement([receipt, prior], [removal], period);
assert.deepEqual(result, { receivedNetKg: 777070, removedImpuritiesKg: 130380, netAfterRemovalsKg: 646690, unresolvedTicketCount: 0 });
assert.equal(buildPotatoPeriodMovement([receipt, receipt], [removal, removal], period).netAfterRemovalsKg, 646690);
const ignored = [
  row({ ...removal, id: "open", status: "active", is_finalized: false }),
  row({ ...removal, id: "void", status: "voided", is_voided: true }),
  row({ ...removal, id: "replaced", replacement_ticket_id: "other" }),
  row({ ...removal, id: "before", finalized_at: "2026-09-19T01:59:59Z" }),
  row({ ...removal, id: "at-end", finalized_at: period.end }),
  row({ ...removal, id: "carrot", lines: [{ crop_id: "carrot", crop_name: "Морковь" }] as any }),
];
assert.equal(buildPotatoPeriodMovement([receipt], [removal, ...ignored], period).netAfterRemovalsKg, 646690);
assert.equal(buildPotatoPeriodMovement([], [removal], period).netAfterRemovalsKg, -130380);
assert.equal(buildPotatoPeriodMovement([receipt], [row({ ...removal, id: "unknown", lines: [] })], period).netAfterRemovalsKg, null);
assert.equal(buildPotatoPeriodMovement([receipt], [row({ ...removal, id: "pooled", field_id: null })], period, { fieldId: "vine" }).netAfterRemovalsKg, null);
assert.equal(buildPotatoPeriodMovement([receipt], [removal], period, { warehouseId: "other" }).netAfterRemovalsKg, 0);
const original = row({ ...removal, id: "original", finalized_at: "2026-09-18T15:00:00Z", replacement_ticket_id: "corrected" });
const corrected = row({ ...removal, id: "corrected", correction_of_ticket_id: "original" });
assert.equal(buildPotatoPeriodMovement([receipt], [original, corrected], period).netAfterRemovalsKg, 777070);
assert.equal(buildPotatoPeriodMovement([row({net_weight_kg: 1.111})], [row({...removal,net_weight_kg:0.222})], period).netAfterRemovalsKg, 0.889);
const summary = buildHarvestOverview([receipt], { period, impurityTickets: [removal] });
assert.equal(summary.potatoPeriodMovement.netAfterRemovalsKg, 646690);
assert.equal(summary.potatoAcceptedKg, 698627.344); // receipt-cohort yield stays separate
assert.equal(summary.potatoDrivers.reduce((sum, driver) => sum + driver.netWeightKg, 0), 777070);
console.log("PASS: paper reconciliation 777070 - 130380 = 646690; overnight 07:00 boundary; exclusions; dedupe; corrections; crop/warehouse isolation; unknown attribution; negative day; precision; driver and yield unchanged.");
