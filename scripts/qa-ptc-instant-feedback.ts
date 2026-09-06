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

// Run the actual shared channels: BroadcastChannel for tabs on this device and
// Supabase Broadcast for other authenticated devices. Both carry invalidation only.
const channels: any[] = [];
class TestChannel {
  closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  messages: unknown[] = [];
  constructor(public name: string) { channels.push(this); }
  postMessage(value: unknown) { this.messages.push(JSON.parse(JSON.stringify(value))); }
  close() { this.closed = true; }
}
const liveChannels: TestLiveChannel[] = [];
const authTokens: string[] = [];
class TestLiveChannel {
  callback: (() => void) | null = null;
  onType = "";
  onEvent = "";
  subscribed = false;
  removed = false;
  messages: unknown[] = [];
  constructor(public name: string, public options: unknown) { liveChannels.push(this); }
  on(type: string, filter: { event: string }, callback: () => void) {
    this.onType = type; this.onEvent = filter.event; this.callback = callback; return this;
  }
  subscribe() { this.subscribed = true; return this; }
  async send(value: unknown) { this.messages.push(JSON.parse(JSON.stringify(value))); return "ok"; }
}
const fakeSupabase = {
  auth: { getSession: async () => ({ data: { session: { access_token: "test-access-token" } }, error: null }) },
  realtime: { setAuth: async (token: string) => { authTokens.push(token); } },
  channel: (name: string, options: unknown) => new TestLiveChannel(name, options),
  removeChannel: async (channel: TestLiveChannel) => { channel.removed = true; return "ok"; },
};
const loaded = { exports: {} as any };
vm.runInNewContext(ts.transpileModule(readFileSync("lib/traffic/changes.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module: loaded, exports: loaded.exports, BroadcastChannel: TestChannel,
  require: (specifier: string) => {
    if (specifier === "@/lib/supabase/client") return { supabase: fakeSupabase };
    throw new Error(`Unexpected test import: ${specifier}`);
  },
});
const api = loaded.exports;
const liveCompany = "10000000-0000-4000-8000-000000000001";
const otherCompany = "20000000-0000-4000-8000-000000000002";
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

async function verifyChannels() {
  const received: string[] = [];
  const stopBad = api.subscribeTrafficChanges(liveCompany, () => { throw new Error("isolated consumer"); });
  const stopGood = api.subscribeTrafficChanges(liveCompany, (companyId: string) => received.push(companyId));
  const stopOther = api.subscribeTrafficChanges(otherCompany, () => received.push("wrong-company"));
  check(channels.length, 1);
  await flush();
  check(liveChannels.map(channel => ({ name: channel.name, onType: channel.onType, onEvent: channel.onEvent, subscribed: channel.subscribed })), [
    { name: `travkinflow:traffic:${liveCompany}`, onType: "broadcast", onEvent: "changed", subscribed: true },
    { name: `travkinflow:traffic:${otherCompany}`, onType: "broadcast", onEvent: "changed", subscribed: true },
  ]);
  check(authTokens.every(token => token === "test-access-token"), true);
  for (const data of [null, {}, { companyId: 7 }, { companyId: "" }, { companyId: "x".repeat(65) }]) channels[0].onmessage({ data });
  check(received.length, 0);
  channels[0].onmessage({ data: { companyId: liveCompany, state: "ignored", driver: "ignored" } });
  check(received, [liveCompany]); check(channels[0].messages.length, 0);
  liveChannels.find(channel => channel.name.endsWith(liveCompany))?.callback?.();
  check(received, [liveCompany, liveCompany]);
  liveChannels.find(channel => channel.name.endsWith(otherCompany))?.callback?.();
  check(received.includes("wrong-company"), true);
  api.publishTrafficChanged(liveCompany);
  await flush();
  check(channels[0].messages, [{ companyId: liveCompany }]);
  check(liveChannels.find(channel => channel.name.endsWith(liveCompany))?.messages, [{
    type: "broadcast", event: "changed", payload: {},
  }]);
  api.publishTrafficChanged(undefined); api.publishTrafficChanged("not-a-company-id");
  await flush(); check(channels[0].messages.length, 1);
  stopBad(); check(channels[0].closed, false);
  stopGood(); check(channels[0].closed, false);
  stopOther(); await flush();
  check(channels[0].closed, true); check(liveChannels.every(channel => channel.removed), true);
  console.log(`PTC instant feedback PASS: ${checks} checks (instant UI, cross-tab and cross-device invalidation, tenant filtering, cleanup; no remote writes).`);
}
void verifyChannels().catch(error => { console.error(error); process.exitCode = 1; });
