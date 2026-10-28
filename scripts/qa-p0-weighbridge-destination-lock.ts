import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createUniversalWorkspace, parseUniversalWorkspaceState, serializeUniversalWorkspaceState } from "../lib/weighbridge/universal-workspaces";

const root = process.cwd();
const page = readFileSync(path.join(root, "app/(dashboard)/weighbridge/page.tsx"), "utf8");
const workspace = readFileSync(path.join(root, "lib/weighbridge/universal-workspaces.ts"), "utf8");
let passed = 0;

function check(name: string, test: () => void) {
  test();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

check("destination lock uses a new storage generation", () => {
  assert.match(workspace, /travkin\.weighbridge\.defaultDestination\.v2\.\$\{company\}\.\$\{workstation\}/);
  assert.doesNotMatch(workspace, /defaultDestination\.v1/);
});

check("unavailable warehouse is cleared only in the affected active workspace", () => {
  const block = page.slice(page.indexOf('|| !lockedHarvestDestinationId'), page.indexOf("const stockSourcePlaceType"));
  assert.match(block, /workspace.id === selectedWorkspaceId && workspace.form.operationType === "harvest_incoming"/);
});

check("no single yard is silently selected", () => {
  assert.doesNotMatch(page, /yards\.length === 1 \? yards\[0\] : null/);
});

check("terminal destination is only a migration fallback, not a saved-tab override", () => {
  assert.match(page, /lockedDestinationId = getWeighbridgeDefaultDestinationId\(/);
  assert.match(page, /restoredState.workspaces.map\(\(workspace\) => !migrated && workspace.form.operationType === "harvest_incoming"/);
  assert.match(page, /harvestDestinationLockRef.current = selectedDestinationId/);
});

check("manual destination change always asks for confirmation", () => {
  const handler = page.slice(
    page.indexOf("const changeHarvestDestination = async"),
    page.indexOf("const setActiveHarvestForm =", page.indexOf("const changeHarvestDestination = async")),
  );
  assert.match(handler, /await siteConfirm\(/);
  assert.match(handler, /Сменить место приёмки\?/);
  assert.match(handler, /Зафиксировать место приёмки\?/);
});

check("browser tab draft restores before shared restart fallback", () => {
  assert.match(page, /sessionStorage.getItem\(universalWorkspacePersistKey\) \?\? localStorage.getItem\(universalWorkspacePersistKey\)/);
  assert.match(page, /sessionStorage.setItem\(universalWorkspacePersistKey, snapshot\)/);
  assert.match(page, /localStorage.setItem\(universalWorkspacePersistKey, snapshot\)/);
});

check("confirmed destination changes only the explicitly selected workspace", () => {
  assert.match(page, /workspace.id === targetWorkspaceId && workspace.form.operationType === "harvest_incoming"/);
  assert.doesNotMatch(page, /setWeighbridgeDefaultDestinationId/);
  assert.match(page, /selectedWorkspaceIdRef.current !== targetWorkspaceId/);
  assert.match(page, /hydratedWorkspaceKeyRef.current !== targetWorkspaceKey/);
});

check("active harvest selection cannot replace destination without confirmation", () => {
  assert.match(page, /route\.warehouseId !== harvestDestinationLockRef\.current[\s\S]*?await changeHarvestDestination\(route\.warehouseId\)/);
  assert.match(page, /warehouseToId: harvestDestinationLockRef\.current/);
});

check("switching workspace restores its own form and destination lock", () => {
  const block = page.slice(page.indexOf("const activateWorkspace ="), page.indexOf("const selectWorkspace ="));
  assert.match(block, /const nextForm = workspace.form;/);
  assert.match(block, /nextForm.operationType === "harvest_incoming" \? nextForm.warehouseToId : ""/);
  assert.match(block, /harvestDestinationLockRef.current = destinationId/);
});

check("harvest destination picker uses the guarded handler", () => {
  const picker = page.slice(
    page.indexOf("<Label>Место приёмки *"),
    page.indexOf("isImpurityRemoval", page.indexOf("<Label>Место приёмки *")),
  );
  assert.match(picker, /changeHarvestDestination\(warehouseToId\)/);
  assert.match(picker, /Автоматически он меняться не будет/);
});

check("ticket submission rejects a form and lock mismatch", () => {
  assert.match(page, /form\.warehouseToId !== harvestDestinationLockRef\.current/);
  assert.match(page, /Место приёмки не подтверждено/);
});

check("ticket reset retains the confirmed destination", () => {
  assert.match(page, /operationType: "harvest_incoming"[\s\S]*?warehouseToId: prev\.warehouseToId/);
});

check("same field, different destinations survive reload without mixing cargo", () => {
  const initial = { operationType: "harvest_incoming", fieldId: "vinograd", warehouseToId: "", grossKg: "", cropStructureAllocationId: "gala-1" };
  const tabs = [
    createUniversalWorkspace({ ...initial, warehouseToId: "storage", grossKg: "20000" }, "harvest_incoming", "one"),
    createUniversalWorkspace({ ...initial, warehouseToId: "hangar", grossKg: "17000" }, "harvest_incoming", "two"),
  ];
  const restored = parseUniversalWorkspaceState(serializeUniversalWorkspaceState({ version: 3, selectedId: "two", workspaces: tabs, migratedLegacyHarvest: true }), initial)!;
  assert.deepEqual(restored.workspaces, tabs);
  assert.equal(restored.selectedId, "two");
  assert.equal(createUniversalWorkspace(initial).form.warehouseToId, "");
});

check("new tab never inherits another tab's destination silently", () => {
  const block = page.slice(page.indexOf("const addWorkspace ="), page.indexOf("const removeWorkspace ="));
  assert.match(block, /const next = createEmptyWorkspace\(operationType\)/);
  assert.doesNotMatch(block, /harvestDestinationLockRef/);
});

check("warehouse is prominent in tab title and confirmation is explicitly local", () => {
  assert.match(page, /primaryLabel = warehouseTo\?\.name \|\| "Выберите место приёмки"/);
  assert.match(page, /Новые талоны только этой вкладки/);
  assert.doesNotMatch(page, /Зафиксировано для всего терминала|Все новые талоны этого терминала/);
});

console.log(`P0 weighbridge destination lock PASS: ${passed}/${passed}`);
