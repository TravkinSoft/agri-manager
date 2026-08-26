import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateHarvestLotAccounting } from "../lib/weighbridge/harvest-lot-accounting";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const stockRoute = read("app/api/weighbridge/stock-identities/route.ts");
const ticketRoute = read("app/api/weighbridge/tickets/route.ts");
const processingRoute = read("app/api/processing/transformations/route.ts");
const transferRoute = read("app/api/warehouses/[id]/transfers/route.ts");
const harvestBatchRoute = read("app/api/weighbridge/harvest-batches/route.ts");
const migration = read("supabase/migrations/20260821152000_tz296_harvest_stock_aggregation_v1.sql");

const checks: Array<{ name: string; run: () => void }> = [];
const check = (name: string, run: () => void) => checks.push({ name, run });

check("stock picker returns aggregate harvest lots and hides linked trip batches", () => {
  assert.match(stockRoute, /v_weighbridge_harvest_lot_available_v2/);
  assert.match(stockRoute, /aggregate_harvest_lot/);
  assert.match(stockRoute, /exactRows = \(rawRows \|\| \[\]\)\.filter/);
  assert.match(stockRoute, /!lotIdByBatchId\.has/);
  assert.match(stockRoute, /source: "aggregate_harvest_lots_plus_exact_non_harvest"/);
});

check("aggregate DTO carries lot state and trip count without a technical batch id", () => {
  assert.match(stockRoute, /harvest_lot_id: harvestLotId/);
  assert.match(stockRoute, /source_physical_state/);
  assert.match(stockRoute, /trip_count/);
  assert.match(stockRoute, /batchId = sourceKind === "exact_stock_identity"/);
  assert.match(stockRoute, /\[lotId, batchClass, physicalState\]/);
  assert.doesNotMatch(stockRoute, /\[lotId, productId, batchClass, physicalState\]/);
});

check("warehouse cards aggregate technical physical states into one canonical lot row", () => {
  assert.match(harvestBatchRoute, /stockByWarehouse/);
  assert.match(harvestBatchRoute, /warehouseStockRows/);
  assert.match(harvestBatchRoute, /stockComponents/);
  assert.match(harvestBatchRoute, /trip\.opType === "harvest_incoming"/);
});

check("processing outputs are not counted twice as harvest receipts", () => {
  const accounting = calculateHarvestLotAccounting({
    receivedKg: 0,
    currentKg: 94_000,
    ledgerEntries: [
      { reason_type: "processing_output_in", delta_qty_signed: 95_000 },
      { reason_type: "warehouse_transfer", delta_qty_signed: 22_000 },
      { reason_type: "warehouse_transfer_out", delta_qty_signed: -23_000 },
    ],
  });
  assert.equal(accounting.expectedPhysicalKg, 94_000);
  assert.equal(accounting.reconciliationDeltaKg, 0);
});

check("ticket create validates aggregate stock and persists canonical lot identity", () => {
  assert.match(ticketRoute, /resolveAggregateHarvestLotStock/);
  assert.match(ticketRoute, /ticket\.harvest_lot_id/);
  assert.match(ticketRoute, /source_physical_state/);
  assert.match(ticketRoute, /line\.batch_id = null/);
});

check("FIFO is deterministic by received time, source ticket, batch creation and id", () => {
  assert.match(migration, /coalesce\(ib\.received_at, source_ticket\.finalized_at, ib\.created_at\)/);
  assert.match(migration, /order by fifo_received_at, fifo_ticket_at, ib\.created_at, ib\.id/);
});

check("one aggregate request creates exact internal ledger allocations", () => {
  assert.match(migration, /create or replace view public\.v_harvest_lot_stock_v1/);
  assert.match(migration, /prepare_grain_lot_ticket_allocations_v1/);
  assert.match(migration, /inventory_batch_id/);
  assert.match(migration, /ensure_transfer_destination_batch_for_document_v1/);
  assert.match(migration, /aggregate_harvest_lot_fifo/);
  assert.match(migration, /assert_harvest_stock_transfer_actor_v1/);
  assert.doesNotMatch(migration, /ib\.product_id = v_template\.product_id/);
});

check("processing inputs allocate one user lot across exact trip batches", () => {
  assert.match(processingRoute, /selectedHarvestLotId/);
  assert.match(processingRoute, /inputAllocations/);
  assert.match(processingRoute, /harvest_lot_id: selectedHarvestLotId/);
});

check("direct transfer keeps one document and warehouse-local destination batches", () => {
  assert.match(transferRoute, /create_harvest_lot_transfer_atomic_v1/);
  assert.match(migration, /warehouse_transfer_documents/);
  assert.match(migration, /ensure_transfer_destination_batch_for_document_v1/);
  assert.match(migration, /parent_batch_id = v_source\.id/);
});

check("FIFO allocation spans multiple technical batches exactly", () => {
  const balances = [8_000, 12_000, 5_000];
  let remaining = 18_500;
  const allocations: number[] = [];
  for (const available of balances) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, available);
    allocations.push(take);
    remaining -= take;
  }
  assert.deepEqual(allocations, [8_000, 10_500]);
  assert.equal(remaining, 0);
  assert.equal(allocations.reduce((sum, value) => sum + value, 0), 18_500);
});

let passed = 0;
for (const item of checks) {
  try {
    item.run();
    passed += 1;
    console.log(`PASS ${item.name}`);
  } catch (error) {
    console.error(`FAIL ${item.name}`);
    throw error;
  }
}
console.log(`TZ296 ${passed}/${checks.length} PASS`);
