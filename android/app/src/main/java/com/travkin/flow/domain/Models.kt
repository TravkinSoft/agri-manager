package com.travkin.flow.domain

enum class SupportedRole(
    val wireValue: String,
    val displayName: String,
    val canViewHarvest: Boolean,
    val canViewWarehouses: Boolean,
    val canUseWeighbridgeWorkspace: Boolean,
    val canViewWeather: Boolean,
) {
    GLOBAL_ADMIN("global_admin", "Global Admin", true, true, true, true),
    COMPANY_ADMIN("company_admin", "Company Admin", true, true, true, false),
    AGRONOMIST("agronomist", "Агроном", true, true, false, true),
    WEIGHMAN("weighman", "Весовщик", false, true, true, false),
    SPECIALIST("specialist", "Специалист", false, false, false, false);

    companion object {
        fun fromWire(value: String?): SupportedRole? = entries.firstOrNull {
            it.wireValue == value?.trim()?.lowercase()
        }
    }
}

data class Actor(
    val id: String,
    val role: SupportedRole,
    val companyId: String?,
    val email: String?,
)

data class OperationalOverview(
    val shiftOpen: Boolean,
    val shiftStale: Boolean,
    val shiftTrips: Int,
    val shiftNetKg: Double,
    val activeTickets: Int,
    val stuckTickets: Int,
    val unsyncedTickets: Int,
    val requiresReview: Int,
    val manualCorrections: Int,
    val harvestedTodayKg: Double,
    val fetchedAtEpochMillis: Long,
)

data class CachedOverview(
    val actorId: String,
    val companyId: String?,
    val overview: OperationalOverview,
)

data class TicketSummary(
    val id: String,
    val ticketNo: String,
    val operationType: String,
    val direction: String,
    val status: String,
    val createdAt: String,
    val fieldName: String?,
    val vehicleName: String?,
    val vehiclePlate: String?,
    val driverName: String?,
    val destinationName: String?,
    val netWeightKg: Double?,
    val requiresReview: Boolean,
    val grossWeightKg: Double? = null,
    val tareWeightKg: Double? = null,
    val harvestLotId: String? = null,
    val linkedProcessingId: String? = null,
)

data class TicketLine(
    val productName: String,
    val varietyName: String?,
    val reproductionName: String?,
    val quantity: Double,
    val unit: String,
    val moisturePercent: Double?,
    val lotId: String? = null,
    val batchClass: String? = null,
)

data class TicketDetails(
    val summary: TicketSummary,
    val companyName: String?,
    val supplierName: String?,
    val buyerName: String?,
    val warehouseFrom: String?,
    val warehouseTo: String?,
    val grossWeightKg: Double?,
    val tareWeightKg: Double?,
    val notes: String?,
    val lines: List<TicketLine>,
)

data class TicketPage(
    val tickets: List<TicketSummary>,
    val historyHasMore: Boolean,
    val historyLimit: Int,
    val fetchedAtEpochMillis: Long,
)

data class CachedTicketPage(
    val actorId: String,
    val companyId: String?,
    val page: TicketPage,
)

data class HarvestCropTotal(
    val key: String,
    val cropName: String,
    val receivedKg: Double,
    val trips: Int,
)

data class HarvestFieldSummary(
    val key: String,
    val fieldName: String,
    val identityLabel: String,
    val destinationName: String,
    val receivedKg: Double,
    val trips: Int,
    val lastTripAt: String,
)

data class HarvestMoistureSummary(
    val key: String,
    val fieldName: String,
    val cropName: String,
    val latestPercent: Double,
    val averagePercent: Double,
    val measuredTrips: Int,
    val totalTrips: Int,
)

data class HarvestIssue(
    val key: String,
    val title: String,
    val detail: String,
)

data class HarvestOverview(
    val periodLabel: String,
    val completedTripCount: Int,
    val openTicketCount: Int,
    val cropTotals: List<HarvestCropTotal>,
    val fields: List<HarvestFieldSummary>,
    val moisture: List<HarvestMoistureSummary>,
    val issues: List<HarvestIssue>,
    val fetchedAtEpochMillis: Long,
)

data class CachedHarvestOverview(
    val actorId: String,
    val companyId: String,
    val overview: HarvestOverview,
)

data class WarehouseObjectSummary(
    val id: String,
    val name: String,
    val placeType: String,
    val warehouseType: String?,
    val capacityValue: Double?,
    val capacityUnit: String?,
    val location: String?,
    val description: String?,
    val positionCount: Int,
    val harvestLotCount: Int,
    val harvestWeightKg: Double,
    val totalWeightKg: Double,
    val seedWeightKg: Double,
    val otherMaterialWeightKg: Double,
    val lastMovementAt: String?,
)

data class WarehouseOverview(
    val objects: List<WarehouseObjectSummary>,
    val fetchedAtEpochMillis: Long,
)

data class CachedWarehouseOverview(
    val actorId: String,
    val companyId: String,
    val overview: WarehouseOverview,
)

