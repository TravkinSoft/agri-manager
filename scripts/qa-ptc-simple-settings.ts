import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const localRequire = createRequire(import.meta.url);
let checks = 0;
function check(actual: unknown, expected: unknown) { assert.deepEqual(actual, expected); checks++; }
function load(source: string, dependencies: Record<string, unknown>) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} as any };
  vm.runInNewContext(output, { exports: loaded.exports, module: loaded, require: (name: string) => dependencies[name] ?? localRequire(name) });
  return loaded.exports;
}
function flatten(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  return [node, ...flatten(node.props?.children)];
}
function textOf(node: any): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return node?.props ? textOf(node.props.children) : "";
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const wrapper = ({ children }: any) => React.createElement("div", null, children);
const Button = ({ children, ...props }: any) => React.createElement("button", props, children);
const TrafficBoard = () => null;
const DropdownMenuItem = wrapper;
const DropdownMenuContent = ({ children }: any) => React.createElement("div", null, children);

async function main() {
  const pageSource = readFileSync("app/(dashboard)/traffic/page.tsx", "utf8");
  const boardSource = readFileSync("components/traffic/traffic-board.tsx", "utf8");
  const apiSource = readFileSync("app/api/traffic/route.ts", "utf8");
  const legacyField = "10000000-0000-4000-8000-000000000001";
  const ids = [1, 2, 3, 4].map(n => `20000000-0000-4000-8000-00000000000${n}`);
  const snapshot = {
    role: "manager", personName: "", enabled: false, fieldId: legacyField, fieldName: "Legacy field",
    events: [], serverTime: "2026-09-04T00:00:00Z",
    vehicles: ["empty", "loaded", "unloading"].map((state, i) => ({
      vehicle_id: ids[i], state, assigned: true, name: `Truck ${i + 1}`, plate: `TEST-${i + 1}`, version: i + 10, cycle: i + 1,
    })),
  };
  const submitted: any[] = [];
  const live = {
    managerData: { snapshot, fleet: [0, 3].map(i => ({ id: ids[i], name: `Truck ${i + 1}`, license_plate: `TEST-${i + 1}` })), people: [], accounts: [], fields: [], canManageUsers: false },
    data: snapshot, loading: false, error: "", stale: false, refresh: async () => undefined,
  };
  // React test libraries are not installed. Execute the real component and its handlers
  // with controlled hook state, then SSR its real form. This is not a browser/mobile gate.
  const state: any[] = [], refs: any[] = [];
  let stateIndex = 0, refIndex = 0;
  const component = load(pageSource, {
    react: { ...React,
      useState: (initial: any) => {
        const i = stateIndex++;
        if (!(i in state)) state[i] = initial;
        return [state[i], (value: any) => { state[i] = typeof value === "function" ? value(state[i]) : value; }];
      },
      useRef: (initial: any) => { const i = refIndex++; return refs[i] ?? (refs[i] = { current: initial }); },
    },
    "lucide-react": { Truck: () => null, Settings2: () => null, KeyRound: () => null, Loader2: () => null },
    "@/components/traffic/traffic-board": { TrafficBoard },
    "@/components/traffic/use-traffic": { useTraffic: () => live, trafficRequest: async (...args: any[]) => { submitted.push(args); return { ok: true }; } },
    "@/lib/traffic/model": { ROLE_LABEL: {}, operatorRole: () => null },
    "@/components/ui/dialog": { Dialog: wrapper, DialogContent: wrapper, DialogHeader: wrapper, DialogTitle: wrapper, DialogDescription: wrapper },
    "@/components/ui/button": { Button },
    "@/components/ui/dropdown-menu": { DropdownMenu: wrapper, DropdownMenuTrigger: wrapper, DropdownMenuContent, DropdownMenuItem },
  }).default;
  function render() { stateIndex = 0; refIndex = 0; return component(); }
  function openSettings() {
    const tree = render();
    flatten(tree).find(node => node.type === "button" && textOf(node).includes("Выбрать машины")).props.onClick();
    return render();
  }
  const initialTree = render();
  const desktopHeader = flatten(initialTree).find(node => node.type === "header");
  check(desktopHeader.props.className.includes("hidden lg:block"), true);
  check(flatten(initialTree).some(node => node.type === "h1" && node.props.className.includes("sr-only lg:hidden")), true);
  const mobileActions = flatten(initialTree).find(node => node.type === TrafficBoard).props.mobileActions;
  const menuTrigger = flatten(mobileActions).find(node => node.type === "button");
  check(menuTrigger.props["aria-label"], "Настройки оборота машин");
  check(menuTrigger.props.className.includes("min-h-[48px] min-w-[48px]"), true);
  check(menuTrigger.props.disabled, false);
  const menuContent = flatten(mobileActions).find(node => node.type === DropdownMenuContent);
  check(menuContent.props.align, "end");
  check(menuContent.props.className, "max-w-[calc(100vw-2rem)]");
  // The production Radix content uses a portal, outside the mobile list's scroller.
  check(readFileSync("components/ui/dropdown-menu.tsx", "utf8").includes("<DropdownMenuPrimitive.Portal>"), true);
  const menuItems = flatten(mobileActions).filter(node => node.type === DropdownMenuItem && node.props.onSelect);
  check(menuItems.length, 2);
  check(menuItems.every(node => node.props.className.includes("min-h-[48px]")), true);
  menuItems[0].props.onSelect();
  check(flatten(render()).some(node => node.type === "form"), true);
  check(textOf(render()).includes("Машины в работе"), true);
  menuItems[1].props.onSelect();
  check(textOf(render()).includes("Аккаунты операторов"), true);
  check(submitted.length, 0); // Opening either menu item is read-only.
  let tree = openSettings();
  let html = renderToStaticMarkup(tree);
  check(html.includes("<select"), false);
  check(html.includes("Оборот машин включён"), false);
  check(html.includes("Поле потока"), false);
  check(html.includes("Сохранить машины"), true);
  check(html.includes("TEST-2") && html.includes("TEST-3"), true); // Assigned cars not in active fleet remain visible.
  let inputs = flatten(tree).filter(node => node.type === "input" && node.props.type === "checkbox");
  check(inputs.length, 4); // Only vehicle selectors before adding a new car.
  check(inputs.filter(node => node.props.disabled).length, 2);
  check(inputs.filter(node => node.props.disabled).every(node => node.props.checked), true);
  check(inputs.some(node => node.props.required), false);
  inputs.find(node => !node.props.checked).props.onChange({ target: { checked: true } });
  tree = render();
  inputs = flatten(tree).filter(node => node.type === "input" && node.props.type === "checkbox");
  check(inputs.filter(node => node.props.required).length, 1); // New vehicles still require empty confirmation.
  html = renderToStaticMarkup(tree);
  check(html.includes("Добавляемые машины сейчас пустые."), true);
  const form = flatten(tree).find(node => node.type === "form");
  form.props.onSubmit({ preventDefault() {} });
  await flush();
  check(submitted.length, 1);
  check(submitted[0][0], "/api/traffic");
  check(submitted[0][1], "POST");
  check(JSON.parse(JSON.stringify(submitted[0][2])), { action: "configure", enabled: true, fieldId: legacyField, vehicleIds: [ids[0], ids[1], ids[2], ids[3]] });

  tree = openSettings(); live.stale = true; tree = render();
  const staleSubmit = flatten(tree).find(node => node.type === Button && node.props.type === "submit");
  check(staleSubmit.props.disabled, true);
  flatten(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  await flush(); check(submitted.length, 1); // Handler also refuses stale writes.
  live.stale = false; live.managerData.snapshot.fieldId = null as unknown as string;
  tree = openSettings();
  flatten(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  await flush();
  check(submitted[1][2].enabled, true); check(submitted[1][2].fieldId, null);

  const tables: string[] = [];
  const db = { from: (table: string) => {
    tables.push(table);
    if (table === "fields") throw new Error("Field catalog must not be loaded");
    const q: any = { select: () => q, eq: () => q, is: () => q, in: () => q, order: () => q, range: async () => ({ data: [], error: null }) };
    return q;
  } };
  const api = load(apiSource, {
    "next/server": {},
    "@/lib/supabase/service": { getServiceClient: () => db },
    "@/lib/traffic/server": {
      manager: async () => ({ actor: { role: "agronomist" }, companyId: "company" }),
      readSnapshot: async () => snapshot, noStore: (data: any) => data, failed: (error: unknown) => { throw error; }, sameOrigin: () => undefined,
    },
  });
  const response = await api.GET({ nextUrl: new URL("https://example.test/api/traffic") });
  check(tables, ["reference_vehicles", "company_people", "profiles"]);
  check(JSON.parse(JSON.stringify(response.fields)), []);
  check(response.snapshot, snapshot);
  check(response.canManageUsers, false);
  tables.length = 0;
  const compact = await api.GET({ nextUrl: new URL("https://example.test/api/traffic?snapshot=1") });
  check(tables, []); check(compact.snapshot, snapshot);
  check(boardSource.includes("Поле не назначено") || boardSource.includes("snapshot.fieldName") || boardSource.includes("event.field_name"), false);
  check(boardSource.includes("stale || !snapshot.enabled"), true);

  const readTables: string[] = [];
  const server = load(readFileSync("lib/traffic/server.ts", "utf8"), {
    "next/server": {},
    "@/lib/supabase/service": { getServiceClient: () => ({ from: (table: string) => {
      readTables.push(table);
      if (table === "fields") throw new Error("Snapshot must not depend on the field catalog");
      const rows: Record<string, any[]> = {
        ptc_flows: [{ enabled: true, field_id: legacyField }],
        ptc_vehicle_states: snapshot.vehicles,
        ptc_events: [{ id: "old-event", vehicle_id: ids[0], field_id: legacyField }],
        reference_vehicles: snapshot.vehicles.map(v => ({ id: v.vehicle_id, name: v.name, license_plate: v.plate, primary_responsible_personnel_id: null })),
      };
      const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: rows[table]?.[0] ?? null, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve, reject),
      };
      return q;
    } }) },
    "@/lib/auth/server-session": {}, "@/lib/auth/server-acl": {},
    "./model": { visibleVehicles: (vehicles: any[]) => vehicles, operatorRole: () => null },
  });
  const current = await server.readSnapshot("company", "manager", "");
  check(readTables.includes("fields"), false);
  check(current.fieldId, legacyField); check(current.fieldName, null);
  check(current.events[0].field_id, legacyField); check(current.events[0].field_name, null);
  check(current.vehicles.length, 3);
  console.log(`PTC simple settings PASS: ${checks} checks (real component handlers + SSR, injected GET; no browser or hosted writes)`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
