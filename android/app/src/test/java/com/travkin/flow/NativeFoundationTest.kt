package com.travkin.flow

import com.travkin.flow.data.CountersDto
import com.travkin.flow.data.HarvestAggregateDto
import com.travkin.flow.data.HarvestCropTotalDto
import com.travkin.flow.data.HarvestFieldSummaryDto
import com.travkin.flow.data.HarvestIssueDto
import com.travkin.flow.data.HarvestMoistureSummaryDto
import com.travkin.flow.data.HarvestOverviewDto
import com.travkin.flow.data.HarvestPeriodDto
import com.travkin.flow.data.HarvestSummaryDto
import com.travkin.flow.data.OperationalBootstrapDto
import com.travkin.flow.data.OperatorStateDto
import com.travkin.flow.data.InitialWeighbridgeWorkspaceDto
import com.travkin.flow.data.KatoLocalityDto
import com.travkin.flow.data.KatoSearchEnvelopeDto
import com.travkin.flow.data.HarvestAllocationDto
import com.travkin.flow.data.HarvestAllocationsDto
import com.travkin.flow.data.ResourceOptionDto
import com.travkin.flow.data.ShiftDto
import com.travkin.flow.data.ShiftGuardDto
import com.travkin.flow.data.ShiftSummaryDto
import com.travkin.flow.data.TicketDetailEnvelopeDto
import com.travkin.flow.data.TicketDto
import com.travkin.flow.data.TicketLineDto
import com.travkin.flow.data.TicketPageDto
import com.travkin.flow.data.WarehouseDto
import com.travkin.flow.data.WarehouseSummariesEnvelopeDto
import com.travkin.flow.data.WarehouseSummaryDto
import com.travkin.flow.data.WeighbridgeResourcesDto
import com.travkin.flow.data.WeighbridgeShiftDto
import com.travkin.flow.data.WeatherForecastDto
import com.travkin.flow.data.WeatherForecastEnvelopeDto
import com.travkin.flow.data.WeatherLocationDto
import com.travkin.flow.data.WeatherPointDto
import com.travkin.flow.data.WeatherProviderMetaDto
import com.travkin.flow.data.WeatherSunDto
import com.travkin.flow.data.UserNotificationDto
import com.travkin.flow.data.matchesScope
import com.travkin.flow.data.isSameSecureOrigin
import com.travkin.flow.data.toOperationalOverview
import com.travkin.flow.data.toHarvestOverview
import com.travkin.flow.data.toTicketDetails
import com.travkin.flow.data.toTicketPage
import com.travkin.flow.data.toWarehouseOverview
import com.travkin.flow.data.toWeighbridgeWorkspace
import com.travkin.flow.data.toKatoLocalities
import com.travkin.flow.data.toWeatherForecast
import com.travkin.flow.data.toNotificationCenter
import com.travkin.flow.domain.CachedOverview
import com.travkin.flow.domain.OperationalOverview
import com.travkin.flow.domain.SupportedRole
import com.travkin.flow.domain.WeighbridgeWritePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import okhttp3.HttpUrl.Companion.toHttpUrl

class NativeFoundationTest {
    @Test
    fun `only approved roles are accepted`() {
        assertEquals(SupportedRole.GLOBAL_ADMIN, SupportedRole.fromWire("global_admin"))
        assertEquals(SupportedRole.COMPANY_ADMIN, SupportedRole.fromWire("company_admin"))
        assertEquals(SupportedRole.AGRONOMIST, SupportedRole.fromWire("agronomist"))
        assertEquals(SupportedRole.WEIGHMAN, SupportedRole.fromWire("WEIGHMAN"))
        assertEquals(SupportedRole.SPECIALIST, SupportedRole.fromWire(" specialist "))
        assertNull(SupportedRole.fromWire("warehouse"))
        assertNull(SupportedRole.fromWire("director"))
        assertNull(SupportedRole.fromWire("unknown"))
        assertTrue(SupportedRole.GLOBAL_ADMIN.canViewHarvest)
        assertTrue(SupportedRole.COMPANY_ADMIN.canViewHarvest)
        assertTrue(SupportedRole.AGRONOMIST.canViewHarvest)
        assertFalse(SupportedRole.WEIGHMAN.canViewHarvest)
        assertFalse(SupportedRole.SPECIALIST.canViewHarvest)
        assertTrue(SupportedRole.GLOBAL_ADMIN.canViewWarehouses)
        assertTrue(SupportedRole.COMPANY_ADMIN.canViewWarehouses)
        assertTrue(SupportedRole.AGRONOMIST.canViewWarehouses)
        assertTrue(SupportedRole.WEIGHMAN.canViewWarehouses)
        assertFalse(SupportedRole.SPECIALIST.canViewWarehouses)
        assertTrue(SupportedRole.GLOBAL_ADMIN.canUseWeighbridgeWorkspace)
        assertTrue(SupportedRole.COMPANY_ADMIN.canUseWeighbridgeWorkspace)
        assertTrue(SupportedRole.WEIGHMAN.canUseWeighbridgeWorkspace)
        assertFalse(SupportedRole.AGRONOMIST.canUseWeighbridgeWorkspace)
        assertFalse(SupportedRole.SPECIALIST.canUseWeighbridgeWorkspace)
        assertTrue(SupportedRole.GLOBAL_ADMIN.canViewWeather)
        assertTrue(SupportedRole.AGRONOMIST.canViewWeather)
        assertFalse(SupportedRole.COMPANY_ADMIN.canViewWeather)
        assertFalse(SupportedRole.WEIGHMAN.canViewWeather)
        assertFalse(SupportedRole.SPECIALIST.canViewWeather)
    }

