import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { trafficStatusSince, visibleVehicles, type TrafficVehicle } from "../lib/traffic/model";

const source = readFileSync("components/dashboard/harvest-dashboard.tsx", "utf8");
assert.match(source, /age\(trafficStatusSince\(vehicle, "manager"\), now\)/);
const vehicle = (id: string, since: string, repairChangedAt: string | null = null): TrafficVehicle => ({
  vehicle_id: id, name: id, plate: null, driver: "Test", state: "empty", version: 1,
  cycle: 1, assigned: true, inRepair: false, since, repairChangedAt,
});
const waiting = vehicle("waiting", "2026-09-19T06:00:00Z");
const fromRepair = vehicle("repair-return", "2026-09-07T05:15:00Z", "2026-09-19T07:00:00Z");
const fromOffline = vehicle("line-return", "2026-09-19T07:10:00Z");
assert.equal(trafficStatusSince(fromRepair, "manager"), fromRepair.repairChangedAt);
assert.equal(trafficStatusSince(fromOffline, "manager"), fromOffline.since);
for (const role of ["manager", "harvester"] as const) {
  assert.deepEqual(visibleVehicles([fromOffline, fromRepair, waiting], role).map(v => v.vehicle_id), ["waiting", "repair-return", "line-return"]);
}
assert.equal(trafficStatusSince({ ...fromRepair, since: "2026-09-19T08:00:00Z" }, "manager"), "2026-09-19T08:00:00Z");
console.log("PASS: dashboard and PTC share the queue clock, repair/off-line returns append to tail, next state supersedes repair clock");
