import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { formatVehiclePlate, transportPickerLabel } from "../lib/weighbridge/transport";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
let passed = 0;

function check(name: string, test: () => void) {
  test();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

const warehousePage = read("app/(dashboard)/warehouses/manage/page.tsx");
const warehouseService = read("lib/services/warehouses.ts");
const weighbridgePage = read("app/(dashboard)/weighbridge/page.tsx");
const picker = read("components/weighbridge/transport-driver-picker.tsx");
const combobox = read("components/weighbridge/searchable-combobox.tsx");

check("warehouse core responses publish before delete checks", () => {
  assert.match(warehousePage, /setWarehouses\(warehousesData\)[\s\S]*?setLoading\(false\)[\s\S]*?void loadDeleteChecks/);
});
check("warehouse requests use generation guard", () => assert.match(warehousePage, /generation !== loadGenerationRef\.current/));
check("warehouse requests abort stale work", () => assert.match(warehousePage, /loadAbortRef\.current\?\.abort\(\)/));
check("warehouse confirmed data is cached", () => assert.match(warehousePage, /warehouseManageCache\.set\(cacheKey/));
check("warehouse background error is visible", () => assert.match(warehousePage, /role="alert"/));
check("warehouse data is not cleared during same-context refresh", () => {
  assert.doesNotMatch(warehousePage, /const loadData[\s\S]{0,500}setWarehouses\(\[\]\)/);
});
check("delete checks accept AbortSignal", () => assert.match(warehouseService, /getWarehouseDeleteCheck[\s\S]*?signal: options\?\.signal/));
check("warehouse list accepts AbortSignal", () => assert.match(warehouseService, /getWarehouses[\s\S]*?signal: options\?\.signal/));
check("products accept AbortSignal", () => assert.match(warehouseService, /getProducts[\s\S]*?signal: options\?\.signal/));
check("balances accept AbortSignal", () => assert.match(warehouseService, /getInventoryBalances[\s\S]*?signal: options\?\.signal/));

check("operator GET uses request generation", () => assert.match(weighbridgePage, /operatorRequestGenerationRef/));
check("operator GET has dedicated AbortController", () => assert.match(weighbridgePage, /operatorRequestAbortRef/));
check("stale operator response cannot update state", () => {
  assert.match(weighbridgePage, /generation !== operatorRequestGenerationRef\.current/);
});
check("PIN submit invalidates stale GET before POST", () => {
  assert.match(weighbridgePage, /const submitOperatorAction[\s\S]*?setOperatorBusy\(true\);[\s\S]*?invalidateOperatorSessionRequest\(\);[\s\S]*?unlockWeighbridgeOperator/);
});
check("successful PIN closes modal immediately", () => {
  assert.match(weighbridgePage, /setOperatorState\(completeOperatorState\)[\s\S]*?setOperatorSessionStatus\("ready"\)[\s\S]*?setOperatorDialogOpen\(false\)/);
});
check("unlocked canonical state keeps modal closed", () => {
  assert.match(weighbridgePage, /if \(operatorState\.unlocked\) \{[\s\S]*?setOperatorDialogOpen\(false\)/);
});

check("Kazakhstan plate gets readable spacing", () => assert.equal(formatVehiclePlate("247AP15"), "247 AP 15"));
check("already spaced plate remains canonical", () => assert.equal(formatVehiclePlate("247 AP 15"), "247 AP 15"));
check("vehicle model is removed from primary label", () => {
  assert.equal(transportPickerLabel({ name: "KAMAZ 45142-011", model: "45142-011", plate: "247AP15" }), "KAMAZ · 247 AP 15");
});
check("brand and plate have equal primary emphasis", () => assert.match(picker, /label: vehicleTitle\(vehicle\)/));
check("series remains searchable", () => assert.match(picker, /vehicle\.model/));
check("last plate symbols remain searchable", () => assert.match(picker, /slice\(-4\)/));
check("series is not rendered as secondary description", () => assert.doesNotMatch(picker, /description:\s*\[[\s\S]*?vehicle\.model/));
check("waiting-for-tare status remains visible", () => assert.match(picker, /status: assignment \? "Ждёт тару"/));
check("picker status is rendered inline", () => assert.match(combobox, /option\.status[\s\S]*?text-amber-300/));

assert.equal(passed, 25);
console.log(`TZ277 regression PASS: ${passed}/25`);
