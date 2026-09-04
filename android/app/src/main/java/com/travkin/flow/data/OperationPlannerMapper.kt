package com.travkin.flow.data

import android.content.res.AssetManager
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.travkin.flow.domain.*

internal fun operationTypes(assets: AssetManager): List<OperationTypeOption> =
    assets.open("operation-catalog.json").bufferedReader(Charsets.UTF_8).use { operationTypesJson(it.readText()) }

internal fun operationTypesJson(json: String): List<OperationTypeOption> {
    val root = JsonParser.parseString(json).takeIf { it.isJsonObject }?.asJsonObject
        ?: throw UserFacingException("Каталог полевых работ повреждён.")
    val categories = root.requireRows("types").associateBy { it.text("slug") }
    return root.requireRows("subtypes").mapNotNull { row ->
        val categorySlug = row.text("categorySlug") ?: return@mapNotNull null
        val category = categories[categorySlug] ?: return@mapNotNull null
        val slug = row.text("slug") ?: return@mapNotNull null
        OperationTypeOption(
            categorySlug = categorySlug,
            categoryLabel = category.text("label") ?: categorySlug,
            slug = slug,
            label = row.text("label") ?: slug,
            requiresMachine = category.flag("requiresMachine"),
            supportsMaterials = category.flag("supportsMaterials"),
        )
    }.distinctBy { it.categorySlug to it.slug }
}

private fun asset(row: JsonObject, kind: String): OperationAsset? {
    val id = row.text("id") ?: return null
    val global = row.obj("global_model")
    val model = row.obj("global_vehicle_models")
    val brand = row.obj("global_vehicle_brands")
    val name = listOfNotNull(
        row.text("name"), row.text("plate_number"), row.text("license_plate"),
        global.text("full_name"), model.text("name"), brand.text("name")
    ).distinct().joinToString(" · ").ifBlank { "$kind · $id" }
    return OperationAsset(id, name)
}

internal fun operationPlanner(data: JsonObject, editor: CropEditorData, types: List<OperationTypeOption>): OperationPlannerData {
    fun name(list: String, id: String?) = data.rows(list).firstOrNull { it.text("id") == id }
        ?.let { it.text("name_ru") ?: it.text("name") }
    val allocations = data.rows("cropStructure").filter { it.text("field_id") == editor.fieldId }.mapNotNull { row ->
        val id = row.text("id") ?: return@mapNotNull null
        val area = row.number("area")?.takeIf { it > 0 } ?: return@mapNotNull null
        val cropName = name("crops", row.text("crop_id"))
        val varietyName = name("varieties", row.text("variety_id"))
        OperationAllocation(
            id = id,
            label = "${cropIdentity(row, data)} — ${formatOperationNumber(area)} га",
            landUse = row.text("land_use_type") ?: "crop",
            areaHa = area,
            cropId = row.text("crop_id"),
            varietyId = row.text("variety_id"),
            reproductionId = row.text("reproduction_id"),
            cropName = cropName,
            varietyName = varietyName,
            irrigationType = row.text("irrigation_type") ?: "unknown",
            rowSpacingM = row.number("row_spacing_m"),
            seedSpacingCm = row.number("seed_spacing_cm"),
        )
    }
    fun assets(key: String, kind: String) = data.rows(key).mapNotNull { asset(it, kind) }
    return OperationPlannerData(
        fieldId = editor.fieldId,
        fieldName = editor.fieldName,
        fieldAreaHa = editor.fieldArea,
        seasonId = editor.seasonId,
        seasonYear = editor.seasonYear,
        allocations = allocations,
        specialists = data.rows("specialists").mapNotNull { row -> row.text("id")?.let { OperationAsset(it, row.text("full_name") ?: row.text("email") ?: "Специалист") } },
        machines = assets("machines", "Машина"),
        equipment = assets("equipment", "Оборудование"),
        transports = assets("vehicles", "Транспорт"),
        types = types,
    )
}

internal fun operationPlanBody(context: OperationPlannerData, draft: OperationPlanDraft, companyId: String, idempotencyKey: String): JsonObject {
    validateOperationPlan(context, draft)?.let { throw UserFacingException(it) }
    val allocation = context.allocations.firstOrNull { it.id == draft.allocationId }
    val type = availableOperationTypes(context, draft).first { it.slug == draft.typeSlug }
    fun numeric(value: String) = decimal(value)
    return JsonObject().apply {
        addProperty("companyId", companyId)
        addProperty("field_id", context.fieldId)
        addProperty("crop_structure_id", if (draft.wholeField) null else allocation?.id)
        addProperty("operation_category_slug", type.categorySlug)
        addProperty("operation_type_slug", type.slug)
        addProperty("operation_type", type.label)
        addProperty("planned_area_ha", numeric(draft.areaHa))
        addProperty("crop_id", if (draft.wholeField || allocation?.landUse == "crop_mix") null else allocation?.cropId)
        addProperty("machine_id", draft.machineId)
        addProperty("equipment_id", draft.equipmentId)
        addProperty("transport_id", draft.transportId)
        addProperty("operation_target", null as String?)
        addProperty("rate_per_ha", null as Number?)
        addProperty("spray_volume_per_ha", null as Number?)
        addProperty("row_spacing_m", allocation?.rowSpacingM)
        addProperty("seed_spacing_cm", allocation?.seedSpacingCm)
        add("operation_params", JsonObject().apply {
            addProperty("scope", if (draft.wholeField) "whole_field" else "structure_line")
            addProperty("target_scope", if (draft.wholeField) "field" else "structure_line")
            addProperty("crop_requirement", if (type.slug in setOf("plowing", "snow_retention")) "crop_not_required" else "crop_required")
            addProperty("season_id", context.seasonId)
            addProperty("irrigation_type", allocation?.irrigationType ?: "unknown")
            addProperty("operation_template", type.slug)
            addProperty("depth_cm", numeric(draft.depthCm))
            addProperty("water_norm_mm", numeric(draft.waterNormMm))
            addProperty("water_volume_m3", numeric(draft.waterVolumeM3))
            addProperty("irrigation_zone", draft.irrigationZone.trim().ifBlank { null })
            addProperty("duration_hours", numeric(draft.durationHours))
        })
        add("purposes", JsonArray())
        add("materials", JsonArray())
        add("targets", JsonArray())
        addProperty("date", draft.date.trim())
        addProperty("responsible_user_id", draft.responsibleId)
        addProperty("notes", draft.notes.trim().ifBlank { null })
        addProperty("idempotency_key", idempotencyKey)
    }
}
