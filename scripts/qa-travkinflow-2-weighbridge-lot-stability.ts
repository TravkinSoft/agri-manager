import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "app/(dashboard)/weighbridge/page.tsx"), "utf8");
const refresh = source.slice(source.indexOf("const refreshHarvestBatches"), source.indexOf("const selectImpurityWarehouse"));
const switchWarehouse = source.slice(source.indexOf("const selectImpurityWarehouse"), source.indexOf("const refreshBootstrap"));
const validationStart = source.lastIndexOf('} else if (form.operationType === "impurity_removal")');
const validation = source.slice(validationStart, source.indexOf('} else if (form.operationType === "disposal_writeoff")', validationStart));
const lotUiStart = source.indexOf("<Label>Партия урожая *</Label>");
const lotUi = source.slice(lotUiStart, source.indexOf("selectedHarvestBatch?.detailLevel", lotUiStart));

assert.match(source, /"idle" \| "loading" \| "refreshing" \| "ready" \| "stale" \| "error"/);
assert.match(source, /harvestBatchesCacheRef = useRef\(new Map<string, HarvestBatchSummary\[\]>\(\)\)/);
assert.match(refresh, /const requestKey = `\$\{companyId\}:\$\{warehouseId\}`/);
assert.match(refresh, /const retainedRows = harvestBatchesCacheRef\.current\.get\(requestKey\) \|\| \[\]/);
assert.match(refresh, /setHarvestBatchOptionsStatus\(retainedRows\.length \? "refreshing" : "loading"\)/);
assert.match(refresh, /harvestBatchesCacheRef\.current\.set\(requestKey, rows\)/);
assert.match(refresh, /setHarvestBatchOptionsStatus\(fallbackRows\.length \? "stale" : "error"\)/);
assert.doesNotMatch(refresh.slice(refresh.indexOf("const requestKey")), /setHarvestBatches\(\[\]\)/);

assert.match(switchWarehouse, /sourceBatchId: ""/);
assert.match(switchWarehouse, /harvestBatchesCacheRef\.current\.get\(requestKey\)/);
assert.match(source, /harvestBatchesCacheRef\.current\.clear\(\)/);
assert.match(source, /batch\.warehouseId === form\.warehouseFromId/);

assert.match(validation, /harvestBatchOptionsStatus !== "ready"/);
assert.match(validation, /сохранённый список устарел/);
assert.match(validation, /selectedHarvestBatch\.warehouseId !== form\.warehouseFromId/);

assert.match(source, /min-h-\[7\.75rem\] space-y-1\.5[\s\S]{0,120}<Label>Партия урожая \*<\/Label>/);
assert.match(lotUi, /aria-live="polite"/);
assert.match(lotUi, /последний подтверждённый список остаётся доступен/);
assert.match(lotUi, /Показан последний подтверждённый список/);

console.log("TRAVKINFLOW 2 WEIGHBRIDGE LOT STABILITY: 19/19 PASS");
