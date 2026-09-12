package com.travkin.flow.data

import com.google.gson.JsonObject
import com.travkin.flow.domain.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.text.NumberFormat
import java.util.Locale

internal fun JsonObject.text(key: String): String? = get(key)?.takeIf { it.isJsonPrimitive }
    ?.asString?.trim()?.takeIf { it.isNotEmpty() }
internal fun JsonObject.number(key: String): Double? = text(key)?.toDoubleOrNull()?.takeIf(Double::isFinite)
internal fun JsonObject.flag(key: String) = get(key)?.takeIf { it.isJsonPrimitive }?.asString == "true"
internal fun JsonObject.obj(key: String): JsonObject = get(key)?.takeIf { it.isJsonObject }?.asJsonObject ?: JsonObject()
internal fun JsonObject.rows(key: String): List<JsonObject> = get(key)?.takeIf { it.isJsonArray }?.asJsonArray
    ?.mapNotNull { it.takeIf { row -> row.isJsonObject }?.asJsonObject }.orEmpty()
internal fun JsonObject.requireRows(key: String): List<JsonObject> {
    if (get(key)?.isJsonArray != true) throw UserFacingException("Сервер вернул неполные данные. Повторите загрузку.")
    return rows(key)
}
internal fun quantity(value: Double?, unit: String = ""): String = value?.let {
    NumberFormat.getNumberInstance(Locale.forLanguageTag("ru-RU")).apply { maximumFractionDigits = 3 }.format(it) + unit
} ?: "Не указано"
internal fun serverDate(value: String?): String = value?.let {
    runCatching { DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(it)) }.getOrDefault(it)
} ?: "Не указано"
private fun value(label: String, content: String?) = CabinetRow(label, content ?: "Не указано")
private fun metric(label: String, row: JsonObject, key: String, unit: String = "") = value(label, quantity(row.number(key), unit))

internal fun mapCabinet(query: CabinetQuery, payload: JsonObject, operationTypes: List<OperationTypeOption> = emptyList()): CabinetPage = when (query.section) {
    CabinetSection.NOTIFICATIONS -> notificationPage(payload)
    CabinetSection.SETTINGS -> CabinetPage("Настройки уведомлений", emptyList(), notificationPreferences = notificationPreferences(payload.obj("preferences")))
    CabinetSection.HARVEST -> if (query.partyKey != null) harvestPartyPage(payload, query) else harvestPage(payload, query)
    CabinetSection.CROPS -> cropsPage(payload, query, operationTypes)
    CabinetSection.WAREHOUSES -> when {
        query.lotId != null -> harvestLotPage(payload, query)
        query.productId != null -> stockPage(payload, query)
        query.warehouseId != null -> warehouseContents(payload, query)
        else -> warehousePage(payload)
    }
    CabinetSection.TICKETS -> if (query.objectId != null) ticketDetail(payload) else ticketPage(payload, query)
    CabinetSection.TRAFFIC -> if (query.objectId != null) driverAssignmentPage(payload, query) else trafficPage(payload)
    CabinetSection.WEATHER -> weatherPage(payload, query)
}

