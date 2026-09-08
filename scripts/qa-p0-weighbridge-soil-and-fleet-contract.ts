import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const batchesRoute = read("app/api/weighbridge/harvest-batches/route.ts");
const ticketsRoute = read("app/api/weighbridge/tickets/route.ts");
const finalizeRoute = read("app/api/weighbridge/tickets/[id]/finalize/route.ts");
const resourcesRoute = read("app/api/weighbridge/resources/route.ts");
const operatorSessionRoute = read("app/api/weighbridge/operator-session/route.ts");
const warehouseSummariesRoute = read("app/api/warehouses/summaries/route.ts");
const harvestDashboardRoute = read("app/api/dashboard/harvest-summary/route.ts");
const migration = read("supabase/migrations/20260908123000_p0_weighbridge_session_and_stock_stability.sql");

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
};

check("soil picker requests only the selected warehouse", () => {
  assert.match(page, /refreshHarvestBatches = async \(options: \{ force\?: boolean; signal\?: AbortSignal; warehouseId\?: string \}/);
  assert.match(page, /const requestKey = `\$\{companyId\}:\$\{warehouseId\}`/);
  assert.match(page, /listHarvestBatchSummaries\(companyId, \{[\s\S]*?warehouseId,[\s\S]*?aggregateLots: true,[\s\S]*?summaryOnly: true/);
  assert.match(page, /refreshHarvestBatches\(\{ warehouseId: form\.warehouseFromId \}\)/);
});

check("warehouse changes cannot reuse another warehouse result", () => {
  assert.match(page, /harvestBatchesRequestKeyRef\.current === requestKey/);
  assert.match(page, /harvestBatchesGenerationRef\.current \+= 1;[\s\S]*?harvestBatchesAbortRef\.current\?\.abort\(\)/);
  assert.match(page, /warehouseFromId,[\s\S]*?sourceBatchId: ""/);
  assert.match(page, /const selectImpurityWarehouse = \(warehouseFromId: string\)/);
  assert.match(page, /setHarvestBatches\(\[\]\);[\s\S]*?setHarvestBatchOptionsStatus\(warehouseFromId \? "loading" : "idle"\)/);
  assert.match(page, /selectedHarvestBatch\.warehouseId !== form\.warehouseFromId/);
});

check("loading and read errors are never mislabeled as an empty warehouse", () => {
  assert.match(page, /harvestBatchOptionsStatus/);
  assert.match(page, /setHarvestBatchOptionsStatus\("loading"\)/);
  assert.match(page, /setHarvestBatchOptionsStatus\("ready"\)/);
  assert.match(page, /setHarvestBatchOptionsStatus\("error"\)/);
  assert.match(page, /Не удалось загрузить партии урожая\. Нажмите «Повторить»/);
  assert.match(page, /harvestBatchOptionsStatus === "ready" && availableHarvestBatches\.length === 0/);
  assert.doesNotMatch(page, /На складе нет принятых партий урожая/);
});

check("summary and detail reads have a deadline and persistent retry", () => {
  assert.match(page, /HARVEST_BATCH_REQUEST_TIMEOUT_MS = 12_000/);
  assert.match(page, /requestTimedOut = true;[\s\S]*?controller\.abort\(\)/);
  assert.match(page, /harvestBatchDetailError/);
  assert.match(page, /setHarvestBatchDetailRetry\(\(value\) => value \+ 1\)/);
  assert.match(page, /Карточка партии загружается слишком долго/);
});

check("server summary reads positive aggregate stock by warehouse", () => {
  assert.match(batchesRoute, /HARVEST_STOCK_VIEW = "v_harvest_lot_stock_v2"/);
  assert.match(batchesRoute, /if \(warehouseId\) stockQuery = stockQuery\.eq\("warehouse_id", warehouseId\)/);
  assert.match(batchesRoute, /\.gt\("current_weight_kg", 0\.0001\)/);
  assert.match(batchesRoute, /HARVEST_STOCK_READ_ATTEMPTS = 2/);
  assert.match(batchesRoute, /trace_id: traceId/);
});

check("authenticated routes isolate the privileged stock read behind verified company scope", () => {
  assert.match(batchesRoute, /resolveWeighbridgeSession[\s\S]*?const harvestStockSupabase = getServiceClient\(\)/);
  assert.match(batchesRoute, /harvestStockSupabase[\s\S]*?\.from\(HARVEST_STOCK_VIEW\)[\s\S]*?\.eq\("company_id", companyId\)/);
  assert.match(warehouseSummariesRoute, /assertActorAccess[\s\S]*?const harvestStockSupabase = getServiceClient\(\)/);
  assert.match(warehouseSummariesRoute, /harvestStockSupabase[\s\S]*?\.from\("v_harvest_lot_stock_v2"\)[\s\S]*?\.eq\("company_id", companyId\)/);
  assert.match(harvestDashboardRoute, /resolveWeighbridgeSession[\s\S]*?loadWarehouseRows\(supabase, getServiceClient\(\), companyId\)/);
  assert.match(harvestDashboardRoute, /harvestStockSupabase[\s\S]*?\.from\("v_harvest_lot_stock_v2"\)[\s\S]*?\.eq\("company_id", companyId\)/);
});

check("soil ticket binds the selected aggregate lot and warehouse", () => {
  assert.match(page, /batch_id: isImpurityRemoval && !selectedHarvestBatch\?\.aggregateLot \? form\.sourceBatchId : null/);
  assert.match(page, /isImpurityRemoval[\s\S]*?selectedHarvestBatch\?\.aggregateLotId \|\| null/);
  assert.match(ticketsRoute, /resolveAggregateHarvestLotStock\(supabase, \{[\s\S]*?warehouseId: String\(ticket\.warehouse_from_id\),[\s\S]*?harvestLotId: String\(ticket\.harvest_lot_id\)/);
  assert.match(ticketsRoute, /\.eq\("harvest_lot_id", input\.harvestLotId\)/);
  assert.match(ticketsRoute, /\.eq\("warehouse_id", input\.warehouseId\)/);
});

check("finalization uses the atomic impurity allocation path", () => {
  assert.match(finalizeRoute, /ticketBefore\.op_type === "weighbridge_impurities"[\s\S]*?finalize_weighbridge_impurity_ticket_for_session_v1/);
  assert.match(migration, /create or replace view public\.v_harvest_lot_stock_v2/);
  assert.match(migration, /security_invoker = true/);
});

check("weighbridge exposes both direct vehicles and company machines without PTC proxies", () => {
  assert.match(resourcesRoute, /from\("reference_machines"\)/);
  assert.match(resourcesRoute, /\.is\("source_machine_id", null\)/);
  assert.match(operatorSessionRoute, /from\("reference_machines"\)/);
  assert.match(page, /source: "reference_vehicles" \| "reference_machines"/);
  assert.match(page, /selectedVehicle\?\.source === "reference_vehicles"/);
});

console.log(`P0 soil and fleet contract PASS: ${passed}/${passed}`);
