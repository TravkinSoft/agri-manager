import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  UNIVERSAL_WORKSPACE_MAX_TABS,
  UNIVERSAL_WORKSPACE_OPERATION_TYPES,
  UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
  createUniversalWorkspace,
  isUniversalWorkspaceDirty,
  migrateLegacyHarvestWorkspaces,
  parseUniversalWorkspaceState,
  serializeUniversalWorkspaceState,
  universalWorkspaceStorageKey,
} from "../lib/weighbridge/universal-workspaces";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const tabs = read("components/weighbridge/universal-workspace-tabs.tsx");

const initialForm = {
  operationType: "harvest_incoming",
  fieldId: "",
  warehouseFromId: "",
  warehouseToId: "",
  cropStructureAllocationId: "",
  vehicleId: "",
  driverId: "",
  grossKg: "",
  notes: "",
};

const checks: Array<{ name: string; run: () => void }> = [];
const check = (name: string, run: () => void) => checks.push({ name, run });

check("universal operation menu reuses all seven canonical types", () => {
  assert.deepEqual(UNIVERSAL_WORKSPACE_OPERATION_TYPES, [
    "harvest_incoming",
    "supplier_receipt",
    "issue_to_field",
    "transfer_between_warehouses",
    "shipment_outbound",
    "disposal_writeoff",
    "impurity_removal",
  ]);
  for (const type of UNIVERSAL_WORKSPACE_OPERATION_TYPES) assert.match(tabs, new RegExp(type));
});

check("workspace is local UI state and max is six", () => {
  assert.equal(UNIVERSAL_WORKSPACE_MAX_TABS, 6);
  assert.match(page, /Можно открыть не более 6 рабочих вкладок\./);
  assert.match(tabs, /title="Добавить вкладку"/);
  assert.doesNotMatch(tabs, /Добавить приёмку|Максимум 4/);
});

check("six workspaces preserve independent form state", () => {
  const workspaces = UNIVERSAL_WORKSPACE_OPERATION_TYPES.slice(0, 6).map((operationType, index) =>
    createUniversalWorkspace(
      { ...initialForm, operationType, notes: `workspace-${index}`, grossKg: String(index * 1000) },
      operationType,
      `workspace-${index}`
    )
  );
  workspaces[0].form.fieldId = "field-28";
  workspaces[1].form.warehouseFromId = "bis";
  workspaces[1].form.warehouseToId = "field-store";
  assert.equal(workspaces[0].form.fieldId, "field-28");
  assert.equal(workspaces[0].form.warehouseFromId, "");
  assert.equal(workspaces[1].form.warehouseFromId, "bis");
  assert.equal(workspaces[5].form.notes, "workspace-5");
});

check("v3 persistence survives serialization and caps hostile payloads at six", () => {
  const workspaces = Array.from({ length: 8 }, (_, index) =>
    createUniversalWorkspace({ ...initialForm, notes: String(index) }, "harvest_incoming", `w-${index}`)
  );
  const raw = serializeUniversalWorkspaceState({
    version: UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
    selectedId: "w-5",
    workspaces,
    migratedLegacyHarvest: true,
  });
  const restored = parseUniversalWorkspaceState(raw, initialForm);
  assert.ok(restored);
  assert.equal(restored.workspaces.length, 6);
  assert.equal(restored.selectedId, "w-5");
  assert.equal(restored.workspaces[5].form.notes, "5");
});

check("legacy harvest tabs migrate once to harvest workspaces", () => {
  const migrated = migrateLegacyHarvestWorkspaces(JSON.stringify({
    selectedId: "intake-2",
    drafts: [
      { id: "intake-1", fieldId: "field-28", warehouseToId: "hangar-1", grossKg: "18000" },
      { id: "intake-2", fieldId: "field-20", warehouseToId: "grain", grossKg: "24000" },
    ],
  }), initialForm);
  assert.ok(migrated);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.migratedLegacyHarvest, true);
  assert.equal(migrated.selectedId, "intake-2");
  assert.equal(migrated.workspaces[0].form.operationType, "harvest_incoming");
  assert.equal(migrated.workspaces[1].form.grossKg, "24000");
  assert.equal(parseUniversalWorkspaceState(serializeUniversalWorkspaceState(migrated), initialForm)?.migratedLegacyHarvest, true);
});