private fun harvestPage(data: JsonObject, query: CabinetQuery): CabinetPage {
    val totals = data.requireRows("cropTotals")
    return CabinetPage("Сводка урожая", listOf(
        CabinetGroup(data.obj("period").text("label") ?: "Выбранный период", listOf(CabinetCard("total", "Рейсы", rows = listOf(
            metric("Завершены", data, "completedTripCount"), metric("Открыты", data, "openTicketCount"))))),
        CabinetGroup("Партии урожая", data.rows("parties").mapNotNull { r -> r.text("key")?.let { key -> CabinetCard(key, r.text("identityLabel") ?: "Партия",
            rows = listOf(metric("Сейчас на складах", r, "currentStockKg", " кг"), metric("Принято за период", r, "receivedKg", " кг"),
                metric("Открытые рейсы", r, "openTicketCount"), metric("Завершены за период", r, "completedTicketCount")),
            destination = query.copy(partyKey = key, title = r.text("identityLabel"))) } }),
        CabinetGroup("По культурам", totals.mapIndexed { i, r -> CabinetCard("crop-$i", r.text("cropName") ?: "Культура не указана", rows = listOf(
            metric("Принято", r, "receivedKg", " кг"), metric("Рейсов", r, "trips"))) }),
        CabinetGroup("По полям", data.rows("fields").mapIndexed { i, r -> CabinetCard("field-$i", r.text("fieldName") ?: "Поле не указано",
            r.text("identityLabel"), listOf(value("Назначение", r.text("destinationName")), metric("Принято", r, "receivedKg", " кг"),
                metric("Рейсов", r, "trips"), value("Последний рейс", serverDate(r.text("lastTripAt"))))) }),
        CabinetGroup("Влажность", data.rows("moisture").mapIndexed { i, r -> CabinetCard("moisture-$i", r.text("fieldName") ?: "Поле не указано",
            r.text("cropName"), listOf(metric("Последняя", r, "latestPercent", "%"), metric("Средняя", r, "averagePercent", "%"),
                metric("Измерено рейсов", r, "measuredTrips"))) }),
        CabinetGroup("Требует внимания", data.rows("issues").mapIndexed { i, r -> CabinetCard("issue-$i", r.text("title") ?: "Требует проверки", r.text("detail"), tone = "warning") }),
        CabinetGroup("Открытые талоны", data.rows("openTickets").mapIndexed { index, r -> summaryTicketCard(r, index) }),
        CabinetGroup("Последние завершённые рейсы", data.rows("completedEvents").mapIndexed { index, r -> summaryTicketCard(r, index) }),
    ), harvestOptions = data.obj("filterOptions").entrySet().associate { (key, value) ->
        key to if (value.isJsonArray) value.asJsonArray.mapNotNull { item -> if (!item.isJsonObject) null else item.asJsonObject.let { row -> row.text("id")?.let { CatalogOption(it, row.text("label") ?: it) } } } else emptyList()
    })
}

internal fun cropIdentity(row: JsonObject, data: JsonObject): String {
    fun name(list: String, id: String?) = data.rows(list).firstOrNull { it.text("id") == id }?.let { it.text("name_ru") ?: it.text("name") }
    if (row.text("land_use_type") == "fallow") return "Пар"
    if (row.text("land_use_type") == "crop_mix") return "Зерносмесь: " + row.rows("mix_components").joinToString(" + ") { name("crops", it.text("crop_id")) ?: "Культура не указана" }
    return listOfNotNull(name("crops", row.text("crop_id")) ?: "Культура не указана", name("varieties", row.text("variety_id")), name("reproductions", row.text("reproduction_id"))).joinToString(" · ")
}

private fun cropsPage(data: JsonObject, query: CabinetQuery, operationTypes: List<OperationTypeOption>): CabinetPage {
    val fields = data.requireRows("fields")
    val structure = data.requireRows("cropStructure")
    val selectedSeasonId = query.seasonId ?: data.text("activeSeasonId")
    val season = data.rows("seasons").firstOrNull { it.text("id") == selectedSeasonId }
    val groups = fields.filter { query.objectId == null || it.text("id") == query.objectId }.mapNotNull { field ->
        val id = field.text("id") ?: return@mapNotNull null
        val allocations = structure.filter { it.text("field_id") == id }
        val name = field.text("name") ?: "Поле без названия"
        val cards = if (query.objectId == null) listOf(CabinetCard(id, name,
            allocations.joinToString(" / ") { cropIdentity(it, data) }.ifBlank { "Структура не заполнена" },
            listOf(metric("Площадь поля", field, "area", " га")),
            query.copy(objectId = id, title = name)))
        else listOf(CabinetCard("field", name, field.text("notes"), listOf(metric("Площадь поля", field, "area", " га")))) + allocations.mapIndexed { i, row ->
            CabinetCard(row.text("id") ?: "allocation-$i", cropIdentity(row, data), row.text("notes"), listOf(
                metric("Площадь", row, "area", " га"), value("Орошение", irrigationLabel(row.text("irrigation_type"))),
                metric("Междурядье", row, "row_spacing_m", " м"), metric("Межсемянное расстояние", row, "seed_spacing_cm", " см")) +
                row.rows("mix_components").map { component -> value(cropIdentity(component, data), quantity(component.number("seed_rate_kg_ha"), " кг/га")) })
        }
        val operationCards = if (query.objectId != null) data.rows("operations").mapIndexed { index, row -> operationCard(row, index) } else emptyList()
        CabinetGroup(if (query.objectId == null) "Поля" else "Агро-контур", cards) to operationCards
    }
    val fieldGroups = groups.map { it.first }
    val operationCards = groups.flatMap { it.second }
    val editor = if (selectedSeasonId == data.text("activeSeasonId")) cropEditor(data, query.objectId) else null
    return CabinetPage(query.title ?: "Структура посевов", fieldGroups + if (query.objectId != null) listOf(CabinetGroup("История работ", operationCards)) else emptyList(),
        if (season == null) "Нет активного сезона. Показан список полей без выдуманных посевов." else "Сезон ${season.text("year")}",
        cropEditor = editor,
        seasons = data.rows("seasons").mapNotNull { row -> row.text("id")?.let { id ->
            SeasonOption(id, (row.text("year") ?: "Сезон") + when { row.flag("archived") -> " · закрыт"; id == data.text("activeSeasonId") -> " · активный"; else -> " · только чтение" }, id == selectedSeasonId)
        } },
        operationPlanner = if (editor != null && operationTypes.isNotEmpty() && data.has("machines")) operationPlanner(data, editor, operationTypes) else null,
    )
}

