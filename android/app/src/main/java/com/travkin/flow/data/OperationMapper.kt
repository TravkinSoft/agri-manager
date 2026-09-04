package com.travkin.flow.data

import com.google.gson.JsonObject
import com.travkin.flow.domain.*

/** Same line/config precedence as normalizeOperationRow; no invented zero for missing area. */
internal fun plannedOperationArea(row: JsonObject): Double? {
    val fromLines = row.rows("operation_lines").sumOf { it.number("planned_area_ha") ?: 0.0 }
    return fromLines.takeIf { it > 0 } ?: row.obj("operation_config").number("planned_area_ha")?.takeIf { it > 0 }
}
internal fun actualOperationArea(row: JsonObject): Double? = row.number("completed_area_ha") ?: row.rows("operation_lines")
    .mapNotNull { it.number("actual_area_ha") }.takeIf { it.isNotEmpty() }?.sum()

internal fun operationCard(row: JsonObject, index: Int): CabinetCard {
    val config = row.obj("operation_config")
    val status = row.text("operation_status") ?: row.text("status") ?: row.text("work_status")
    val statusLabel = mapOf("planned" to "Запланировано", "active" to "Активно", "accepted" to "Принято", "in_progress" to "В работе", "paused" to "Приостановлено", "completed" to "Завершено", "cancelled" to "Отменено", "awaiting_approval" to "Ожидает подтверждения", "awaiting_reconciliation" to "Ожидает сверки")[status] ?: status ?: "Статус не указан"
    val responsible = row.obj("responsible_profile")
    val materials = row.rows("operation_materials").flatMap { material ->
        val product = material.obj("products")
        val name = product.text("trade_name") ?: product.text("name") ?: listOf("crops", "varieties", "reproductions").mapNotNull { relation ->
            material.obj(relation).text("name_ru") ?: material.obj(relation).text("name")
        }.joinToString(" · ").ifBlank { "Материал не указан" }
        val unit = material.text("unit") ?: ""
        listOf(CabinetRow("Материал", name), CabinetRow("План материала", quantity(material.number("planned_quantity"), " $unit")),
            CabinetRow("Выдано", quantity(material.number("issued_quantity"), " $unit")),
            CabinetRow("Фактический расход", quantity(material.number("actual_quantity"), " $unit")))
    }
    return CabinetCard(row.text("id") ?: "operation-$index", config.text("operation_engine_label") ?: row.text("operation_type") ?: "Работа",
        statusLabel, listOf(CabinetRow("Дата", row.text("date") ?: "Не указано"), CabinetRow("Плановая площадь", quantity(plannedOperationArea(row), " га")),
            CabinetRow("Выполнено", quantity(actualOperationArea(row), " га")), CabinetRow("Ответственный", responsible.text("full_name") ?: responsible.text("email") ?: "Не назначен"),
            CabinetRow("Примечание", row.text("notes") ?: "Не указано")) + materials)
}
