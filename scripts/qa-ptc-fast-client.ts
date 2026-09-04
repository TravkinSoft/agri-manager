import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as model from "../lib/traffic/model";
import type { VehicleDriverAssignmentResult } from "../lib/vehicles/driver-assignment-client";

const localRequire = createRequire(import.meta.url);
const source = readFileSync("components/traffic/use-traffic.ts", "utf8");
let checks = 0;
function check(actual: unknown, expected: unknown) { assert.deepEqual(actual, expected); checks++; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const snapshot = (vehicleId = "car-a", version = 1, state: model.TrafficState = "empty", role: model.TrafficRole = "harvester"): model.TrafficSnapshot => ({
  role, companyId: "company-a", personName: "Operator", enabled: true, fieldId: null, fieldName: null,
  serverTime: "2026-09-04T10:00:00Z", events: [],
  vehicles: [{ vehicle_id: vehicleId, name: "Existing truck", plate: "QA-101", driver: "Existing driver", state, version,
    since: "2026-09-04T09:58:00Z", cycle: 1, assigned: true }],
});
const receipt = (vehicleId = "car-a", version = 2, state: model.TrafficState = "loaded"): model.TrafficCommit => ({
  eventId: "60000000-0000-4000-8000-000000000001", replayed: false, refreshRequired: false, serverTime: "2026-09-04T10:01:00Z",
  vehicle: { vehicle_id: vehicleId, state, version, since: "2026-09-04T10:01:00Z", cycle: 1, assigned: true },
});

// Run the actual hook and trafficRequest with a deterministic hooks dispatcher and
// controllable fetch/timers. Fetch deliberately ignores AbortSignal: epoch guards
// must still reject an old response after a commit or an account change.
function harness(isManager = false, initiallyHidden = false) {
  const states: any[] = [], refs: any[] = [];
  const callbacks: Array<{ deps: unknown[]; value: unknown }> = [];
  const effectSlots: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
  const effects: Array<() => void> = [];
  const requests: Array<{ path: string; options: RequestInit; result: ReturnType<typeof deferred<Response>> }> = [];
  const timers = new Map<number, { ms: number; callback: () => unknown }>();
  const windowListeners = new Map<string, () => void>();
  const documentListeners = new Map<string, () => void>();
  const documentMock = { visibilityState: initiallyHidden ? "hidden" : "visible",
    addEventListener: (event: string, callback: () => void) => documentListeners.set(event, callback),
    removeEventListener: (event: string) => documentListeners.delete(event),
  };
  const navigatorMock = { onLine: true };
  let stateIndex = 0, refIndex = 0, callbackIndex = 0, effectIndex = 0, timerId = 0, unsubscribed = 0;
  let authChange: (event: string, session: { user: { id: string } } | null) => void = () => undefined;
  let assignmentListener: ((result: VehicleDriverAssignmentResult) => void) | null = null;
  const sameDeps = (left: unknown[], right: unknown[]) => left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const loaded = { exports: {} as any };
  const dependencies: Record<string, unknown> = {
    react: {
      useState: (initial: unknown) => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (value: any) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useRef: (initial: unknown) => { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }); },
      useCallback: (value: unknown, deps: unknown[]) => {
        const index = callbackIndex++;
        if (!callbacks[index] || !sameDeps(callbacks[index].deps, deps)) callbacks[index] = { value, deps: [...deps] };
        return callbacks[index].value;
      },
      useEffect: (effect: () => (() => void), deps: unknown[]) => {
        const index = effectIndex++;
        if (!effectSlots[index] || !sameDeps(effectSlots[index].deps, deps)) effects.push(() => {
          effectSlots[index]?.cleanup?.();
          effectSlots[index] = { deps: [...deps], cleanup: effect() };
        });
      },
    },
    "@/lib/traffic/model": model,
    "@/lib/supabase/client": { supabase: { auth: { onAuthStateChange: (callback: typeof authChange) => {
      authChange = callback; callback("INITIAL_SESSION", { user: { id: "account-a" } });
      return { data: { subscription: { unsubscribe: () => { unsubscribed++; } } } };
    } } } },
    "@/lib/supabase/client-auth": { buildClientAuthHeaders: async () => ({ Authorization: "Bearer test-only-token" }) },
    "@/lib/vehicles/driver-assignment-client": { subscribeVehicleDriverAssignments: (listener: (result: VehicleDriverAssignmentResult) => void) => {
      assignmentListener = listener;
      return () => { if (assignmentListener === listener) assignmentListener = null; };
    } },
  };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: loaded, exports: loaded.exports, AbortController,
    require: (name: string) => dependencies[name] ?? localRequire(name),
    navigator: navigatorMock, document: documentMock,
    window: {
      setTimeout: (callback: () => unknown, ms: number) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
      clearTimeout: (id: number) => timers.delete(id),
      addEventListener: (event: string, callback: () => void) => windowListeners.set(event, callback),
      removeEventListener: (event: string) => windowListeners.delete(event),
    },
    fetch: (path: string, options: RequestInit) => {
      const result = deferred<Response>(); requests.push({ path, options, result }); return result.promise;
    },
  });
  const render = () => {
    stateIndex = refIndex = callbackIndex = effectIndex = 0;
    const value = loaded.exports.useTraffic(isManager);
    effects.splice(0).forEach(effect => effect());
    return value;
  };
  return {
    render, requests, timers, navigator: navigatorMock, document: documentMock,
    request: loaded.exports.trafficRequest as (path: string, method?: string, body?: unknown) => Promise<any>,
    respond: async (index: number, payload: unknown, status = 200) => {
      assert.ok(requests[index], `fetch ${index} exists`);
      requests[index].result.resolve(new Response(JSON.stringify(payload), { status })); await flush();
    },
    auth: (event: string, id: string | null) => authChange(event, id ? { user: { id } } : null),
    assignment: (value: VehicleDriverAssignmentResult) => assignmentListener?.(value),
    hasAssignmentListener: () => assignmentListener !== null,
    fire: (event: string) => (windowListeners.get(event) ?? documentListeners.get(event))?.(),
    runTimer: async (ms: number) => {
      const entry = Array.from(timers).find(([, timer]) => timer.ms === ms);
      assert.ok(entry, `scheduled ${ms}ms timer exists`); checks++;
      timers.delete(entry[0]); void entry[1].callback(); await flush();
    },
    unmount: () => effectSlots.forEach(effect => effect.cleanup?.()),
    cleanupState: () => ({ unsubscribed, windowListeners: windowListeners.size, documentListeners: documentListeners.size, timers: timers.size }),
  };
}

