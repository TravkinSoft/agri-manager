import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss, { type AtRule, type Node as PostcssNode } from "postcss";
import tailwindcss from "tailwindcss";
import config from "../tailwind.config";
import * as model from "../lib/traffic/model";
import * as optimistic from "../lib/traffic/optimistic";

const localRequire = createRequire(import.meta.url);
const source = readFileSync("components/traffic/traffic-board.tsx", "utf8");
let checks = 0;
function check(actual: unknown, expected: unknown) { assert.deepEqual(actual, expected); checks++; }
function isAtRule(node: PostcssNode): node is AtRule { return node.type === "atrule"; }
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
    role, companyId: "company-a", personName: "", enabled: true, fieldId: null, fieldName: null, serverTime: "2026-09-04T10:08:00Z",
    vehicles: model.visibleVehicles(input, role), events: [],
  };
  const state: any[] = [], refs: any[] = [], calls: any[] = [], commits: any[] = [], managedVehicles: string[] = [];
  const requests: ReturnType<typeof deferred<model.TrafficCommit>>[] = [];
  const refreshCalls: Array<boolean | undefined> = [];
  const refreshGate = deferred<void>();
  const props = { snapshot, stale: false, error: "", onManageVehicle: role === "manager"
    ? (vehicle: model.TrafficVehicle) => managedVehicles.push(vehicle.vehicle_id)
    : undefined, refresh: async (fresh?: boolean) => {
    refreshCalls.push(fresh); if (options.deferRefresh) await refreshGate.promise;
  }, onCommitted: (receipt: model.TrafficCommit, vehicleId: string, expectedVersion: number) => {
    commits.push([receipt, vehicleId, expectedVersion]);
    if (options.acceptReceipt === false) return false;
    props.snapshot = model.applyTrafficCommit(props.snapshot, receipt);
    return true;
  } };
  let cursor = 0, refCursor = 0, effectCursor = 0, keyCounter = 0;
  const effectSlots: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
  const effects: Array<() => void> = [];
  const loaded = { exports: {} as any };
  const dependencies: Record<string, unknown> = {
    react: { ...React, useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
      const i = effectCursor++;
      if (!effectSlots[i] || deps.some((value, index) => !Object.is(value, effectSlots[i].deps[index]))) effects.push(() => {
        effectSlots[i]?.cleanup?.();
        effectSlots[i] = { deps, cleanup: effect() || undefined };
      });
    }, useMemo: (factory: () => unknown) => factory(),
      useState: (initial: unknown) => {
        const i = cursor++; if (!(i in state)) state[i] = initial;
        return [state[i], (value: any) => { state[i] = typeof value === "function" ? value(state[i]) : value; }];
      },
      useRef: (initial: unknown) => { const i = refCursor++; return refs[i] ?? (refs[i] = { current: initial }); },
    },
    "lucide-react": Object.fromEntries(["Truck", "Clock3", "Loader2", "RefreshCw", "WifiOff", "Wrench"].map(key => [key, () => null])),
    "@/lib/traffic/model": model,
    "@/lib/traffic/optimistic": optimistic,
    "./use-traffic": { trafficRequest: (...args: any[]) => {
      calls.push(args); const request = deferred<model.TrafficCommit>(); requests.push(request); return request.promise;
    } },
    "@/components/ui/alert-dialog": { AlertDialog: Dialog, AlertDialogContent: wrapper, AlertDialogHeader: wrapper, AlertDialogTitle: wrapper,
      AlertDialogDescription: wrapper, AlertDialogFooter: wrapper, AlertDialogCancel: Button },
    "@/components/ui/button": { Button },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { module: loaded, exports: loaded.exports, window: { setInterval: () => 1, clearInterval: () => undefined },
      crypto: { randomUUID: () => `50000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}` }, require: (name: string) => dependencies[name] ?? localRequire(name) });
  const render = () => {
    cursor = 0; refCursor = 0; effectCursor = 0;
    const tree = loaded.exports.TrafficBoard(props);
    effects.splice(0).forEach(effect => effect());
    return tree;
  };
  return { render, props, calls, requests, commits, refreshCalls, refreshGate, managedVehicles, refreshCount: () => refreshCalls.length,
    unmount: () => effectSlots.forEach(effect => effect.cleanup?.()) };
}

