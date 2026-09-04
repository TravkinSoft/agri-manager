package com.travkin.flow

import com.google.gson.JsonParser
import com.travkin.flow.data.*
import com.travkin.flow.domain.*
import org.junit.Assert.*
import org.junit.Test

class DriverAssignmentTest {
    private val context = DriverAssignment("company", "vehicle", "Машина", "001", "old-assignment", "old-person", "Было", true, listOf(CatalogOption("next", "Новый водитель")))
    @Test fun `driver command includes exact compare-and-set token`() {
        val body = driverAssignmentBody(context, "next")
        assertEquals(setOf("companyId", "vehicleId", "driverPersonId", "expectedAssignmentId"), body.keySet())
        assertEquals("old-assignment", body.get("expectedAssignmentId").asString)
        assertEquals("next", body.get("driverPersonId").asString)
    }
    @Test fun `unassignment explicit null is distinct from missing property`() {
        val body = driverAssignmentBody(context, null)
        assertTrue(body.has("driverPersonId"))
        assertTrue(body.get("driverPersonId").isJsonNull)
    }
    @Test fun `driver must be offered by scoped server and edit permission required`() {
        assertThrows(UserFacingException::class.java) { driverAssignmentBody(context, "foreign") }
        assertThrows(UserFacingException::class.java) { driverAssignmentBody(context.copy(canEdit = false), "next") }
    }
    @Test fun `receipt scope mismatch and missing edit flag rejected`() {
        val data = JsonParser.parseString("""{"companyId":"company","canEdit":true,"vehicle":{"id":"vehicle","name":"Машина"}}""").asJsonObject
        assertEquals("vehicle", driverAssignment(data, "vehicle", "company").vehicleId)
        assertThrows(UserFacingException::class.java) { driverAssignment(data, "other", "company") }
        assertThrows(UserFacingException::class.java) { driverAssignment(data, "vehicle", "other") }
        data.remove("canEdit")
        assertThrows(UserFacingException::class.java) { driverAssignment(data, "vehicle", "company") }
    }
}
