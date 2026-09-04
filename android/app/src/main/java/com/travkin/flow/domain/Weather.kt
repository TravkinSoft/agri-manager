package com.travkin.flow.domain

import java.time.Instant

data class WeatherProfile(
    val id: String? = null, val name: String = "", val updatedAt: String? = null,
    val windEnabled: Boolean = false, val maxWindMs: Double? = null,
    val gustEnabled: Boolean = false, val maxGustMs: Double? = null,
    val precipitationEnabled: Boolean = false, val precipitationMode: String = "forbidden", val maxPrecipitationMmH: Double? = null,
    val precipitationProbabilityEnabled: Boolean = false, val maxPrecipitationProbabilityPct: Double? = null,
    val temperatureEnabled: Boolean = false, val minTemperatureC: Double? = null, val maxTemperatureC: Double? = null,
    val isDefault: Boolean = false,
)
data class WeatherPoint(val time: String, val wind: Double?, val gust: Double?, val rain: Double?, val probability: Double?, val temperature: Double?)
data class OperatingHour(val point: WeatherPoint, val status: String, val reasons: List<String>)
data class OperatingWindow(val start: String, val end: String, val hours: Int)
val weatherModes = linkedMapOf("general" to "Общие работы", "spraying" to "Опрыскивание", "fertilizing" to "Удобрения", "sowing" to "Посев", "harvest" to "Уборка")

fun validateWeatherProfile(profile: WeatherProfile): String? {
    if (profile.name.trim().length !in 1..80) return "Название профиля: от 1 до 80 символов."
    val ranges = listOf(Triple(profile.maxWindMs, 0.0, 100.0), Triple(profile.maxGustMs, 0.0, 150.0),
        Triple(profile.maxPrecipitationMmH, 0.0, 500.0), Triple(profile.maxPrecipitationProbabilityPct, 0.0, 100.0),
        Triple(profile.minTemperatureC, -100.0, 100.0), Triple(profile.maxTemperatureC, -100.0, 100.0))
    if (ranges.any { (value, min, max) -> value != null && (!value.isFinite() || value !in min..max) }) return "Значение выходит за допустимый диапазон."
    if (profile.precipitationMode !in setOf("forbidden", "maximum")) return "Выберите режим осадков."
    if (profile.windEnabled && profile.maxWindMs == null || profile.gustEnabled && profile.maxGustMs == null ||
        profile.precipitationEnabled && profile.precipitationMode == "maximum" && profile.maxPrecipitationMmH == null ||
        profile.precipitationProbabilityEnabled && profile.maxPrecipitationProbabilityPct == null) return "Укажите предел для каждого включённого критерия."
    if (profile.temperatureEnabled && profile.minTemperatureC == null && profile.maxTemperatureC == null) return "Укажите хотя бы одну границу температуры."
    if (profile.minTemperatureC != null && profile.maxTemperatureC != null && profile.minTemperatureC > profile.maxTemperatureC) return "Максимум температуры должен быть не ниже минимума."
    return null
}

fun weatherModeProfile(mode: String): WeatherProfile? {
    val values = when (mode) {
        "general" -> listOf(8.0, 12.0, 1.0, 70.0, -5.0, 40.0)
        "spraying" -> listOf(4.0, 6.0, 0.0, 25.0, 5.0, 30.0)
        "fertilizing" -> listOf(6.0, 9.0, 0.5, 50.0, 0.0, 35.0)
        "sowing" -> listOf(8.0, 12.0, 2.0, 75.0, 0.0, 35.0)
        "harvest" -> listOf(8.0, 12.0, 0.2, 40.0, -2.0, 38.0)
        else -> return null
    }
    return WeatherProfile(name = weatherModes[mode].orEmpty(), windEnabled = true, maxWindMs = values[0], gustEnabled = true,
        maxGustMs = values[1], precipitationEnabled = true, precipitationMode = if (mode == "spraying") "forbidden" else "maximum",
        maxPrecipitationMmH = if (mode == "spraying") null else values[2], precipitationProbabilityEnabled = true,
        maxPrecipitationProbabilityPct = values[3], temperatureEnabled = true, minTemperatureC = values[4], maxTemperatureC = values[5])
}

