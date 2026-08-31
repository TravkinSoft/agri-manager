import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateHarvestLotAccounting } from "../lib/weighbridge/harvest-lot-accounting";
import {
  hasCompleteHarvestTicketLineage,
  isEffectiveFinalizedHarvestTicket,
  lineageTicketIds,
  lotByTicketIdFromLineage,
  resolveHarvestLotTicketLineage,
  resolveHarvestTicketIdsByBatch,
} from "../lib/weighbridge/harvest-lot-lineage";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const stockRoute = read("app/api/weighbridge/stock-identities/route.ts");
const ticketRoute = read("app/api/weighbridge/tickets/route.ts");
const processingRoute = read("app/api/processing/transformations/route.ts");
const transferRoute = read("app/api/warehouses/[id]/transfers/route.ts");
const harvestBatchRoute = read("app/api/weighbridge/harvest-batches/route.ts");
const dashboardRoute = read("app/api/dashboard/harvest-summary/route.ts");
const migration = read("supabase/migrations/20260821152000_tz296_harvest_stock_aggregation_v1.sql");
const atomicProcessingMigration = read(
  "supabase/migrations/20260831102520_tz315_processing_create_atomic_v1.sql",
);

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

check("legacy ticket lineage follows canonical precedence through repeated transfers", () => {
  const memberLinks = [
    { harvest_lot_id: "lot-link", inventory_batch_id: "batch-link", source_ticket_id: "ticket-link" },
    { harvest_lot_id: "lot-batch", inventory_batch_id: "batch-source", source_ticket_id: null },
    { harvest_lot_id: "lot-parent-link", inventory_batch_id: "child-parent-link", source_ticket_id: null },
    { harvest_lot_id: "lot-parent-batch", inventory_batch_id: "child-parent-batch", source_ticket_id: null },
    { harvest_lot_id: "lot-transfer", inventory_batch_id: "child-transfer", source_ticket_id: "ticket-transfer" },
    { harvest_lot_id: "lot-grandparent", inventory_batch_id: "grandchild-transfer", source_ticket_id: null },
  ];
  const parentLinks = [
    { harvest_lot_id: "lot-parent-link", inventory_batch_id: "parent-link", source_ticket_id: "ticket-parent-link" },
    { harvest_lot_id: "lot-grandparent", inventory_batch_id: "root-harvest-link", source_ticket_id: "ticket-grandparent" },
  ];
  const batches = [
    { id: "batch-link", source_ticket_id: "ticket-batch-ignored" },
    { id: "batch-source", source_ticket_id: "ticket-batch" },
    { id: "child-parent-link", parent_batch_id: "parent-link", source_ticket_id: null },
    { id: "parent-link", source_ticket_id: null },
    { id: "child-parent-batch", parent_batch_id: "parent-batch", source_ticket_id: null },
    { id: "parent-batch", source_ticket_id: "ticket-parent-batch" },
    { id: "child-transfer", parent_batch_id: "parent-harvest", source_ticket_id: null },
    { id: "parent-harvest", source_ticket_id: "ticket-harvest" },
    { id: "grandchild-transfer", parent_batch_id: "middle-transfer", source_ticket_id: null },
    { id: "middle-transfer", parent_batch_id: "root-harvest-link", source_ticket_id: null },
    { id: "root-harvest-link", source_ticket_id: null },
  ];
  const lineage = resolveHarvestLotTicketLineage(memberLinks, [...memberLinks, ...parentLinks], batches);
  const byBatch = new Map(lineage.map((row) => [row.inventoryBatchId, row]));

  assert.deepEqual(
    ["batch-link", "batch-source", "child-parent-link", "child-parent-batch", "child-transfer", "grandchild-transfer"]
      .map((batchId) => [byBatch.get(batchId)?.ticketId, byBatch.get(batchId)?.source]),
    [
      ["ticket-link", "link"],
      ["ticket-batch", "inventory_batch"],
      ["ticket-parent-link", "parent_link"],
      ["ticket-parent-batch", "parent_batch"],
      ["ticket-transfer", "link"],
      ["ticket-grandparent", "parent_link"],
    ]
  );
  assert.deepEqual(new Set(lineageTicketIds(lineage)), new Set([
    "ticket-link",
    "ticket-batch-ignored",
    "ticket-batch",
    "ticket-parent-link",
    "ticket-parent-batch",
    "ticket-transfer",
    "ticket-harvest",
    "ticket-grandparent",
  ]));

  const harvestTicketIds = [
    "ticket-link",
    "ticket-batch",
    "ticket-parent-link",
    "ticket-parent-batch",
    "ticket-harvest",
    "ticket-grandparent",
  ];
  const mapped = lotByTicketIdFromLineage(lineage, harvestTicketIds);
  assert.equal(mapped.lotByTicketId.get("ticket-harvest"), "lot-transfer");
  assert.equal(mapped.lotByTicketId.get("ticket-parent-link"), "lot-parent-link");
  assert.equal(mapped.lotByTicketId.get("ticket-grandparent"), "lot-grandparent");
  assert.equal(mapped.lotByTicketId.has("ticket-batch-ignored"), false);
  assert.equal(mapped.conflictingTicketIds.size, 0);
});

