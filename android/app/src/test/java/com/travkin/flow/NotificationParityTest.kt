package com.travkin.flow

import com.google.gson.JsonParser
import com.travkin.flow.data.*
import com.travkin.flow.domain.*
import org.junit.Assert.*
import org.junit.Test

class NotificationParityTest {
    @Test fun `only allowed relative role routes open`() {
        listOf("https://evil.test/tickets", "//evil.test/tickets", "/\\evil.test/tickets", "/users", "/traffic-operator", "/weighbridge", "javascript:alert(1)", "/%2f%2fevil.test").forEach { assertNull(notificationDestination(it)) }
        assertEquals(CabinetSection.TICKETS, notificationDestination("/tickets?ignored=true")!!.section)
        assertEquals(CabinetSection.SETTINGS, notificationDestination("/settings")!!.section)
    }
    @Test fun `incomplete preference response is not guessed from defaults`() {
        assertThrows(UserFacingException::class.java) { notificationPreferences(JsonParser.parseString("{}").asJsonObject) }
    }
    @Test fun `nonmobile settings preserved when updating account notifications`() {
        val preferences = NotificationPreferences(false, true, false, true, false, "weekly")
        val body = preferencesBody(preferences, "company")
        assertEquals("false", body.get("proactive_assist_enabled").asString)
        assertEquals("weekly", body.get("proactive_assist_cadence").asString)
        assertFalse(body.has("profile_id"))
        assertEquals(preferences, notificationPreferences(body))
    }
    @Test fun `non-agronomist notification category is excluded`() {
        val page = notificationPage(JsonParser.parseString("""{"notifications":[{"id":"x","category":"assistant"},{"id":"y","category":"operation","href":"/crop-structure"}]}""").asJsonObject)
        assertEquals(listOf("y"), page.notifications!!.map { it.id })
    }
}
