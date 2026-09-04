package com.travkin.flow.data

import com.google.gson.JsonObject
import com.travkin.flow.domain.*

internal fun driverAssignment(data: JsonObject, vehicleId: String, companyId: String? = null): DriverAssignment {
    val vehicle = data.obj("vehicle")
    val company = data.text("companyId") ?: throw UserFacingException("Ответ назначения без компании.")
    if (vehicle.text("id") != vehicleId || companyId != null && company != companyId) throw UserFacingException("Ответ сервера не соответствует выбранной машине.")
    if (data.text("canEdit") !in setOf("true", "false")) throw UserFacingException("Сервер не подтвердил права на назначение.")
    return DriverAssignment(company, vehicleId, vehicle.text("name") ?: "Машина", vehicle.text("plate"), vehicle.text("assignmentId"),
        vehicle.text("driverPersonId"), vehicle.text("driverName"), data.flag("canEdit"), data.rows("drivers").mapNotNull { row ->
            row.text("id")?.let { CatalogOption(it, row.text("name") ?: "Сотрудник") }
        })
}
internal fun driverAssignmentBody(context: DriverAssignment, personId: String?): JsonObject {
    if (!context.canEdit) throw UserFacingException("Изменение назначения недоступно.")
    if (personId != null && context.drivers.none { it.id == personId }) throw UserFacingException("Водитель недоступен. Обновите список.")
    return JsonObject().apply {
        addProperty("companyId", context.companyId); addProperty("vehicleId", context.vehicleId)
        addProperty("driverPersonId", personId); addProperty("expectedAssignmentId", context.assignmentId)
    }
}
internal fun driverAssignmentPage(data: JsonObject, query: CabinetQuery): CabinetPage {
    val assignment = driverAssignment(data, query.objectId ?: throw UserFacingException("Машина не выбрана."))
    return CabinetPage("Водитель машины", emptyList(), driverAssignment = assignment)
}
