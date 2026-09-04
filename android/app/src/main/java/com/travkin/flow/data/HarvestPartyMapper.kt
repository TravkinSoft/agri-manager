package com.travkin.flow.data

import com.google.gson.JsonObject
import com.travkin.flow.domain.*

internal fun summaryTicketCard(row: JsonObject, index: Int) = CabinetCard(row.text("ticketId") ?: "trip-$index", "№ ${row.text("ticketNo") ?: "—"}",
    listOfNotNull(row.text("fieldName"), row.text("identityLabel")).joinToString(" · "), listOf(
        CabinetRow("Машина", row.text("vehicleLabel") ?: "Не указана"), CabinetRow("Дата", serverDate(row.text("occurredAt") ?: row.text("openedAt"))),
        CabinetRow("Брутто", quantity(row.number("grossWeightKg"), " кг")), CabinetRow("Нетто", quantity(row.number("netWeightKg"), " кг")),
        CabinetRow("Ожидание тары", quantity(row.number("waitingTareMinutes"), " мин")),
        CabinetRow("Влажность", quantity(row.number("moisturePercent"), "%"))),
    destination = row.text("ticketId")?.let { CabinetQuery(CabinetSection.TICKETS, objectId = it, title = "Талон № ${row.text("ticketNo") ?: "—"}") })

internal fun harvestPartyPage(data: JsonObject, query: CabinetQuery): CabinetPage {
    val party = data.requireRows("parties").firstOrNull { it.text("key") == query.partyKey }
        ?: throw UserFacingException("Партия больше не входит в эту сводку. Вернитесь назад и обновите данные.")
    val metrics = listOf("Сейчас на складах" to "currentStockKg", "Принято за период" to "receivedKg")
    val moisture = party.obj("moisture")
    return CabinetPage(party.text("identityLabel") ?: "Партия", listOf(
        CabinetGroup("Итоги", listOf(CabinetCard("totals", party.text("identityLabel") ?: "Партия", data.obj("period").text("label"),
            metrics.map { (label, key) -> CabinetRow(label, quantity(party.number(key), " кг")) }))),
        CabinetGroup("Склады", party.rows("warehouses").mapIndexed { i, row -> CabinetCard("warehouse-$i", row.text("warehouseName") ?: "Склад", rows = listOf(CabinetRow("Сейчас", quantity(row.number("currentKg"), " кг"))),
            destination = row.text("warehouseId")?.let { CabinetQuery(CabinetSection.WAREHOUSES, warehouseId = it, title = row.text("warehouseName")) }) }),
        CabinetGroup("Поля", party.rows("fields").mapIndexed { i, row -> CabinetCard("field-$i", row.text("fieldName") ?: "Поле", rows = listOf(
            CabinetRow("Принято", quantity(row.number("receivedKg"), " кг")), CabinetRow("Рейсов", quantity(row.number("trips"))), CabinetRow("Последний рейс", serverDate(row.text("lastTripAt"))))) }),
        CabinetGroup("Влажность", listOf(CabinetCard("moisture", "Измерения", rows = listOf("Последняя" to "latestPercent", "Средняя" to "averagePercent", "Минимальная" to "minimumPercent", "Максимальная" to "maximumPercent").map { (label, key) -> CabinetRow(label, quantity(moisture.number(key), "%")) }))),
        CabinetGroup("Открытые рейсы", party.rows("openTickets").mapIndexed { i, row -> summaryTicketCard(row, i) }),
        CabinetGroup("Завершённые рейсы", party.rows("completedTickets").mapIndexed { i, row -> summaryTicketCard(row, i) }),
        CabinetGroup("Требует внимания", party.rows("issues").mapIndexed { i, row -> CabinetCard("issue-$i", row.text("title") ?: "Проверьте", row.text("detail"), tone = "warning") }),
    ))
}
