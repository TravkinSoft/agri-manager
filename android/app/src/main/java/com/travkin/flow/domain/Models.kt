package com.travkin.flow.domain

enum class SupportedRole(val wireValue: String, val displayName: String) {
    GLOBAL_ADMIN("global_admin", "Global Admin"),
    COMPANY_ADMIN("company_admin", "Company Admin"),
    AGRONOMIST("agronomist", "Агроном"),
    WEIGHMAN("weighman", "Весовщик"),
    SPECIALIST("specialist", "Специалист");

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
