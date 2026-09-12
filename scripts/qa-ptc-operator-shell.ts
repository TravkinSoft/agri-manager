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

const localRequire = createRequire(import.meta.url);
const pageSource = readFileSync("app/traffic-operator/page.tsx", "utf8");
const pwaSource = readFileSync("components/traffic/install-traffic-app.tsx", "utf8");
let checks = 0;
function check(actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected);
  checks++;
}
function load(source: string, dependencies: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
  const loaded = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module: loaded, exports: loaded.exports,
    require: (name: string) => dependencies[name] ?? localRequire(name), ...globals,
  });
  return loaded.exports;
}
function nodes(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function materialize(node: any): any {
  let current = node;
  while (current && typeof current.type === "function") current = current.type(current.props);
  return current;
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const TrafficBoard = () => null;
const TrafficPwa = () => null;
function page(live: Record<string, unknown>, released = true) {
  const pageModule = load(pageSource, {
    react: {
      ...React,
      useState: (initial: unknown) => [initial === "checking" ? "operator" : initial, () => undefined],
      useCallback: (callback: unknown) => callback,
      useEffect: () => undefined,
    },
    "lucide-react": { Truck: () => null, LogOut: () => null, Loader2: () => null, Plus: () => null, Settings2: () => null },
    "@/lib/traffic/model": { ROLE_LABEL: { harvester: "Комбайнёр", receiver: "Приёмка картофеля" } },
    "@/components/traffic/traffic-board": { TrafficBoard },
    "@/components/traffic/use-traffic": { useTraffic: () => live, trafficRequest: async () => ({}) },
    "@/components/traffic/install-traffic-app": { TrafficPwa },
    "@/components/traffic/traffic-fleet-controls": { TrafficFleetControls: () => null },
    "@/components/traffic/fleet-entity-creator": { FleetEntityCreator: () => null },
    "@/components/traffic/traffic-shift-controls": { TrafficShiftControls: () => null },
    "@/lib/supabase/client": { supabase: {} },
    "@/lib/travkinflow-2/release": { TRAVKINFLOW_2_FUNCTIONS_RELEASED: released },
  });
  return materialize(pageModule.default());
}

async function main() {
  const layout = load(readFileSync("app/traffic-operator/layout.tsx", "utf8"));
  const viewport = JSON.parse(JSON.stringify(layout.metadata.viewport));
  check(viewport, { width: "device-width", initialScale: 1, minimumScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" });
  // Exercise the installed Next 13 serializer, not just a source-text assertion.
  const { resolveViewport } = localRequire("next/dist/lib/metadata/resolvers/resolve-basics");
  const serialized = resolveViewport(viewport);
  for (const setting of ["width=device-width", "initial-scale=1", "minimum-scale=1", "maximum-scale=1", "user-scalable=no", "viewport-fit=cover"]) {
    check(serialized.split(", ").includes(setting), true);
  }
  check(layout.metadata.manifest, "/traffic-operator.webmanifest");
  check(layout.default({ children: "route contents" }), "route contents");
  const root = readFileSync("app/layout.tsx", "utf8");
  check(/minimumScale|maximumScale|userScalable/.test(root), false);
  check(root.includes("manifest: '/manifest.webmanifest'"), true);
  check(pageSource.includes('trafficRequest("/api/traffic?snapshot=1"'), true);
  check(/failure\.status === 401 \|\| failure\.status === 403/.test(pageSource), true);
  check(/mode === "manager"[\s\S]*<TrafficManagerPwa/.test(pageSource), true);
  check(/<TrafficFleetControls[\s\S]*<FleetEntityCreator/.test(pageSource), true);
  check(pageSource.includes("fleet={managed?.fleet}"), true);
  check(/onManageVehicle=\{managed\?\.canManageFleet \? setSelected : undefined\}/.test(pageSource), true);
  check(/Settings2|Машины не на линии|drawerOpen|onDrawerOpen/.test(pageSource), false);
  check(pageSource.includes("const PTC_BOARD_V2 = TRAVKINFLOW_2_FUNCTIONS_RELEASED"), true);
  check(readFileSync("lib/travkinflow-2/release.ts", "utf8").includes("export const TRAVKINFLOW_2_FUNCTIONS_RELEASED = true"), true);

  const applyCommitted = () => undefined;
  const scenarios = [
    { loading: true, needsLogin: false, data: null },
    { loading: false, needsLogin: true, data: null },
    { loading: false, needsLogin: false, data: { role: "harvester", personName: "Тест" } },
    { loading: false, needsLogin: false, data: { role: "receiver", personName: "Тест" } },
    { loading: false, needsLogin: false, data: null },
  ];
  for (const scenario of scenarios) {
    const tree = page({ ...scenario, stale: false, error: "", refresh: async () => undefined, applyCommitted });
    check(tree.type, "main");
    check(tree.props.className.split(/\s+/).includes("tf2-shell"), true);
    check(tree.props.className.split(/\s+/).includes("tf2-traffic-shell"), true);
    check(tree.props.className.split(/\s+/).includes("touch-pan-y"), true);
    check(tree.props.className.split(/\s+/).includes("min-h-[100dvh]"), true);
    check(/(?:^|\s)(?:h-screen|h-\[100dvh\]|overflow-hidden|overflow-y-hidden)(?:\s|$)/.test(tree.props.className), false);
    check(nodes(tree).filter(node => node.type === TrafficPwa).length, 1);
    const html = renderToStaticMarkup(tree);
    check(/Установить на телефон|Как установить|Установка Оборота машин|на главном экране/.test(html), false);
    for (const target of nodes(tree).filter(node => ["button", "input", "a"].includes(node.type))) {
      check(target.props.className.includes("min-h-[48px]"), true);
      if (target.type === "input") check(target.props.className.includes("text-base"), true);
    }
    if (scenario.data) {
      const board = nodes(tree).find(node => node.type === TrafficBoard);
      check(board.props.onCommitted, applyCommitted);
      check(board.props.fleet, undefined); // Operator cabinets never receive the manager fleet payload.
      check(board.props.onManageVehicle, undefined);
    }
  }

  {
    const legacyTree = page({ loading: false, needsLogin: true, data: null, stale: false, error: "", refresh: async () => undefined }, false);
    const legacyClasses = legacyTree.props.className.split(/\s+/);
    check(legacyClasses.includes("tf2-shell"), false);
    check(legacyClasses.includes("tf2-traffic-shell"), false);
    check(legacyClasses.includes("bg-card"), true);
    const legacyContainer = nodes(legacyTree).find(node => node.type === "div" && node.props?.className === "mx-auto max-w-5xl");
    check(Boolean(legacyContainer), true);
    const legacyForm = nodes(legacyTree).find(node => node.type === "form");
    check(legacyForm.props.className.includes("max-w-sm"), true);
    check(legacyForm.props.className.includes("tf2-panel"), false);
    check(renderToStaticMarkup(legacyTree).includes("Единый аккаунт TravkinFlow"), false);
  }

  // Mount the actual headless effect with controlled browser APIs: no network or browser writes.
  for (const mode of ["secure", "insecure", "unsupported", "register-fails", "update-fails"] as const) {
    const effects: Array<() => unknown> = [];
    const calls: any[] = [];
    let updates = 0;
    const navigatorMock = mode === "unsupported" ? {} : {
      serviceWorker: { register: async (...args: any[]) => {
        calls.push(args);
        if (mode === "register-fails") throw new Error("simulated registration failure");
        return { update: async () => {
          updates++;
          if (mode === "update-fails") throw new Error("simulated update failure");
        } };
      } },
    };
    const pwa = load(pwaSource, {
      react: { useEffect: (effect: () => unknown, deps: unknown[]) => { check(deps.length, 0); effects.push(effect); } },
    }, {
      navigator: navigatorMock,
      window: { isSecureContext: mode !== "insecure", addEventListener: () => { throw new Error("No global event listeners in the headless PWA"); } },
    });
    check(pwa.TrafficPwa(), null);
    check(effects.length, 1);
    effects[0]();
    await flush();
    const shouldRegister = mode !== "insecure" && mode !== "unsupported";
    check(calls.length, shouldRegister ? 1 : 0);
    if (shouldRegister) check(JSON.parse(JSON.stringify(calls[0])), ["/ptc-sw.js", { scope: "/traffic-operator", updateViaCache: "none" }]);
    check(updates, shouldRegister && mode !== "register-fails" ? 1 : 0);
  }
  check(/preventDefault|touchmove|gesturestart|beforeinstallprompt|appinstalled|\.unregister\(|caches\./.test(pwaSource), false);
  const css = (await postcss([tailwindcss({ ...config, content: [{ raw: pageSource, extension: "tsx" }] })])
    .process("@tailwind utilities;", { from: undefined })).css;
  // Tailwind 3 composes touch-action through custom properties rather than a literal pan-y.
  const touchRule = postcss.parse(css).nodes.find(node => node.type === "rule" && node.selector === ".touch-pan-y");
  check(touchRule?.type, "rule");
  if (touchRule?.type === "rule") {
    check(touchRule.nodes.some(node => node.type === "decl" && node.prop === "--tw-pan-y" && node.value === "pan-y"), true);
    check(touchRule.nodes.some(node => node.type === "decl" && node.prop === "touch-action" && node.value === "var(--tw-pan-x) var(--tw-pan-y) var(--tw-pinch-zoom)"), true);
  }
  for (const expression of [/min-height:\s*100dvh/, /min-height:\s*48px/, /font-size:\s*1rem/, /safe-area-inset-bottom/, /safe-area-inset-top/]) {
    assert.match(css, expression); checks++;
  }
  console.log(`PTC operator shell PASS: ${checks} checks (component renders, actual headless effect, Next viewport serialization, compiled CSS). Physical Android gestures/accessibility overrides require device QA.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