private fun irrigationLabel(value: String?) = when(value) {
    "drip" -> "Капельное"; "sprinkler" -> "Дождевание"; "dryland" -> "Богара"; else -> "Не указано"
}

private fun warehousePage(data: JsonObject) = CabinetPage("Склады", listOf(CabinetGroup("Объекты хранения", data.requireRows("summaries").mapNotNull { r ->
    val w = r.obj("warehouse")
    val id = w.text("id") ?: return@mapNotNull null
    CabinetCard(id, w.text("name") ?: "Объект без названия", w.text("location"), listOf(
        value("Тип", when(w.text("place_type")) { "YARD" -> "Площадка"; "DRYER" -> "Сушка"; "CLEANER" -> "Очистка"; else -> "Склад" }),
        metric("Общий вес", r, "total_weight_kg", " кг"), metric("Урожай", r, "harvest_weight_kg", " кг"),
        metric("Семена", r, "seed_weight_kg", " кг"), metric("Прочие материалы", r, "other_material_weight_kg", " кг"),
        metric("Позиций", r, "position_count"), metric("Партий урожая", r, "harvest_lot_count"), value("Последнее движение", serverDate(r.text("last_movement_at")))),
        destination = CabinetQuery(CabinetSection.WAREHOUSES, warehouseId = id, title = w.text("name")))
})))

internal fun isFinalizedHarvest(t: JsonObject) = t.text("op_type") == "harvest_incoming" && t.text("status") == "finalized" && t.flag("is_finalized") && !t.flag("is_voided") && t.text("replacement_ticket_id") == null
internal fun isOpenHarvest(t: JsonObject) = t.text("op_type") == "harvest_incoming" && !t.flag("is_voided") && !t.flag("is_finalized") && t.text("status") in setOf("draft", "active", "ready_to_close")
internal fun ticketMatches(t: JsonObject, mode: String, today: LocalDate = LocalDate.now(), zone: ZoneId = ZoneId.systemDefault()): Boolean {
    if (t.text("op_type") != "harvest_incoming") return false
    return when (mode) {
        "open" -> isOpenHarvest(t)
        "today" -> {
            val date = if (t.text("external_document_no") != null) t.text("created_at") else t.text("finalized_at") ?: t.text("updated_at")
            isFinalizedHarvest(t) && runCatching { Instant.parse(date).atZone(zone).toLocalDate() == today }.getOrDefault(false)
        }
        "history" -> true
        else -> false
    }
}

private fun ticketCard(t: JsonObject, detail: Boolean = false): CabinetCard {
    val id = t.text("id") ?: throw UserFacingException("У документа отсутствует идентификатор.")
    val line = t.rows("lines").firstOrNull() ?: JsonObject()
    val title = "№ ${t.text("ticket_no") ?: "—"} · ${t.text("field_name_snapshot") ?: "Поле не указано"}"
    val status = when {
        t.flag("is_voided") || t.text("status") == "voided" -> if (t.text("replacement_ticket_id") != null) "Исправлен" else "Аннулирован"
        isFinalizedHarvest(t) -> "Завершён"
        isOpenHarvest(t) -> "Открыт"
        else -> t.text("status") ?: "Не указан"
    }
    return CabinetCard(id, title, status, listOf(
        value("Культура", t.text("crop_name_snapshot") ?: line.text("product_name")),
        value("Сорт", t.text("variety_name_snapshot") ?: line.text("variety_name")),
        value("Репродукция", t.text("reproduction_name_snapshot") ?: line.text("reproduction_name")),
        value("Машина", t.text("vehicle_plate_snapshot") ?: t.text("vehicle_name_snapshot")),
        value("Водитель", t.text("driver_name_snapshot")), value("Назначение", t.text("warehouse_to_name_snapshot") ?: t.text("destination_text")),
        metric("Брутто", t, "gross_weight_kg", " кг"), metric("Тара", t, "tare_weight_kg", " кг"), metric("Нетто", t, "net_weight_kg", " кг"),
        metric("Влажность", line, "moisture_percent", "%"), value("Дата рейса", serverDate(t.text("created_at")))) +
        listOfNotNull(t.text("external_document_no")?.let { value("Бумажный №", it) }, t.text("notes")?.let { value("Примечание", it) }),
        if (detail) null else CabinetQuery(CabinetSection.TICKETS, objectId = id, title = title))
}

