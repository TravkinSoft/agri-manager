package com.travkin.flow.domain

enum class SupportedRole(
    val wireValue: String,
    val displayName: String,
    val canViewHarvest: Boolean,
    val canViewWarehouses: Boolean,
) {
    GLOBAL_ADMIN("global_admin", "Global Admin", true, true),
    COMPANY_ADMIN("company_admin", "Company Admin", true, true),
    AGRONOMIST("agronomist", "Агроном", true, true),
    WEIGHMAN("weighman", "Весовщик", false, true),
    SPECIALIST("specialist", "Специалист", false, false);

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
)

data class TicketLine(
    val productName: String,
    val varietyName: String?,
    val reproductionName: String?,
    val quantity: Double,
    val unit: String,
    val moisturePercent: Double?,
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
