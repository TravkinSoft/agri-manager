import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import config from "../tailwind.config";
import * as model from "../lib/traffic/model";

const localRequire = createRequire(import.meta.url);
const source = readFileSync("components/traffic/traffic-board.tsx", "utf8");
let checks = 0;
function check(actual: unknown, expected: unknown) { assert.deepEqual(actual, expected); checks++; }
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
const cardNodes = (tree: any) => nodes(tree).filter(node => node.props?.["data-testid"]?.startsWith("traffic-vehicle-"));
const wrapper = ({ children }: any) => React.createElement("div", null, children);
const Dialog = ({ open, children }: any) => open ? React.createElement("div", { role: "alertdialog" }, children) : null;
const Button = ({ children, ...props }: any) => React.createElement("button", props, children);
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const vehicles: model.TrafficVehicle[] = ["loaded", "empty", "unloading", "empty"].map((state, index) => ({
  vehicle_id: `car-${index}`, name: `Truck ${index}`, plate: `QA-${index}`, driver: index === 1 ? "Existing Driver" : null,
  state: state as model.TrafficState, version: index + 5, cycle: index + 1, assigned: true, since: "2026-09-04T10:00:00Z",
}));

function receiptFor(vehicle: model.TrafficVehicle, state: model.TrafficState, version = vehicle.version + 1): model.TrafficCommit {
  return { eventId: "60000000-0000-4000-8000-000000000001", replayed: false, serverTime: "2026-09-04T10:09:00Z", refreshRequired: false,
    vehicle: { vehicle_id: vehicle.vehicle_id, state, version, cycle: vehicle.cycle, assigned: true, since: "2026-09-04T10:09:00Z" } };
}
function harness(role: model.TrafficRole, input = vehicles, options: { acceptReceipt?: boolean; deferRefresh?: boolean } = {}) {
  const snapshot: model.TrafficSnapshot = {
    role, personName: "", enabled: true, fieldId: null, fieldName: null, serverTime: "2026-09-04T10:08:00Z",
    vehicles: model.visibleVehicles(input, role), events: [],
  };
  const state: any[] = [], refs: any[] = [], calls: any[] = [], commits: any[] = [];
  const requests: ReturnType<typeof deferred<model.TrafficCommit>>[] = [];
  const refreshCalls: Array<boolean | undefined> = [];
  const refreshGate = deferred<void>();
  const props = { snapshot, stale: false, error: "", refresh: async (fresh?: boolean) => {
    refreshCalls.push(fresh); if (options.deferRefresh) await refreshGate.promise;
  }, onCommitted: (receipt: model.TrafficCommit, vehicleId: string, expectedVersion: number) => {
    commits.push([receipt, vehicleId, expectedVersion]);
    if (options.acceptReceipt === false) return false;
    props.snapshot = model.applyTrafficCommit(props.snapshot, receipt);
    return true;
  } };
  let cursor = 0, refCursor = 0;
  const loaded = { exports: {} as any };
  const dependencies: Record<string, unknown> = {
    react: { ...React, useEffect: () => undefined, useMemo: (factory: () => unknown) => factory(),
      useState: (initial: unknown) => {
        const i = cursor++; if (!(i in state)) state[i] = initial;
        return [state[i], (value: any) => { state[i] = typeof value === "function" ? value(state[i]) : value; }];
      },
      useRef: (initial: unknown) => { const i = refCursor++; return refs[i] ?? (refs[i] = { current: initial }); },
    },
    "lucide-react": Object.fromEntries(["Truck", "Clock3", "Loader2", "RefreshCw", "WifiOff"].map(key => [key, () => null])),
    "@/lib/traffic/model": model,
    "./use-traffic": { trafficRequest: (...args: any[]) => {
      calls.push(args); const request = deferred<model.TrafficCommit>(); requests.push(request); return request.promise;
    } },
    "@/components/ui/alert-dialog": { AlertDialog: Dialog, AlertDialogContent: wrapper, AlertDialogHeader: wrapper, AlertDialogTitle: wrapper,
      AlertDialogDescription: wrapper, AlertDialogFooter: wrapper, AlertDialogCancel: Button },
    "@/components/ui/button": { Button },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { module: loaded, exports: loaded.exports, crypto: { randomUUID: () => "50000000-0000-4000-8000-000000000001" }, require: (name: string) => dependencies[name] ?? localRequire(name) });
  const render = () => { cursor = 0; refCursor = 0; return loaded.exports.TrafficBoard(props); };
  return { render, props, calls, requests, commits, refreshCalls, refreshGate, refreshCount: () => refreshCalls.length };
}