    @Test
    fun `weighbridge write policy is qa only and role limited`() {
        assertTrue(
            WeighbridgeWritePolicy.isAllowed(
                enabled = true,
                appChannel = "qa",
                baseUrl = "https://qa.travkinflow.com/",
                role = SupportedRole.WEIGHMAN,
            ),
        )
        assertFalse(WeighbridgeWritePolicy.isAllowed(true, "release", "https://travkinflow.com", SupportedRole.WEIGHMAN))
        assertFalse(WeighbridgeWritePolicy.isAllowed(true, "qa", "https://travkinflow.com", SupportedRole.WEIGHMAN))
        assertFalse(WeighbridgeWritePolicy.isAllowed(false, "qa", "https://qa.travkinflow.com", SupportedRole.WEIGHMAN))
        assertFalse(WeighbridgeWritePolicy.isAllowed(true, "qa", "https://qa.travkinflow.com", SupportedRole.AGRONOMIST))
        assertFalse(WeighbridgeWritePolicy.isAllowed(true, "qa", "https://qa.travkinflow.com", SupportedRole.SPECIALIST))
    }

    @Test
    fun `operator cookie origin never crosses into auth host`() {
        val qaOrigin = "https://qa.travkinflow.com".toHttpUrl()
        assertTrue(isSameSecureOrigin("https://qa.travkinflow.com/api/weighbridge/operator-session".toHttpUrl(), qaOrigin))
        assertFalse(isSameSecureOrigin("https://example.supabase.co/auth/v1/token".toHttpUrl(), qaOrigin))
        assertFalse(isSameSecureOrigin("http://qa.travkinflow.com/api/weighbridge/operator-session".toHttpUrl(), qaOrigin))
    }

    @Test
    fun `weather read only responses map validated KATO and forecast`() {
        val localities = KatoSearchEnvelopeDto(
            items = listOf(
                KatoLocalityDto("123", "Астана", "Астана", "Астана Г.А.", "Астана"),
                KatoLocalityDto(null, "broken", null, null, null),
            ),
        ).toKatoLocalities()
        assertEquals(1, localities.size)
        assertEquals("123", localities.single().code)

        val point = WeatherPointDto(
            time = "2026-09-02T12:00:00Z",
            temperatureC = 24.5,
            dewPointC = 10.0,
            windMs = 3.2,
            gustMs = 5.5,
            precipitationProbabilityPct = 20.0,
            precipitationRateMmH = 0.0,
            precipitationType = null,
            cloudCoverPct = 30.0,
            visibilityKm = 10.0,
            humidityPct = 45.0,
            pressureMslHpa = 1012.0,
        )
        val mapped = WeatherForecastEnvelopeDto(
            weather = WeatherForecastDto(
                location = WeatherLocationDto(51.1694, 71.4491, "Астана", null, "Астана", "Астана", "123"),
                current = point,
                hourlyForecast = listOf(point),
                sun = listOf(WeatherSunDto("2026-09-02", "2026-09-02T01:00:00Z", "2026-09-02T14:00:00Z")),
                providerMeta = WeatherProviderMetaDto("UAV Forecast", "Asia/Almaty", "hit", 168),
                updatedAt = "2026-09-02T12:00:00Z",
                stale = false,
            ),
        ).toWeatherForecast(fetchedAtEpochMillis = 222L)

        requireNotNull(mapped)
        assertEquals("Астана", mapped.location.displayName)
        assertEquals(24.5, mapped.current.temperatureC ?: 0.0, 0.0)
        assertEquals(1, mapped.hourlyForecast.size)
        assertEquals("Asia/Almaty", mapped.providerMeta.timezone)
        assertEquals(222L, mapped.fetchedAtEpochMillis)
    }

