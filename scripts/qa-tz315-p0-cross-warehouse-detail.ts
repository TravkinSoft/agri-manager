import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  countVisibleWarehousePositions,
  findWarehouseScopedHarvestBatch,
} from "../lib/warehouse/harvest-batch-selection";
import {
  resolveEffectiveHarvestTicketCandidatesByBatch,
  resolveHarvestLotTicketLineage,
  resolveHarvestTicketContributionsForBatches,
} from "../lib/weighbridge/harvest-lot-lineage";

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

const lineage = resolveHarvestLotTicketLineage(
  [{ harvest_lot_id: "lot", inventory_batch_id: "clean-output" }],
  [
    { harvest_lot_id: "lot", inventory_batch_id: "clean-output" },
    { harvest_lot_id: "lot", inventory_batch_id: "trip-12", source_ticket_id: "ticket-12" },
    { harvest_lot_id: "lot", inventory_batch_id: "trip-13", source_ticket_id: "ticket-13" },
    { harvest_lot_id: "lot", inventory_batch_id: "trip-11", source_ticket_id: "ticket-11" },
  ],
  [
    { id: "clean-output" },
    { id: "trip-12" },
    { id: "trip-13" },
    { id: "trip-11" },
  ],
  [
    { output_batch_id: "clean-output", input_batch_id: "trip-12", input_weight_kg: 12_000 },
    { output_batch_id: "clean-output", input_batch_id: "trip-13", input_weight_kg: 13_000 },
    { output_batch_id: "clean-output", input_batch_id: "trip-11", input_weight_kg: 5_000 },
  ]
);
const effectiveCandidates = resolveEffectiveHarvestTicketCandidatesByBatch(lineage, [
  { id: "ticket-12", op_type: "harvest_incoming", status: "finalized", is_finalized: true },
  { id: "ticket-13", op_type: "harvest_incoming", status: "finalized", is_finalized: true },
  { id: "ticket-11", op_type: "harvest_incoming", status: "finalized", is_finalized: true },
]);
assert.deepEqual(
  resolveHarvestTicketContributionsForBatches(effectiveCandidates, ["clean-output"]),
  new Map([
    ["ticket-12", 12_000],
    ["ticket-13", 13_000],
    ["ticket-11", 5_000],
  ])
);

assert.equal(countVisibleWarehousePositions([
  { productId: "rapeseed" },
  { productId: "potato" },
  { productId: "wheat-likamero" },
  { productId: "wheat-lamis" },
], [
  { product_id: "rapeseed", material_quantity: 0 },
  { product_id: "potato", material_quantity: 0 },
  { product_id: "wheat-likamero", material_quantity: 0 },
  { product_id: "wheat-lamis", material_quantity: 0 },
]), 4);

assert.match(page, /countVisibleWarehousePositions\(batches, stock\)/);

const dialog = readFileSync(path.join(root, "components/warehouses/harvest-batch-dialog.tsx"), "utf8");
assert.match(dialog, /<details key=/);
assert.match(dialog, /Исходно принято/);
assert.match(dialog, /Вошло в обработку/);
assert.match(dialog, /Операции по партии/);
assert.doesNotMatch(dialog, />История партии</);

console.log("PASS TZ315 P0 warehouse detail and lineage regressions (18/18)");
