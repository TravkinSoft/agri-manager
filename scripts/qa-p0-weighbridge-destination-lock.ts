import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

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

check("destination lock can be invalidated when a warehouse disappears", () => {
  assert.match(workspace, /export function clearWeighbridgeDefaultDestinationId/);
  assert.match(page, /clearWeighbridgeDefaultDestinationId\(/);
});

check("no single yard is silently selected", () => {
  assert.doesNotMatch(page, /yards\.length === 1 \? yards\[0\] : null/);
});

check("workspace hydration applies one terminal destination to every harvest tab", () => {
  assert.match(page, /lockedDestinationId = getWeighbridgeDefaultDestinationId\(/);
  assert.match(page, /restoredState\.workspaces\.map\(\(workspace\) => workspace\.form\.operationType === "harvest_incoming"[\s\S]*?warehouseToId: lockedDestinationId/);
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

check("confirmed destination is persisted for company and workstation", () => {
  assert.match(page, /setWeighbridgeDefaultDestinationId\([\s\S]*?profile\.company_id,[\s\S]*?workstationId,[\s\S]*?nextWarehouse\.id/);
});

check("confirmed destination is propagated to every harvest workspace", () => {
  assert.match(page, /setWorkspaces\(\(current\) => current\.map\(\(workspace\) => workspace\.form\.operationType === "harvest_incoming"[\s\S]*?warehouseToId: nextWarehouse\.id/);
});

check("active harvest selection cannot replace destination without confirmation", () => {
  assert.match(page, /route\.warehouseId !== harvestDestinationLockRef\.current[\s\S]*?await changeHarvestDestination\(route\.warehouseId\)/);
  assert.match(page, /warehouseToId: harvestDestinationLockRef\.current/);
});

check("switching workspace reapplies the terminal lock", () => {
  assert.match(page, /const nextForm = workspace\.form\.operationType === "harvest_incoming"[\s\S]*?warehouseToId: harvestDestinationLockRef\.current/);
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

assert.equal(passed, 12);
console.log(`P0 weighbridge destination lock PASS: ${passed}/12`);
