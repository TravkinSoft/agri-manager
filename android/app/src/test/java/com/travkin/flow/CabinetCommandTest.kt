package com.travkin.flow

import com.google.gson.JsonParser
import com.travkin.flow.data.*
import com.travkin.flow.domain.*
import org.junit.Assert.*
import org.junit.Test
import retrofit2.http.GET
import retrofit2.http.PUT
import retrofit2.http.POST
import retrofit2.http.PATCH
import retrofit2.http.DELETE

class CabinetCommandTest {
    private val crop = CropAllocationDraft(id = "row1", cropId = "wheat", varietyId = "wheat-v", reproductionId = "elite", area = "10")
    private val context = CropEditorData("field", "Поле", 20.0, "season", "2026", listOf(crop),
        listOf(CatalogOption("wheat", "Пшеница"), CatalogOption("oats", "Овёс"), CatalogOption("potato", "Картофель")),
        listOf(CatalogOption("wheat-v", "Сорт пшеницы", "wheat"), CatalogOption("oats-v", "Сорт овса", "oats")),
        listOf(CatalogOption("elite", "Элита")))
    private fun json(value: String) = JsonParser.parseString(value).asJsonObject

    @Test fun `crop draft accepts comma decimals and optional variety`() {
        assertNull(validateCropDraft(context, listOf(crop.copy(area = "12,5", varietyId = null, reproductionId = null))))
    }
    @Test fun `area cannot be nonfinite zero negative or exceed field`() {
        listOf("NaN", "Infinity", "0", "-1", "20.01").forEach { assertNotNull(validateCropDraft(context, listOf(crop.copy(area = it)))) }
        assertNotNull(validateCropDraft(context, listOf(crop.copy(area = "12"), crop.copy(id = null, area = "12"))))
    }
    @Test fun `foreign duplicate identities and incompatible variety rejected`() {
        assertNotNull(validateCropDraft(context, listOf(crop.copy(id = "other-field-row"))))
        assertNotNull(validateCropDraft(context, listOf(crop, crop)))
        assertNotNull(validateCropDraft(context, listOf(crop.copy(varietyId = "oats-v"))))
        assertNotNull(validateCropDraft(context, listOf(crop.copy(reproductionId = "unavailable"))))
    }
    @Test fun `mix requires two different complete components`() {
        val wheat = CropMixDraft(cropId = "wheat", varietyId = "wheat-v", reproductionId = "elite", seedRate = "120,5")
        val oats = CropMixDraft(cropId = "oats", varietyId = "oats-v", reproductionId = "elite", seedRate = "50")
        val mix = crop.copy(landUse = "crop_mix", mix = listOf(wheat, oats))
        assertNull(validateCropDraft(context, listOf(mix)))
        assertNotNull(validateCropDraft(context, listOf(mix.copy(mix = listOf(wheat)))))
        assertNotNull(validateCropDraft(context, listOf(mix.copy(mix = listOf(wheat, wheat)))))
        assertNotNull(validateCropDraft(context, listOf(mix.copy(mix = listOf(wheat, oats.copy(seedRate = "0"))))))
    }
    @Test fun `potato requires seed spacing`() {
        val potato = crop.copy(cropId = "potato", varietyId = null)
        assertNotNull(validateCropDraft(context, listOf(potato)))
        assertNull(validateCropDraft(context, listOf(potato.copy(seedSpacing = "25"))))
    }
    @Test fun `fallow payload clears identity and field scope comes from verified context`() {
        val body = cropSaveBody(context, listOf(crop.copy(landUse = "fallow", area = "12,5", notes = " test ")), "verified-company")
        assertEquals(setOf("companyId", "seasonId", "rows"), body.keySet())
        assertEquals("verified-company", body.text("companyId"))
        val row = body.rows("rows").single()
        assertNull(row.text("crop_id"))
        assertNull(row.text("variety_id"))
        assertNull(row.text("row_spacing_m"))
        assertEquals(12.5, row.number("area")!!, 0.0)
        assertEquals("test", row.text("notes"))
    }
    @Test fun `closed season cannot offer editor`() {
        assertNull(cropEditor(json("""{"fields":[{"id":"field","area":20}],"activeSeasonId":"season","seasons":[{"id":"season","archived":true}]}"""), "field"))
    }
    @Test fun `crop catalog excludes other company and archived rows`() {
        val editor = cropEditor(json("""{"companyId":"ours","fields":[{"id":"field","area":20}],"activeSeasonId":"season","seasons":[{"id":"season"}],"cropStructure":[],"crops":[{"id":"global"},{"id":"ours","company_id":"ours"},{"id":"other","company_id":"other"},{"id":"archived","archived":true}]}"""), "field")!!
        assertEquals(listOf("global", "ours"), editor.crops.map { it.id })
    }
    private val traffic = TrafficEditorData("legacy-field", listOf(
        TrafficVehicle("busy", "Загруженная", "001", true, "loaded"),
        TrafficVehicle("old", "Назначенная", "002", true, "empty"),
        TrafficVehicle("new", "Новая", "003", false, null)), emptyList())
    @Test fun `busy vehicle and invalid ids cannot be removed or submitted`() {
        assertNotNull(validateTrafficSelection(traffic, setOf("old"), false))
        assertNotNull(validateTrafficSelection(traffic, setOf("busy", "foreign"), true))
        assertNull(validateTrafficSelection(traffic, setOf("busy"), false))
    }
    @Test fun `new vehicles require explicit empty confirmation`() {
        assertNotNull(validateTrafficSelection(traffic, setOf("busy", "new"), false))
        assertNull(validateTrafficSelection(traffic, setOf("busy", "new"), true))
    }
    @Test fun `traffic payload preserves legacy field and exact endpoint schema`() {
        val body = trafficSaveBody(traffic, setOf("busy", "new"), true)
        assertEquals(setOf("action", "enabled", "fieldId", "vehicleIds"), body.keySet())
        assertEquals("legacy-field", body.text("fieldId"))
        assertEquals("configure", body.text("action"))
        assertTrue(body.flag("enabled"))
    }
    @Test fun `assigned archived vehicle is preserved and duplicate person links are not confirmed`() {
        val mapped = trafficEditor(json("""{"snapshot":{"role":"manager","vehicles":[{"vehicle_id":"archived","assigned":true,"state":"unloading","name":"Старая"}]},"fleet":[{"id":"new","name":"Новая"}],"people":[{"user_id":"u","full_name":"A"},{"user_id":"u","full_name":"B"}],"accounts":[{"id":"u","full_name":"Account","status":"active","role":"mechanic_operator"}]}"""))
        assertEquals(setOf("archived"), mapped.assignedIds)
        assertTrue(mapped.vehicles.first { it.id == "archived" }.locked)
        assertEquals("Account", mapped.accounts.single().name)
        assertEquals("Нужна проверка связи с сотрудником", mapped.accounts.single().statusLabel)
    }
    @Test fun `read interface has no write routes and commands are explicitly allowlisted`() {
        assertTrue(CabinetApi::class.java.declaredMethods.filterNot { it.isSynthetic }.all { it.getAnnotation(GET::class.java) != null })
        assertTrue(SupabaseReadApi::class.java.declaredMethods.filterNot { it.isSynthetic }.all { it.getAnnotation(GET::class.java) != null })
        val paths = CabinetCommandApi::class.java.declaredMethods.map { method ->
            method.getAnnotation(PUT::class.java)?.let { "PUT ${it.value}" } ?: method.getAnnotation(POST::class.java)?.let { "POST ${it.value}" }
                ?: method.getAnnotation(PATCH::class.java)?.let { "PATCH ${it.value}" } ?: method.getAnnotation(DELETE::class.java)?.let { "DELETE ${it.value}" }
        }.toSet()
        assertEquals(setOf("PUT api/crop-structure/fields/{id}", "POST api/traffic", "POST api/weather-lab/profiles", "PATCH api/weather-lab/profiles/{id}", "DELETE api/weather-lab/profiles/{id}", "PATCH api/settings/notifications", "POST api/vehicles/driver-assignment"), paths)
    }
}