check("warehouse detail and dashboard use one lineage resolver", () => {
  assert.match(harvestBatchRoute, /resolveHarvestLotTicketLineage/);
  assert.match(harvestBatchRoute, /while \(ancestorBatchIds\.length\)/);
  assert.match(harvestBatchRoute, /\.select\("id,ticket_no,op_type,/);
  assert.match(harvestBatchRoute, /loadInChunks<any>\(ticketIds,/);
  assert.match(harvestBatchRoute, /query\(chunk\)\.range\(from, from \+ LINEAGE_QUERY_PAGE_SIZE - 1\)/);
  assert.match(harvestBatchRoute, /resolveHarvestTicketIdsByBatch\(lineage, ticketRows\)/);
  assert.match(harvestBatchRoute, /hasCompleteHarvestTicketLineage\(/);
  assert.match(harvestBatchRoute, /warehouseMemberBatchIds/);
  assert.match(harvestBatchRoute, /warehouseMemberBatchIds = ids\(\[[\s\S]*?stockBearingBatchIds[\s\S]*?warehouseLedgerEntries\.map\(\(entry\) => resolveLedgerBatchId\(entry\)\)/);
  assert.match(harvestBatchRoute, /reconciliationState:[\s\S]*?incomplete_lineage/);
  assert.match(dashboardRoute, /resolveHarvestLotTicketLineage/);
  assert.match(dashboardRoute, /while \(parentFrontier\.length\)/);
  assert.match(dashboardRoute, /\.in\("parent_batch_id", chunk\)/);
  assert.match(dashboardRoute, /lotByTicketIdFromLineage\(lineage, ticketIds\)/);
  assert.match(migration, /hlb\.source_ticket_id,[\s\S]*ib\.source_ticket_id,[\s\S]*parent_link\.source_ticket_id,[\s\S]*parent_batch\.source_ticket_id/);
});

check("only effective finalized harvest tickets can reconcile warehouse accounting", () => {
  const lineage = resolveHarvestLotTicketLineage(
    [{ harvest_lot_id: "lot", inventory_batch_id: "batch", source_ticket_id: "ticket-open" }],
    [{ harvest_lot_id: "lot", inventory_batch_id: "batch", source_ticket_id: "ticket-open" }],
    [{ id: "batch", source_ticket_id: "ticket-final" }]
  );
  const tickets = [
    { id: "ticket-open", op_type: "harvest_incoming", status: "active", is_finalized: false, is_voided: false },
    { id: "ticket-final", op_type: "harvest_incoming", status: "finalized", is_finalized: true, is_voided: false },
  ];
  const resolved = resolveHarvestTicketIdsByBatch(lineage, tickets);
  assert.equal(resolved.displayByBatchId.get("batch"), "ticket-final");
  assert.equal(resolved.effectiveByBatchId.get("batch"), "ticket-final");
  assert.equal(hasCompleteHarvestTicketLineage(lineage, resolved.effectiveByBatchId, ["batch"]), true);
  assert.equal(hasCompleteHarvestTicketLineage(lineage, resolved.effectiveByBatchId, ["batch", "missing"]), false);
  assert.equal(isEffectiveFinalizedHarvestTicket(tickets[0]), false);
  assert.equal(isEffectiveFinalizedHarvestTicket(tickets[1]), true);
  assert.equal(isEffectiveFinalizedHarvestTicket({
    ...tickets[1],
    id: "ticket-replaced",
    replacement_ticket_id: "replacement",
  }), false);
});

check("complete legacy lineage does not create a false accounting mismatch", () => {
  const receivedKg = [{ id: "ticket-legacy", netWeightKg: 12_000 }]
    .reduce((sum, ticket) => sum + ticket.netWeightKg, 0);
  const accounting = calculateHarvestLotAccounting({
    receivedKg,
    currentKg: 12_000,
    ledgerEntries: [],
  });
  assert.equal(receivedKg, 12_000);
  assert.equal(accounting.receivedKg, 12_000);
  assert.equal(accounting.reconciliationDeltaKg, 0);
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
  assert.match(processingRoute, /create_processing_transformation_atomic_v1/);
  assert.match(processingRoute, /harvest_lot_id: selectedHarvestLotId/);
  assert.match(atomicProcessingMigration, /join public\.harvest_lot_batches link/);
  assert.match(atomicProcessingMigration, /v_effective_stock_balance_identity_v1/);
  assert.match(atomicProcessingMigration, /v_allocations/);
  assert.match(
    atomicProcessingMigration,
    /order by coalesce\(batch\.received_at, batch\.created_at\), batch\.id/,
  );
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
