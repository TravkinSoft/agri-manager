package com.travkin.flow

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.travkin.flow.data.*
import com.travkin.flow.domain.*
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class CabinetParityTest {
    private fun json(value: String) = JsonParser.parseString(value).asJsonObject
    private fun ticket(extra: String = "") = json("""{"id":"id","op_type":"harvest_incoming","status":"finalized","is_finalized":true $extra} """)

    @Test fun `visible sections use current site names and owner scope`() {
        assertEquals(listOf("/dashboard", "/crop-structure", "/warehouses", "/weather-lab"), CabinetSection.entries.filter { it.primary }.map { it.webPath })
    }
    @Test fun `admin and station links never become native routes`() {
        listOf("/platform", "/weighbridge", "/users", "/fields-map", "/assistant", "/traffic-operator", "/tickets", "/traffic", null).forEach { assertNull(CabinetSection.fromPath(it)) }
    }
    @Test fun `older request loses permission to commit`() {
        val gate = RequestGeneration()
        val first = gate.next()
        assertTrue(gate.isCurrent(first))
        val second = gate.next()
        assertFalse(gate.isCurrent(first))
        assertTrue(gate.isCurrent(second))
        gate.next()
        assertFalse(gate.isCurrent(second))
    }
    @Test fun `missing numeric value is not a fabricated zero`() {
        assertEquals("Не указано", quantity(null))
        assertEquals("0 кг", quantity(0.0, " кг"))
    }
    @Test fun `nonfinite metric is unknown`() {
        assertNull(json("""{"value":"NaN"}""").number("value"))
        assertNull(json("""{"value":"Infinity"}""").number("value"))
    }
    @Test fun `missing required array is an error not an empty successful screen`() {
        assertThrows(UserFacingException::class.java) { mapCabinet(CabinetQuery(CabinetSection.CROPS), JsonObject()) }
        assertThrows(UserFacingException::class.java) { mapCabinet(CabinetQuery(CabinetSection.TICKETS), JsonObject()) }
        assertThrows(UserFacingException::class.java) { mapCabinet(CabinetQuery(CabinetSection.WAREHOUSES), JsonObject()) }
    }
    @Test fun `genuinely empty page remains empty`() {
        assertTrue(mapCabinet(CabinetQuery(CabinetSection.TICKETS), json("""{"tickets":[]}""")).groups.all { it.cards.isEmpty() })
    }
    @Test fun `finalized status alone is not canonical finalized harvest`() {
        assertFalse(isFinalizedHarvest(json("""{"op_type":"harvest_incoming","status":"finalized"}""")))
        assertTrue(isFinalizedHarvest(ticket()))
    }
    @Test fun `replaced and voided tickets excluded from effective harvest`() {
        assertFalse(isFinalizedHarvest(ticket(",\"is_voided\":true")))
        assertFalse(isFinalizedHarvest(ticket(",\"replacement_ticket_id\":\"replacement\"")))
    }
    @Test fun `open harvest uses website predicate`() {
        listOf("draft", "active", "ready_to_close").forEach {
            assertTrue(isOpenHarvest(json("""{"op_type":"harvest_incoming","status":"$it"}""")))
        }
        assertFalse(isOpenHarvest(ticket()))
        assertFalse(isOpenHarvest(json("""{"op_type":"shipment_outgoing","status":"active"}""")))
    }
    @Test fun `today for paper tickets uses trip date rather than later finalization`() {
        val t = ticket(",\"created_at\":\"2026-09-03T12:00:00Z\",\"finalized_at\":\"2026-09-04T12:00:00Z\",\"external_document_no\":\"123\"")
        assertTrue(ticketMatches(t, "today", LocalDate.parse("2026-09-03"), ZoneId.of("Asia/Qyzylorda")))
        assertFalse(ticketMatches(t, "today", LocalDate.parse("2026-09-04"), ZoneId.of("Asia/Qyzylorda")))
    }
    @Test fun `today for electronic tickets uses finalized date`() {
        val t = ticket(",\"created_at\":\"2026-09-03T12:00:00Z\",\"finalized_at\":\"2026-09-04T12:00:00Z\"")
        assertTrue(ticketMatches(t, "today", LocalDate.parse("2026-09-04"), ZoneId.of("Asia/Qyzylorda")))
    }
    @Test fun `history keeps void evidence but rejects nonharvest`() {
        assertTrue(ticketMatches(ticket(",\"is_voided\":true"), "history"))
        assertFalse(ticketMatches(json("""{"op_type":"shipment_outgoing"}"""), "history"))
    }
    @Test fun `unknown ticket filter fails closed`() { assertFalse(ticketMatches(ticket(), "all-admin")) }
    @Test fun `deferred ticket page has no dashboard drilldown`() {
        assertNull(summaryTicketCard(json("""{"ticketId":"ticket","ticketNo":"7"}"""), 0).destination)
    }
    @Test fun `field identity supports crop mix and fallow`() {
        val catalog = json("""{"crops":[{"id":"c1","name_ru":"Пшеница"},{"id":"c2","name_ru":"Горох"}],"varieties":[{"id":"v1","name":"Сорт 1"}]}""")
        assertEquals("Пар", cropIdentity(json("""{"land_use_type":"fallow"}"""), catalog))
        assertEquals("Зерносмесь: Пшеница + Горох", cropIdentity(json("""{"land_use_type":"crop_mix","mix_components":[{"crop_id":"c1"},{"crop_id":"c2"}]}"""), catalog))
        assertEquals("Пшеница · Сорт 1", cropIdentity(json("""{"crop_id":"c1","variety_id":"v1"}"""), catalog))
    }
    @Test fun `no active season displays real field without invented crop`() {
        val page = mapCabinet(CabinetQuery(CabinetSection.CROPS), json("""{"fields":[{"id":"f1","name":"Поле 1","area":12}],"cropStructure":[],"seasons":[],"activeSeasonId":null}"""))
        assertTrue(page.notice!!.contains("Нет активного сезона"))
        assertEquals("Структура не заполнена", page.groups.single().cards.single().subtitle)
    }
    @Test fun `traffic requires manager response`() {
        assertThrows(UserFacingException::class.java) { mapCabinet(CabinetQuery(CabinetSection.TRAFFIC), json("""{"snapshot":{"role":"receiver","vehicles":[]}}""")) }
    }
    @Test fun `traffic groups assigned vehicles only`() {
        val page = mapCabinet(CabinetQuery(CabinetSection.TRAFFIC), json("""{"snapshot":{"role":"manager","enabled":true,"vehicles":[{"vehicle_id":"v1","name":"Машина","assigned":true,"state":"loaded"},{"vehicle_id":"v2","assigned":false,"state":"loaded"}],"events":[]}}"""))
        assertEquals(1, page.groups.sumOf { it.cards.size })
        assertEquals("loaded", page.groups[1].cards.single().tone)
    }
    @Test fun `stock response cannot silently show different warehouse`() {
        assertThrows(UserFacingException::class.java) { stockPage(json("""{"details":{"warehouse_id":"other","product_id":"p1"}}"""), CabinetQuery(CabinetSection.WAREHOUSES, warehouseId = "w1", productId = "p1")) }
    }
    @Test fun `weather locality links preserve verified code`() {
        val page = mapCabinet(CabinetQuery(CabinetSection.WEATHER), json("""{"items":[{"code":"123","nameRu":"Караагаш"}]}"""))
        assertEquals("123", page.groups.single().cards.single().destination!!.localityCode)
    }
}