private fun ticketPage(data: JsonObject, query: CabinetQuery) = CabinetPage("Талоны", listOf(CabinetGroup("Документы урожая",
    data.requireRows("tickets").filter { ticketMatches(it, query.ticketMode) }.map { ticketCard(it) })))

private fun ticketDetail(data: JsonObject): CabinetPage {
    val t = data.obj("ticket")
    if (t.text("op_type") != "harvest_incoming") throw UserFacingException("Этот документ не относится к кабинету Агронома.")
    return CabinetPage("Талон", listOf(CabinetGroup("Документ", listOf(ticketCard(t, true))),
        CabinetGroup("Состав", (if (data.has("lines")) data.rows("lines") else t.rows("lines")).mapIndexed { i, r ->
            CabinetCard("line-$i", r.text("product_name") ?: "Материал не указан", listOfNotNull(r.text("variety_name"), r.text("reproduction_name")).joinToString(" · "),
                listOf(metric("Количество", r, "quantity", " ${r.text("uom") ?: ""}"), metric("Влажность", r, "moisture_percent", "%")))
        })))
}

internal val trafficLabels = linkedMapOf("empty" to "Пустая", "loaded" to "Загружена", "unloading" to "На выгрузке")
internal val trafficActionLabels = mapOf(
    "loaded" to "Загружена — отправить",
    "unloading" to "Прибыла на выгрузку",
    "empty" to "Разгрузилась",
)

internal fun operatorNextState(role: String?, state: String?, inRepair: Boolean = false): String? = when {
    role == "harvester" && state == "empty" && !inRepair -> "loaded"
    role == "weighman" && state == "loaded" -> "unloading"
    role == "receiver" && state == "unloading" -> "empty"
    else -> null
}

private fun trafficPage(data: JsonObject): CabinetPage {
    if (!data.has("snapshot")) return trafficOperatorPage(data)
    val snapshot = data.obj("snapshot")
    if (snapshot.text("role") != "manager") throw UserFacingException("Сервер не подтвердил кабинет управления оборотом машин.")
    val vehicles = snapshot.requireRows("vehicles")
    return CabinetPage("Оборот машин", trafficLabels.map { (state, label) ->
        val rows = vehicles.filter { it.flag("assigned") && it.text("state") == state }
        CabinetGroup("$label · ${rows.size}", rows.map { r -> CabinetCard(r.text("vehicle_id") ?: "", r.text("plate") ?: r.text("name") ?: "Машина",
            r.text("name"), listOf(value("Водитель", r.text("driver")), value("Состояние с", serverDate(r.text("since"))), metric("Цикл", r, "cycle")),
            destination = r.text("vehicle_id")?.let { CabinetQuery(CabinetSection.TRAFFIC, objectId = it, title = "Водитель · ${r.text("plate") ?: r.text("name") ?: "Машина"}") }, tone = state) })
    } + CabinetGroup("История событий", snapshot.rows("events").map { r -> CabinetCard(r.text("id") ?: "", r.text("vehicle_plate") ?: r.text("vehicle_name") ?: "Машина",
        "${trafficLabels[r.text("from_state")] ?: "—"} → ${trafficLabels[r.text("to_state")] ?: "—"}", listOf(value("Сотрудник", r.text("actor_name")), value("Время", serverDate(r.text("created_at"))))) }),
        if (snapshot.flag("enabled")) null else "Оборот машин не настроен или приостановлен.",
        trafficEditor = if (data.has("fleet")) trafficEditor(data) else null)
}

