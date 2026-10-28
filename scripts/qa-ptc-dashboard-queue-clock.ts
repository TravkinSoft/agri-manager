import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { trafficStatusSince, visibleVehicles, type TrafficVehicle } from "../lib/traffic/model";
import { buildTrafficBoard } from "../lib/traffic/read-only-board";

const source = readFileSync("components/dashboard/dashboard-traffic-panel.tsx", "utf8");
assert.match(source, /age\(vehicle.since, now\)/);
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
const queue = [fromOffline, fromRepair, waiting];
const board = buildTrafficBoard("company", {vehicles:queue, serverTime:"2026-09-19T09:00:00Z"},
  queue.map(v => ({id:v.vehicle_id,name:v.name,plate:null,driver:v.driver,state:v.state,assigned:true,
    inRepair:false,repairChangedAt:v.repairChangedAt,lastActivity:v.since})));
assert.deepEqual(board.vehicles.map(v=>v.id), ["waiting", "repair-return", "line-return"]);
assert.equal(board.vehicles.find(v=>v.id==='repair-return')?.since, fromRepair.repairChangedAt);
console.log("PASS: dashboard and PTC share the queue clock, repair/off-line returns append to tail, next state supersedes repair clock");
