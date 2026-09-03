import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findWarehouseScopedHarvestBatch } from "../lib/warehouse/harvest-batch-selection";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(path.join(root, "app/(dashboard)/warehouses/page.tsx"), "utf8");

const lotId = "lot-lamis-r2";
const rows = [
  { id: lotId, warehouseId: "yard", cleanMassKg: 17_034 },
  { id: lotId, warehouseId: "dryer-1", cleanMassKg: 5 },
  { id: lotId, warehouseId: "kymyzkhana", cleanMassKg: 16_125 },
  { id: lotId, warehouseId: "nomer-1", cleanMassKg: 5_100 },
];

const selected = rows[2];
assert.equal(findWarehouseScopedHarvestBatch(rows, selected), selected);

const realtimeReordered = [rows[1], rows[0], rows[3], rows[2]];
assert.deepEqual(
  findWarehouseScopedHarvestBatch(realtimeReordered, selected),
  { id: lotId, warehouseId: "kymyzkhana", cleanMassKg: 16_125 }
);
assert.notEqual(findWarehouseScopedHarvestBatch(realtimeReordered, selected)?.warehouseId, "dryer-1");
assert.equal(
  findWarehouseScopedHarvestBatch(realtimeReordered, { id: lotId, warehouseId: "missing" }),
  undefined
);

assert.match(page, /findWarehouseScopedHarvestBatch\(harvestBatches, selectedBatch\)/);
assert.doesNotMatch(page, /harvestBatches\.find\(\(batch\) => batch\.id === selectedBatch\.id\)/);
assert.match(page, /row\.id === batch\.id && row\.warehouseId === batch\.warehouseId/);
assert.match(page, /current\?\.id === batch\.id && current\.warehouseId === batch\.warehouseId/);

console.log("PASS TZ315 P0 cross-warehouse aggregate lot selection (8/8)");