private fun trafficOperatorPage(snapshot: JsonObject): CabinetPage {
    val role = snapshot.text("role")
    val roleLabel = when (role) {
        "harvester" -> "Комбайнёр"
        "weighman" -> "Весовая"
        "receiver" -> "Приёмка"
        else -> throw UserFacingException("Сервер не подтвердил роль оператора PTC.")
    }
    val vehicles = snapshot.requireRows("vehicles").filter { it.flag("assigned") }
    val groups = trafficLabels.mapNotNull { (state, label) ->
        val rows = vehicles.filter { it.text("state") == state }
        if (rows.isEmpty()) null else CabinetGroup("$label · ${rows.size}", rows.map { row ->
            val id = row.text("vehicle_id") ?: throw UserFacingException("Сервер вернул машину без идентификатора.")
            val version = row.number("version")?.takeIf { it >= 0 && it % 1.0 == 0.0 }?.toInt()
                ?: throw UserFacingException("Сервер вернул некорректную версию машины.")
            val target = operatorNextState(role, state, row.flag("inRepair"))
            CabinetCard(
                id = id,
                title = row.text("plate") ?: row.text("name") ?: "Машина",
                subtitle = row.text("name"),
                rows = listOf(
                    value("Водитель", row.text("driver")),
                    value("Состояние", trafficLabels[state]),
                    value("Состояние с", serverDate(row.text("since"))),
                    metric("Цикл", row, "cycle"),
                ),
                tone = state,
                trafficTransition = target?.let {
                    TrafficTransition(id, version, it, trafficActionLabels[it] ?: "Подтвердить")
                },
            )
        })
    }
    val notice = when {
        !snapshot.flag("enabled") -> "Оборот машин не запущен. Обратитесь к Завгару."
        vehicles.isEmpty() -> "Сейчас нет машин, ожидающих действие роли «$roleLabel»."
        else -> "Показаны только машины, доступные вашей роли. Переход фиксируется сервером один раз."
    }
    return CabinetPage("PTC · $roleLabel", groups, notice)
}

private fun weatherPage(data: JsonObject, query: CabinetQuery): CabinetPage {
    if (query.localityCode == null) return CabinetPage("Погода", listOf(CabinetGroup("Населённые пункты", data.requireRows("items").mapNotNull { r ->
        val code = r.text("code") ?: return@mapNotNull null
        CabinetCard(code, r.text("nameRu") ?: code, listOfNotNull(r.text("districtRu"), r.text("regionRu")).joinToString(" · "),
            destination = query.copy(localityCode = code, title = r.text("nameRu")))
    })), "Найдите населённый пункт и откройте прогноз.")
    val weather = data.obj("weather")
    if (!weather.has("current")) throw UserFacingException("Прогноз пока недоступен.")
    val profiles = data.rows("profiles").map(::weatherProfile)
    val profile = if (query.weatherMode == "custom") profiles.firstOrNull { it.id == query.weatherProfileId } ?: profiles.firstOrNull { it.isDefault } ?: profiles.firstOrNull() else weatherModeProfile(query.weatherMode)
    fun point(r: JsonObject, id: String, title: String) = CabinetCard(id, title, rows = listOf(
        metric("Температура", r, "temperatureC", " °C"), metric("Влажность воздуха", r, "humidityPct", "%"),
        metric("Ветер", r, "windMs", " м/с"), metric("Порывы", r, "gustMs", " м/с"),
        metric("Вероятность осадков", r, "precipitationProbabilityPct", "%"), metric("Осадки", r, "precipitationRateMmH", " мм/ч"),
        metric("Облачность", r, "cloudCoverPct", "%"), metric("Видимость", r, "visibilityKm", " км")))
    return CabinetPage(weather.obj("location").text("displayName") ?: query.title ?: "Погода", listOf(
        CabinetGroup("Сейчас", listOf(point(weather.obj("current"), "current", serverDate(weather.text("updatedAt"))))),
        CabinetGroup("Почасовой прогноз", weather.rows("hourlyForecast").mapIndexed { i, r -> point(r, "hour-$i", serverDate(r.text("time"))) }),
        CabinetGroup("Солнце", weather.rows("sun").mapIndexed { i, r -> CabinetCard("sun-$i", r.text("date") ?: "", rows = listOf(value("Восход", serverDate(r.text("sunrise"))), value("Закат", serverDate(r.text("sunset"))))) }),
    ) + weatherOperatingGroups(weather, profile),
        (if (weather.flag("stale")) "Показан ранее полученный прогноз. Источник пока не обновился. " else "") + "Условия рассчитаны по профилю «${profile?.name ?: "не выбран"}». Это оценка по прогнозу; решение о работах принимается с учётом фактических условий.",
        weatherProfiles = profiles)
}
