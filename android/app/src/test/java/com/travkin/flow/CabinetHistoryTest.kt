package com.travkin.flow

import com.google.gson.JsonArray
import com.google.gson.JsonParser
import com.travkin.flow.data.*
import com.travkin.flow.domain.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class CabinetHistoryTest {
    private fun json(value: String) = JsonParser.parseString(value).asJsonObject
    @Test fun `custom harvest period uses Qyzylorda not device timezone`() {
        val params = harvestFilterParameters(HarvestFilters(start = "2026-09-04 07:00", end = "2026-09-04 19:00"), true)
        assertEquals("2026-09-04T02:00:00Z", params["start"])
        assertEquals("2026-09-04T14:00:00Z", params["end"])
    }
    @Test fun `invalid reversed custom period rejected`() {
        assertThrows(IllegalArgumentException::class.java) { harvestFilterParameters(HarvestFilters(start = "2026-09-04 19:00", end = "2026-09-04 07:00"), true) }
    }
    @Test fun `normal period never leaks stale custom range`() {
        assertEquals(mapOf("cropId" to "crop"), harvestFilterParameters(HarvestFilters(cropId = "crop", start = "bad", end = "bad"), false))
    }
    @Test fun `historical crop drilldown retains season and forbids editor`() {
        val data = json("""{"fields":[{"id":"field","area":20}],"cropStructure":[],"activeSeasonId":"current","seasons":[{"id":"current","year":2026},{"id":"old","year":2025,"archived":true}]}""")
        val query = CabinetQuery(CabinetSection.CROPS, seasonId = "old")
        val list = mapCabinet(query, data)
        val target = list.groups.first().cards.first().destination!!
        assertEquals("old", target.seasonId)
        assertNull(mapCabinet(target, data).cropEditor)
        assertTrue(list.seasons.first { it.id == "old" }.active)
    }
    @Test fun `operation plan prioritizes lines then config not nonexistent scalar`() {
        assertEquals(13.0, plannedOperationArea(json("""{"operation_config":{"planned_area_ha":100},"operation_lines":[{"planned_area_ha":6},{"planned_area_ha":7}]}"""))!!, 0.0)
        assertEquals(100.0, plannedOperationArea(json("""{"operation_config":{"planned_area_ha":100},"operation_lines":[]}"""))!!, 0.0)
        assertNull(plannedOperationArea(json("""{}""")))
    }
    @Test fun `explicit zero completed overrides operation line history`() {
        assertEquals(0.0, actualOperationArea(json("""{"completed_area_ha":0,"operation_lines":[{"actual_area_ha":10}]}"""))!!, 0.0)
        assertNull(actualOperationArea(json("""{"operation_lines":[]}""")))
    }
    @Test fun `pagination requests beyond exact full page and keeps all rows`() = runBlocking {
        val offsets = mutableListOf<Int>()
        val result = readAllPages(pageSize = 2) { offset ->
            offsets += offset
            JsonArray().apply { if (offset < 4) { add(json("""{"id":"$offset"}""")); add(json("""{"id":"${offset+1}"}""")) } }
        }
        assertEquals(listOf(0, 2, 4), offsets)
        assertEquals(4, result.size())
    }
    @Test fun `missing harvest party fails rather than showing a different one`() {
        assertThrows(UserFacingException::class.java) { mapCabinet(CabinetQuery(partyKey = "gone"), json("""{"parties":[{"key":"other"}]}""")) }
    }
}
