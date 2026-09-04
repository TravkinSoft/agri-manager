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
  let now = Date.parse("2026-09-04T10:00:00Z");
  class TestDate extends Date { static now() { return now; } }
  let authChange: (event: string, session: { user: { id: string } } | null) => void = () => undefined;
  let assignmentListener: ((result: VehicleDriverAssignmentResult) => void) | null = null;
  let trafficListener: ((companyId: string) => void) | null = null;
  const published: string[] = [];
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
    "@/lib/traffic/changes": {
      publishTrafficChanged: (companyId: string) => published.push(companyId),
      subscribeTrafficChanges: (listener: (companyId: string) => void) => {
        trafficListener = listener; return () => { if (trafficListener === listener) trafficListener = null; };
      },
    },
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
    module: loaded, exports: loaded.exports, AbortController, Date: TestDate,
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
    advance: (ms: number) => { now += ms; },
    request: loaded.exports.trafficRequest as (path: string, method?: string, body?: unknown) => Promise<any>,
    respond: async (index: number, payload: unknown, status = 200) => {
      assert.ok(requests[index], `fetch ${index} exists`);
      requests[index].result.resolve(new Response(JSON.stringify(payload), { status })); await flush();
    },
    auth: (event: string, id: string | null) => authChange(event, id ? { user: { id } } : null),
    assignment: (value: VehicleDriverAssignmentResult) => assignmentListener?.(value),
    hasAssignmentListener: () => assignmentListener !== null,
    changed: (companyId: string) => trafficListener?.(companyId),
    hasTrafficListener: () => trafficListener !== null,
    published,
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
  // Cold start + a same-session renewal can make the first old-token read fail.
  // It must stay in loading until the queued authorized successor resolves.
  const coldRenewal = harness();
  coldRenewal.render(); await flush(); check(coldRenewal.requests.length, 1);
  coldRenewal.auth("TOKEN_REFRESHED", "account-a"); await coldRenewal.runTimer(0);
  await coldRenewal.respond(0, { error: "Old token expired during bootstrap" }, 401);
  check(coldRenewal.requests.length, 2); check(coldRenewal.render().data, null);
  check(coldRenewal.render().loading, true); check(coldRenewal.render().needsLogin, false);
  await coldRenewal.respond(1, snapshot());
  check(coldRenewal.render().loading, false); check(coldRenewal.render().data.vehicles[0].vehicle_id, "car-a");
  coldRenewal.unmount();

  const h = harness();
  let live = await ready(h);
  check(h.requests[0].path, "/api/traffic/operator");
  check(h.requests[0].options.cache, "no-store");
  check(h.requests[0].options.credentials, "same-origin");
  check((h.requests[0].options.headers as Record<string, string>).Authorization, "Bearer test-only-token");
  check(Array.from(h.timers.values()).filter(timer => timer.ms === 1000).length, 1);

  const oldRead = live.refresh(); await flush();
  check(h.requests.length, 2);
  check(h.requests[1].options.signal?.aborted, false);
  check(live.applyCommitted(receipt(), "car-a", 1), true);
  check(h.published, ["company-a"]);
  live = h.render();
  check(live.data.vehicles[0].state, "loaded"); check(live.data.vehicles[0].version, 2);
  check(live.data.vehicles[0].name, "Existing truck"); check(live.data.vehicles[0].driver, "Existing driver");
  check(h.requests[1].options.signal?.aborted, true);
  check(h.requests.length, 2); // Applying a receipt itself makes no mandatory second GET.
  await h.respond(1, snapshot()); await oldRead;
  live = h.render();
  check(live.data.vehicles[0].version, 2); check(live.data.vehicles[0].state, "loaded");

  // The next ordinary 1s poll may reconcile to a newer canonical row.
  await h.runTimer(1000);
  check(h.requests.length, 3);
  await h.respond(2, snapshot("car-a", 3, "unloading"));
  live = h.render(); check(live.data.vehicles[0].version, 3); check(live.data.vehicles[0].state, "unloading");
  check(Array.from(h.timers.values()).filter(timer => timer.ms === 1000).length, 1);

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
  check(h.hasTrafficListener(), false);

  // A cross-tab hint never supplies data and does not flash the stale/loading UI.
  const crossTab = harness(); let crossLive = await ready(crossTab);
  crossTab.changed("other-company"); await flush(); check(crossTab.requests.length, 1);
  const previousRead = crossLive.refresh(); await flush();
  crossTab.changed("company-a"); await flush();
  check(crossTab.requests[1].options.signal?.aborted, true);
  check(crossTab.render().stale, false); check(crossTab.render().loading, false);
  await crossTab.respond(1, snapshot()); await previousRead; await flush();
  check(crossTab.requests.length, 3);
  await crossTab.respond(2, snapshot("car-a", 2, "loaded"));
  crossLive = crossTab.render(); check(crossLive.data.vehicles[0].state, "loaded");
  check(crossTab.published.length, 0); // Incoming hints are never echoed.
  crossTab.unmount(); check(crossTab.hasTrafficListener(), false);

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
  let accountB = account.render(); check(accountB.data, null); check(accountB.stale, true); check(accountB.loading, true);
  check(accountA.applyCommitted(receipt(), "car-a", 1), false);
  await account.runTimer(0); check(account.requests.length, 2); // Fresh request waits for the old read to settle.
  await account.respond(1, snapshot()); await oldAccountRead; await flush();
  check(account.render().data, null); check(account.render().loading, true); check(account.requests.length, 3);
  await account.respond(2, snapshot("car-b", 10));
  accountB = account.render(); check(accountB.data.vehicles[0].vehicle_id, "car-b"); check(accountB.loading, false);
  check(accountA.applyCommitted(receipt("car-b", 11), "car-b", 10), false);
  check(accountB.applyCommitted(receipt("car-b", 11), "car-b", 10), true);
  check(account.render().data.vehicles[0].version, 11);
  account.auth("SIGNED_OUT", null);
  check(accountB.applyCommitted(receipt("car-b", 12), "car-b", 11), false);
  const loggedOut = account.render(); check(loggedOut.data, null); check(loggedOut.needsLogin, true); check(loggedOut.stale, true);
  check(loggedOut.loading, false);
  await account.runTimer(1000); check(account.requests.length, 3);
  account.unmount();

  // Resume retains the same canonical snapshot/board scope and joins one GET,
  // even when the first response beats the rest of the browser's wake events.
  const resume = harness(); const beforeResume = await ready(resume);
  resume.document.visibilityState = "hidden"; resume.fire("visibilitychange");
  check(resume.render().stale, false); check(resume.render().data, beforeResume.data);
  await resume.runTimer(1000); check(resume.requests.length, 1);
  resume.document.visibilityState = "visible"; resume.fire("visibilitychange");
  resume.fire("focus"); resume.fire("pageshow");
  resume.auth("SIGNED_IN", "account-a"); resume.auth("TOKEN_REFRESHED", "account-a");
  await resume.runTimer(0); await resume.runTimer(0);
  check(resume.requests.length, 2);
  check(resume.render().data, beforeResume.data); check(resume.render().scopeKey, beforeResume.scopeKey);
  check(resume.render().loading, false); check(resume.render().stale, false); check(resume.render().error, "");
  await resume.respond(1, snapshot("car-a", 2, "loaded"));
  resume.advance(100); resume.fire("focus"); resume.fire("pageshow");
  resume.auth("SIGNED_IN", "account-a"); await resume.runTimer(0);
  check(resume.requests.length, 2); check(resume.render().data.vehicles[0].version, 2);
  resume.advance(1000); resume.fire("focus"); await flush(); check(resume.requests.length, 3);
  await resume.respond(2, { error: "Background server error" }, 500);
  check(resume.render().data.vehicles[0].version, 2); check(resume.render().loading, false);
  check(resume.render().stale, true); check(resume.render().error, "Background server error");
  resume.advance(1000); resume.fire("focus"); await flush();
  await resume.respond(3, snapshot("car-a", 3, "unloading")); check(resume.render().stale, false);
  resume.auth("TOKEN_REFRESHED", "account-a"); // Unmount must also cancel delayed auth callbacks.
  resume.unmount(); check(resume.cleanupState(), { unsubscribed: 1, windowListeners: 0, documentListeners: 0, timers: 0 });

  // Manager wake reads only the snapshot; multiple explicit metadata requests
  // during that GET share one full successor, without losing manager controls.
  const manager = harness(true);
  const managerSnapshot = snapshot("car-a", 1, "empty", "manager");
  const metadata = { snapshot: managerSnapshot, fleet: [{ id: "car-a" }], people: [], fields: [], accounts: [], canManageUsers: true };
  manager.render(); await flush(); await manager.respond(0, metadata);
  const managerReady = manager.render(); check(managerReady.managerData.canManageUsers, true);
  manager.fire("focus"); await flush(); check(manager.requests[1].path, "/api/traffic?snapshot=1");
  const freshRequests = [managerReady.refresh(true), managerReady.refresh(true), managerReady.refresh(true)];
  manager.fire("pageshow"); check(manager.render().stale, false);
  await manager.respond(1, { snapshot: { ...managerSnapshot, vehicles: [] } });
  check(manager.requests.length, 3); check(manager.requests[2].path, "/api/traffic");
  check(manager.render().managerData.fleet, metadata.fleet);
  await manager.respond(2, metadata); await Promise.all(freshRequests);
  check(manager.requests.length, 3); check(manager.render().loading, false);
  manager.auth("SIGNED_IN", "account-a"); manager.auth("SIGNED_OUT", null);
  await manager.runTimer(0); check(manager.render().data, null); check(manager.render().managerData, null);
  await manager.runTimer(1000); check(manager.requests.length, 3); manager.unmount();

  // An explicit queued read or a delayed same-user auth event must not revive
  // the previous account after sign-out, including a late successful response.
  const exit = harness(); const beforeExit = await ready(exit);
  const inFlight = beforeExit.refresh(); await flush();
  const queuedExit = beforeExit.refresh(true);
  exit.auth("SIGNED_IN", "account-a"); exit.auth("SIGNED_OUT", null);
  await exit.runTimer(0); await exit.respond(1, snapshot()); await inFlight; await queuedExit;
  check(exit.requests.length, 2); check(exit.render().data, null); check(exit.render().needsLogin, true);
  exit.unmount();

  // True authorization loss still clears protected operator data; role denial
  // remains a visible error with all transitions disabled, not a quiet success.
  const denied = harness(); const beforeDeny = await ready(denied);
  const roleDenied = beforeDeny.refresh(); await flush();
  await denied.respond(1, { error: "Role no longer allowed" }, 403); await roleDenied;
  check(denied.render().stale, true); check(denied.render().error, "Role no longer allowed");
  const sessionExpired = denied.render().refresh(true); await flush();
  await denied.respond(2, { error: "Session expired" }, 401); await sessionExpired;
  check(denied.render().data, null); check(denied.render().needsLogin, true);
  denied.auth("TOKEN_REFRESHED", "account-a"); await denied.runTimer(0);
  check(denied.requests.length, 4); await denied.respond(3, snapshot());
  check(denied.render().needsLogin, false); check(denied.render().stale, false);
  denied.unmount();

  // A full refresh requested during login still runs if the older read returns
  // 401. That is not an actual SIGNED_OUT and must not strand a valid login.
  const relogin = harness(); const loggedIn = await ready(relogin);
  const oldSession = loggedIn.refresh(); await flush();
  const afterLogin = loggedIn.refresh(true);
  await relogin.respond(1, { error: "Previous token expired" }, 401); await oldSession;
  check(relogin.requests.length, 3);
  await relogin.respond(2, snapshot()); await afterLogin;
  check(relogin.render().needsLogin, false); check(relogin.render().stale, false);
  relogin.unmount();

  // Renewal can beat the old-token failure. Retry that old 401 exactly once
  // using the newer session, but never loop if the fresh request is also denied.
  for (const event of ["SIGNED_IN", "TOKEN_REFRESHED"]) {
    const renewal = harness(); const oldTokenView = await ready(renewal);
    const oldTokenRead = oldTokenView.refresh(); await flush();
    renewal.auth(event, "account-a"); await renewal.runTimer(0);
    check(renewal.requests.length, 2); check(renewal.render().stale, false);
    await renewal.respond(1, { error: "Old token expired" }, 401); await oldTokenRead;
    check(renewal.requests.length, 3); check(renewal.render().needsLogin, false);
    check(renewal.render().stale, true); // No actions until the new session is verified.
    await renewal.respond(2, { error: "Session really expired" }, 401);
    check(renewal.requests.length, 3); check(renewal.render().needsLogin, true);
    check(renewal.render().data, null); renewal.unmount();
  }

  // Hidden pages do not poll; real offline/online events retain the freshness gate.
  const hidden = harness(false, true);
  hidden.render(); await flush(); check(hidden.requests.length, 0);
  await hidden.runTimer(1000); check(hidden.requests.length, 0);
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
  console.log(`PTC fast client PASS: ${checks} checks (actual useTraffic/trafficRequest + controlled deferred fetch, hook lifecycle, 1s poll, cross-tab hints, commit/read epoch and account guards; no remote writes).`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
