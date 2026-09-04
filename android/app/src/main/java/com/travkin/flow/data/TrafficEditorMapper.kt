package com.travkin.flow.data

import com.google.gson.JsonObject
import com.google.gson.JsonArray
import com.travkin.flow.domain.*

internal fun trafficEditor(data: JsonObject): TrafficEditorData {
    val snapshot = data.obj("snapshot")
    if (snapshot.text("role") != "manager") throw UserFacingException("Кабинет управления не подтверждён.")
    val assigned = snapshot.requireRows("vehicles").filter { it.flag("assigned") }
    val available = linkedMapOf<String, TrafficVehicle>()
    data.requireRows("fleet").forEach { row ->
        val id = row.text("id") ?: throw UserFacingException("Некорректный справочник машин.")
        available[id] = TrafficVehicle(id, row.text("name") ?: "Машина", row.text("license_plate") ?: row.text("plate_number"), false, null)
    }
    // Assigned archived vehicles must stay visible and selected, as in the web UI.
    assigned.forEach { row ->
        val id = row.text("vehicle_id") ?: throw UserFacingException("Некорректное состояние машины.")
        val old = available[id]
        available[id] = TrafficVehicle(id, old?.name ?: row.text("name") ?: "Машина", old?.plate ?: row.text("plate"), true, row.text("state"))
    }
    val people = data.requireRows("people")
    val accounts = data.requireRows("accounts").map { row ->
        val id = row.text("id") ?: throw UserFacingException("Некорректная учётная запись сотрудника.")
        val linked = people.filter { it.text("user_id") == id }
        TrafficAccount(id, (if (linked.size == 1) linked[0].text("full_name") else row.text("full_name")) ?: "Сотрудник",
            when (row.text("role")) { "mechanic_operator" -> "Комбайнёр"; "vegetable_brigadier" -> "Приёмка картофеля"; else -> "Кабинет не назначен" },
            when { row.text("status") != "active" -> "Аккаунт ещё не активен"; linked.size == 1 -> "Аккаунт активен · сотрудник связан"; else -> "Нужна проверка связи с сотрудником" })
    }
    return TrafficEditorData(snapshot.text("fieldId"), available.values.toList(), accounts)
}

internal fun trafficSaveBody(context: TrafficEditorData, selected: Set<String>, emptyConfirmed: Boolean): JsonObject {
    validateTrafficSelection(context, selected, emptyConfirmed)?.let { throw UserFacingException(it) }
    return JsonObject().apply {
        addProperty("action", "configure")
        addProperty("enabled", true)
        addProperty("fieldId", context.fieldId)
        add("vehicleIds", JsonArray().apply { selected.sorted().forEach { add(it) } })
    }
}
