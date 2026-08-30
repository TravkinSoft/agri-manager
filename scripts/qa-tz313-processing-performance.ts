import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const workspace = read("components/weighbridge/processing-workspace.tsx");
const processingService = read("lib/services/processing.ts");
const processingRoute = read("app/api/processing/transformations/route.ts");
const warehouseService = read("lib/services/warehouses.ts");
const summariesRoute = read("app/api/warehouses/summaries/route.ts");

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
};

check("mode switch changes the form without a global catalog gate", () => {
  const declaration = page.match(/const needsSecondaryCatalogs = \[[\s\S]*?\.includes\(form\.operationType\);/)?.[0] || "";
  assert.match(declaration, /supplier_receipt/);
  assert.match(declaration, /issue_to_field/);
  assert.match(declaration, /shipment_outbound/);
  assert.doesNotMatch(declaration, /transfer_between_warehouses|disposal_writeoff|impurity_removal/);
  assert.match(page, /const secondaryCatalogKey = useMemo/);
});

check("each mode loads only its own catalog scope", () => {
  const loader = page.match(/const loadSecondaryCatalogs = async[\s\S]*?\n  const load = async/)?.[0] || "";
  assert.match(loader, /operationType === "supplier_receipt"[\s\S]*?from\("products"\)[\s\S]*?loadSuppliers/);
  assert.match(loader, /operationType === "shipment_outbound"[\s\S]*?loadBuyers/);
  assert.match(loader, /operationType === "issue_to_field" && fieldId[\s\S]*?from\("operations"\)[\s\S]*?\.eq\("field_id", fieldId\)/);
  assert.doesNotMatch(loader, /\.limit\(500\)/);
});

check("mode catalogs are single-flight cached and survive rapid revisits", () => {
  assert.match(page, /MODE_RESOURCE_STABILITY_DELAY_MS = 75/);
  assert.match(page, /secondaryCatalogRequestsRef = useRef\(new Map<string, AbortableRequest<void>>\(\)\)/);
  assert.match(page, /secondaryCatalogReadyRef = useRef\(new Set/);
  assert.match(page, /const existing = secondaryCatalogRequestsRef\.current\.get\(cacheKey\)/);
  assert.match(page, /if \(existing\) return existing\.promise/);
  assert.match(page, /secondaryCatalogRequestsRef\.current\.set\(cacheKey, entry\)/);
  assert.match(page, /secondaryCatalogRequestsRef\.current\.forEach\(\(entry\) => entry\.controller\.abort\(\)\)/);
  assert.doesNotMatch(page, /secondaryCatalogGenerationRef/);
  assert.match(page, /window\.setTimeout\([\s\S]*?loadSecondaryCatalogs[\s\S]*?MODE_RESOURCE_STABILITY_DELAY_MS/);
  assert.match(page, /window\.clearTimeout\(timer\)/);
});

check("impurity batches are stable-mode delayed, single-flight and cached", () => {
  assert.match(page, /harvestBatchesRequestRef = useRef<Promise<void> \| null>/);
  assert.match(page, /harvestBatchesReadyRef = useRef\(false\)/);
  assert.match(page, /if \(!options\.force && harvestBatchesReadyRef\.current\) return/);
  assert.match(page, /if \(harvestBatchesRequestRef\.current\) return harvestBatchesRequestRef\.current/);
  assert.match(page, /summaryOnly:\s*true,[\s\S]*?signal:\s*controller\.signal/);
  assert.match(page, /form\.operationType !== "impurity_removal"[\s\S]*?window\.setTimeout\([\s\S]*?refreshHarvestBatches\(\)[\s\S]*?MODE_RESOURCE_STABILITY_DELAY_MS/);
  assert.match(page, /harvestBatchesAbortRef\.current\?\.abort\(\)/);
});

check("stock and operation details load only after source selection and are cached", () => {
  assert.match(page, /stockIdentityCacheRef = useRef\(new Map/);
  assert.match(page, /if \(!profile\?\.company_id \|\| !profile\?\.id \|\| !needsStockIdentity \|\| !form\.warehouseFromId\)/);
  assert.match(page, /stockIdentityCacheRef\.current\.get\(cacheKey\)/);
  assert.match(page, /signal: controller\.signal/);
  assert.match(page, /operationLinesCacheRef = useRef\(new Map/);
  assert.match(page, /operationLinesCacheRef\.current\.get\(cacheKey\)/);
  assert.match(page, /\.abortSignal\(controller\.signal\)/);
});

check("weighbridge page has no idle polling fan-out", () => {
  const liveRefresh = page.match(/useLiveRefresh\(\{[\s\S]*?\n  \}\);/)?.[0] || "";
  assert.match(liveRefresh, /intervalMs:\s*0/);
  assert.doesNotMatch(liveRefresh, /60_000/);
});

check("processing workspace has no idle polling", () => {
  assert.doesNotMatch(workspace, /setInterval\s*\(/);
  assert.doesNotMatch(workspace, /addEventListener\("visibilitychange"/);
  assert.match(workspace, /useLiveRefresh\(\{/);
  assert.match(workspace, /intervalMs:\s*0/);
});

check("processing refresh is event driven and single flight", () => {
  assert.match(workspace, /travkin:weighbridge-data-changed/);
  assert.match(workspace, /PROCESSING_REFRESH_TABLES/);
  assert.match(workspace, /if \(loadInFlight\.current\)/);
  assert.match(workspace, /loadPending\.current = true/);
  assert.match(workspace, /new AbortController\(\)/);
  assert.match(workspace, /loadController\.current\?\.abort\(\)/);
  assert.match(workspace, /if \(loadController\.current === controller\)/);
  assert.match(workspace, /loadController\.current = null;[\s\S]*loadInFlight\.current = false;[\s\S]*loadPending\.current = false;/);
});

check("processing cards request only bounded weighbridge data", () => {
  assert.match(workspace, /scope:\s*"weighbridge"/);
  assert.match(workspace, /historyLimit:\s*10/);
  assert.match(processingService, /scope\?: "weighbridge"/);
  assert.match(processingService, /params\.set\("scope", options\.scope\)/);
  assert.match(processingService, /signal:\s*options\?\.signal/);
});

check("weighbridge processing API separates open cycles from bounded history", () => {
  assert.match(processingRoute, /scope"\) === "weighbridge"/);
  assert.match(processingRoute, /Math\.max\(1, Math\.min\(50/);
  assert.match(processingRoute, /const \[openResult, historyResult\] = await Promise\.all/);
  assert.match(processingRoute, /\.limit\(historyLimit\)/);
  assert.match(processingRoute, /const waiting = weighbridgeScope\s*\? \[\]/);
});

check("processing API avoids select-star hydration for scoped cycles and children", () => {
  const loader = processingRoute.match(/async function loadTransformationItems[\s\S]*?async function loadWaitingTickets/)?.[0] || "";
  assert.doesNotMatch(loader, /batch_transformations"\)\s*\.select\("\*"\)/);
  assert.doesNotMatch(loader, /batch_transformation_inputs"\)\.select\("\*"\)/);
  assert.doesNotMatch(loader, /batch_transformation_outputs"\)\.select\("\*"\)/);
  assert.match(loader, /WEIGHBRIDGE_TRANSFORMATION_COLUMNS/);
  assert.match(loader, /processing_nodes"\)[\s\S]*?\.in\("id", nodeIds\)/);
});

check("processing cards use the lightweight warehouse summary contract", () => {
  assert.match(workspace, /scope:\s*"processing_cards"/);
  assert.match(warehouseService, /scope\?: "processing_cards"/);
  assert.match(warehouseService, /query\.set\("scope", options\.scope\)/);
  assert.match(warehouseService, /signal:\s*options\?\.signal/);
});

check("processing summary scope is bounded and has no ledger N plus one", () => {
  const scopedBlock = summariesRoute.match(/if \(processingCardsScope\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(summariesRoute, /scope"\) === "processing_cards"/);
  assert.match(summariesRoute, /warehouseQuery\.in\("place_type", \["YARD", "DRYER", "CLEANER"\]\)/);
  assert.match(scopedBlock, /v_harvest_lot_stock_v1/);
  assert.doesNotMatch(scopedBlock, /stock_ledger_entries/);
  assert.doesNotMatch(scopedBlock, /inventory_batches/);
  assert.match(scopedBlock, /last_movement_at:\s*null/);
});

check("default warehouse summaries remain backward compatible", () => {
  assert.match(summariesRoute, /v_stock_balance_canonical/);
  assert.match(summariesRoute, /stock_ledger_entries/);
  assert.match(summariesRoute, /lastMovementByWarehouse/);
  assert.match(warehouseService, /options\?: \{ scope\?: "processing_cards"; signal\?: AbortSignal \}/);
});

console.log(`TZ313 processing performance PASS: ${passed}/${passed}`);