async function ready(h: ReturnType<typeof harness>, initial = snapshot()) {
  h.render(); await flush();
  check(h.requests.length, 1);
  await h.respond(0, initial);
  const live = h.render();
  check(live.loading, false); check(live.stale, false); check(live.data.vehicles[0].version, initial.vehicles[0].version);
  return live;
}
async function main() {
  const h = harness();
  let live = await ready(h);
  check(h.requests[0].path, "/api/traffic/operator");
  check(h.requests[0].options.cache, "no-store");
  check(h.requests[0].options.credentials, "same-origin");
  check((h.requests[0].options.headers as Record<string, string>).Authorization, "Bearer test-only-token");
  check(Array.from(h.timers.values()).filter(timer => timer.ms === 2000).length, 1);

  const oldRead = live.refresh(); await flush();
  check(h.requests.length, 2);
  check(h.requests[1].options.signal?.aborted, false);
  check(live.applyCommitted(receipt(), "car-a", 1), true);
  live = h.render();
  check(live.data.vehicles[0].state, "loaded"); check(live.data.vehicles[0].version, 2);
  check(live.data.vehicles[0].name, "Existing truck"); check(live.data.vehicles[0].driver, "Existing driver");
  check(h.requests[1].options.signal?.aborted, true);
  check(h.requests.length, 2); // Applying a receipt itself makes no mandatory second GET.
  await h.respond(1, snapshot()); await oldRead;
  live = h.render();
  check(live.data.vehicles[0].version, 2); check(live.data.vehicles[0].state, "loaded");

  // The next ordinary 2s poll may reconcile to a newer canonical row.
  await h.runTimer(2000);
  check(h.requests.length, 3);
  await h.respond(2, snapshot("car-a", 3, "unloading"));
  live = h.render(); check(live.data.vehicles[0].version, 3); check(live.data.vehicles[0].state, "unloading");
  check(Array.from(h.timers.values()).filter(timer => timer.ms === 2000).length, 1);

  // Even an old GET's late 401 must not replace a successfully committed account view.
  const staleFailure = live.refresh(); await flush();
  check(live.applyCommitted(receipt("car-a", 4, "empty"), "car-a", 3), true);
  await h.respond(3, { error: "old unauthorized result" }, 401); await staleFailure;
  live = h.render(); check(live.data.vehicles[0].version, 4); check(live.needsLogin, false); check(live.error, "");

  const replay = { ...receipt("car-a", 7, "unloading"), replayed: true };
  check(live.applyCommitted(replay, "car-a", 4), true);
  live = h.render(); check(live.data.vehicles[0].version, 7); check(live.data.vehicles[0].state, "unloading");
  check(live.applyCommitted(receipt("car-a", 5, "loaded"), "car-a", 4), true);
  live = h.render(); check(live.data.vehicles[0].version, 7); check(live.data.vehicles[0].state, "unloading"); // No regression.

  const valid = receipt("car-a", 8);
  const invalid = [
    { ...valid, vehicle: null, refreshRequired: true }, { ...valid, eventId: null }, { ...valid, serverTime: "invalid" },
    { ...valid, vehicle: { ...valid.vehicle, vehicle_id: "different" } }, { ...valid, vehicle: { ...valid.vehicle, state: "fake" } },
    { ...valid, vehicle: { ...valid.vehicle, version: 7 } }, { ...valid, vehicle: { ...valid.vehicle, cycle: -1 } },
    { ...valid, vehicle: { ...valid.vehicle, assigned: "true" } }, { ...valid, vehicle: { ...valid.vehicle, since: "invalid" } },
  ];
  for (const candidate of invalid) {
    check(live.applyCommitted(candidate, "car-a", 7), false);
    check(h.render().data.vehicles[0].version, 7);
  }
  h.unmount(); check(live.applyCommitted(valid, "car-a", 7), false);
  check(h.cleanupState(), { unsubscribed: 1, windowListeners: 0, documentListeners: 0, timers: 0 });
  check(h.hasAssignmentListener(), false);

  // The shared assignment event changes only the current name in this company.
  // An in-flight snapshot from before the assignment cannot roll that name back.
  const names = harness(); let namesLive = await ready(names);
  const oldNamesRead = namesLive.refresh(); await flush();
  const assignedDriver: VehicleDriverAssignmentResult = {
    companyId: "company-a", canEdit: true,
    vehicle: { id: "car-a", name: "Existing truck", plate: "QA-101", assignmentId: "assignment-b", driverPersonId: "person-b", driverName: "New Driver" },
  };
  names.assignment({ ...assignedDriver, companyId: "other-company" });
  check(names.requests[1].options.signal?.aborted, false); check(names.render().data.vehicles[0].driver, "Existing driver");
  names.assignment(assignedDriver); namesLive = names.render();
  check(namesLive.data.vehicles[0].driver, "New Driver"); check(namesLive.data.vehicles[0].state, "empty");
  check(namesLive.data.vehicles[0].version, 1); check(namesLive.data.vehicles[0].since, "2026-09-04T09:58:00Z");
  check(names.requests[1].options.signal?.aborted, true);
  await names.respond(1, snapshot()); await oldNamesRead; await flush();
  check(names.render().data.vehicles[0].driver, "New Driver");
  names.assignment({ ...assignedDriver, vehicle: { ...assignedDriver.vehicle, assignmentId: null, driverPersonId: null, driverName: null } });
  await flush(); check(names.render().data.vehicles[0].driver, null);
  check(names.render().data.vehicles[0].state, "empty");
  await names.respond(2, { ...snapshot(), vehicles: snapshot().vehicles.map(vehicle => ({ ...vehicle, driver: null })) });
  check(names.render().data.vehicles[0].driver, null);
  names.unmount(); check(names.hasAssignmentListener(), false);

  // The callback captured by an old account cannot apply its late POST after switching accounts.
  const account = harness();
  const accountA = await ready(account);
  const oldAccountRead = accountA.refresh(); await flush();
  account.auth("SIGNED_IN", "account-b");
  let accountB = account.render(); check(accountB.data, null); check(accountB.stale, true);
  check(accountA.applyCommitted(receipt(), "car-a", 1), false);
  await account.runTimer(0); check(account.requests.length, 2); // Fresh request waits for the old read to settle.
  await account.respond(1, snapshot()); await oldAccountRead; await flush();
  check(account.render().data, null); check(account.requests.length, 3);
  await account.respond(2, snapshot("car-b", 10));
  accountB = account.render(); check(accountB.data.vehicles[0].vehicle_id, "car-b");
  check(accountA.applyCommitted(receipt("car-b", 11), "car-b", 10), false);
  check(accountB.applyCommitted(receipt("car-b", 11), "car-b", 10), true);
  check(account.render().data.vehicles[0].version, 11);
  account.auth("SIGNED_OUT", null);
  check(accountB.applyCommitted(receipt("car-b", 12), "car-b", 11), false);
  const loggedOut = account.render(); check(loggedOut.data, null); check(loggedOut.needsLogin, true); check(loggedOut.stale, true);
  await account.runTimer(2000); check(account.requests.length, 3);
  account.unmount();

  // Hidden pages do not poll; visibility/online wakeups retain the canonical freshness gate.
  const hidden = harness(false, true);
  hidden.render(); await flush(); check(hidden.requests.length, 0);
  await hidden.runTimer(2000); check(hidden.requests.length, 0);
  hidden.document.visibilityState = "visible"; hidden.fire("visibilitychange"); await flush();
  check(hidden.requests.length, 1); await hidden.respond(0, snapshot()); check(hidden.render().stale, false);
  hidden.navigator.onLine = false; hidden.fire("offline"); check(hidden.render().stale, true);
  check(hidden.render().error.includes("Нет связи"), true);
  hidden.navigator.onLine = true; hidden.fire("online"); await flush();
  check(hidden.requests.length, 2); await hidden.respond(1, snapshot("car-a", 2, "loaded")); check(hidden.render().stale, false);
  hidden.unmount();

  // Exercise real trafficRequest error parsing using a deferred HTTP response.
  const transport = harness();
  const failedPost = transport.request("/api/traffic/operator", "POST", { key: "same-command-key" });
  const observedFailure = failedPost.then(() => null, (error: Error & { status?: number }) => error);
  await flush(); check(transport.requests.length, 1);
  check(transport.requests[0].options.method, "POST"); check(transport.requests[0].options.body, '{"key":"same-command-key"}');
  await transport.respond(0, { error: "HTTP failure is not a commit" }, 503);
  const failure = await observedFailure; check(failure?.status, 503); check(failure?.message, "HTTP failure is not a commit");
  check(transport.timers.size, 0);

  const receiver = snapshot("car-a", 1, "unloading", "receiver");
  check(model.applyTrafficCommit(receiver, receipt("car-a", 2, "empty")).vehicles.length, 0);
  check(model.applyTrafficCommit(snapshot(), { ...receipt(), vehicle: null }).vehicles[0].version, 1);
  console.log(`PTC fast client PASS: ${checks} checks (actual useTraffic/trafficRequest + controlled deferred fetch, hook lifecycle, 2s poll, commit/read epoch and account guards; no remote writes).`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