async function main() {
  // A repair mark does not replace cargo state. It only blocks starting new loads.
  const repairVehicles = vehicles.map(vehicle => ({ ...vehicle, inRepair: true }));
  for (const role of ["manager", "harvester", "receiver"] as const) {
    const repairTree = harness(role, repairVehicles).render();
    const repairCards = cardNodes(repairTree);
    check(repairCards.every(card => card.props.className.includes("bg-rose-100")), true);
    check(repairCards.every(card => words(card).includes("На ремонте")), true);
    check(repairCards.every(card => card.type === (role === "harvester" ? "article" : "button")), true);
    const repairHtml = renderToStaticMarkup(repairTree);
    check(repairHtml.includes("На ремонте"), true);
  }
  const managerVehicles = vehicles.map(vehicle => vehicle.vehicle_id === "car-3" ? { ...vehicle, inRepair: true } : vehicle);
  const manager = harness("manager", managerVehicles);
  const tree = manager.render();
  const groups = nodes(tree).filter(node => node.props?.["data-testid"]?.startsWith("traffic-group-"));
  check(groups.map(group => group.props["data-testid"]), ["traffic-group-empty", "traffic-group-loaded", "traffic-group-unloading", "traffic-group-repair"]);
  const expected = [["car-1"], ["car-0"], ["car-2"], ["car-3"]];
  for (const [index, group] of Array.from(groups.entries())) {
    check(cardNodes(group).map(card => card.props["data-testid"].replace("traffic-vehicle-", "")), expected[index]);
    const count = nodes(group).filter(node => node.props?.className?.includes("tabular-nums"));
    check(count.length, 1); check(count[0].props.children, expected[index].length);
  }
  check(nodes(tree).filter(node => node.props?.className?.includes("tabular-nums")).length, 8); // Mobile selectors + desktop column headings; never visible together.
  check(cardNodes(tree).length, vehicles.length);
  check(new Set(cardNodes(tree).map(card => card.props["data-testid"])).size, vehicles.length);
  check(cardNodes(tree).every(card => card.type === "button"), true);
  const unassignedCard = cardNodes(tree).find(card => card.props["data-testid"] === "traffic-vehicle-car-0")!;
  const assignedCard = cardNodes(tree).find(card => card.props["data-testid"] === "traffic-vehicle-car-1")!;
  check(words(unassignedCard).startsWith("QA-0Truck 0Без водителя"), true);
  check(words(unassignedCard).includes("Водитель не назначен"), false);
  check(words(assignedCard).startsWith("Existing DriverTruck 1 · QA-1"), true);
  check(nodes(tree).filter(node => node.props?.["data-driver-assignment"]).length, 0);
  check(cardNodes(tree).every(card => !card.props.className.includes("pr-14")), true);
  cardNodes(groups[3])[0].props.onClick();
  check(manager.managedVehicles, ["car-3"]); // Repair card stays fully clickable for Fleet Manager controls.
  const colors = ["bg-[#ffffff]", "bg-emerald-100", "bg-amber-100", "bg-rose-100"];
  groups.forEach((group, index) => check(cardNodes(group).every(card => card.props.className.split(" ").includes(colors[index])), true));
  const globalCss = readFileSync("app/globals.css", "utf8");
  // The dashboard shell deliberately remaps .bg-white with !important. PTC cards and
  // the category dot must use an explicit white utility outside that selector.
  const whiteNodes = [...cardNodes(groups[0]), ...nodes(groups[0]).filter(node => node.type === "span" && node.props?.["aria-hidden"])];
  check(whiteNodes.length, 2);
  for (const node of whiteNodes) {
    const classes = node.props.className.split(/\s+/);
    check(classes.includes("bg-white"), false);
    check(classes.includes("bg-[#ffffff]"), true);
  }
  check(globalCss.includes(".travkin-shell .bg-white"), true);
  check(globalCss.includes(".travkin-shell .bg-\\[\\#ffffff\\]"), false);
  check(cardNodes(tree).every(card => card.props.className.includes("p-2.5")), true);
  const managerHtml = renderToStaticMarkup(tree);
  check((managerHtml.match(/data-driver-assignment=/g) ?? []).length, 0);
  check(managerHtml.includes("<button><button"), false);
  const managerText = managerHtml.replace(/<[^>]*>/g, "");
  check((managerText.match(/Пустые/g) ?? []).length, 2);
  check((managerText.match(/Загруженные/g) ?? []).length, 2);
  check((managerText.match(/На выгрузке/g) ?? []).length, 2);
  check((managerText.match(/На ремонте/g) ?? []).length >= 2, true);
  check(managerHtml.includes("lg:grid-cols-4"), true);
  check(managerHtml.includes("grid-cols-4") && !managerHtml.includes('class="grid grid-cols-4'), true);
  const emptyTree = harness("manager", []).render();
  check(nodes(emptyTree).filter(node => node.props?.["data-testid"]?.startsWith("traffic-group-")).length, 4);
  check((renderToStaticMarkup(emptyTree).match(/Нет машин/g) ?? []).length, 4);

  const filterNodes = (value: any) => nodes(value).filter(node => node.props?.["data-testid"]?.startsWith("traffic-filter-"));
  const mobileGroups = (value: any) => nodes(value).filter(node => node.props?.["data-testid"]?.startsWith("traffic-group-") && !node.props.className.split(/\s+/).includes("hidden"));
  const filterCounts = (value: any) => filterNodes(value).map(filter => Number(words(nodes(filter).find(node => node.props?.className?.includes("tabular-nums")))));
  const allRepairManager = harness("manager", repairVehicles);
  const allRepairTree = allRepairManager.render();
  const allRepairGroups = nodes(allRepairTree).filter(node => node.props?.["data-testid"]?.startsWith("traffic-group-"));
  check(allRepairGroups.map(group => cardNodes(group).length), [0, 0, 0, repairVehicles.length]);
  filterNodes(allRepairTree)[3].props.onClick();
  check(mobileGroups(allRepairManager.render()).map(group => group.props["data-testid"]), ["traffic-group-repair"]);
  check(filterCounts(tree), [1, 1, 1, 1]);
  check(mobileGroups(tree).map(group => group.props["data-testid"]), ["traffic-group-empty"]);
  check(filterNodes(tree).map(filter => filter.props["aria-pressed"]), [true, false, false, false]);
  check(nodes(tree).some(node => node.props?.role === "group" && node.props["aria-label"] === "Показать машины по статусу"), true);
  filterNodes(tree).forEach(filter => {
    check(filter.type, "button"); check(filter.props.type, "button");
    check(filter.props.tabIndex, undefined); // Native Tab + Enter/Space, not an incomplete ARIA tablist.
    check(filter.props.className.includes("min-h-[48px]"), true);
    check(filter.props.className.includes("focus-visible:outline"), true);
    check(groups.some(group => group.props.id === filter.props["aria-controls"]), true);
  });
  filterNodes(tree)[1].props.onClick();
  let filteredTree = manager.render();
  check(filterNodes(filteredTree).map(filter => filter.props["aria-pressed"]), [false, true, false, false]);
  check(mobileGroups(filteredTree).map(group => group.props["data-testid"]), ["traffic-group-loaded"]);
  check(cardNodes(mobileGroups(filteredTree)).map(card => card.props["data-testid"]), ["traffic-vehicle-car-0"]);
  check(filterCounts(filteredTree), [1, 1, 1, 1]);
  check(manager.calls.length, 0);
  manager.props.snapshot = {
    ...manager.props.snapshot,
    vehicles: manager.props.snapshot.vehicles.map(vehicle => vehicle.vehicle_id === "car-1" ? { ...vehicle, state: "loaded" } : vehicle),
    events: [{ id: "event-1", vehicle_id: "car-1", from_state: "empty", to_state: "loaded", created_at: "2026-09-04T10:00:00Z", actor_name: "Operator", field_id: null, field_name: null, vehicle_name: "Truck", vehicle_plate: "QA-1" }],
  };
  filteredTree = manager.render();
  check(filterCounts(filteredTree), [0, 2, 1, 1]);
  check(filterNodes(filteredTree).map(filter => filter.props["aria-pressed"]), [false, true, false, false]);
  check(cardNodes(mobileGroups(filteredTree)).length, 2);
  check(nodes(filteredTree).filter(node => node.props?.["data-driver-assignment"]).length, 0);

  // A loaded vehicle is one filter click away even behind fourteen empty vehicles.
  const longFleet = harness("manager", [...Array.from({ length: 14 }, (_, index) => ({ ...vehicles[1], vehicle_id: `empty-${index}` })), vehicles[0], vehicles[2]]);
  check(cardNodes(mobileGroups(longFleet.render())).length, 14);
  filterNodes(longFleet.render())[1].props.onClick();
  check(cardNodes(mobileGroups(longFleet.render())).map(card => card.props["data-testid"]), ["traffic-vehicle-car-0"]);
  check(filterCounts(longFleet.render()), [14, 1, 1, 0]);
  filterNodes(longFleet.render())[2].props.onClick();
  check(cardNodes(mobileGroups(longFleet.render())).map(card => card.props["data-testid"]), ["traffic-vehicle-car-2"]);
  check(filterNodes(longFleet.render())[3].props["aria-pressed"], false);
  check(filterNodes(emptyTree).map(filter => filter.props.disabled), [undefined, undefined, undefined, undefined]);

  const refreshing = harness("harvester");
  refreshing.props.stale = true;
  check(words(refreshing.render()).includes("Проверяем актуальность"), false);
  check(nodes(refreshing.render()).some(node => node.props?.role === "status"), false);
  check(cardNodes(refreshing.render()).filter(card => card.type === "button").every(card => card.props.disabled), true);
  refreshing.props.error = "Нет сети. Проверьте соединение.";
  check(words(refreshing.render()).includes(refreshing.props.error), true);
  nodes(refreshing.render()).find(node => node.props?.["aria-label"] === "Обновить статусы").props.onClick();
  check(refreshing.refreshCalls, [true]);

  for (const role of ["harvester", "receiver"] as const) {
    const h = harness(role);
    let operatorTree = h.render();
    const cards = cardNodes(operatorTree);
    check(nodes(operatorTree).filter(node => node.props?.["data-driver-assignment"]).length, 0);
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
        check(card.props.className.split(/\s+/).includes("grayscale"), false);
        check(card.props.className.split(/\s+/).some((name: string) => name.startsWith("opacity-")), false);
        check(card.props.onClick, undefined);
        check(card.props.tabIndex, undefined);
      }
      check(card.props.className.includes({ empty: "bg-[#ffffff]", loaded: "bg-emerald-100", unloading: "bg-amber-100" }[vehicle.state]), true);
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
    check(pendingCard.props["aria-busy"], undefined);
    check(words(pendingTree).includes("Сохраняем…"), false);
    check(words(pendingCard).includes(model.STATE_LABEL[model.nextState(role, clicked.state)!]), true);
    check(pendingCard.type, role === "harvester" ? "article" : "button");
    if (role === "harvester") check(cardNodes(pendingTree).findIndex(card => card.props["data-testid"] === `traffic-vehicle-${clicked.vehicle_id}`) > 0, true);
    else check(pendingCard.props.disabled, true);
    check(cardNodes(pendingTree).filter(card => card.type === "button" && card !== pendingCard).every(card => !card.props.disabled), true);
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
  check(cardNodes(unloading.render()).length, 0); // Disappears before any network response.
  check(unloading.props.snapshot.vehicles.length, 1); // Canonical source is untouched.
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
  check(cardNodes(replayTree)[0].props["aria-busy"], undefined);
  check(renderToStaticMarkup(replayTree).includes('role="alertdialog"'), false);
  check(replay.refreshCount(), 1);
  replay.refreshGate.resolve(); await flush();

  // An uncertain response rolls back the local display and keeps the SAME retry key.
  const failure = harness("harvester", [vehicles[1]]);
  cardNodes(failure.render())[0].props.onClick();
  nodes(failure.render()).find(node => node.type === Button && words(node) === "Подтвердить").props.onClick();
  failure.requests[0].reject(Object.assign(new Error("HTTP 503: try again"), { status: 503 })); await flush();
  const failedTree = failure.render();
  check(renderToStaticMarkup(failedTree).includes('role="alertdialog"'), false);
  check(words(failedTree).includes("HTTP 503"), true);
  check(failure.props.snapshot.vehicles[0].state, vehicles[1].state);
  check(failure.commits.length, 0);
  check(failure.refreshCalls, [true]);
  check(cardNodes(failedTree)[0].props.disabled, true);
  check(words(cardNodes(failedTree)[0]).includes("Пустая"), true);
  const retry = nodes(failedTree).find(node => node.type === "button" && words(node) === "Повторить отправку");
  retry.props.onClick(); retry.props.onClick();
  check(failure.calls.length, 2);
  check(JSON.stringify(failure.calls[1][2]), JSON.stringify(failure.calls[0][2]));
  failure.requests[1].resolve(receiptFor(vehicles[1], "loaded")); await flush();
  check(failure.props.snapshot.vehicles[0].state, "loaded");

  // A committed receipt without a row needs canonical reconciliation, no spinner.
  const fallback = harness("harvester", [vehicles[1]], { acceptReceipt: false, deferRefresh: true });
  cardNodes(fallback.render())[0].props.onClick();
  nodes(fallback.render()).find(node => node.type === Button && words(node) === "Подтвердить").props.onClick();
  fallback.requests[0].resolve({ ...receiptFor(vehicles[1], "loaded"), vehicle: null, refreshRequired: true }); await flush();
  check(fallback.props.snapshot.vehicles[0].state, "empty");
  check(cardNodes(fallback.render())[0].type, "article");
  check(words(fallback.render()).includes("Сохраняем…"), false);
  check(fallback.refreshCalls, [true]);
  fallback.refreshGate.resolve(); await flush();
  // A failed refetch must not unlock a duplicate transition.
  check(cardNodes(fallback.render())[0].type, "article");
  fallback.props.snapshot = model.applyTrafficCommit(fallback.props.snapshot, receiptFor(vehicles[1], "loaded"));
  fallback.render();
  check(words(fallback.render()).includes("Загружена"), true);

  // Another vehicle remains actionable; out-of-order responses do not lose either intent.
  const parallel = harness("harvester", [vehicles[1], vehicles[3]]);
  const sendCar = (h: ReturnType<typeof harness>, id: string) => {
    cardNodes(h.render()).find(card => card.props["data-testid"] === `traffic-vehicle-${id}`)!.props.onClick();
    nodes(h.render()).find(node => node.type === Button && words(node) === "Подтвердить").props.onClick();
  };
  sendCar(parallel, "car-1");
  check(cardNodes(parallel.render()).find(card => card.props["data-testid"] === "traffic-vehicle-car-3")!.props.disabled, false);
  sendCar(parallel, "car-3"); check(parallel.calls.length, 2);
  check(parallel.calls[0][2].key !== parallel.calls[1][2].key, true);
  check(cardNodes(parallel.render()).every(card => card.type === "article"), true);
  parallel.requests[1].resolve(receiptFor(vehicles[3], "loaded")); await flush();
  check(cardNodes(parallel.render()).every(card => card.type === "article"), true);
  parallel.requests[0].resolve(receiptFor(vehicles[1], "loaded")); await flush();
  check(parallel.props.snapshot.vehicles.every(vehicle => vehicle.state === "loaded"), true);

  // An old GET cannot visually undo an in-flight intent; a newer canonical row wins.
  const racing = harness("receiver", [vehicles[0]]);
  sendCar(racing, "car-0");
  racing.props.snapshot = { ...racing.props.snapshot, vehicles: [{ ...vehicles[0] }] };
  check(words(cardNodes(racing.render())[0]).includes("На выгрузке"), true);
  racing.props.snapshot = model.applyTrafficCommit(racing.props.snapshot, receiptFor(vehicles[0], "empty", vehicles[0].version + 2));
  check(cardNodes(racing.render()).length, 0);
  racing.requests[0].resolve(receiptFor(vehicles[0], "unloading")); await flush();
  check(cardNodes(racing.render()).length, 0);

  // Known rejection restores the card without reopening/interfering with another dialog.
  const rejected = harness("receiver", [vehicles[2]]);
  sendCar(rejected, "car-2"); check(cardNodes(rejected.render()).length, 0);
  rejected.requests[0].reject(Object.assign(new Error("Статус изменён другим сотрудником"), { status: 409 })); await flush();
  check(cardNodes(rejected.render()).length, 1);
  check(cardNodes(rejected.render())[0].props.disabled, false);
  check(words(rejected.render()).includes("QA-2: Статус изменён"), true);
  check(renderToStaticMarkup(rejected.render()).includes('role="alertdialog"'), false);

  // The sender can lose its response after the server commits. A new snapshot settles it.
  const lost = harness("harvester", [vehicles[1]]);
  sendCar(lost, "car-1"); lost.requests[0].reject(new Error("Нет подтверждения сервера")); await flush();
  check(words(lost.render()).includes("Повторить отправку"), true);
  lost.props.snapshot = model.applyTrafficCommit(lost.props.snapshot, receiptFor(vehicles[1], "empty", vehicles[1].version + 3));
  lost.render(); const settled = lost.render();
  check(words(settled).includes("Повторить отправку"), false);
  check(cardNodes(settled)[0].props.disabled, false);

  // Logout/unmount cannot apply a late response into another cabinet.
  const gone = harness("harvester", [vehicles[1]]);
  sendCar(gone, "car-1"); gone.unmount();
  gone.requests[0].resolve(receiptFor(vehicles[1], "loaded")); await flush();
  check(gone.commits.length, 0); check(gone.refreshCount(), 0);
  check(source.includes("animate-spin"), false);

  const malformed = harness("harvester", [vehicles[1]]);
  sendCar(malformed, "car-1");
  malformed.requests[0].resolve({ ...receiptFor(vehicles[1], "loaded"), eventId: "invalid" }); await flush();
  check(malformed.commits.length, 0);
  check(words(cardNodes(malformed.render())[0]).includes("Пустая"), true);
  check(words(malformed.render()).includes("Нет корректного подтверждения"), true);
  check(cardNodes(malformed.render())[0].props.disabled, true);

  const changedWhileConfirming = harness("harvester", [vehicles[1]]);
  cardNodes(changedWhileConfirming.render())[0].props.onClick();
  changedWhileConfirming.props.snapshot = model.applyTrafficCommit(changedWhileConfirming.props.snapshot, receiptFor(vehicles[1], "loaded"));
  nodes(changedWhileConfirming.render()).find(node => node.type === Button && words(node) === "Подтвердить").props.onClick(); await flush();
  check(changedWhileConfirming.calls.length, 0);
  check(words(changedWhileConfirming.render()).includes("Статус машины уже изменился"), true);
  for (const page of ["app/traffic-operator/page.tsx", "app/(dashboard)/traffic/page.tsx"]) {
    check(readFileSync(page, "utf8").includes("key={live.scopeKey}"), true);
  }
  const pageSource = readFileSync("app/(dashboard)/traffic/page.tsx", "utf8");
  const css = (await postcss([tailwindcss({ ...config, content: [{ raw: `${source}\n${pageSource}`, extension: "tsx" }] })]).process("@tailwind utilities;", { from: undefined })).css;
  for (const expression of [/min-height:\s*48px/, /padding:\s*0\.625rem/, /@media \(min-width: 1024px\)/, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
    /\.bg-emerald-100\s*\{/, /\.bg-amber-100\s*\{/]) { assert.match(css, expression); checks++; }
  check(source.includes("grayscale"), false);
  check(source.includes("Проверяем актуальность"), false);
  const compiled = postcss.parse(css);
  const stylesAt = (node: any, width: number) => {
    const classes = new Set(node.props.className.split(/\s+/));
    const declarations: Record<string, string> = {};
    compiled.walkRules(rule => {
      const parent = rule.parent;
      if (parent && isAtRule(parent) && parent.name === "media") {
        const minWidth = parent.params.match(/min-width:\s*(\d+)px/);
        if (minWidth && width < Number(minWidth[1])) return;
      }
      const utility = rule.selector.replace(/^\./, "").replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g,
        (_match, escape: string) => /^[0-9a-fA-F]/.test(escape) ? String.fromCodePoint(parseInt(escape, 16)) : escape);
      if (!classes.has(utility)) return;
      rule.walkDecls(declaration => {
        declarations[declaration.prop] = declaration.value;
        if (declaration.prop === "overflow") declarations["overflow-x"] = declarations["overflow-y"] = declaration.value;
      });
    });
    return declarations;
  };
  // These checks validate compiled responsive constraints, not browser geometry.
  for (const width of [320, 360, 390, 412, 1024, 1440]) {
    const desktop = width >= 1024;
    const toolbar = nodes(filteredTree).find(node => node.props?.["data-testid"] === "traffic-mobile-toolbar");
    const toolbarStyle = stylesAt(toolbar, width);
    check(toolbarStyle.display, desktop ? "none" : "flex");
    check(toolbarStyle.position, "sticky");
    check(toolbarStyle.top, "0px");
    check(toolbarStyle["flex-shrink"], "0");
    check(toolbarStyle["min-width"], "0px");
    const board = nodes(filteredTree).find(node => node.props?.["data-testid"] === "traffic-manager-board");
    check(stylesAt(board, width)["max-height"], desktop ? "none" : "max(12rem,calc(100dvh - 14rem))");
    const lists = nodes(filteredTree).find(node => node.props?.["data-testid"] === "traffic-manager-lists");
    check(stylesAt(lists, width)["min-height"], "0px");
    check(stylesAt(lists, width)["overflow-y"] ?? stylesAt(lists, width).overflow, desktop ? "visible" : "auto");
    check(nodes(lists).includes(toolbar), false); // Selector/menu never scroll away with the cards.
    const renderedGroups = nodes(filteredTree).filter(node => node.props?.["data-testid"]?.startsWith("traffic-group-"));
    check(renderedGroups.filter(group => stylesAt(group, width).display !== "none").length, desktop ? 4 : 1);
    renderedGroups.forEach(group => {
      check(stylesAt(group, width)["min-width"], "0px");
      const heading = nodes(group).find(node => node.type === "h2");
      check(stylesAt(heading, width).display, desktop ? "flex" : "none");
    });
    const filters = filterNodes(filteredTree);
    filters.forEach(filter => {
      check(stylesAt(filter, width)["min-height"], "48px");
      check(stylesAt(filter, width)["min-width"], "0px");
      check(stylesAt(nodes(filter).find(node => node.props?.className?.includes("break-words")), width)["overflow-wrap"], "break-word");
    });
    const filterGrid = nodes(toolbar).find(node => node.props?.role === "group");
    check(stylesAt(filterGrid, width)["grid-template-columns"], "repeat(4, minmax(0, 1fr))");
    const explainer = nodes(filteredTree).find(node => node.props?.["data-testid"] === "traffic-empty-explainer");
    check(stylesAt(explainer, width).display, desktop ? "block" : "none");
    const inlineHistory = nodes(filteredTree).find(node => node.props?.["data-testid"] === "traffic-manager-history-inline");
    check(stylesAt(inlineHistory, width).display, desktop ? "block" : "none");
  }
  const explicitWhite = postcss.parse(css).nodes.find(node => node.type === "rule" && node.selector === ".bg-\\[\\#ffffff\\]");
  check(!!explicitWhite, true);
  if (explicitWhite?.type === "rule") {
    check(explicitWhite.nodes.some(node => node.type === "decl" && node.prop === "background-color" && node.value.includes("255 255 255")), true);
  }
  console.log(`PTC compact board PASS: ${checks} checks (actual component handlers + SSR + compiled CSS; no browser measurements or remote writes)`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
