import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatMoisturePercent, warehouseFlowSummary } from "../lib/warehouse/batch-card-presentation";
import { collapseOperationDocuments, selectActiveWarehouseOperationEntries, warehouseOperationLabel } from "../lib/weighbridge/warehouse-operation-display";
import type { HarvestBatchSummary } from "../lib/types/weighbridge";

const batch = {
  receivedKg: 0, transferInKg: 10_100, issueKg: 5_000, cleanMassKg: 5_100,
  voidedKg: 70_000, companyReceivedKg: 36_000,
  fieldSummaries: [{ netWeightKg: 25_000, enteredProcessingKg: 25_000 }, { netWeightKg: 11_000, enteredProcessingKg: 5_000 }],
} as HarvestBatchSummary;
assert.deepEqual(warehouseFlowSummary(batch), { incomingKg: 10_100, outgoingKg: 5_000, expectedKg: 5_100 });
assert.equal(formatMoisturePercent(15.842), "15,8%");
assert.equal(formatMoisturePercent(15.86), "15,9%");
assert.equal(formatMoisturePercent(14), "14,0%");
assert.equal(formatMoisturePercent(0), "0,0%");
assert.deepEqual(warehouseFlowSummary({ ...batch, processingInputKg: 100, processingOutputKg: 80, otherAdjustmentKg: -5 }),
  { incomingKg: 10_180, outgoingKg: 5_105, expectedKg: 5_075 });
assert.deepEqual(warehouseFlowSummary({ ...batch, receivedKg: 1_000, otherAdjustmentKg: 25 }),
  { incomingKg: 11_125, outgoingKg: 5_000, expectedKg: 6_125 });

const entries = [
  { id: "in-a", delta_qty_signed: 10_000, reason_type: "warehouse_transfer_in" },
  { id: "in-b", delta_qty_signed: 100, reason_type: "warehouse_transfer_in" },
  { id: "out", delta_qty_signed: -5_000, reason_type: "shipment_outbound" },
  { id: "cancelled", delta_qty_signed: 999 },
  { id: "storno", delta_qty_signed: -999, is_storno: true, storno_of_entry_id: "cancelled" },
  { id: "legacy-storno", delta_qty_signed: 10, reason_type: "storno_warehouse_transfer_out" },
  { id: "zero", delta_qty_signed: 0 },
  { id: "invalid", delta_qty_signed: "bad" },
];
const active = selectActiveWarehouseOperationEntries(entries);
assert.deepEqual(active.map((row) => row.id), ["in-a", "in-b", "out"]);
assert.equal(active.reduce((sum, row) => sum + Number(row.delta_qty_signed), 0), 5_100);
assert.equal(selectActiveWarehouseOperationEntries([{ id: "harvest", delta_qty_signed: 100, reason_type: "harvest_incoming_in" }]).length, 1);
assert.equal(selectActiveWarehouseOperationEntries([{ id: "processing", delta_qty_signed: 100, reason_type: "processing_output_in" }]).length, 1);
assert.equal(warehouseOperationLabel({ direction: "in", reasonType: "unclassified" }), "Поступление");
assert.equal(warehouseOperationLabel({ direction: "in", reasonType: "warehouse_opening_balance" }), "Начальный остаток");
assert.equal(warehouseOperationLabel({ direction: "in", operationType: "supplier_incoming" }), "Приход от поставщика");

const collapsed = collapseOperationDocuments(active.map((entry) => ({
  id: entry.id, label: "Перемещение", warehouseName: "Номер 1",
  quantityKg: Math.abs(Number(entry.delta_qty_signed)),
  direction: Number(entry.delta_qty_signed) > 0 ? "in" as const : "out" as const,
  sourceType: "weighbridge_ticket" as const, sourceId: "same-ticket", ticketId: "same-ticket",
})));
assert.equal(collapsed.length, 2, "in/out must never collapse into one signed operation");
assert.equal(collapsed.find((doc) => doc.direction === "in")?.quantityKg, 10_100);
assert.equal(collapsed.find((doc) => doc.direction === "out")?.quantityKg, 5_000);

const route = readFileSync(new URL("../app/api/weighbridge/harvest-batches/route.ts", import.meta.url), "utf8");
const dialog = readFileSync(new URL("../components/warehouses/harvest-batch-dialog.tsx", import.meta.url), "utf8");
assert.match(route, /movementTicketIds = ids\(documentLedgerEntries\.map/);
assert.match(route, /selectActiveWarehouseOperationEntries\(warehouseLedgerEntries\)/);
assert.match(route, /movement\.sourceId === document\.sourceId && movement\.direction === "in"/);
assert.match(dialog, /formatMoisturePercent\(weightedMoisture\)/);
assert.ok(dialog.indexOf('aria-label="Операции по партии"') < dialog.indexOf("Происхождение и рейсы — исходное сырьё"));
assert.ok(dialog.indexOf('return <button key={document.id}') < dialog.indexOf("Происхождение и рейсы — исходное сырьё"), "origin section must be outside the operation document map");
assert.match(dialog, /это история|история сырья/i);
assert.match(dialog, /не замер текущего остатка/);
console.log("PASS warehouse-card-clarity: warehouse balance, incoming documents, cancellation, scope labels and one-decimal moisture (25 checks)");
