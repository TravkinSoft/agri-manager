import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("app/(dashboard)/weighbridge/page.tsx", "utf8");

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
};

check("harvest context uses an abortable single-flight entry", () => {
  assert.match(page, /harvestContextRequestCache = new Map<string, SharedAbortableRequest<HarvestContextState>>/);
  const loader = page.match(/const loadHarvestContextCached = async[\s\S]*?\n};/)?.[0] || "";
  assert.match(loader, /signal\?: AbortSignal/);
  assert.match(loader, /harvestContextRequestCache\.get\(key\)/);
  assert.match(loader, /return followHarvestContextRequest\(pending, params\.signal\)/);
  assert.match(loader, /signal: controller\.signal/);
  assert.match(loader, /harvestContextRequestCache\.set\(key, entry\)/);
  assert.match(loader, /harvestContextRequestCache\.get\(key\) === entry/);
  assert.match(page, /if \(entry\.subscribers === 0\) entry\.controller\.abort\(\)/);
});

check("harvest context consumers abort and reject stale responses", () => {
  assert.match(page, /signal: controller\.signal,[\s\S]*?return \(\) => controller\.abort\(\)/);
  const selectedContextEffect = page.match(
    /const key = harvestContextCacheKey[\s\S]*?\}, \[profile\?\.company_id, form\.operationType, form\.fieldId, form\.cropStructureAllocationId, harvestContextRevision\]\);/,
  )?.[0] || "";
  assert.match(selectedContextEffect, /const requestGeneration = \+\+harvestContextGenerationRef\.current/);
  assert.match(selectedContextEffect, /signal: controller\.signal/);
  assert.match(selectedContextEffect, /requestGeneration === harvestContextGenerationRef\.current/);
  assert.match(selectedContextEffect, /controller\.abort\(\)/);
  assert.doesNotMatch(selectedContextEffect, /let cancelled = false/);
});

check("stock identity detail is cached and explicitly single-flight", () => {
  assert.match(page, /stockIdentityRequestsRef = useRef\(new Map<string, AbortableRequest<StockIdentityOption\[\]>>\(\)\)/);
  const effect = page.match(/const cacheKey = `\$\{companyId}:\$\{warehouseFromId}`;[\s\S]*?stockSourcePlaceType, toast\]\);/)?.[0] || "";
  assert.match(effect, /const requestMap = stockIdentityRequestsRef\.current/);
  assert.match(effect, /requestMap\.get\(cacheKey\)/);
  assert.match(effect, /requestMap\.set\(cacheKey, createdEntry\)/);
  assert.match(effect, /const requestGeneration = \+\+stockIdentityGenerationRef\.current/);
  assert.match(effect, /signal: controller\.signal/);
  assert.match(effect, /requestGeneration !== stockIdentityGenerationRef\.current/);
  assert.match(effect, /activeRequest\.controller\.abort\(\)/);
  assert.match(effect, /stockIdentityCacheRef\.current\.set\(cacheKey, items\)/);
});

check("operation-line detail is cached and explicitly single-flight", () => {
  assert.match(page, /operationLinesRequestsRef = useRef\(new Map<string, AbortableRequest<LinkedOperationLineOption\[\]>>\(\)\)/);
  const effect = page.match(/const cacheKey = `\$\{companyId}:\$\{operationId}`;[\s\S]*?form\.linkedOperationId,[\s\S]*?toast,[\s\S]*?\]\);/)?.[0] || "";
  assert.match(effect, /const requestMap = operationLinesRequestsRef\.current/);
  assert.match(effect, /requestMap\.get\(cacheKey\)/);
  assert.match(effect, /requestMap\.set\(cacheKey, createdEntry\)/);
  assert.match(effect, /const requestGeneration = \+\+operationLinesGenerationRef\.current/);
  assert.match(effect, /\.abortSignal\(controller\.signal\)/);
  assert.match(effect, /requestGeneration !== operationLinesGenerationRef\.current/);
  assert.match(effect, /activeRequest\.controller\.abort\(\)/);
  assert.match(effect, /operationLinesCacheRef\.current\.set\(cacheKey, options\)/);
});

check("profile changes abort every outstanding mode-detail request", () => {
  assert.match(page, /secondaryCatalogRequestsRef\.current\.forEach\(\(entry\) => entry\.controller\.abort\(\)\)/);
  assert.match(page, /secondaryCatalogRequestsRef\.current\.clear\(\)/);
  assert.match(page, /stockIdentityRequestsRef\.current\.forEach\(\(entry\) => entry\.controller\.abort\(\)\)/);
  assert.match(page, /stockIdentityRequestsRef\.current\.clear\(\)/);
  assert.match(page, /operationLinesRequestsRef\.current\.forEach\(\(entry\) => entry\.controller\.abort\(\)\)/);
  assert.match(page, /operationLinesRequestsRef\.current\.clear\(\)/);
});

check("rapid mode revisits share catalog and harvest requests instead of restarting them", () => {
  assert.match(page, /secondaryCatalogRequestsRef = useRef\(new Map<string, AbortableRequest<void>>\(\)\)/);
  assert.match(page, /if \(existing\) return existing\.promise/);
  assert.match(page, /secondaryCatalogRequestsRef\.current\.set\(cacheKey, entry\)/);
  const modesStart = page.indexOf("const needsSecondaryCatalogs");
  const effectStart = page.indexOf("  useEffect(() => {", modesStart);
  const effectEnd = page.indexOf("  useEffect(() => {", effectStart + 1);
  const secondaryEffect = page.slice(effectStart, effectEnd);
  assert.match(secondaryEffect, /return \(\) => window\.clearTimeout\(timer\)/);
  assert.doesNotMatch(secondaryEffect, /controller\.abort\(\)|secondaryCatalogRequestsRef\.current\.delete/);
  assert.match(page, /if \(harvestBatchesRequestRef\.current\) return harvestBatchesRequestRef\.current/);
  assert.match(page, /form\.operationType !== "impurity_removal"[\s\S]*?refreshHarvestBatches\(\)/);
});

check("mode-specific and lazy loading boundaries remain intact", () => {
  const modes = page.match(/const needsSecondaryCatalogs = \[[\s\S]*?\.includes\(form\.operationType\);/)?.[0] || "";
  assert.match(modes, /supplier_receipt/);
  assert.match(modes, /issue_to_field/);
  assert.match(modes, /shipment_outbound/);
  assert.doesNotMatch(modes, /transfer_between_warehouses|disposal_writeoff|impurity_removal/);
  assert.match(page, /form\.operationType !== "impurity_removal"[\s\S]*?refreshHarvestBatches\(\)/);
  assert.match(page, /summaryOnly:\s*true/);
  assert.match(page, /selectedHarvestBatch\?\.aggregateLotId[\s\S]*?lotId: selectedHarvestBatch\.aggregateLotId/);
});

console.log(`TZ314 PERFORMANCE CANCELLATION PASS: ${passed}/${passed}`);
