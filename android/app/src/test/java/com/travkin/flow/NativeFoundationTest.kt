package com.travkin.flow

import com.travkin.flow.data.CountersDto
import com.travkin.flow.data.HarvestAggregateDto
import com.travkin.flow.data.HarvestSummaryDto
import com.travkin.flow.data.OperationalBootstrapDto
import com.travkin.flow.data.ShiftDto
import com.travkin.flow.data.ShiftGuardDto
import com.travkin.flow.data.ShiftSummaryDto
import com.travkin.flow.data.matchesScope
import com.travkin.flow.data.toOperationalOverview
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
}
