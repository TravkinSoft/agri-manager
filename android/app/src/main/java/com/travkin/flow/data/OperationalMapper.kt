package com.travkin.flow.data

import com.travkin.flow.domain.CachedOverview
import com.travkin.flow.domain.CachedHarvestOverview
import com.travkin.flow.domain.CachedTicketPage
import com.travkin.flow.domain.CachedWarehouseOverview
import com.travkin.flow.domain.HarvestCropTotal
import com.travkin.flow.domain.HarvestFieldSummary
import com.travkin.flow.domain.HarvestIssue
import com.travkin.flow.domain.HarvestMoistureSummary
import com.travkin.flow.domain.HarvestOverview
import com.travkin.flow.domain.OperationalOverview
import com.travkin.flow.domain.TicketDetails
import com.travkin.flow.domain.TicketLine
import com.travkin.flow.domain.TicketPage
import com.travkin.flow.domain.TicketSummary
import com.travkin.flow.domain.WarehouseObjectSummary
import com.travkin.flow.domain.WarehouseOverview

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

internal fun HarvestOverviewDto.toHarvestOverview(
    fetchedAtEpochMillis: Long = System.currentTimeMillis(),
): HarvestOverview = HarvestOverview(
    periodLabel = period?.label?.trim()?.takeIf(String::isNotEmpty) ?: "Текущий операционный день",
    completedTripCount = completedTripCount ?: 0,
    openTicketCount = openTicketCount ?: 0,
    cropTotals = cropTotals.orEmpty().map { row ->
        HarvestCropTotal(
            key = row.key.orEmpty(),
            cropName = row.cropName?.trim()?.takeIf(String::isNotEmpty) ?: "Культура не указана",
            receivedKg = row.receivedKg ?: 0.0,
            trips = row.trips ?: 0,
        )
    },
    fields = fields.orEmpty().map { row ->
        HarvestFieldSummary(
            key = row.key.orEmpty(),
            fieldName = row.fieldName?.trim()?.takeIf(String::isNotEmpty) ?: "Поле не указано",
            identityLabel = row.identityLabel.orEmpty(),
            destinationName = row.destinationName.orEmpty(),
            receivedKg = row.receivedKg ?: 0.0,
            trips = row.trips ?: 0,
            lastTripAt = row.lastTripAt.orEmpty(),
        )
    },
    moisture = moisture.orEmpty().map { row ->
        HarvestMoistureSummary(
            key = row.key.orEmpty(),
            fieldName = row.fieldName?.trim()?.takeIf(String::isNotEmpty) ?: "Поле не указано",
            cropName = row.cropName?.trim()?.takeIf(String::isNotEmpty) ?: "Культура не указана",
            latestPercent = row.latestPercent ?: 0.0,
            averagePercent = row.averagePercent ?: 0.0,
            measuredTrips = row.measuredTrips ?: 0,
            totalTrips = row.totalTrips ?: 0,
        )
    },
    issues = issues.orEmpty().map { row ->
        HarvestIssue(
            key = row.key.orEmpty(),
            title = row.title?.trim()?.takeIf(String::isNotEmpty) ?: "Требует проверки",
            detail = row.detail.orEmpty(),
        )
    },
    fetchedAtEpochMillis = fetchedAtEpochMillis,
)

internal fun CachedHarvestOverview.matchesScope(actorId: String, companyId: String): Boolean =
    this.actorId == actorId && this.companyId == companyId

internal fun WarehouseSummariesEnvelopeDto.toWarehouseOverview(
    fetchedAtEpochMillis: Long = System.currentTimeMillis(),
): WarehouseOverview = WarehouseOverview(
    objects = summaries.orEmpty().mapNotNull { row ->
        val warehouse = row.warehouse ?: return@mapNotNull null
        val id = warehouse.id?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
        WarehouseObjectSummary(
            id = id,
            name = warehouse.name?.trim()?.takeIf(String::isNotEmpty) ?: "Объект без названия",
            placeType = warehouse.placeType?.trim()?.uppercase()?.takeIf(String::isNotEmpty) ?: "WAREHOUSE",
            warehouseType = warehouse.warehouseType,
            capacityValue = warehouse.capacityValue,
            capacityUnit = warehouse.capacityUnit,
            location = warehouse.location,
            description = warehouse.description,
            positionCount = row.positionCount ?: 0,
            harvestLotCount = row.harvestLotCount ?: 0,
            harvestWeightKg = row.harvestWeightKg ?: 0.0,
            totalWeightKg = row.totalWeightKg ?: 0.0,
            seedWeightKg = row.seedWeightKg ?: 0.0,
            otherMaterialWeightKg = row.otherMaterialWeightKg ?: 0.0,
            lastMovementAt = row.lastMovementAt,
        )
    },
    fetchedAtEpochMillis = fetchedAtEpochMillis,
)

internal fun CachedWarehouseOverview.matchesScope(actorId: String, companyId: String): Boolean =
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
