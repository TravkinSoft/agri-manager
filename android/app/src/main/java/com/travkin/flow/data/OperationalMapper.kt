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
import com.travkin.flow.domain.HarvestAllocationOption
import com.travkin.flow.domain.WeighbridgeOperator
import com.travkin.flow.domain.WeighbridgeResourceOption
import com.travkin.flow.domain.WeighbridgeShift
import com.travkin.flow.domain.WeighbridgeWorkspace
import com.travkin.flow.domain.CachedWeatherForecast
import com.travkin.flow.domain.KatoLocality
import com.travkin.flow.domain.WeatherForecast
import com.travkin.flow.domain.WeatherLocation
import com.travkin.flow.domain.WeatherPoint
import com.travkin.flow.domain.WeatherProviderMeta
import com.travkin.flow.domain.WeatherSun
import com.travkin.flow.domain.CachedNotificationCenter
import com.travkin.flow.domain.NotificationCenterData
import com.travkin.flow.domain.UserNotification

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

internal fun OperatorStateDto.toWeighbridgeWorkspace(
    localWorkstationId: String,
    writesEnabled: Boolean,
    pendingCommandCount: Int,
    fetchedAtEpochMillis: Long = System.currentTimeMillis(),
): WeighbridgeWorkspace {
    val resources = initialWorkspace?.resources
    val fields = resources?.fields.orEmpty().mapNotNull { row ->
        val id = row.id?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
        WeighbridgeResourceOption(id, row.name?.trim()?.takeIf(String::isNotEmpty) ?: "Поле", row.area?.let { "$it га" })
    }
    val fieldNameById = fields.associate { it.id to it.name }
    val allocations = initialWorkspace?.harvestAllocations?.byField.orEmpty().flatMap { (fieldId, rows) ->
        rows.mapNotNull { row ->
            val allocationId = row.allocationId?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
            val cropId = row.cropId?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
            HarvestAllocationOption(
                id = allocationId,
                fieldId = fieldId,
                fieldName = fieldNameById[fieldId] ?: "Поле",
                cropId = cropId,
                cropName = row.cropName?.trim()?.takeIf(String::isNotEmpty) ?: "Культура",
                varietyId = row.varietyId,
                varietyName = row.varietyName,
                reproductionId = row.reproductionId,
                reproductionName = row.reproductionName,
                incomplete = row.isIncomplete == true,
            )
        }
    }
    return WeighbridgeWorkspace(
        shift = shift?.id?.trim()?.takeIf(String::isNotEmpty)?.let { id ->
            WeighbridgeShift(id, shift.status.orEmpty(), shift.operatorPersonId, shift.openedAt)
        },
        unlocked = unlocked == true,
        operator = operator.toDomainOperator(),
        operators = operators.orEmpty().mapNotNull(WeighbridgeOperatorDto::toDomainOperator),
        fields = fields,
        destinations = resources?.destinations.orEmpty().mapNotNull { row ->
            val id = row.id?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
            WeighbridgeResourceOption(id, row.name?.trim()?.takeIf(String::isNotEmpty) ?: "Объект", row.placeType)
        },
        vehicles = resources?.vehicles.orEmpty().mapNotNull { row ->
            val id = row.id?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
            WeighbridgeResourceOption(
                id,
                row.name?.trim()?.takeIf(String::isNotEmpty) ?: "Транспорт",
                listOf(row.plate, row.model).mapNotNull { it?.takeIf(String::isNotBlank) }.joinToString(" · ").ifBlank { null },
            )
        },
        drivers = resources?.drivers.orEmpty().mapNotNull { row ->
            val id = row.id?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
            WeighbridgeResourceOption(id, row.name?.trim()?.takeIf(String::isNotEmpty) ?: "Водитель", row.position)
        },
        allocations = allocations,
        resourceErrors = resources?.resourceErrors.orEmpty().mapNotNull { it.message?.takeIf(String::isNotBlank) },
        stationContractAvailable = false,
        localWorkstationId = localWorkstationId,
        writesEnabled = writesEnabled,
        pendingCommandCount = pendingCommandCount,
        fetchedAtEpochMillis = fetchedAtEpochMillis,
    )
}

private fun WeighbridgeOperatorDto?.toDomainOperator(): WeighbridgeOperator? {
    val dto = this ?: return null
    val id = dto.id?.trim()?.takeIf(String::isNotEmpty) ?: return null
    return WeighbridgeOperator(
        id = id,
        name = dto.name?.trim()?.takeIf(String::isNotEmpty) ?: "Весовщик",
        hasPin = dto.hasPin != false,
        pinActive = dto.pinActive != false,
        lockedUntil = dto.lockedUntil,
    )
}

internal fun TicketDto.toTicketSummary(): TicketSummary? {
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
        grossWeightKg = grossWeightKg,
        tareWeightKg = tareWeightKg,
        harvestLotId = harvestLotId,
        linkedProcessingId = linkedProcessingId,
    )
}

private fun TicketLineDto.toTicketLine(): TicketLine = TicketLine(
    productName = productName?.trim()?.takeIf(String::isNotEmpty) ?: "Не указано",
    varietyName = varietyName,
    reproductionName = reproductionName,
    quantity = quantity ?: 0.0,
    unit = uom?.trim()?.takeIf(String::isNotEmpty) ?: "kg",
    moisturePercent = moisturePercent,
    lotId = lotId,
    batchClass = batchClass,
)

