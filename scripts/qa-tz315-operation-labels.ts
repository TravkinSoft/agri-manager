import assert from "node:assert/strict";
import {
  collapseOperationDocuments,
  warehouseOperationLabel,
} from "../lib/weighbridge/warehouse-operation-display";

assert.equal(warehouseOperationLabel({ reasonType: "warehouse_transfer_out", destinationPlaceType: "CLEANER" }), "Очистка");
assert.equal(warehouseOperationLabel({ reasonType: "warehouse_transfer_out", destinationPlaceType: "DRYER" }), "Сушка");
assert.equal(warehouseOperationLabel({ reasonType: "warehouse_transfer_out", destinationPlaceType: "WAREHOUSE" }), "Перемещение");
assert.equal(warehouseOperationLabel({ reasonType: "weighbridge_impurities" }), "Вывоз примеси");
assert.equal(warehouseOperationLabel({ reasonType: "waste", ticketType: "disposal" }), "Списание");
assert.equal(warehouseOperationLabel({ reasonType: "shipment_outbound" }), "Отгрузка");
assert.equal(warehouseOperationLabel({ reasonType: "issue_to_field" }), "Выдача на поле");
assert.equal(warehouseOperationLabel({ reasonType: "processing_moisture_loss", transformationType: "drying" }), "Производственная потеря");
assert.equal(warehouseOperationLabel({ reasonType: "processing_loss", transformationType: "cleaning" }), "Производственная потеря");
assert.equal(warehouseOperationLabel({ reasonType: "processing_output_source_out", transformationType: "cleaning" }), "Очистка");
assert.equal(warehouseOperationLabel({ reasonType: "processing_output_in", transformationType: "drying" }), "Сушка");
assert.equal(warehouseOperationLabel({ reasonType: "harvest_incoming_in" }), "Приход урожая");
assert.equal(warehouseOperationLabel({ reasonType: "storno_weighbridge_impurities", isStorno: true }), "Аннулирование");
assert.equal(warehouseOperationLabel({ reasonType: "warehouse_transfer_out", correctionOfTicketId: "ticket" }), "Корректировка");

const collapsed = collapseOperationDocuments([
  { id: "one", label: "Очистка", quantityKg: 13_000, warehouseName: "Площадка", sourceType: "weighbridge_ticket" as const, sourceId: "ticket", ticketId: "ticket" },
  { id: "two", label: "Очистка", quantityKg: 5_000, warehouseName: "Площадка", sourceType: "weighbridge_ticket" as const, sourceId: "ticket", ticketId: "ticket" },
  { id: "three", label: "Очистка", quantityKg: 12_000, warehouseName: "Площадка", sourceType: "weighbridge_ticket" as const, sourceId: "ticket", ticketId: "ticket" },
]);
assert.equal(collapsed.length, 1);
assert.equal(collapsed[0]?.quantityKg, 30_000);

console.log("PASS qa-tz315-operation-labels (15/15)");