    @Test
    fun `notification center rejects cross actor and cross company rows`() {
        val center = listOf(
            UserNotificationDto(
                id = "notification-1",
                companyId = "company-1",
                recipientUserId = "actor-1",
                category = "operation",
                eventType = "operation_started",
                title = "Операция начата",
                body = "Поле 1",
                href = "/operations/1",
                entityType = "operation",
                entityId = "operation-1",
                readAt = null,
                createdAt = "2026-09-02T12:00:00Z",
            ),
            UserNotificationDto(
                id = "notification-2",
                companyId = "company-1",
                recipientUserId = "actor-other",
                category = "system",
                eventType = "ignored",
                title = "Чужое",
                body = null,
                href = "/notifications",
                entityType = null,
                entityId = null,
                readAt = null,
                createdAt = "2026-09-02T12:01:00Z",
            ),
            UserNotificationDto(
                id = "notification-3",
                companyId = "company-other",
                recipientUserId = "actor-1",
                category = "system",
                eventType = "ignored",
                title = "Другая компания",
                body = null,
                href = "/notifications",
                entityType = null,
                entityId = null,
                readAt = null,
                createdAt = "2026-09-02T12:02:00Z",
            ),
        ).toNotificationCenter(
            expectedActorId = "actor-1",
            expectedCompanyId = "company-1",
            fetchedAtEpochMillis = 333L,
        )

        assertEquals(1, center.notifications.size)
        assertEquals("notification-1", center.notifications.single().id)
        assertEquals(1, center.unreadCount)
        assertEquals(333L, center.fetchedAtEpochMillis)
    }

    @Test
    fun `weighbridge workspace maps resources but fails closed without station contract`() {
        val mapped = OperatorStateDto(
            shift = WeighbridgeShiftDto("shift-1", "open", "person-1", "2026-09-02T08:00:00Z"),
            unlocked = true,
            sessionExpiresAt = null,
            operator = null,
            operators = emptyList(),
            unconfiguredOperatorCount = 0,
            initialWorkspace = InitialWeighbridgeWorkspaceDto(
                resources = WeighbridgeResourcesDto(
                    fields = listOf(ResourceOptionDto("field-1", "Поле 1", 100.0, null, null)),
                    destinations = listOf(ResourceOptionDto("warehouse-1", "Ток", null, "universal", "yard")),
                    vehicles = emptyList(),
                    drivers = emptyList(),
                    resourceErrors = emptyList(),
                ),
                harvestAllocations = HarvestAllocationsDto(
                    seasonId = "season-1",
                    seasonYear = 2026,
                    byField = mapOf(
                        "field-1" to listOf(
                            HarvestAllocationDto(
                                allocationId = "allocation-1",
                                areaHa = 100.0,
                                cropId = "crop-1",
                                cropName = "Пшеница",
                                varietyId = null,
                                varietyName = null,
                                reproductionId = null,
                                reproductionName = null,
                                isIncomplete = false,
                            ),
                        ),
                    ),
                    incompleteByField = emptyMap(),
                ),
            ),
        ).toWeighbridgeWorkspace(
            localWorkstationId = "native-device-1",
            writesEnabled = true,
            pendingCommandCount = 2,
            fetchedAtEpochMillis = 111L,
        )

        assertEquals("shift-1", mapped.shift?.id)
        assertEquals("Поле 1", mapped.allocations.single().fieldName)
        assertEquals("Пшеница", mapped.allocations.single().cropName)
        assertEquals("Ток", mapped.destinations.single().name)
        assertEquals(2, mapped.pendingCommandCount)
        assertFalse(mapped.stationContractAvailable)
    }