internal fun KatoSearchEnvelopeDto.toKatoLocalities(): List<KatoLocality> =
    items.orEmpty().mapNotNull { row ->
        val code = row.code?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
        val name = row.nameRu?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
        KatoLocality(
            code = code,
            nameRu = name,
            nameKz = row.nameKz?.trim()?.takeIf(String::isNotEmpty),
            districtRu = row.districtRu?.trim()?.takeIf(String::isNotEmpty),
            regionRu = row.regionRu?.trim()?.takeIf(String::isNotEmpty),
        )
    }

internal fun WeatherLocationEnvelopeDto.toWeatherLocation(): WeatherLocation? = location?.toDomainLocation()

internal fun WeatherForecastEnvelopeDto.toWeatherForecast(
    fetchedAtEpochMillis: Long = System.currentTimeMillis(),
): WeatherForecast? {
    val dto = weather ?: return null
    val location = dto.location?.toDomainLocation() ?: return null
    val current = dto.current?.toDomainPoint() ?: return null
    val meta = dto.providerMeta
    return WeatherForecast(
        location = location,
        current = current,
        hourlyForecast = dto.hourlyForecast.orEmpty().mapNotNull(WeatherPointDto::toDomainPoint).take(24 * 7),
        sun = dto.sun.orEmpty().mapNotNull { row ->
            val date = row.date?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
            WeatherSun(date, row.sunrise, row.sunset)
        },
        providerMeta = WeatherProviderMeta(
            provider = meta?.provider?.trim()?.takeIf(String::isNotEmpty) ?: "UAV Forecast",
            timezone = meta?.timezone?.trim()?.takeIf(String::isNotEmpty),
            cache = meta?.cache?.trim()?.takeIf(String::isNotEmpty) ?: "unknown",
            forecastHours = meta?.forecastHours ?: dto.hourlyForecast.orEmpty().size,
        ),
        updatedAt = dto.updatedAt.orEmpty(),
        stale = dto.stale == true,
        fetchedAtEpochMillis = fetchedAtEpochMillis,
    )
}

internal fun CachedWeatherForecast.matchesScope(actorId: String, companyId: String?): Boolean =
    this.actorId == actorId && this.companyId == companyId

private fun WeatherLocationDto.toDomainLocation(): WeatherLocation? {
    val latitude = latitude?.takeIf { it.isFinite() && it in -90.0..90.0 } ?: return null
    val longitude = longitude?.takeIf { it.isFinite() && it in -180.0..180.0 } ?: return null
    return WeatherLocation(
        latitude = latitude,
        longitude = longitude,
        region = region?.trim()?.takeIf(String::isNotEmpty),
        district = district?.trim()?.takeIf(String::isNotEmpty),
        locality = locality?.trim()?.takeIf(String::isNotEmpty),
        displayName = displayName?.trim()?.takeIf(String::isNotEmpty)
            ?: "$latitude, $longitude",
        katoCode = katoCode?.trim()?.takeIf(String::isNotEmpty),
    )
}

private fun WeatherPointDto.toDomainPoint(): WeatherPoint? {
    val time = time?.trim()?.takeIf(String::isNotEmpty) ?: return null
    return WeatherPoint(
        time = time,
        temperatureC = temperatureC,
        dewPointC = dewPointC,
        windMs = windMs,
        gustMs = gustMs,
        precipitationProbabilityPct = precipitationProbabilityPct,
        precipitationRateMmH = precipitationRateMmH,
        precipitationType = precipitationType,
        cloudCoverPct = cloudCoverPct,
        visibilityKm = visibilityKm,
        humidityPct = humidityPct,
        pressureMslHpa = pressureMslHpa,
    )
}

internal fun List<UserNotificationDto>.toNotificationCenter(
    expectedActorId: String,
    expectedCompanyId: String?,
    fetchedAtEpochMillis: Long = System.currentTimeMillis(),
): NotificationCenterData {
    val notifications = mapNotNull { row ->
        val id = row.id?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
        val companyId = row.companyId?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
        val recipientId = row.recipientUserId?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
        if (recipientId != expectedActorId || (expectedCompanyId != null && companyId != expectedCompanyId)) {
            return@mapNotNull null
        }
        val title = row.title?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
        val createdAt = row.createdAt?.trim()?.takeIf(String::isNotEmpty) ?: return@mapNotNull null
        UserNotification(
            id = id,
            companyId = companyId,
            recipientUserId = recipientId,
            category = row.category?.trim()?.takeIf(String::isNotEmpty) ?: "system",
            eventType = row.eventType?.trim()?.takeIf(String::isNotEmpty) ?: "unknown",
            title = title,
            body = row.body?.trim()?.takeIf(String::isNotEmpty),
            href = row.href?.trim()?.takeIf { it.startsWith('/') } ?: "/notifications",
            entityType = row.entityType?.trim()?.takeIf(String::isNotEmpty),
            entityId = row.entityId?.trim()?.takeIf(String::isNotEmpty),
            readAt = row.readAt,
            createdAt = createdAt,
        )
    }
    return NotificationCenterData(
        notifications = notifications,
        unreadCount = notifications.count { it.readAt.isNullOrBlank() },
        fetchedAtEpochMillis = fetchedAtEpochMillis,
    )
}

internal fun CachedNotificationCenter.matchesScope(actorId: String, companyId: String?): Boolean =
    this.actorId == actorId && this.companyId == companyId