/** Literal thresholds/priority ported from web lib/weather/operating-window.ts at 9ea2c8317aad. */
fun evaluateOperatingHour(point: WeatherPoint, profile: WeatherProfile?): OperatingHour {
    if (profile == null) return OperatingHour(point, "gray", listOf("Выберите или создайте профиль"))
    if (!profile.windEnabled && !profile.gustEnabled && !profile.precipitationEnabled && !profile.precipitationProbabilityEnabled && !profile.temperatureEnabled)
        return OperatingHour(point, "gray", listOf("В профиле не включены критерии"))
    val findings = mutableListOf<Pair<String, String>>()
    fun upper(value: Double?, limit: Double?, label: String) {
        when {
            limit == null -> findings += "gray" to "$label: предел не настроен"
            value == null || !value.isFinite() -> findings += "gray" to "$label: нет данных"
            value > limit -> findings += "red" to "$label выше предела $limit"
            limit > 0 && value >= limit * 0.92 -> findings += "orange" to "$label почти у предела $limit"
            limit > 0 && value >= limit * 0.75 -> findings += "yellow" to "$label близко к пределу $limit"
        }
    }
    if (profile.windEnabled) upper(point.wind, profile.maxWindMs, "Ветер")
    if (profile.gustEnabled) upper(point.gust, profile.maxGustMs, "Порывы")
    if (profile.precipitationEnabled) {
        if (point.rain == null) findings += "gray" to "Осадки: нет данных"
        else if (profile.precipitationMode == "forbidden") { if (point.rain > 0) findings += "red" to "Прогнозируются осадки" }
        else upper(point.rain, profile.maxPrecipitationMmH, "Осадки")
    }
    if (profile.precipitationProbabilityEnabled) upper(point.probability, profile.maxPrecipitationProbabilityPct, "Вероятность осадков")
    if (profile.temperatureEnabled) {
        val value = point.temperature; val min = profile.minTemperatureC; val max = profile.maxTemperatureC
        val margin = if (min != null && max != null) maxOf(1.0, (max - min) * 0.2) else 2.0
        when {
            value == null -> findings += "gray" to "Температура: нет данных"
            min == null && max == null -> findings += "gray" to "Температура: границы не настроены"
            min != null && value < min -> findings += "red" to "Температура ниже $min °C"
            max != null && value > max -> findings += "red" to "Температура выше $max °C"
            min != null && value <= min + margin * 0.4 -> findings += "orange" to "Температура почти у минимума $min °C"
            max != null && value >= max - margin * 0.4 -> findings += "orange" to "Температура почти у максимума $max °C"
            min != null && value <= min + margin -> findings += "yellow" to "Температура близко к минимуму $min °C"
            max != null && value >= max - margin -> findings += "yellow" to "Температура близко к максимуму $max °C"
        }
    }
    return OperatingHour(point, listOf("red", "gray", "orange", "yellow").firstOrNull { status -> findings.any { it.first == status } } ?: "green", findings.map { it.second })
}

fun findOperatingWindows(hours: List<OperatingHour>): List<OperatingWindow> {
    val result = mutableListOf<OperatingWindow>()
    var start = -1
    fun append(end: Int) {
        if (start < 0) return
        val last = Instant.parse(hours[end].point.time)
        val interval = if (end > start) maxOf(1L, last.toEpochMilli() - Instant.parse(hours[end - 1].point.time).toEpochMilli()) else 3_600_000L
        result += OperatingWindow(hours[start].point.time, last.plusMillis(interval).toString(), end - start + 1)
        start = -1
    }
    hours.forEachIndexed { index, hour ->
        val continuous = index == 0 || Instant.parse(hour.point.time).toEpochMilli() - Instant.parse(hours[index - 1].point.time).toEpochMilli() <= 5_400_000
        if (start >= 0 && (!continuous || hour.status != "green")) append(index - 1)
        if (hour.status == "green" && start < 0) start = index
        if (index == hours.lastIndex && start >= 0) append(index)
    }
    return result
}