check("storage is isolated by company season and workstation, not operator", () => {
  const key = universalWorkspaceStorageKey("company-a", "season-2026", "terminal-1");
  assert.equal(key, "travkin.weighbridge.universalWorkspaces.v3.company-a.season-2026.terminal-1");
  assert.notEqual(key, universalWorkspaceStorageKey("company-b", "season-2026", "terminal-1"));
  assert.notEqual(key, universalWorkspaceStorageKey("company-a", "season-2027", "terminal-1"));
  assert.notEqual(key, universalWorkspaceStorageKey("company-a", "season-2026", "terminal-2"));
});

check("dirty state requires confirmation but empty workspace does not", () => {
  assert.equal(isUniversalWorkspaceDirty(initialForm, initialForm), false);
  assert.equal(isUniversalWorkspaceDirty({ ...initialForm, grossKg: "18000" }, initialForm), true);
  assert.equal(isUniversalWorkspaceDirty(initialForm, initialForm, 1), true);
  assert.match(page, /Сменить тип движения\?/);
  assert.match(page, /Несохранённые данные этой вкладки будут очищены\./);
  assert.match(page, /Закрыть вкладку\?/);
  assert.match(page, /Открытый талон останется в разделе “Открытые талоны”\./);
});

check("add and close handlers never create business entities", () => {
  const handlerBlock = page.slice(page.indexOf("const addWorkspace"), page.indexOf("const changeHarvestTarget"));
  assert.doesNotMatch(handlerBlock, /fetch\(|createTicket\(|createActiveHarvestRoute\(|supabase\.|\.insert\(|\.update\(|\.delete\(/);
});

check("only active workspace mounts the heavy form and shared cache stays 1x", () => {
  assert.match(page, /const \[form, setForm\] = useState<FormState>\(INITIAL_FORM\)/);
  assert.doesNotMatch(page, /workspaces\.map\([\s\S]{0,300}<Card/);
  assert.match(page, /weighbridgePageCache = new Map/);
  assert.match(page, /transportPickerRequestCache = new Map/);
});

check("six tabs stay in one row on desktop and wrap only below desktop", () => {
  assert.match(tabs, /grid-cols-2/);
  assert.match(tabs, /md:grid-cols-3/);
  assert.match(tabs, /xl:grid-cols-6/);
  assert.doesNotMatch(tabs, /min-\[1680px\]:grid-cols-6/);
  assert.doesNotMatch(tabs, /overflow-x-auto|overflow-x-scroll|whitespace-nowrap/);
});

check("closing the last workspace creates a default harvest workspace", () => {
  assert.match(page, /remaining\.length > 0[\s\S]*createEmptyWorkspace\("harvest_incoming"\)/);
});

const createSamples: number[] = [];
const switchSamples: number[] = [];
let perfWorkspaces = [createUniversalWorkspace(initialForm, "harvest_incoming", "p-0")];
for (let index = 0; index < 600; index += 1) {
  const operationType = UNIVERSAL_WORKSPACE_OPERATION_TYPES[index % UNIVERSAL_WORKSPACE_OPERATION_TYPES.length];
  const createStart = performance.now();
  const next = createUniversalWorkspace(initialForm, operationType, `p-${index + 1}`);
  perfWorkspaces = [...perfWorkspaces.slice(-5), next];
  createSamples.push(performance.now() - createStart);

  const switchStart = performance.now();
  const selected = perfWorkspaces[index % perfWorkspaces.length];
  assert.ok(selected.form);
  switchSamples.push(performance.now() - switchStart);
}

const percentile = (values: number[], quantile: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
};

let passed = 0;
for (const item of checks) {
  item.run();
  passed += 1;
  console.log(`PASS ${item.name}`);
}

const metrics = {
  tabCreateP50Ms: Number(percentile(createSamples, 0.5).toFixed(3)),
  tabCreateP95Ms: Number(percentile(createSamples, 0.95).toFixed(3)),
  tabSwitchP50Ms: Number(percentile(switchSamples, 0.5).toFixed(3)),
  tabSwitchP95Ms: Number(percentile(switchSamples, 0.95).toFixed(3)),
};

assert.ok(metrics.tabCreateP95Ms <= 50, `tab create p95 ${metrics.tabCreateP95Ms}ms exceeds 50ms`);
assert.ok(metrics.tabSwitchP95Ms <= 50, `tab switch p95 ${metrics.tabSwitchP95Ms}ms exceeds 50ms`);
console.log(JSON.stringify({ passed, total: checks.length, metrics }));
