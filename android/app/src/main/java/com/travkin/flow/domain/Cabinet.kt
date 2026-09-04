package com.travkin.flow.domain

/** Mirrors AGRONOMIST_NAV, web baseline 9ea2c8317aad, not the admin menu. */
enum class CabinetSection(val label: String, val webPath: String, val primary: Boolean = true) {
    HARVEST("Сводка урожая", "/dashboard"),
    CROPS("Структура посевов", "/crop-structure"),
    WAREHOUSES("Склады", "/warehouses"),
    TICKETS("Талоны", "/tickets", false),
    TRAFFIC("Оборот машин", "/traffic", false),
    WEATHER("Погода", "/weather-lab"),
    NOTIFICATIONS("Уведомления", "/notifications", false),
    SETTINGS("Настройки уведомлений", "/settings", false);

    companion object {
        fun fromPath(path: String?) = entries.firstOrNull {
            it.webPath == path && (it.primary || it == NOTIFICATIONS || it == SETTINGS)
        }
    }
}

data class CabinetQuery(
    val section: CabinetSection = CabinetSection.HARVEST,
    val period: String = "current_day",
    val ticketMode: String = "open",
    val objectId: String? = null,
    val title: String? = null,
    val localityCode: String? = null,
    val localitySearch: String = "",
    val warehouseId: String? = null,
    val productId: String? = null,
    val unit: String? = null,
    val batchClass: String? = null,
    val lotId: String? = null,
    val seasonId: String? = null,
    val harvestFilters: HarvestFilters = HarvestFilters(),
    val partyKey: String? = null,
    val weatherMode: String = "general",
    val weatherProfileId: String? = null,
)

data class CabinetRow(val label: String, val value: String)

data class CabinetCard(
    val id: String,
    val title: String,
    val subtitle: String? = null,
    val rows: List<CabinetRow> = emptyList(),
    val destination: CabinetQuery? = null,
    val tone: String? = null,
)

data class CabinetGroup(val title: String, val cards: List<CabinetCard>)
data class SeasonOption(val id: String, val label: String, val active: Boolean)

data class CabinetPage(
    val title: String,
    val groups: List<CabinetGroup>,
    val notice: String? = null,
    val fetchedAt: Long = System.currentTimeMillis(),
    val cropEditor: CropEditorData? = null,
    val trafficEditor: TrafficEditorData? = null,
    val seasons: List<SeasonOption> = emptyList(),
    val harvestOptions: Map<String, List<CatalogOption>>? = null,
    val weatherProfiles: List<WeatherProfile> = emptyList(),
    val notifications: List<CabinetNotification>? = null,
    val notificationPreferences: NotificationPreferences? = null,
    val driverAssignment: DriverAssignment? = null,
    val operationPlanner: OperationPlannerData? = null,
)

/** A monotonic generation makes late network results harmless after navigation/logout. */
class RequestGeneration {
    private var generation = 0L
    fun next(): Long = ++generation
    fun isCurrent(value: Long) = value == generation
}
