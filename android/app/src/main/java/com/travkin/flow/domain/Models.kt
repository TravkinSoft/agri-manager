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
