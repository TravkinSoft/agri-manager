import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { buildHarvestOverview, resolveHarvestPeriod } from "../lib/dashboard/harvest-summary";
import type { WeighbridgeTicket } from "../lib/types/weighbridge";

const dashboard = readFileSync("components/dashboard/harvest-dashboard.tsx", "utf8");
assert.doesNotMatch(dashboard, /PotatoDriverSummary|refreshDrivers|driverSummary|championPeriod|таблиц[ау] чемпионов/i);
assert.match(dashboard, /includeDriverStats: false/);
assert(!existsSync("components/dashboard/potato-driver-summary.tsx"));
const route = readFileSync("app/api/dashboard/harvest-summary/route.ts", "utf8");
assert.match(route, /loadTickets\(supabase, companyId, includeDriverStats\)/);
assert.match(route, /const ptcEventIds = includeDriverStats \? uniqueIds\([^;]+: \[\];/);
assert.match(route, /impurityTickets,\s+includeDriverStats,/);
const service = readFileSync("lib/services/harvest-dashboard.ts", "utf8");
assert.match(service, /query.includeDriverStats === false\) params.set\("includeDriverStats", "false"\)/);

const now = new Date("2026-09-20T16:00:00Z");
const period = resolveHarvestPeriod({ now });
const receipt = {
  id: "receipt", op_type: "harvest_incoming", status: "finalized", is_finalized: true,
  is_voided: false, net_weight_kg: 20000, harvest_clean_weight_kg: 18000,
  created_at: "2026-09-20T05:00:00Z", finalized_at: "2026-09-20T06:00:00Z",
  field_id: "field", driver_id: "driver", driver_name_snapshot: "Водитель",
  lines: [{ crop_id: "potato", crop_name: "Картофель", product_name: "Картофель" }],
} as WeighbridgeTicket;
for (const tickets of [[], [receipt], [receipt, { ...receipt, id: "second", driver_id: "second-driver" }]]) {
  const before = buildHarvestOverview(tickets, { period, now });
  const after = buildHarvestOverview(tickets, { period, now, includeDriverStats: false });
  assert.deepEqual(after.potatoDrivers, []);
  assert.deepEqual(after, { ...before, potatoDrivers: [] });
  if (tickets.length) assert(before.potatoDrivers.length > 0, "legacy consumers still supported");
}
console.log("PASS: leaderboard component, effect and request removed; PTC timing queries gated; all non-driver summary fields unchanged for empty/single/multiple receipts.");
