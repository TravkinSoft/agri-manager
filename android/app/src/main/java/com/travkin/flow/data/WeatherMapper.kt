package com.travkin.flow.data

import com.google.gson.JsonObject
import com.travkin.flow.domain.*

internal fun weatherProfileBody(profile: WeatherProfile): JsonObject {
    validateWeatherProfile(profile)?.let { throw UserFacingException(it) }
    return JsonObject().apply {
        addProperty("name", profile.name.trim())
        addProperty("windEnabled", profile.windEnabled); addProperty("maxWindMs", profile.maxWindMs)
        addProperty("gustEnabled", profile.gustEnabled); addProperty("maxGustMs", profile.maxGustMs)
        addProperty("precipitationEnabled", profile.precipitationEnabled); addProperty("precipitationMode", profile.precipitationMode)
        addProperty("maxPrecipitationMmH", profile.maxPrecipitationMmH)
        addProperty("precipitationProbabilityEnabled", profile.precipitationProbabilityEnabled); addProperty("maxPrecipitationProbabilityPct", profile.maxPrecipitationProbabilityPct)
        addProperty("temperatureEnabled", profile.temperatureEnabled); addProperty("minTemperatureC", profile.minTemperatureC); addProperty("maxTemperatureC", profile.maxTemperatureC)
        addProperty("isDefault", profile.isDefault)
    }
}

internal fun weatherProfile(row: JsonObject) = WeatherProfile(row.text("id"), row.text("name").orEmpty(), row.text("updatedAt"),
    row.flag("windEnabled"), row.number("maxWindMs"), row.flag("gustEnabled"), row.number("maxGustMs"),
    row.flag("precipitationEnabled"), row.text("precipitationMode") ?: "forbidden", row.number("maxPrecipitationMmH"),
    row.flag("precipitationProbabilityEnabled"), row.number("maxPrecipitationProbabilityPct"), row.flag("temperatureEnabled"), row.number("minTemperatureC"), row.number("maxTemperatureC"), row.flag("isDefault"))

internal fun weatherOperatingGroups(weather: JsonObject, profile: WeatherProfile?): List<CabinetGroup> {
    val hours = weather.rows("hourlyForecast").take(168).map { row -> evaluateOperatingHour(WeatherPoint(row.text("time") ?: throw UserFacingException("В прогнозе не указано время."),
        row.number("windMs"), row.number("gustMs"), row.number("precipitationRateMmH"), row.number("precipitationProbabilityPct"), row.number("temperatureC")), profile) }
    val windows = findOperatingWindows(hours.take(48))
    val labels = mapOf("green" to "Подходящие условия", "yellow" to "Близко к пределу", "orange" to "Почти у предела", "red" to "Вне условий профиля", "gray" to "Недостаточно данных")
    return listOf(CabinetGroup("Рабочие окна · ближайшие 48 часов", windows.mapIndexed { i, window -> CabinetCard("window-$i", "${serverDate(window.start)} — ${serverDate(window.end)}", "${window.hours} ч · ${profile?.name.orEmpty()}", tone = "loaded") }),
        CabinetGroup("Условия работ · до 7 дней", hours.mapIndexed { i, hour -> CabinetCard("operating-$i", serverDate(hour.point.time), labels[hour.status],
            hour.reasons.map { CabinetRow("Причина", it) }, tone = when(hour.status) { "green" -> "loaded"; "red", "orange", "yellow" -> "warning"; else -> null }) }))
}
