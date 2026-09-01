package com.travkin.flow

import com.travkin.flow.data.CountersDto
import com.travkin.flow.data.HarvestAggregateDto
import com.travkin.flow.data.HarvestSummaryDto
import com.travkin.flow.data.OperationalBootstrapDto
import com.travkin.flow.data.ShiftDto
import com.travkin.flow.data.ShiftGuardDto
import com.travkin.flow.data.ShiftSummaryDto
import com.travkin.flow.data.TicketDetailEnvelopeDto
import com.travkin.flow.data.TicketDto
import com.travkin.flow.data.TicketLineDto
import com.travkin.flow.data.TicketPageDto
import com.travkin.flow.data.matchesScope
import com.travkin.flow.data.toOperationalOverview
import com.travkin.flow.data.toTicketDetails
import com.travkin.flow.data.toTicketPage
import com.travkin.flow.domain.CachedOverview
import com.travkin.flow.domain.OperationalOverview
import com.travkin.flow.domain.SupportedRole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

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
                ),
            ),
        ).toTicketDetails()

        requireNotNull(mapped)
        assertEquals(15_000.0, mapped.grossWeightKg ?: 0.0, 0.0)
        assertEquals(5_000.0, mapped.tareWeightKg ?: 0.0, 0.0)
        assertEquals("Пшеница", mapped.lines.single().productName)
        assertEquals(12.5, mapped.lines.single().moisturePercent ?: 0.0, 0.0)
    }
}
