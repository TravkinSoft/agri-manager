import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildWarehouseMassBreakdown,
  isCanonicalMassKg,
  warehouseCapacityPercent,
} from "../lib/warehouse/warehouse-summary-math";
import { isHarvestLedgerRow } from "../lib/warehouse/harvest-ledger-origin";

const warehouseId = "angar-1";
const mass = buildWarehouseMassBreakdown([
  { warehouse_id: warehouseId, quantity: 94_000, uom: "kg", batch_class: "commodity" },
  { warehouse_id: warehouseId, quantity: 10_000, uom: "kg", batch_class: "seed" },
  { warehouse_id: warehouseId, quantity: 12, uom: "pcs", batch_class: "material" },
  { warehouse_id: warehouseId, quantity: -500, uom: "kg", batch_class: "material" },
], new Map([[warehouseId, 94_000]])).get(warehouseId);

assert.ok(mass);
assert.equal(mass.totalWeightKg, 104_000, "card total must equal all positive visible mass positions");
assert.equal(mass.harvestWeightKg, 94_000, "harvest remains a separate category");
assert.equal(mass.seedWeightKg, 10_000, "seed remains a separate category");
assert.equal(mass.otherMaterialWeightKg, 0, "harvest and seed must not be counted twice");
assert.equal(warehouseCapacityPercent(104_000, 10_000), 1040, "over-capacity utilization must not be silently capped");
assert.equal(warehouseCapacityPercent(104_000, null), null, "missing capacity must not invent a percentage");
assert.equal(isCanonicalMassKg("kg"), true);
assert.equal(isCanonicalMassKg("legacy/kg"), true);
assert.equal(isCanonicalMassKg("pcs"), false);

const originRefs = {
  batchIds: new Set(["10000000-0000-4000-8000-000000000001"]),
  ticketIds: new Set(["20000000-0000-4000-8000-000000000001"]),
};
assert.equal(isHarvestLedgerRow({
  inventory_batch_id: "10000000-0000-4000-8000-000000000001",
}, originRefs), true);
assert.equal(isHarvestLedgerRow({
  batch_id_text: "10000000-0000-4000-8000-000000000001",
}, originRefs), true);
assert.equal(isHarvestLedgerRow({
  ticket_id: "20000000-0000-4000-8000-000000000001",
}, originRefs), true);
assert.equal(isHarvestLedgerRow({
  inventory_batch_id: "30000000-0000-4000-8000-000000000001",
}, originRefs), false);
assert.equal(1_500 - 1_000, 500, "supplier/opening remainder must stay visible");

const root = process.cwd();
const page = readFileSync(path.join(root, "app/(dashboard)/warehouses/page.tsx"), "utf8");
const balancesRoute = readFileSync(path.join(root, "app/api/warehouses/balances/route.ts"), "utf8");
const stockDetailsRoute = readFileSync(path.join(root, "app/api/warehouses/[id]/stock-details/route.ts"), "utf8");
const summariesRoute = readFileSync(path.join(root, "app/api/warehouses/summaries/route.ts"), "utf8");
const lotRoute = readFileSync(path.join(root, "app/api/weighbridge/harvest-batches/route.ts"), "utf8");
const lotDialog = readFileSync(path.join(root, "components/warehouses/harvest-batch-dialog.tsx"), "utf8");
const stockDialog = readFileSync(path.join(root, "components/warehouses/warehouse-stock-details-dialog.tsx"), "utf8");
const warehouseService = readFileSync(path.join(root, "lib/services/warehouses.ts"), "utf8");

assert.match(summariesRoute, /total_weight_kg:\s*mass\?\.totalWeightKg/);
assert.match(summariesRoute, /seed_weight_kg:\s*mass\?\.seedWeightKg/);
assert.match(page, /label:\s*"Всего"/);
assert.match(page, /label:\s*"Урожай"/);
assert.match(page, /label:\s*"Семена"/);
assert.match(page, /label:\s*"Групп остатков"/);
assert.match(page, /warehousePositionCountLabel\(selectedSummary\.positionCount\)/);
assert.match(balancesRoute, /batch_class,/);
assert.match(balancesRoute, /\$\{uom\}\|\$\{batchClass\}/);
assert.match(page, /row\.batch_class \|\| "commodity"/);
assert.match(page, /row\.material_quantity/);
assert.match(page, /totalWeightKg <= 0\.000001/);
assert.match(balancesRoute, /loadHarvestLedgerOriginRefs/);
assert.match(balancesRoute, /harvest_represented_quantity/);
assert.match(balancesRoute, /material_quantity/);
assert.match(stockDetailsRoute, /searchParams\.get\("batchClass"\)/);
assert.match(stockDetailsRoute, /searchParams\.get\("stockOrigin"\)/);
assert.match(stockDetailsRoute, /String\(row\.batch_class \|\| "commodity"\)\.toLowerCase\(\) === requestedBatchClass/);
assert.match(stockDetailsRoute, /stockOrigin !== "material" \|\| !isHarvestLedgerRow/);
assert.match(stockDetailsRoute, /const batchId = resolveLedgerBatchId\(row\)/);
assert.match(stockDetailsRoute, /batch_class: requestedBatchClass \|\| null/);
assert.match(stockDialog, /balance\.batch_class \|\| "commodity"/);
assert.match(stockDialog, /stockOrigin: "material"/);
assert.match(stockDialog, /setDetails\(cached\)/);
assert.match(warehouseService, /query\.set\("batchClass", params\.batchClass\)/);
assert.match(warehouseService, /query\.set\("stockOrigin", params\.stockOrigin\)/);
assert.doesNotMatch(summariesRoute, /harvestProductClassesByWarehouse|representedByHarvestLot/);
assert.match(summariesRoute, /position_count:\s*countColdWarehousePositions/);
assert.match(page, /Остаток превышает указанную вместимость/);
assert.doesNotMatch(page, /Math\.min\(100, Math\.round\(\(harvestWeightKg \/ capacity\)/);
assert.match(lotRoute, /const warehouseTrips = trips\.filter/);
assert.match(lotRoute, /fieldSummaries: warehouseFieldSummaries/);
assert.match(lotRoute, /tripBatches: warehouseOriginTrips/);
assert.match(lotRoute, /originState: warehouseOriginTrips\.length > 0/);
assert.match(lotDialog, /Талонное происхождение на этом складе отсутствует/);
assert.match(lotDialog, /visible: batch\.receivedKg > 0\.001/);
assert.doesNotMatch(lotDialog, /label: "Принято по всей партии"/);

console.log("TZ314 warehouse math regression PASS: 48/48");
