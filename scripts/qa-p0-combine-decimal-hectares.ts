import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { parseHectaresInput } from "../lib/traffic/hectares-input";

let checks = 0;
const equal = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };
for (const [input, expected] of [["8,3", 8.3], ["8.3", 8.3], ["8,34", 8.34], ["8.345", 8.345], [" 8,3 ", 8.3], ["0", 0], ["0,1", 0.1], [",3", 0.3], [".3", 0.3], ["1000000", 1000000]] as const) {
  equal(parseHectaresInput(input), expected);
}
for (const input of ["", " ", "8,", "8,3,4", "8.3.4", "8,3.4", "8,3456", "1e3", "NaN", "Infinity", "-1", "1000000.001", null, undefined, {}, "8га"]) {
  equal(parseHectaresInput(input), null);
}

const source = readFileSync("components/traffic/traffic-shift-controls.tsx", "utf8");
const localRequire = createRequire(import.meta.url);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
}
function words(node: any): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return Array.isArray(node) ? node.map(words).join("") : node?.props ? words(node.props.children) : "";
}

async function harness() {
  const state: any[] = [];
  let cursor = 0;
  const calls: any[] = [];
  const effects: (() => unknown)[] = [];
  let firstRender = true;
  let refreshes = 0;
  let commits = 0;
  const plots = [
    { cropStructureId: "current", fieldId: "field", fieldName: "28", cropName: "Картофель", varietyName: "Сорая", reproductionName: "1", plannedAreaHa: 12, actualCompletedHa: 2, remainingAreaHa: 10, status: "active" },
    { cropStructureId: "next", fieldId: "next-field", fieldName: "9", cropName: "Картофель", varietyName: "Гала", reproductionName: "1", plannedAreaHa: 15, actualCompletedHa: 0, remainingAreaHa: 15, status: "active" },
  ];
  const mocks: Record<string, unknown> = {
    react: { ...React,
      useState: (initial: any) => {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
        return [state[index], (value: any) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
      },
      useMemo: (fn: () => unknown) => fn(),
      useCallback: (fn: unknown) => fn,
      useEffect: (fn: () => unknown) => { if (firstRender) effects.push(fn); },
    },
    "lucide-react": Object.fromEntries(["Check", "ChevronRight", "MapPin", "Play", "RefreshCw", "Square", "Wrench"].map(name => [name, () => null])),
    "@/lib/traffic/model": { stateAge: () => "1 ч" },
    "@/lib/traffic/hectares-input": { parseHectaresInput },
    "@/components/ui/dialog": Object.fromEntries(["Dialog", "DialogContent", "DialogDescription", "DialogHeader", "DialogTitle"].map(name => [name, ({ children }: any) => children])),
    "./use-traffic": { trafficRequest: async (url: string, method: string, body: unknown) => {
      if (method === "GET") return { plots };
      calls.push({ url, method, body });
      return { ok: true };
    } },
  };
  const loaded = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module: loaded, exports: loaded.exports,
    require: (id: string) => mocks[id] ?? localRequire(id),
    crypto: { randomUUID },
    FormData: class { constructor(private data: Record<string, string>) {} get(key: string) { return this.data[key] ?? null; } },
    window: { confirm: () => true, setInterval: () => 1, clearInterval: () => undefined },
  });
  function render() {
    cursor = 0;
    const tree = loaded.exports.TrafficShiftControls({
      snapshot: { enabled: true, serverTime: new Date().toISOString(), fieldName: "28", combineShift: { id: "shift", status: "open", cropStructureId: "current", openedAt: new Date().toISOString(), hectaresFieldTotal: null } },
      stale: false, refresh: async () => { refreshes++; }, onCommitted: async () => { commits++; },
    });
    firstRender = false;
    return nodes(tree);
  }
  render();
  effects.forEach(fn => fn());
  await flush();
  return { render, calls, commits: () => commits, refreshes: () => refreshes };
}

async function main() {
  for (const action of ["closeShift", "submitPlot"]) {
    for (const value of ["8,3", "8.3", "8,34", "8.345"]) {
      const ui = await harness();
      if (action === "submitPlot") {
        ui.render().find(node => node.type === "button" && words(node).includes("Закончить или сменить поле")).props.onClick();
        ui.render().find(node => node.type === "button" && words(node).includes("Поле 9")).props.onClick();
      }
      const form = ui.render().find(node => node.type === "form" && node.props.onSubmit.name === action);
      form.props.onSubmit({ preventDefault() {}, currentTarget: { hectaresFieldTotal: value } });
      await flush();
      equal(ui.calls.length, 1);
      equal(ui.calls[0].body.hectaresFieldTotal, parseHectaresInput(value));
      equal(ui.calls[0].body.action, action === "closeShift" ? "close" : "switch");
      equal(ui.commits(), 1);
    }
  }
  for (const value of ["", "не число", "8,3,4", "-1", "1,9", "8.1234"]) {
    const ui = await harness();
    const form = ui.render().find(node => node.type === "form" && node.props.onSubmit.name === "closeShift");
    form.props.onSubmit({ preventDefault() {}, currentTarget: { hectaresFieldTotal: value } });
    await flush();
    equal(ui.calls.length, 0);
    equal(nodes(ui.render().find(node => node.type === "form" && node.props.onSubmit.name === "closeShift")).some(node => node.props?.role === "alert"), true);
  }
  const ui = await harness();
  for (const input of ui.render().filter(node => node.type === "input" && node.props.name === "hectaresFieldTotal")) {
    equal(input.props.type, "text");
    equal(input.props.inputMode, "decimal");
  }
  console.log(`P0 combine decimal hectares PASS ${checks}: parsing, both real form handlers, numeric payload, invalid/backwards guards, inline errors; no hosted writes.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