    @Test
    fun `operational bootstrap maps to stable domain model`() {
        val mapped = OperationalBootstrapDto(
            shift = ShiftDto("shift-1", "open"),
            shiftGuard = ShiftGuardDto(stale = false),
            harvestSummary = HarvestSummaryDto(HarvestAggregateDto(netKg = 12_500.0, cleanMassKg = null, totalKg = null)),
            shiftSummary = ShiftSummaryDto(trips = 7, netKg = 11_000.0, open = 1, voided = 0, manualCorrections = 2),
            counters = CountersDto(activeTickets = 1, stuckTickets = 2, unsynced = 3, requiresReview = 4, manualCorrections = 5),
        ).toOperationalOverview(fetchedAtEpochMillis = 123L)

        assertTrue(mapped.shiftOpen)
        assertEquals(7, mapped.shiftTrips)
        assertEquals(12_500.0, mapped.harvestedTodayKg, 0.0)
        assertEquals(5, mapped.manualCorrections)
        assertEquals(123L, mapped.fetchedAtEpochMillis)
    }

    @Test
    fun `cache cannot cross actor or company scope`() {
        val overview = OperationalOverview(false, false, 0, 0.0, 0, 0, 0, 0, 0, 0.0, 1L)
        val cached = CachedOverview("actor-a", "company-a", overview)

        assertTrue(cached.matchesScope("actor-a", "company-a"))
        assertFalse(cached.matchesScope("actor-b", "company-a"))
        assertFalse(cached.matchesScope("actor-a", "company-b"))
    }

    @Test
    fun `ticket page maps only identified tickets and preserves server window`() {
        val mapped = TicketPageDto(
            tickets = listOf(
                TicketDto(
                    id = "ticket-1",
                    ticketNo = "WB-001",
                    operationType = "harvest_incoming",
                    direction = "incoming",
                    status = "active",
                    createdAt = "2026-09-02T08:00:00Z",
                    companyName = "Астык",
                    fieldName = "Поле 7",
                    vehicleName = "КамАЗ",
                    vehiclePlate = "123ABC",
                    driverName = "Водитель",
                    warehouseFrom = null,
                    warehouseTo = "Ток",
                    supplierName = null,
                    buyerName = null,
                    destinationText = null,
                    grossWeightKg = 12_500.0,
                    tareWeightKg = 4_500.0,
                    netWeightKg = 8_000.0,
                    physicalNetKg = 7_950.0,
                    requiresReview = true,
                    notes = null,
                    lines = null,
                    harvestLotId = "lot-1",
                    linkedProcessingId = "processing-1",
                ),
                TicketDto(
                    id = null,
                    ticketNo = "broken",
                    operationType = null,
                    direction = null,
                    status = null,
                    createdAt = null,
                    companyName = null,
                    fieldName = null,
                    vehicleName = null,
                    vehiclePlate = null,
                    driverName = null,
                    warehouseFrom = null,
                    warehouseTo = null,
                    supplierName = null,
                    buyerName = null,
                    destinationText = null,
                    grossWeightKg = null,
                    tareWeightKg = null,
                    netWeightKg = null,
                    physicalNetKg = null,
                    requiresReview = null,
                    notes = null,
                    lines = null,
                ),
            ),
            historyHasMore = true,
        ).toTicketPage(historyLimit = 20, fetchedAtEpochMillis = 456L)

        assertEquals(1, mapped.tickets.size)
        assertEquals("ticket-1", mapped.tickets.single().id)
        assertEquals(7_950.0, mapped.tickets.single().netWeightKg ?: 0.0, 0.0)
        assertTrue(mapped.tickets.single().requiresReview)
        assertEquals(12_500.0, mapped.tickets.single().grossWeightKg ?: 0.0, 0.0)
        assertEquals("lot-1", mapped.tickets.single().harvestLotId)
        assertEquals("processing-1", mapped.tickets.single().linkedProcessingId)
        assertTrue(mapped.historyHasMore)
        assertEquals(20, mapped.historyLimit)
        assertEquals(456L, mapped.fetchedAtEpochMillis)
    }

