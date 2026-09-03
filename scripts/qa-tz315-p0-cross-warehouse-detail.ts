import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  countColdWarehousePositions,
  countVisibleWarehousePositions,
  findWarehouseScopedHarvestBatch,
  warehousePositionCountLabel,
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

const splitInputLineage = resolveHarvestLotTicketLineage(
  [{ harvest_lot_id: "lot-split", inventory_batch_id: "split-output" }],
  [
    { harvest_lot_id: "lot-split", inventory_batch_id: "split-output" },
    { harvest_lot_id: "lot-split", inventory_batch_id: "split-a", source_ticket_id: "ticket-split" },
    { harvest_lot_id: "lot-split", inventory_batch_id: "split-b", source_ticket_id: "ticket-split" },
  ],
  [{ id: "split-output" }, { id: "split-a" }, { id: "split-b" }],
  [
    { output_batch_id: "split-output", input_batch_id: "split-a", input_weight_kg: 4_000 },
    { output_batch_id: "split-output", input_batch_id: "split-b", input_weight_kg: 6_000 },
  ],
);
const splitCandidates = resolveEffectiveHarvestTicketCandidatesByBatch(splitInputLineage, [
  { id: "ticket-split", op_type: "harvest_incoming", status: "finalized", is_finalized: true },
]);
assert.deepEqual(
  resolveHarvestTicketContributionsForBatches(splitCandidates, ["split-output"]),
  new Map([["ticket-split", 10_000]]),
  "two distinct transformation input batches from one ticket must add their contributions",
);

const multiStageLineage = resolveHarvestLotTicketLineage(
  [{ harvest_lot_id: "lot-multi-stage", inventory_batch_id: "final-output" }],
  [
    { harvest_lot_id: "lot-multi-stage", inventory_batch_id: "final-output" },
    { harvest_lot_id: "lot-multi-stage", inventory_batch_id: "clean-output" },
    { harvest_lot_id: "lot-multi-stage", inventory_batch_id: "source-a", source_ticket_id: "ticket-multi-stage" },
    { harvest_lot_id: "lot-multi-stage", inventory_batch_id: "source-b", source_ticket_id: "ticket-multi-stage" },
  ],
  [
    { id: "final-output", parent_batch_id: "clean-output" },
    { id: "clean-output", parent_batch_id: "source-a" },
    { id: "source-a", source_ticket_id: "ticket-multi-stage" },
    { id: "source-b", source_ticket_id: "ticket-multi-stage" },
  ],
  [
    { output_batch_id: "final-output", input_batch_id: "clean-output", input_weight_kg: 10_000 },
    { output_batch_id: "clean-output", input_batch_id: "source-a", input_weight_kg: 4_000 },
    { output_batch_id: "clean-output", input_batch_id: "source-b", input_weight_kg: 6_000 },
  ],
);
const multiStageCandidates = resolveEffectiveHarvestTicketCandidatesByBatch(multiStageLineage, [
  { id: "ticket-multi-stage", op_type: "harvest_incoming", status: "finalized", is_finalized: true },
]);
assert.deepEqual(
  resolveHarvestTicketContributionsForBatches(multiStageCandidates, ["final-output"]),
  new Map([["ticket-multi-stage", 10_000]]),
  "an output parent fallback must not duplicate the exact weighted transformation inputs",
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

assert.equal(countColdWarehousePositions(
  ["rapeseed-lot", "potato-lot", "wheat-likamero-lot", "wheat-lamis-lot"],
  [
    { product_id: "rapeseed", batch_class: "commodity", uom: "kg", material_quantity: 0 },
    { product_id: "potato", batch_class: "commodity", uom: "kg", material_quantity: 0 },
    { product_id: "wheat", batch_class: "commodity", uom: "kg", material_quantity: 0 },
  ],
), 4, "cold Площадка summary must expose four clickable lot rows before details load");
assert.equal(countColdWarehousePositions(
  ["rapeseed-lot", "potato-lot", "wheat-likamero-lot", "wheat-lamis-lot"],
  [{ product_id: "seed", batch_class: "seed", uom: "kg", material_quantity: 250 }],
), 5, "a real non-harvest material row remains an additional clickable position");
assert.equal(warehousePositionCountLabel(1), "1 группа остатков");
assert.equal(warehousePositionCountLabel(2), "2 группы остатков");
assert.equal(warehousePositionCountLabel(4), "4 группы остатков");
assert.equal(warehousePositionCountLabel(5), "5 групп остатков");
assert.equal(warehousePositionCountLabel(11), "11 групп остатков");
assert.equal(warehousePositionCountLabel(21), "21 группа остатков");
assert.match(page, /warehousePositionCountLabel\(selectedSummary\.positionCount\)/);

const dialog = readFileSync(path.join(root, "components/warehouses/harvest-batch-dialog.tsx"), "utf8");
assert.match(dialog, /<details key=/);
assert.match(dialog, /Исходно принято/);
assert.match(dialog, /Вошло в обработку/);
assert.match(dialog, /Операции по партии/);
assert.doesNotMatch(dialog, />История партии</);

console.log("PASS TZ315 P0 warehouse detail, cold summary, declension and lineage regressions (27/27)");
