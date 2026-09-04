package com.travkin.flow.data

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.travkin.flow.domain.*

internal fun cropDraft(row: JsonObject) = CropAllocationDraft(
    id = row.text("id"), landUse = row.text("land_use_type") ?: "crop", cropId = row.text("crop_id"),
    varietyId = row.text("variety_id"), reproductionId = row.text("reproduction_id"), area = row.text("area").orEmpty(),
    irrigation = row.text("irrigation_type") ?: "unknown", rowSpacing = row.text("row_spacing_m").orEmpty(),
    seedSpacing = row.text("seed_spacing_cm").orEmpty(), notes = row.text("notes").orEmpty(),
    mix = row.rows("mix_components").map { CropMixDraft(it.text("id"), it.text("crop_id"), it.text("variety_id"), it.text("reproduction_id"), it.text("seed_rate_kg_ha").orEmpty()) },
)

internal fun cropEditor(data: JsonObject, fieldId: String?): CropEditorData? {
    val field = data.rows("fields").firstOrNull { it.text("id") == fieldId } ?: return null
    val seasonId = data.text("activeSeasonId") ?: return null
    val season = data.rows("seasons").firstOrNull { it.text("id") == seasonId && !it.flag("archived") } ?: return null
    fun catalog(key: String) = data.rows(key).filter {
        !it.flag("archived") && it.text("is_active") != "false" && (it.text("company_id") == null || it.text("company_id") == data.text("companyId"))
    }.mapNotNull { row ->
        row.text("id")?.let { CatalogOption(it, row.text("name_ru") ?: row.text("name") ?: it, row.text("crop_id")) }
    }
    return CropEditorData(fieldId!!, field.text("name") ?: "Поле", field.number("area") ?: return null, seasonId,
        season.text("year").orEmpty(), data.rows("cropStructure").filter { it.text("field_id") == fieldId }.map(::cropDraft),
        catalog("crops"), catalog("varieties"), catalog("reproductions"))
}

internal fun cropSaveBody(context: CropEditorData, rows: List<CropAllocationDraft>, companyId: String): JsonObject {
    validateCropDraft(context, rows)?.let { throw UserFacingException(it) }
    return JsonObject().apply {
        addProperty("companyId", companyId)
        addProperty("seasonId", context.seasonId)
        add("rows", JsonArray().apply { rows.forEach { row -> add(JsonObject().apply {
            row.id?.let { addProperty("id", it) }
            addProperty("land_use_type", row.landUse)
            addProperty("crop_id", if (row.landUse == "crop") row.cropId else null)
            addProperty("variety_id", if (row.landUse == "crop") row.varietyId else null)
            addProperty("reproduction_id", if (row.landUse == "crop") row.reproductionId else null)
            addProperty("area", decimal(row.area))
            addProperty("irrigation_type", row.irrigation)
            addProperty("row_spacing_m", if (row.landUse == "crop") decimal(row.rowSpacing) else null)
            addProperty("seed_spacing_cm", if (row.landUse == "crop") decimal(row.seedSpacing) else null)
            addProperty("notes", row.notes.trim().ifBlank { null })
            add("mix_components", JsonArray().apply { if (row.landUse == "crop_mix") row.mix.forEachIndexed { index, component -> add(JsonObject().apply {
                component.id?.let { addProperty("id", it) }
                addProperty("crop_id", component.cropId); addProperty("variety_id", component.varietyId); addProperty("reproduction_id", component.reproductionId)
                addProperty("seed_rate_kg_ha", decimal(component.seedRate)); addProperty("sort_order", index + 1)
            }) } })
        }) } })
    }
}