    @Test
    fun `ticket details map read only lines and weights`() {
        val ticket = TicketDto(
            id = "ticket-2",
            ticketNo = "WB-002",
            operationType = "supplier_receipt",
            direction = "incoming",
            status = "finalized",
            createdAt = "2026-09-02T09:00:00Z",
            companyName = "Астык",
            fieldName = null,
            vehicleName = "MAN",
            vehiclePlate = "777AAA",
            driverName = "Иван",
            warehouseFrom = null,
            warehouseTo = "Склад 1",
            supplierName = "Поставщик",
            buyerName = null,
            destinationText = null,
            grossWeightKg = 15_000.0,
            tareWeightKg = 5_000.0,
            netWeightKg = 10_000.0,
            physicalNetKg = null,
            requiresReview = false,
            notes = "Без замечаний",
            lines = null,
        )
        val mapped = TicketDetailEnvelopeDto(
            ticket = ticket,
            lines = listOf(
                TicketLineDto(
                    productName = "Пшеница",
                    varietyName = "Омская",
                    reproductionName = "Элита",
                    quantity = 10_000.0,
                    uom = "kg",
                    moisturePercent = 12.5,
                    lotId = "lot-line-1",
                    batchClass = "food",
                ),
            ),
        ).toTicketDetails()

        requireNotNull(mapped)
        assertEquals(15_000.0, mapped.grossWeightKg ?: 0.0, 0.0)
        assertEquals(5_000.0, mapped.tareWeightKg ?: 0.0, 0.0)
        assertEquals("Пшеница", mapped.lines.single().productName)
        assertEquals(12.5, mapped.lines.single().moisturePercent ?: 0.0, 0.0)
        assertEquals("lot-line-1", mapped.lines.single().lotId)
        assertEquals("food", mapped.lines.single().batchClass)
    }

    @Test
    fun `harvest overview maps compact read only sections`() {
        val mapped = HarvestOverviewDto(
            period = HarvestPeriodDto("02.09.2026 07:00 — сейчас", null, null),
            completedTripCount = 4,
            openTicketCount = 1,
            cropTotals = listOf(HarvestCropTotalDto("wheat", "Пшеница", 20_000.0, 4)),
            fields = listOf(
                HarvestFieldSummaryDto(
                    key = "field-1",
                    fieldName = "Поле 1",
                    identityLabel = "Пшеница / Омская",
                    destinationName = "Ток",
                    receivedKg = 20_000.0,
                    trips = 4,
                    lastTripAt = "2026-09-02T10:00:00Z",
                ),
            ),
            moisture = listOf(
                HarvestMoistureSummaryDto("moisture-1", "Поле 1", "Пшеница", 13.0, 12.5, 3, 4),
            ),
            issues = listOf(HarvestIssueDto("issue-1", "Нет влажности", "Один рейс без замера")),
        ).toHarvestOverview(fetchedAtEpochMillis = 789L)

        assertEquals(4, mapped.completedTripCount)
        assertEquals(1, mapped.openTicketCount)
        assertEquals(20_000.0, mapped.cropTotals.single().receivedKg, 0.0)
        assertEquals("Поле 1", mapped.fields.single().fieldName)
        assertEquals(12.5, mapped.moisture.single().averagePercent, 0.0)
        assertEquals("Нет влажности", mapped.issues.single().title)
        assertEquals(789L, mapped.fetchedAtEpochMillis)
    }

    @Test
    fun `warehouse summaries map only identified objects and confirmed balances`() {
        val mapped = WarehouseSummariesEnvelopeDto(
            summaries = listOf(
                WarehouseSummaryDto(
                    warehouse = WarehouseDto(
                        id = "warehouse-1",
                        name = "Главный ток",
                        placeType = "yard",
                        warehouseType = "universal",
                        capacityValue = 5_000.0,
                        capacityUnit = "t",
                        location = "Север",
                        description = "Приём урожая",
                    ),
                    positionCount = 3,
                    harvestLotCount = 2,
                    harvestWeightKg = 12_000.0,
                    totalWeightKg = 15_000.0,
                    seedWeightKg = 1_000.0,
                    otherMaterialWeightKg = 2_000.0,
                    lastMovementAt = "2026-09-02T11:00:00Z",
                ),
                WarehouseSummaryDto(
                    warehouse = WarehouseDto(null, "broken", null, null, null, null, null, null),
                    positionCount = null,
                    harvestLotCount = null,
                    harvestWeightKg = null,
                    totalWeightKg = null,
                    seedWeightKg = null,
                    otherMaterialWeightKg = null,
                    lastMovementAt = null,
                ),
            ),
        ).toWarehouseOverview(fetchedAtEpochMillis = 987L)

        assertEquals(1, mapped.objects.size)
        assertEquals("warehouse-1", mapped.objects.single().id)
        assertEquals("YARD", mapped.objects.single().placeType)
        assertEquals(3, mapped.objects.single().positionCount)
        assertEquals(15_000.0, mapped.objects.single().totalWeightKg, 0.0)
        assertEquals(987L, mapped.fetchedAtEpochMillis)
    }
}
