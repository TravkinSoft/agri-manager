package com.travkin.flow.data

import com.travkin.flow.domain.CachedOverview
import com.travkin.flow.domain.OperationalOverview

internal fun OperationalBootstrapDto.toOperationalOverview(
    fetchedAtEpochMillis: Long = System.currentTimeMillis(),
): OperationalOverview {
    val today = harvestSummary?.today
    return OperationalOverview(
        shiftOpen = shift?.id?.isNotBlank() == true && shift.status == "open",
        shiftStale = shiftGuard?.stale == true,
        shiftTrips = shiftSummary?.trips ?: 0,
        shiftNetKg = shiftSummary?.netKg ?: 0.0,
        activeTickets = counters?.activeTickets ?: 0,
        stuckTickets = counters?.stuckTickets ?: 0,
        unsyncedTickets = counters?.unsynced ?: 0,
        requiresReview = counters?.requiresReview ?: 0,
        manualCorrections = counters?.manualCorrections ?: shiftSummary?.manualCorrections ?: 0,
        harvestedTodayKg = today?.netKg ?: today?.cleanMassKg ?: today?.totalKg ?: 0.0,
        fetchedAtEpochMillis = fetchedAtEpochMillis,
    )
}

internal fun CachedOverview.matchesScope(actorId: String, companyId: String?): Boolean =
    this.actorId == actorId && this.companyId == companyId
