import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  countColdWarehousePositions,
  warehousePositionCountLabel,
} from "../lib/warehouse/harvest-batch-selection";

const root = process.cwd();
const route = readFileSync(path.join(root, "app/api/warehouses/summaries/route.ts"), "utf8");
const page = readFileSync(path.join(root, "app/(dashboard)/warehouses/page.tsx"), "utf8");

const harvestLotIds = [
  "rapeseed-lot",
  "potato-lot",
  "wheat-likamero-lot",
  "wheat-lamis-lot",
];
const threeCollapsedHarvestProductBalances = [
  { product_id: "rapeseed", batch_class: "commodity", uom: "kg", material_quantity: 0 },
  { product_id: "potato", batch_class: "commodity", uom: "kg", material_quantity: 0 },
  { product_id: "wheat", batch_class: "commodity", uom: "kg", material_quantity: 0 },
];

assert.equal(
  countColdWarehousePositions(harvestLotIds, threeCollapsedHarvestProductBalances),
  4,
  "cold Площадка card must count four clickable harvest lots before detailsLoaded",
);
assert.equal(
  countColdWarehousePositions(harvestLotIds, [
    ...threeCollapsedHarvestProductBalances,
    { product_id: "seed", batch_class: "seed", uom: "kg", material_quantity: 250 },
  ]),
  5,
  "a positive non-harvest material group must remain an additional clickable row",
);
assert.equal(
  countColdWarehousePositions([...harvestLotIds, harvestLotIds[0]], threeCollapsedHarvestProductBalances),
  4,
  "duplicate physical-state rows for one lot must not inflate the cold count",
);

assert.match(route, /loadHarvestLedgerOriginRefs\(supabase, companyId, ledgerRows\)/);
assert.match(route, /material_quantity:\s*row\.quantity - row\.harvest_represented_quantity/);
assert.match(route, /position_count:\s*countColdWarehousePositions/);
assert.doesNotMatch(route, /position_count:\s*materialPositions\.get/);
assert.match(page, /detailsLoaded[\s\S]*countVisibleWarehousePositions\(batches, stock\)[\s\S]*serverSummary\?\.position_count/);

const expectedLabels: Array<[number, string]> = [
  [1, "1 группа остатков"],
  [2, "2 группы остатков"],
  [4, "4 группы остатков"],
  [5, "5 групп остатков"],
  [11, "11 групп остатков"],
  [21, "21 группа остатков"],
];
for (const [count, expected] of expectedLabels) {
  assert.equal(warehousePositionCountLabel(count), expected);
}

console.log("PASS TZ315 P0 cold warehouse summary and Russian declension regression (13/13)");
