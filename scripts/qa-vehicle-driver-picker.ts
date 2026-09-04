import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import config from "../tailwind.config";
import type { VehicleDriverAssignmentResult } from "../lib/vehicles/driver-assignment-client";

const localRequire = createRequire(import.meta.url);
const componentSource = readFileSync("components/vehicles/vehicle-driver-assignment.tsx", "utf8");
const clientSource = readFileSync("lib/vehicles/driver-assignment-client.ts", "utf8");
let checks = 0;
function check(actual: unknown, expected: unknown) { assert.deepEqual(actual, expected); checks++; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const result = (driver = "driver-a", assignment = "assignment-a", vehicle = "vehicle-a", company = "company-a"): VehicleDriverAssignmentResult => ({
  companyId: company, vehicle: { id: vehicle, name: "KAMAZ", plate: "QA-207", assignmentId: assignment || null,
    driverPersonId: driver || null, driverName: driver ? `Имя ${driver}` : null }, canEdit: true,
  drivers: [{ id: "driver-a", name: "Имя driver-a" }, { id: "driver-b", name: "Имя driver-b" }],
});
function nodes(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function words(node: any): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(words).join("");
  return node?.props ? words(node.props.children) : "";
}
const wrapper = ({ children }: any) => React.createElement("div", null, children);
const Dialog = ({ children, open }: any) => open ? React.createElement("div", null, children) : null;
const Combo = () => null;
const Button = () => null;
function harness() {
  const state: any[] = [], refs: any[] = [], effects: Array<() => void> = [];
  const effectSlots: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
  const requests: Array<{ method: string; args: any[]; gate: ReturnType<typeof deferred<VehicleDriverAssignmentResult>> }> = [];
  const published: VehicleDriverAssignmentResult[] = [], assigned: VehicleDriverAssignmentResult[] = [];
  let si = 0, ri = 0, ei = 0, subscriptions = 0, unsubscribed = 0;
  let authChange: (event: string, session: { user: { id: string } } | null) => void = () => undefined;
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const loaded = { exports: {} as any };
  const props = { vehicleId: "vehicle-a", companyId: "company-a", vehicleLabel: "KAMAZ · QA-207", driverName: "Имя driver-a",
    iconOnly: false, disabled: false, onAssigned: (value: VehicleDriverAssignmentResult) => assigned.push(value) };
  const addRequest = (method: string, args: any[]) => { const gate = deferred<VehicleDriverAssignmentResult>(); requests.push({ method, args, gate }); return gate.promise; };
  const dependencies: Record<string, unknown> = {
    react: { ...React,
      useState: (initial: unknown) => { const i = si++; if (!(i in state)) state[i] = initial;
        return [state[i], (value: any) => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
      useRef: (initial: unknown) => { const i = ri++; return refs[i] ?? (refs[i] = { current: initial }); },
      useEffect: (effect: () => (() => void), deps: unknown[]) => {
        const i = ei++;
        if (!effectSlots[i] || !same(effectSlots[i].deps, deps)) effects.push(() => {
          effectSlots[i]?.cleanup?.(); effectSlots[i] = { deps: [...deps], cleanup: effect() };
        });
      },
    },
    "lucide-react": { Loader2: () => null, UserRound: () => null, X: () => null },
    "@/components/ui/button": { Button },
    "@/components/ui/dialog": { Dialog, DialogContent: wrapper, DialogDescription: wrapper, DialogHeader: wrapper, DialogTitle: wrapper },
    "@/components/weighbridge/searchable-combobox": { SearchableCombobox: Combo },
    "@/lib/utils": { cn: (...args: any[]) => args.filter(Boolean).join(" ") },
    "@/lib/supabase/client": { supabase: { auth: { onAuthStateChange: (callback: typeof authChange) => {
      subscriptions++; authChange = callback; callback("INITIAL_SESSION", { user: { id: "account-a" } });
      return { data: { subscription: { unsubscribe: () => { unsubscribed++; } } } };
    } } } },
    "@/lib/vehicles/driver-assignment-client": {
      loadVehicleDriverAssignment: (...args: any[]) => addRequest("GET", args),
      saveVehicleDriverAssignment: (...args: any[]) => addRequest("POST", args),
      publishVehicleDriverAssignment: (value: VehicleDriverAssignmentResult) => published.push(value),
    },
  };
  vm.runInNewContext(ts.transpileModule(componentSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, AbortController,
    Error, require: (name: string) => dependencies[name] ?? localRequire(name) });
  const render = () => { si = ri = ei = 0; const tree = loaded.exports.VehicleDriverAssignment(props); effects.splice(0).forEach(effect => effect()); return tree; };
  return { render, props, requests, assigned, published,
    auth: (event: string, id: string | null) => authChange(event, id ? { user: { id } } : null),
    counts: () => ({ subscriptions, unsubscribed }),
    unmount: () => effectSlots.forEach(effect => effect.cleanup?.()),
  };
}
const trigger = (tree: any) => nodes(tree).find(node => node.type === Button && node.props?.title);
const saveButton = (tree: any) => nodes(tree).find(node => node.type === Button && (words(node) === "Сохранить" || words(node) === "Сохраняем…"));
const combo = (tree: any) => nodes(tree).find(node => node.type === Combo);
const isOpen = (tree: any) => nodes(tree).find(node => node.type === Dialog).props.open;
const alert = (tree: any) => words(nodes(tree).find(node => node.props?.role === "alert"));
async function openReady(h: ReturnType<typeof harness>, response = result()) {
  trigger(h.render()).props.onClick({ stopPropagation: () => undefined }); h.render();
  check(h.requests.length, 1); check(h.requests[0].method, "GET");
  h.requests[0].gate.resolve(response); await flush(); return h.render();
}

function clientHarness() {
  const requests: Array<{ path: string; options: RequestInit; gate: ReturnType<typeof deferred<Response>> }> = [];
  const eventListeners = new Map<string, Set<(event: any) => void>>();
  const channels: any[] = [];
  const headers: Array<string> = [];
  let authGate: ReturnType<typeof deferred<Record<string, string>>> | null = null;
  class Channel {
    closed = false; posts: unknown[] = []; onmessage?: (event: any) => void;
    constructor(public name: string) { channels.push(this); }
    postMessage(value: unknown) { this.posts.push(value); }
    close() { this.closed = true; }
  }
  class CustomEventMock { constructor(public type: string, public init: { detail: unknown }) {} get detail() { return this.init.detail; } }
  const win = {
    addEventListener: (key: string, callback: (event: any) => void) => { if (!eventListeners.has(key)) eventListeners.set(key, new Set()); eventListeners.get(key)!.add(callback); },
    removeEventListener: (key: string, callback: (event: any) => void) => eventListeners.get(key)?.delete(callback),
    dispatchEvent: (event: any) => { eventListeners.get(event.type)?.forEach(callback => callback(event)); return true; },
  };
  const loaded = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(clientSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: loaded, exports: loaded.exports, AbortController, DOMException, Error, URLSearchParams, setTimeout, clearTimeout,
      window: win, CustomEvent: CustomEventMock, BroadcastChannel: Channel,
      require: (name: string) => name === "@/lib/supabase/client-auth" ? { buildClientAuthHeaders: (kind: string) => {
        headers.push(kind); return authGate ? authGate.promise : Promise.resolve({ Authorization: "Bearer fixture-only" });
      } } : localRequire(name),
      fetch: (path: string, options: RequestInit) => { const gate = deferred<Response>(); requests.push({ path, options, gate }); return gate.promise; },
    });
  return { api: loaded.exports, requests, channels, eventListeners, headers,
    blockAuth: () => { authGate = deferred(); return authGate; },
    respond: (index: number, value: unknown, status = 200) => requests[index].gate.resolve(new Response(JSON.stringify(value), { status })),
  };
}

async function main() {
  const h = harness();
  let tree = h.render();
  check(h.requests.length, 0); check(h.counts().subscriptions, 0); check(isOpen(tree), false);
  check(trigger(tree).props["aria-label"], "Сменить водителя: KAMAZ · QA-207");
  check(trigger(tree).props.className.includes("min-h-[48px]"), true);
  h.props.iconOnly = true; tree = h.render();
  check(words(trigger(tree)), ""); check(trigger(tree).props.className.includes("h-12 w-12"), true);
  tree = await openReady(h);
  check(h.counts().subscriptions, 1); check(combo(tree).props.mobile, true);
  check(combo(tree).props.options[0].label, "Без водителя"); check(combo(tree).props.value, "driver-a");
  check(saveButton(tree).props.disabled, true); check(words(tree).includes("Старые талоны не изменятся"), true);
  combo(tree).props.onValueChange("driver-b"); tree = h.render();
  check(saveButton(tree).props.disabled, false);
  saveButton(tree).props.onClick(); saveButton(tree).props.onClick(); tree = h.render();
  check(h.requests.length, 2); check(h.requests[1].method, "POST"); check(h.assigned.length, 0); check(h.published.length, 0);
  check(JSON.parse(JSON.stringify(h.requests[1].args[0])), { companyId: "company-a", vehicleId: "vehicle-a", driverPersonId: "driver-b", expectedAssignmentId: "assignment-a" });
  check(saveButton(tree).props.disabled, true); check(words(saveButton(tree)), "Сохраняем…");
  h.requests[1].gate.resolve(result("driver-b", "assignment-b")); await flush(); tree = h.render();
  check(isOpen(tree), false); check(h.assigned.length, 1); check(h.published.length, 1); check(h.requests.length, 2);
  check(h.assigned[0].vehicle.driverPersonId, "driver-b");
  h.unmount(); check(h.counts().unsubscribed, 1);

  const failed = harness(); tree = await openReady(failed); combo(tree).props.onValueChange("driver-b");
  saveButton(failed.render()).props.onClick(); failed.requests[1].gate.reject(new Error("Сеть недоступна")); await flush(); tree = failed.render();
  check(isOpen(tree), true); check(combo(tree).props.value, "driver-b"); check(alert(tree), "Сеть недоступна");
  check(saveButton(tree).props.disabled, false); check(failed.assigned.length, 0); check(failed.published.length, 0);
  failed.unmount();

  const conflict = harness(); tree = await openReady(conflict); combo(tree).props.onValueChange("driver-b");
  saveButton(conflict.render()).props.onClick(); conflict.requests[1].gate.reject(Object.assign(new Error("Conflict"), { status: 409 })); await flush(); tree = conflict.render();
  check(conflict.requests.length, 3); check(conflict.requests[2].method, "GET"); check(combo(tree), undefined);
  check(saveButton(tree).props.disabled, true); check(alert(tree).includes("Привязку уже изменили"), true);
  conflict.requests[2].gate.resolve(result("driver-b", "assignment-new")); await flush(); tree = conflict.render();
  check(combo(tree).props.value, "driver-b"); check(saveButton(tree).props.disabled, true);
  combo(tree).props.onValueChange("__no_driver__"); saveButton(conflict.render()).props.onClick();
  check(conflict.requests[3].args[0].expectedAssignmentId, "assignment-new"); check(conflict.requests[3].args[0].driverPersonId, null);
  conflict.requests[3].gate.resolve(result("", "")); await flush(); conflict.render();
  check(conflict.published[0].vehicle.driverPersonId, null); conflict.unmount();

  // Legacy assignment rows can outlive their driver person. "No driver" must
  // clear that actual row rather than be incorrectly considered unchanged.
  const legacy = harness(); tree = await openReady(legacy, result("", "legacy-assignment"));
  check(combo(tree).props.value, "__no_driver__"); check(saveButton(tree).props.disabled, false);
  saveButton(tree).props.onClick(); check(legacy.requests.length, 2);
  check(legacy.requests[1].args[0].driverPersonId, null); check(legacy.requests[1].args[0].expectedAssignmentId, "legacy-assignment");
  legacy.requests[1].gate.resolve(result("", "")); await flush(); tree = legacy.render();
  check(isOpen(tree), false); check(legacy.published[0].vehicle.assignmentId, null); legacy.unmount();
  const alreadyClear = harness(); tree = await openReady(alreadyClear, result("", ""));
  check(saveButton(tree).props.disabled, true); saveButton(tree).props.onClick(); check(alreadyClear.requests.length, 1); alreadyClear.unmount();

  const conflictReadFailure = harness(); tree = await openReady(conflictReadFailure);
  combo(tree).props.onValueChange("driver-b"); saveButton(conflictReadFailure.render()).props.onClick();
  conflictReadFailure.requests[1].gate.reject(Object.assign(new Error("Conflict"), { status: 409 })); await flush();
  conflictReadFailure.requests[2].gate.reject(new Error("Нет связи")); await flush(); tree = conflictReadFailure.render();
  check(combo(tree), undefined); check(saveButton(tree).props.disabled, true);
  check(alert(tree).includes("Привязку уже изменили"), true); check(alert(tree).includes("Нет связи"), true);
  check(conflictReadFailure.assigned.length, 0); conflictReadFailure.unmount();

  const closedRead = harness(); trigger(closedRead.render()).props.onClick({ stopPropagation: () => undefined }); tree = closedRead.render();
  nodes(tree).find(node => node.type === Button && node.props["aria-label"] === "Закрыть выбор водителя").props.onClick();
  closedRead.render(); check(closedRead.requests[0].args[2].aborted, true);
  closedRead.requests[0].gate.resolve(result()); await flush(); tree = closedRead.render();
  check(isOpen(tree), false); check(combo(tree), undefined); closedRead.unmount();

  const denied = harness(); tree = await openReady(denied, { ...result(), canEdit: false });
  check(combo(tree).props.disabled, true); check(saveButton(tree).props.disabled, true);
  check(words(tree).includes("Нет прав на смену водителя"), true); denied.unmount();

  const scope = harness(); tree = await openReady(scope); combo(tree).props.onValueChange("driver-b"); saveButton(scope.render()).props.onClick();
  scope.props.vehicleId = "vehicle-new"; scope.props.companyId = "company-new"; scope.render(); scope.render();
  check(scope.requests[1].args[1].aborted, true); check(scope.requests.length, 2);
  scope.requests[1].gate.resolve(result("driver-b", "assignment-b")); await flush(); tree = scope.render();
  check(scope.assigned.length, 0); check(scope.published.length, 0); check(isOpen(tree), false); scope.unmount();

  const unmounted = harness(); tree = await openReady(unmounted); combo(tree).props.onValueChange("driver-b"); saveButton(unmounted.render()).props.onClick();
  unmounted.unmount(); check(unmounted.requests[1].args[1].aborted, true);
  unmounted.requests[1].gate.resolve(result("driver-b", "assignment-b")); await flush();
  check(unmounted.assigned.length, 0); check(unmounted.published.length, 0);

  const account = harness(); tree = await openReady(account); combo(tree).props.onValueChange("driver-b"); saveButton(account.render()).props.onClick();
  account.auth("SIGNED_IN", "account-b"); account.render();
  check(account.requests[1].args[1].aborted, true);
  account.requests[1].gate.resolve(result("driver-b", "assignment-b")); await flush(); tree = account.render();
  check(account.assigned.length, 0); check(isOpen(tree), false); account.unmount();

  const c = clientHarness();
  let received = 0, secondary = 0;
  const stop = c.api.subscribeVehicleDriverAssignments(() => { received++; });
  const stop2 = c.api.subscribeVehicleDriverAssignments(() => { secondary++; });
  check(c.channels.length, 1); check(c.eventListeners.get("travkin:vehicle-driver-assigned")!.size, 1);
  c.api.publishVehicleDriverAssignment(result()); check(received, 1); check(secondary, 1); check(c.channels[0].posts.length, 1);
  check(c.channels[0].posts[0].drivers, undefined);
  c.channels[0].onmessage({ data: result("driver-b", "assignment-b") }); check(received, 2); check(c.channels[0].posts.length, 1);
  c.channels[0].onmessage({ data: { companyId: "company-a" } }); check(received, 2);
  stop(); check(c.channels[0].closed, false); stop2(); check(c.channels[0].closed, true);
  check(c.eventListeners.get("travkin:vehicle-driver-assigned")!.size, 0);
  c.api.publishVehicleDriverAssignment(result()); check(c.channels.length, 2); check(c.channels[1].closed, true);

  const read = c.api.loadVehicleDriverAssignment("vehicle-a", "company-a"); await flush();
  check(c.requests[0].path, "/api/vehicles/driver-assignment?vehicleId=vehicle-a&companyId=company-a");
  check(c.requests[0].options.method, "GET"); check(c.requests[0].options.cache, "no-store"); check(c.requests[0].options.credentials, "same-origin");
  check(c.requests[0].options.body, undefined); c.respond(0, result()); check((await read).vehicle.id, "vehicle-a");
  const write = c.api.saveVehicleDriverAssignment({ vehicleId: "vehicle-a", driverPersonId: null, expectedAssignmentId: "assignment-a", companyId: "company-a", ignored: "never-send" }); await flush();
  check(c.requests[1].path, "/api/vehicles/driver-assignment"); check(c.headers[1], "json");
  check(JSON.parse(c.requests[1].options.body as string), { companyId: "company-a", vehicleId: "vehicle-a", driverPersonId: null, expectedAssignmentId: "assignment-a" });
  c.respond(1, result("", "")); check((await write).vehicle.driverPersonId, null);
  const badScope = c.api.loadVehicleDriverAssignment("vehicle-a", "company-a"); await flush(); c.respond(2, result("driver-a", "assignment-a", "vehicle-other"));
  await assert.rejects(badScope, /не соответствует/); checks++;
  const badCompany = c.api.loadVehicleDriverAssignment("vehicle-a", "company-a"); await flush(); c.respond(3, result("driver-a", "assignment-a", "vehicle-a", "company-other"));
  await assert.rejects(badCompany, /не соответствует/); checks++;
  const missingDrivers = c.api.loadVehicleDriverAssignment("vehicle-a"); await flush(); c.respond(4, { ...result(), drivers: undefined });
  await assert.rejects(missingDrivers, /не соответствует/); checks++;
  const failure = c.api.saveVehicleDriverAssignment({ vehicleId: "vehicle-a", driverPersonId: "driver-b", expectedAssignmentId: "assignment-a" }); await flush(); c.respond(5, { error: "Конфликт назначения" }, 409);
  await assert.rejects(failure, (error: any) => error.status === 409 && error.message === "Конфликт назначения"); checks++;
  const blocked = clientHarness(); const auth = blocked.blockAuth(); const controller = new AbortController();
  const aborted = blocked.api.loadVehicleDriverAssignment("vehicle-a", "company-a", controller.signal);
  controller.abort(); auth.resolve({ Authorization: "Bearer fixture-only" });
  await assert.rejects(aborted, /Нет подтверждения/); checks++; check(blocked.requests.length, 0);

  const comboSource = readFileSync("components/weighbridge/searchable-combobox.tsx", "utf8");
  check(comboSource.includes("mobile = false"), true); check(comboSource.includes('mobile ? "min-w-0 max-w-[calc(100vw-2rem)]" : "min-w-[320px]"'), true);
  const css = await postcss([tailwindcss({ ...config, content: [{ raw: componentSource + comboSource, extension: "tsx" }] })]).process("@tailwind utilities;", { from: undefined });
  check(css.css.includes("min-height: 48px"), true); check(css.css.includes("font-size: 1rem"), true);
  check(css.css.includes("max-width: calc(100vw - 2rem)"), true); check(css.css.includes("width: calc(100% - 2rem)"), true);
  console.log(`Vehicle driver picker: ${checks} PASS`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
