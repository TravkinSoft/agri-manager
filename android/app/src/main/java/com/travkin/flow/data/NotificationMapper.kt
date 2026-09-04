package com.travkin.flow.data

import com.google.gson.JsonObject
import com.travkin.flow.domain.*

internal fun notificationPreferences(row: JsonObject): NotificationPreferences {
    fun required(key: String): Boolean {
        val value = row.text(key)
        if (value !in setOf("true", "false")) throw UserFacingException("Настройки уведомлений не загружены полностью.")
        return value == "true"
    }
    return NotificationPreferences(required("email_enabled"), required("operation_updates_enabled"), required("warehouse_updates_enabled"),
        required("weighbridge_updates_enabled"), required("proactive_assist_enabled"), row.text("proactive_assist_cadence") ?: throw UserFacingException("Режим уведомлений не получен."))
}

internal fun preferencesBody(preferences: NotificationPreferences, company: String) = JsonObject().apply {
    addProperty("companyId", company)
    addProperty("email_enabled", preferences.email)
    addProperty("operation_updates_enabled", preferences.operations)
    addProperty("warehouse_updates_enabled", preferences.warehouses)
    addProperty("weighbridge_updates_enabled", preferences.tickets)
    // Preserve hidden web-only settings without invoking their subsystem.
    addProperty("proactive_assist_enabled", preferences.proactiveEnabled)
    addProperty("proactive_assist_cadence", preferences.proactiveCadence)
}

internal fun notificationPage(data: JsonObject): CabinetPage {
    val notifications = data.requireRows("notifications").filter { it.text("category") != "assistant" }.map { row ->
        CabinetNotification(row.text("id") ?: throw UserFacingException("Идентификатор уведомления не получен."), row.text("title") ?: "Уведомление",
            row.text("body"), row.text("created_at"), row.text("read_at") != null, notificationDestination(row.text("href")))
    }
    return CabinetPage("Уведомления", emptyList(), "Последние 100 событий, как на странице сайта. Автообновление только пока раздел открыт.", notifications = notifications)
}
