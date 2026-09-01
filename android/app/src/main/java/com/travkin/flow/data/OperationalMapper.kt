package com.travkin.flow.data

import com.travkin.flow.domain.CachedOverview
import com.travkin.flow.domain.CachedTicketPage
import com.travkin.flow.domain.OperationalOverview
import com.travkin.flow.domain.TicketDetails
import com.travkin.flow.domain.TicketLine
import com.travkin.flow.domain.TicketPage
import com.travkin.flow.domain.TicketSummary

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

internal fun TicketPageDto.toTicketPage(
    historyLimit: Int,
    fetchedAtEpochMillis: Long = System.currentTimeMillis(),
): TicketPage = TicketPage(
    tickets = tickets.orEmpty().mapNotNull(TicketDto::toTicketSummary),
    historyHasMore = historyHasMore == true,
    historyLimit = historyLimit,
    fetchedAtEpochMillis = fetchedAtEpochMillis,
)

internal fun TicketDetailEnvelopeDto.toTicketDetails(): TicketDetails? {
    val dto = ticket ?: return null
    val summary = dto.toTicketSummary() ?: return null
    val detailLines = (lines ?: dto.lines).orEmpty().map(TicketLineDto::toTicketLine)
    return TicketDetails(
        summary = summary,
        companyName = dto.companyName,
        supplierName = dto.supplierName,
        buyerName = dto.buyerName,
        warehouseFrom = dto.warehouseFrom,
        warehouseTo = dto.warehouseTo,
        grossWeightKg = dto.grossWeightKg,
        tareWeightKg = dto.tareWeightKg,
        notes = dto.notes,
        lines = detailLines,
    )
}

internal fun CachedTicketPage.matchesScope(actorId: String, companyId: String?): Boolean =
    this.actorId == actorId && this.companyId == companyId

private fun TicketDto.toTicketSummary(): TicketSummary? {
    val normalizedId = id?.trim()?.takeIf(String::isNotEmpty) ?: return null
    return TicketSummary(
        id = normalizedId,
        ticketNo = ticketNo?.trim()?.takeIf(String::isNotEmpty) ?: normalizedId.take(8),
        operationType = operationType.orEmpty(),
        direction = direction.orEmpty(),
        status = status.orEmpty(),
        createdAt = createdAt.orEmpty(),
        fieldName = fieldName,
        vehicleName = vehicleName,
        vehiclePlate = vehiclePlate,
        driverName = driverName,
        destinationName = warehouseTo ?: destinationText ?: buyerName ?: supplierName,
        netWeightKg = physicalNetKg ?: netWeightKg,
        requiresReview = requiresReview == true,
    )
}

private fun TicketLineDto.toTicketLine(): TicketLine = TicketLine(
    productName = productName?.trim()?.takeIf(String::isNotEmpty) ?: "Не указано",
    varietyName = varietyName,
    reproductionName = reproductionName,
    quantity = quantity ?: 0.0,
    unit = uom?.trim()?.takeIf(String::isNotEmpty) ?: "kg",
    moisturePercent = moisturePercent,
)