data class WeighbridgeOperator(
    val id: String,
    val name: String,
    val hasPin: Boolean,
    val pinActive: Boolean,
    val lockedUntil: String?,
)

data class WeighbridgeShift(
    val id: String,
    val status: String,
    val operatorPersonId: String?,
    val openedAt: String?,
)

data class WeighbridgeResourceOption(
    val id: String,
    val name: String,
    val secondary: String? = null,
)

data class HarvestAllocationOption(
    val id: String,
    val fieldId: String,
    val fieldName: String,
    val cropId: String,
    val cropName: String,
    val varietyId: String?,
    val varietyName: String?,
    val reproductionId: String?,
    val reproductionName: String?,
    val incomplete: Boolean,
)

data class WeighbridgeWorkspace(
    val shift: WeighbridgeShift?,
    val unlocked: Boolean,
    val operator: WeighbridgeOperator?,
    val operators: List<WeighbridgeOperator>,
    val fields: List<WeighbridgeResourceOption>,
    val destinations: List<WeighbridgeResourceOption>,
    val vehicles: List<WeighbridgeResourceOption>,
    val drivers: List<WeighbridgeResourceOption>,
    val allocations: List<HarvestAllocationOption>,
    val resourceErrors: List<String>,
    val stationContractAvailable: Boolean,
    val localWorkstationId: String,
    val writesEnabled: Boolean,
    val pendingCommandCount: Int,
    val fetchedAtEpochMillis: Long,
)

data class HarvestTicketDraft(
    val allocationId: String,
    val fieldId: String,
    val cropId: String,
    val varietyId: String?,
    val reproductionId: String?,
    val destinationId: String,
    val vehicleId: String?,
    val driverId: String?,
    val grossWeightKg: Double,
    val notes: String?,
)

data class PendingWeighbridgeCommand(
    val idempotencyKey: String,
    val type: String,
    val actorId: String,
    val companyId: String,
    val ticketId: String? = null,
    val draft: HarvestTicketDraft? = null,
    val grossWeightKg: Double? = null,
    val tareWeightKg: Double? = null,
    val confirmTareVariance: Boolean = false,
    val createdAtEpochMillis: Long,
    val attempts: Int = 0,
)

data class PendingWeighbridgeQueue(
    val commands: List<PendingWeighbridgeCommand>,
)

object WeighbridgeWritePolicy {
    fun isAllowed(
        enabled: Boolean,
        appChannel: String,
        baseUrl: String,
        role: SupportedRole,
    ): Boolean = enabled &&
        appChannel == "qa" &&
        baseUrl.trimEnd('/') == "https://qa.travkinflow.com" &&
        role in setOf(SupportedRole.GLOBAL_ADMIN, SupportedRole.COMPANY_ADMIN, SupportedRole.WEIGHMAN)
}

data class KatoLocality(
    val code: String,
    val nameRu: String,
    val nameKz: String?,
    val districtRu: String?,
    val regionRu: String?,
)

data class WeatherLocation(
    val latitude: Double,
    val longitude: Double,
    val region: String?,
    val district: String?,
    val locality: String?,
    val displayName: String,
    val katoCode: String?,
)

data class WeatherPoint(
    val time: String,
    val temperatureC: Double?,
    val dewPointC: Double?,
    val windMs: Double?,
    val gustMs: Double?,
    val precipitationProbabilityPct: Double?,
    val precipitationRateMmH: Double?,
    val precipitationType: String?,
    val cloudCoverPct: Double?,
    val visibilityKm: Double?,
    val humidityPct: Double?,
    val pressureMslHpa: Double?,
)

data class WeatherSun(
    val date: String,
    val sunrise: String?,
    val sunset: String?,
)

data class WeatherProviderMeta(
    val provider: String,
    val timezone: String?,
    val cache: String,
    val forecastHours: Int,
)

data class WeatherForecast(
    val location: WeatherLocation,
    val current: WeatherPoint,
    val hourlyForecast: List<WeatherPoint>,
    val sun: List<WeatherSun>,
    val providerMeta: WeatherProviderMeta,
    val updatedAt: String,
    val stale: Boolean,
    val fetchedAtEpochMillis: Long,
)

data class CachedWeatherForecast(
    val actorId: String,
    val companyId: String?,
    val forecast: WeatherForecast,
)

data class ProfileSessionSnapshot(
    val actorVerifiedAtEpochMillis: Long?,
    val sessionExpiresAtEpochSeconds: Long?,
)

data class UserNotification(
    val id: String,
    val companyId: String,
    val recipientUserId: String,
    val category: String,
    val eventType: String,
    val title: String,
    val body: String?,
    val href: String,
    val entityType: String?,
    val entityId: String?,
    val readAt: String?,
    val createdAt: String,
)

data class NotificationCenterData(
    val notifications: List<UserNotification>,
    val unreadCount: Int,
    val fetchedAtEpochMillis: Long,
)

data class CachedNotificationCenter(
    val actorId: String,
    val companyId: String?,
    val center: NotificationCenterData,
)
