import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { isTrafficAcknowledgement, optimisticTrafficVehicles, trafficCommandObserved, type PendingTrafficCommand } from "../lib/traffic/optimistic";
import { nextState, type TrafficRole, type TrafficSnapshot, type TrafficState } from "../lib/traffic/model";

let checks = 0;
const check = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };
for (const role of ["harvester", "receiver", "manager"] as TrafficRole[]) {
  for (const state of ["empty", "loaded", "unloading"] as TrafficState[]) {
    const snapshot: TrafficSnapshot = {
      companyId: "company-a", role, personName: "QA", enabled: true, fieldName: null, fieldId: null,
      serverTime: "2026-09-04T16:00:00Z", events: [], vehicles: [{ vehicle_id: "car-a", name: "KAMAZ", plate: "QA-207",
        driver: "Original driver", state, version: 8, cycle: 2, assigned: true, since: "2026-09-04T15:00:00Z" }],
    };
    const target = nextState(role, state) ?? "loaded";
    const command: PendingTrafficCommand = { vehicle: snapshot.vehicles[0], target, key: "command-a", phase: "sending", since: snapshot.serverTime };
    const original = JSON.stringify(snapshot);
    const projected = optimisticTrafficVehicles(snapshot, [command]);
    const expectedState = nextState(role, state) ? target : state;
    check(projected.length, role === "receiver" && expectedState === "empty" ? 0 : 1);
    if (projected.length) {
      check(projected[0].state, expectedState); check(projected[0].version, 8); check(projected[0].cycle, 2);
      check(projected[0].driver, "Original driver");
    }
    check(JSON.stringify(snapshot), original);
    check(trafficCommandObserved(snapshot, command), false);
    const newer = { ...snapshot, vehicles: snapshot.vehicles.map(vehicle => ({ ...vehicle, version: 9 })) };
    check(trafficCommandObserved(newer, command), true);
    check(optimisticTrafficVehicles(newer, [command])[0]?.state ?? "hidden", role === "receiver" && state === "empty" ? "hidden" : state);
    check(optimisticTrafficVehicles(snapshot, [{ ...command, phase: "uncertain" }])[0]?.state ?? "hidden", role === "receiver" && state === "empty" ? "hidden" : state);
  }
}
const receipt = { eventId: "60000000-0000-4000-8000-000000000001", serverTime: "2026-09-04T16:00:00Z", replayed: false, refreshRequired: true, vehicle: null };
check(isTrafficAcknowledgement(receipt), true);
for (const bad of [null, {}, { ...receipt, eventId: "not-an-event" }, { ...receipt, replayed: "false" },
  { ...receipt, refreshRequired: undefined }, { ...receipt, serverTime: "bad" }]) check(isTrafficAcknowledgement(bad), false);

// Run the actual shared channel: one listener per page, invalidation-only payload,
// malformed input rejected, subscriber failures isolated, complete cleanup.
const channels: any[] = [];
class TestChannel {
  closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  messages: unknown[] = [];
  constructor(public name: string) { channels.push(this); }
  postMessage(value: unknown) { this.messages.push(JSON.parse(JSON.stringify(value))); }
  close() { this.closed = true; }
}
const loaded = { exports: {} as any };
vm.runInNewContext(ts.transpileModule(readFileSync("lib/traffic/changes.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: loaded, exports: loaded.exports, BroadcastChannel: TestChannel });
const api = loaded.exports;
const received: string[] = [];
const stopBad = api.subscribeTrafficChanges(() => { throw new Error("isolated consumer"); });
const stopGood = api.subscribeTrafficChanges((companyId: string) => received.push(companyId));
check(channels.length, 1);
for (const data of [null, {}, { companyId: 7 }, { companyId: "" }, { companyId: "x".repeat(65) }]) channels[0].onmessage({ data });
check(received.length, 0);
channels[0].onmessage({ data: { companyId: "company-a", state: "ignored", driver: "ignored" } });
check(received, ["company-a"]); check(channels[0].messages.length, 0);
api.publishTrafficChanged("company-a"); check(channels[0].messages, [{ companyId: "company-a" }]);
api.publishTrafficChanged(undefined); check(channels[0].messages.length, 1);
stopBad(); check(channels[0].closed, false);
stopGood(); check(channels[0].closed, true);
console.log(`PTC instant feedback PASS: ${checks} checks (pure UI projection, canonical immutability, invalid acknowledgements, actual cross-tab channel; no remote writes).`);