async function main() {
  const manager = harness("manager");
  const tree = manager.render();
  const groups = nodes(tree).filter(node => node.props?.["data-testid"]?.startsWith("traffic-group-"));
  check(groups.map(group => group.props["data-testid"]), ["traffic-group-empty", "traffic-group-loaded", "traffic-group-unloading"]);
  const expected = [["car-1", "car-3"], ["car-0"], ["car-2"]];
  for (const [index, group] of Array.from(groups.entries())) {
    check(cardNodes(group).map(card => card.props["data-testid"].replace("traffic-vehicle-", "")), expected[index]);
    const count = nodes(group).filter(node => node.props?.className?.includes("tabular-nums"));
    check(count.length, 1); check(count[0].props.children, expected[index].length);
  }
  check(nodes(tree).filter(node => node.props?.className?.includes("tabular-nums")).length, 3); // No separate duplicate summary counts.
  check(cardNodes(tree).length, vehicles.length);
  check(new Set(cardNodes(tree).map(card => card.props["data-testid"])).size, vehicles.length);
  check(cardNodes(tree).every(card => card.type === "article"), true);
  const colors = ["bg-[#ffffff]", "bg-emerald-100", "bg-amber-100"];
  groups.forEach((group, index) => check(cardNodes(group).every(card => card.props.className.split(" ").includes(colors[index])), true));
  const globalCss = readFileSync("app/globals.css", "utf8");
  // The dashboard shell deliberately remaps .bg-white with !important. PTC cards and
  // the category dot must use an explicit white utility outside that selector.
  const whiteNodes = [...cardNodes(groups[0]), ...nodes(groups[0]).filter(node => node.type === "span" && node.props?.["aria-hidden"])];
  check(whiteNodes.length, 3);
  for (const node of whiteNodes) {
    const classes = node.props.className.split(/\s+/);
    check(classes.includes("bg-white"), false);
    check(classes.includes("bg-[#ffffff]"), true);
  }
  check(globalCss.includes(".travkin-shell .bg-white"), true);
  check(globalCss.includes(".travkin-shell .bg-\\[\\#ffffff\\]"), false);
  check(cardNodes(tree).every(card => card.props.className.includes("p-2.5")), true);
  const managerHtml = renderToStaticMarkup(tree);
  const managerText = managerHtml.replace(/<[^>]*>/g, "");
  check((managerText.match(/Пустые/g) ?? []).length, 1);
  check((managerText.match(/Загруженные/g) ?? []).length, 1);
  check((managerText.match(/На выгрузке/g) ?? []).length, 1);
  check(managerHtml.includes("lg:grid-cols-3"), true);
  check(managerHtml.includes("grid-cols-3") && !managerHtml.includes('class="grid grid-cols-3'), true);
  const emptyTree = harness("manager", []).render();
  check(nodes(emptyTree).filter(node => node.props?.["data-testid"]?.startsWith("traffic-group-")).length, 3);
  check((renderToStaticMarkup(emptyTree).match(/Нет машин/g) ?? []).length, 3);

  for (const role of ["harvester", "receiver"] as const) {
    const h = harness(role);
    let operatorTree = h.render();
    const cards = cardNodes(operatorTree);
    check(nodes(operatorTree).some(node => node.props?.["data-testid"]?.startsWith("traffic-group-")), false);
    check(cards.map(card => card.props["data-testid"]), model.visibleVehicles(vehicles, role).map(car => `traffic-vehicle-${car.vehicle_id}`));
    for (const card of cards) {
      const vehicle = vehicles.find(car => `traffic-vehicle-${car.vehicle_id}` === card.props["data-testid"])!;
      const target = model.nextState(role, vehicle.state);
      check(card.type, target ? "button" : "article");
      if (target) {
        check(card.props.disabled, false);
        check(card.props.className.includes("min-h-[48px]"), true);
        check(nodes(card).slice(1).some(node => node.props?.className?.includes("min-h-[48px]")), false);
        check(words(card).includes(model.ACTION_LABEL[target]), false); // The card itself is the only action.
        check(nodes(card).filter(node => node.type === "button").length, 1); // No nested buttons.
      } else {
        check(card.props.className.split(/\s+/).includes("grayscale"), true);
        check(card.props.className.split(/\s+/).some((name: string) => name.startsWith("opacity-")), false);
      }
    }
    const actionable = cards.find(card => card.type === "button")!;
    const clicked = vehicles.find(car => `traffic-vehicle-${car.vehicle_id}` === actionable.props["data-testid"])!;
    actionable.props.onClick(); operatorTree = h.render();
    check(renderToStaticMarkup(operatorTree).includes(`role="alertdialog"`), true);
    const dialog = nodes(operatorTree).find(node => node.type === Dialog);
    check(words(dialog).includes(clicked.plate!), true);
    const confirm = nodes(dialog).find(node => node.type === Button && words(node) === "Подтвердить");
    check(confirm.props.className.includes("min-h-[48px]"), true);
    confirm.props.onClick(); confirm.props.onClick();
    const pendingTree = h.render();
    check(renderToStaticMarkup(pendingTree).includes('role="alertdialog"'), false);
    check(h.props.snapshot.vehicles.find(car => car.vehicle_id === clicked.vehicle_id)?.state, clicked.state);
    check(h.commits.length, 0);
    check(h.refreshCount(), 0);
    const pendingCard = cardNodes(pendingTree).find(card => card.props["data-testid"] === `traffic-vehicle-${clicked.vehicle_id}`)!;
    check(pendingCard.props["aria-busy"], true);
    check(words(pendingCard).includes("Сохраняем…"), true);
    check(cardNodes(pendingTree).filter(card => card.type === "button").every(card => card.props.disabled), true);
    check(h.calls.length, 1);
    check(JSON.parse(JSON.stringify(h.calls[0][2])), { vehicleId: clicked.vehicle_id, version: clicked.version, target: model.nextState(role, clicked.state), key: "50000000-0000-4000-8000-000000000001" });
    const receipt = receiptFor(clicked, model.nextState(role, clicked.state)!);
    h.requests[0].resolve(receipt); await flush();
    check(h.commits.length, 1);
    check(h.commits[0], [receipt, clicked.vehicle_id, clicked.version]);
    check(h.refreshCount(), 1);
    check(h.refreshCalls[0], undefined); // Background reconciliation, not a mandatory fresh GET.
    check(h.props.snapshot.vehicles.find(car => car.vehicle_id === clicked.vehicle_id)?.state, receipt.vehicle?.state);
    check(words(h.render()).includes("Сохраняем…"), false);

    for (const gate of ["stale", "disabled"] as const) {
      const blocked = harness(role);
      const candidate = cardNodes(blocked.render()).find(card => card.type === "button")!;
      candidate.props.onClick();
      if (gate === "stale") blocked.props.stale = true; else blocked.props.snapshot.enabled = false;
      const blockedTree = blocked.render();
      check(cardNodes(blockedTree).filter(card => card.type === "button").every(card => card.props.disabled), true);
      const blockedConfirm = nodes(blockedTree).find(node => node.type === Button && words(node) === "Подтвердить");
      check(blockedConfirm.props.disabled, true);
      blockedConfirm.props.onClick(); await flush(); check(blocked.calls.length, 0);
    }
  }
  const unloading = harness("receiver", vehicles.filter(vehicle => vehicle.state === "unloading"));
  cardNodes(unloading.render())[0].props.onClick();
  const unloadConfirm = nodes(unloading.render()).find(node => node.type === Button && words(node) === "Подтвердить");
  unloadConfirm.props.onClick();
  check(unloading.calls.length, 1); check(unloading.calls[0][2].target, "empty"); check(unloading.calls[0][2].vehicleId, "car-2");
  unloading.requests[0].resolve(receiptFor(vehicles[2], "empty")); await flush();
  check(unloading.props.snapshot.vehicles.length, 0);
  check(renderToStaticMarkup(harness("receiver", []).render()).includes("Пока нет загруженных машин"), true);

  // A replay may return a newer current state, not the target requested by this click.
  const replay = harness("harvester", [vehicles[1]], { deferRefresh: true });
  cardNodes(replay.render())[0].props.onClick();
  nodes(replay.render()).find(node => node.type === Button && words(node) === "Подтвердить").props.onClick();
  const currentReceipt = { ...receiptFor(vehicles[1], "empty", vehicles[1].version + 3), replayed: true };
  replay.requests[0].resolve(currentReceipt); await flush();
  const replayTree = replay.render();
  check(replay.props.snapshot.vehicles[0].state, "empty");
  check(replay.props.snapshot.vehicles[0].version, vehicles[1].version + 3);
  check(cardNodes(replayTree)[0].props.disabled, false); // GET below is deliberately still unresolved.
  check(cardNodes(replayTree)[0].props["aria-busy"], false);
  check(renderToStaticMarkup(replayTree).includes('role="alertdialog"'), false);
  check(replay.refreshCount(), 1);
  replay.refreshGate.resolve(); await flush();

  // HTTP failure reopens the same command for retry and never fabricates a new state/key.
  const failure = harness("harvester", [vehicles[1]]);
  cardNodes(failure.render())[0].props.onClick();
  nodes(failure.render()).find(node => node.type === Button && words(node) === "Подтвердить").props.onClick();
  failure.requests[0].reject(Object.assign(new Error("HTTP 503: try again"), { status: 503 })); await flush();
  const failedTree = failure.render();
  check(renderToStaticMarkup(failedTree).includes('role="alertdialog"'), true);
  check(words(failedTree).includes("HTTP 503"), true);
  check(failure.props.snapshot.vehicles[0].state, vehicles[1].state);
  check(failure.commits.length, 0);
  check(failure.refreshCalls, [true]);
  const retry = nodes(failedTree).find(node => node.type === Button && words(node) === "Подтвердить");
  retry.props.onClick(); retry.props.onClick();
  check(failure.calls.length, 2);
  check(JSON.stringify(failure.calls[1][2]), JSON.stringify(failure.calls[0][2]));
  failure.requests[1].resolve(receiptFor(vehicles[1], "loaded")); await flush();
  check(failure.props.snapshot.vehicles[0].state, "loaded");

  // Invalid/legacy receipts keep the honest pending gate until canonical refetch completes.
  const fallback = harness("harvester", [vehicles[1]], { acceptReceipt: false, deferRefresh: true });
  cardNodes(fallback.render())[0].props.onClick();
  nodes(fallback.render()).find(node => node.type === Button && words(node) === "Подтвердить").props.onClick();
  fallback.requests[0].resolve({ ...receiptFor(vehicles[1], "loaded"), vehicle: null, refreshRequired: true }); await flush();
  check(fallback.props.snapshot.vehicles[0].state, "empty");
  check(cardNodes(fallback.render())[0].props["aria-busy"], true);
  check(fallback.refreshCalls, [true]);
  fallback.refreshGate.resolve(); await flush();
  check(cardNodes(fallback.render())[0].props["aria-busy"], false);
  const css = (await postcss([tailwindcss({ ...config, content: [{ raw: source, extension: "tsx" }] })]).process("@tailwind utilities;", { from: undefined })).css;
  for (const expression of [/min-height:\s*48px/, /padding:\s*0\.625rem/, /@media \(min-width: 1024px\)/, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
    /\.bg-emerald-100\s*\{/, /\.bg-amber-100\s*\{/, /--tw-grayscale:\s*grayscale\(100%\)/]) { assert.match(css, expression); checks++; }
  const explicitWhite = postcss.parse(css).nodes.find(node => node.type === "rule" && node.selector === ".bg-\\[\\#ffffff\\]");
  check(!!explicitWhite, true);
  if (explicitWhite?.type === "rule") {
    check(explicitWhite.nodes.some(node => node.type === "decl" && node.prop === "background-color" && node.value.includes("255 255 255")), true);
  }
  console.log(`PTC compact board PASS: ${checks} checks (actual component handlers + SSR + compiled CSS; no browser measurements or remote writes)`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
