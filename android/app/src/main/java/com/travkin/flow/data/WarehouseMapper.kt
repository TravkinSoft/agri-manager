package com.travkin.flow.data

import com.google.gson.JsonObject
import com.travkin.flow.domain.*

private fun JsonObject.measure(label: String, key: String, unit: String = "") = CabinetRow(label, quantity(number(key), unit))
private fun JsonObject.label(label: String, key: String) = CabinetRow(label, text(key) ?: "Не указано")

internal fun warehouseContents(data: JsonObject, query: CabinetQuery): CabinetPage {
    val lots = data.requireRows("batches")
    return CabinetPage(query.title ?: "Остатки склада", listOf(
        CabinetGroup("Партии урожая", lots.mapNotNull { row ->
            val id = row.text("aggregateLotId") ?: row.text("id") ?: return@mapNotNull null
            CabinetCard(id, row.text("cropName") ?: row.text("productName") ?: "Партия урожая",
                listOfNotNull(row.text("varietyName"), row.text("reproductionName")).joinToString(" · "),
                listOf(row.measure("Текущий остаток", "cleanMassKg", " кг"), row.measure("Зарезервировано", "reservedKg", " кг"),
                    row.measure("Доступно", "availableKg", " кг"), row.measure("Поступило", "receivedKg", " кг")),
                query.copy(lotId = id, title = row.text("batchCode") ?: row.text("cropName")))
        }),
        CabinetGroup("Материалы и доступность", data.requireRows("balances").mapNotNull { row ->
            val id = row.text("product_id") ?: return@mapNotNull null
            val unit = row.text("unit") ?: return@mapNotNull null
            CabinetCard("$id-$unit-${row.text("batch_class")}", row.text("identity_name") ?: row.text("product_name") ?: "Материал",
                listOfNotNull(row.text("variety_name"), row.text("reproduction_name")).joinToString(" · "),
                listOf(row.measure("На складе", "quantity", " $unit"), row.measure("Зарезервировано", "reserved_quantity", " $unit"),
                    row.measure("Доступно", "available_quantity", " $unit"), row.measure("Дефицит", "deficit_quantity", " $unit")),
                query.copy(productId = id, unit = unit, batchClass = row.text("batch_class"), title = row.text("product_name")))
        }),
    ), "Партии урожая и материалы — разные представления остатков; их итоговые значения не складываются.")
}

internal fun stockPage(data: JsonObject, query: CabinetQuery): CabinetPage {
    val stock = data.obj("details")
    if (stock.text("warehouse_id") != query.warehouseId || stock.text("product_id") != query.productId) throw UserFacingException("Сервер вернул другой остаток. Обновите склад.")
    val unit = " ${stock.text("unit") ?: query.unit.orEmpty()}"
    return CabinetPage(stock.text("product_name") ?: "Детали остатка", listOf(
        CabinetGroup("Доступность", listOf(CabinetCard("stock", stock.text("product_name") ?: "Материал", rows = listOf(
            stock.measure("На складе", "quantity", unit), stock.measure("Зарезервировано", "reserved_quantity", unit),
            stock.measure("Доступно", "available_quantity", unit), stock.measure("Дефицит", "deficit_quantity", unit))))),
        CabinetGroup("Партии", stock.rows("lots").mapIndexed { i, row -> CabinetCard("lot-$i", row.text("batch_label") ?: "Партия", row.text("supplier"), listOf(
            row.measure("Остаток", "quantity", unit), row.measure("Доступно", "available_quantity", unit),
            row.label("Документ", "receipt_no"), row.label("Годен до", "expires_at"))) }),
        CabinetGroup("Резервы", stock.rows("reservations").mapIndexed { i, row -> CabinetCard("reservation-$i", row.text("request_number") ?: "Заявка",
            row.text("operation"), listOf(row.label("Поле", "field"), row.measure("Количество", "quantity", unit), row.label("Статус", "status"))) }),
        CabinetGroup("Движения", stock.rows("movements").mapIndexed { i, row -> CabinetCard("movement-$i", row.text("type") ?: row.text("operation_type") ?: "Движение",
            row.text("notes"), listOf(row.measure("Количество", "quantity", unit), row.label("Дата", "created_at"))) }),
    ))
}

internal fun harvestLotPage(data: JsonObject, query: CabinetQuery): CabinetPage {
    val batches = data.requireRows("batches").filter { (it.text("aggregateLotId") ?: it.text("id")) == query.lotId }
    if (batches.isEmpty()) throw UserFacingException("Партия не найдена в выбранном складе.")
    return CabinetPage(query.title ?: "Партия урожая", batches.flatMap { row -> listOf(
        CabinetGroup("Происхождение и остаток", listOf(CabinetCard("summary", row.text("cropName") ?: "Урожай",
            listOfNotNull(row.text("varietyName"), row.text("reproductionName"), row.text("seasonLabel")).joinToString(" · "), listOf(
                row.label("Поле", "fieldName"), row.label("Склад", "warehouseName"), row.measure("Поступило", "receivedKg", " кг"),
                row.measure("Текущий остаток", "cleanMassKg", " кг"), row.measure("Доступно", "availableKg", " кг"), row.label("Сверка", "reconciliationState"))))),
        CabinetGroup("Состав остатка", row.rows("stockComponents").mapIndexed { i, component -> CabinetCard("component-$i",
            component.text("physicalState") ?: "Состояние не указано", component.text("batchClass"), listOf(component.measure("Количество", "quantityKg", " кг"))) }),
        CabinetGroup("Рейсы", row.rows("tripBatches").mapIndexed { i, trip -> CabinetCard("trip-$i", "Талон № ${trip.text("ticketNo") ?: "—"}", trip.text("fieldName"), listOf(
            trip.measure("Нетто", "netWeightKg", " кг"), trip.measure("Влажность", "moisturePercent", "%"), trip.label("Машина", "vehicleName"), trip.label("Дата", "occurredAt")),
            trip.text("ticketId")?.let { CabinetQuery(CabinetSection.TICKETS, objectId = it, title = "Талон № ${trip.text("ticketNo") ?: "—"}") }) }),
    ) })
}
