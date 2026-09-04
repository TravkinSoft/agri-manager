package com.travkin.flow

import com.travkin.flow.data.operationPlanBody
import com.travkin.flow.data.operationTypesJson
import com.travkin.flow.data.obj
import com.travkin.flow.data.text
import com.travkin.flow.data.mapCabinet
import com.travkin.flow.domain.*
import org.junit.Assert.*
import org.junit.Test

class OperationPlannerTest {
    private val types = listOf(
        OperationTypeOption("soil_operation", "Почвообработка", "plowing", "Вспашка", true, false),
        OperationTypeOption("soil_operation", "Почвообработка", "disking", "Дискование", true, false),
        OperationTypeOption("scouting", "Осмотр поля", "field_scouting", "Осмотр поля", false, false),
        OperationTypeOption("harvesting", "Уборка", "grain_harvesting", "Уборка зерновых", true, false),
        OperationTypeOption("irrigation", "Полив", "irrigation_cycle", "Полив", true, false),
        OperationTypeOption("irrigation", "Полив", "drip_irrigation", "Капельный полив", true, false),
        OperationTypeOption("planting", "Посев", "seeding", "Посев", true, true),
    )
    private fun allocation(landUse: String = "crop", irrigation: String = "unknown", complete: Boolean = true) = OperationAllocation(
        "allocation", "Пшеница — 10 га", landUse, 10.0,
        if (landUse == "fallow") null else "crop", if (complete) "variety" else null,
        if (complete) "reproduction" else null, "Пшеница", "Сорт", irrigation, 0.2, 3.0,
    )
    private fun context(allocation: OperationAllocation = allocation()) = OperationPlannerData(
        "field", "Поле 1", 20.0, "season", "2026", listOf(allocation),
        listOf(OperationAsset("specialist", "Специалист")), listOf(OperationAsset("machine", "Трактор")),
        listOf(OperationAsset("equipment", "Агрегат")), listOf(OperationAsset("transport", "КамАЗ")), types,
    )
    private fun draft(type: String = "disking", whole: Boolean = false) = OperationPlanDraft(
        allocationId = if (whole) null else "allocation", wholeField = whole, typeSlug = type,
        date = "2026-09-04", areaHa = "10", responsibleId = "specialist", machineId = "machine",
    )

    @Test fun `catalog parser joins category rules to real work labels`() {
        val parsed = operationTypesJson("""{"types":[{"slug":"soil_operation","label":"Почвообработка","requiresMachine":true,"supportsMaterials":false}],"subtypes":[{"categorySlug":"soil_operation","slug":"disking","label":"Дискование"}]}""")
        assertEquals(listOf(OperationTypeOption("soil_operation", "Почвообработка", "disking", "Дискование", true, false)), parsed)
    }

    @Test fun `material workflows stay hidden until their full native form exists`() {
        assertFalse(availableOperationTypes(context(), draft()).any { it.categorySlug == "planting" })
    }

    @Test fun `whole field and fallow only offer crop independent works`() {
        assertEquals(listOf("plowing"), availableOperationTypes(context(), draft("plowing", whole = true)).map { it.slug })
        assertEquals(listOf("plowing"), availableOperationTypes(context(allocation("fallow")), draft("plowing")).map { it.slug })
    }

    @Test fun `irrigation choices follow field irrigation type`() {
        assertFalse(availableOperationTypes(context(allocation(irrigation = "dryland")), draft()).any { it.categorySlug == "irrigation" })
        assertEquals(listOf("drip_irrigation"), availableOperationTypes(context(allocation(irrigation = "drip")), draft()).filter { it.categorySlug == "irrigation" }.map { it.slug })
    }

    @Test fun `harvest requires complete crop identity`() {
        assertFalse(availableOperationTypes(context(allocation(complete = false)), draft()).any { it.categorySlug == "harvesting" })
    }

    @Test fun `validation rejects stale assets area and missing irrigation water`() {
        assertNotNull(validateOperationPlan(context(), draft().copy(machineId = "other")))
        assertNotNull(validateOperationPlan(context(), draft().copy(areaHa = "10.1")))
        assertNotNull(validateOperationPlan(context(allocation(irrigation = "drip")), draft("drip_irrigation")))
        assertNull(validateOperationPlan(context(allocation(irrigation = "drip")), draft("drip_irrigation").copy(waterNormMm = "20")))
    }

    @Test fun `payload keeps operation inside verified field structure and season`() {
        val body = operationPlanBody(context(), draft(), "company", "11111111-1111-4111-8111-111111111111")
        assertEquals("company", body.text("companyId"))
        assertEquals("field", body.text("field_id"))
        assertEquals("allocation", body.text("crop_structure_id"))
        assertEquals("disking", body.text("operation_type_slug"))
        assertEquals("structure_line", body.obj("operation_params").text("scope"))
        assertEquals("season", body.obj("operation_params").text("season_id"))
        assertEquals("11111111-1111-4111-8111-111111111111", body.text("idempotency_key"))
    }

    @Test fun `whole field payload has no crop structure identity`() {
        val body = operationPlanBody(context(), draft("plowing", whole = true).copy(areaHa = "20"), "company", "11111111-1111-4111-8111-111111111111")
        assertNull(body.text("crop_structure_id"))
        assertNull(body.text("crop_id"))
        assertEquals("whole_field", body.obj("operation_params").text("scope"))
    }

    @Test fun `planner is embedded only in active season field detail`() {
        val payload = com.google.gson.JsonParser.parseString("""{
          "activeSeasonId":"season","fields":[{"id":"field","name":"Поле 1","area":20}],
          "seasons":[{"id":"season","year":2026}],
          "cropStructure":[{"id":"allocation","field_id":"field","season_id":"season","land_use_type":"crop","crop_id":"crop","variety_id":"variety","reproduction_id":"reproduction","area":10}],
          "crops":[{"id":"crop","name":"Пшеница"}],"varieties":[{"id":"variety","name":"Сорт","crop_id":"crop"}],
          "reproductions":[{"id":"reproduction","name":"Элита"}],"specialists":[{"id":"specialist","full_name":"Специалист"}],
          "machines":[],"equipment":[],"vehicles":[],"operations":[]
        }""").asJsonObject
        val page = mapCabinet(CabinetQuery(CabinetSection.CROPS, objectId = "field"), payload, types)
        assertNotNull(page.operationPlanner)
        assertEquals("Поле 1", page.operationPlanner!!.fieldName)
        assertNull(mapCabinet(CabinetQuery(CabinetSection.CROPS), payload, types).operationPlanner)
    }
}
