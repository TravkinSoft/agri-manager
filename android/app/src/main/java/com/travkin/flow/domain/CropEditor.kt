package com.travkin.flow.domain

data class CatalogOption(val id: String, val name: String, val parentId: String? = null)
data class CropMixDraft(
    val id: String? = null,
    val cropId: String? = null,
    val varietyId: String? = null,
    val reproductionId: String? = null,
    val seedRate: String = "",
)
data class CropAllocationDraft(
    val id: String? = null,
    val landUse: String = "crop",
    val cropId: String? = null,
    val varietyId: String? = null,
    val reproductionId: String? = null,
    val area: String = "",
    val irrigation: String = "unknown",
    val rowSpacing: String = "",
    val seedSpacing: String = "",
    val notes: String = "",
    val mix: List<CropMixDraft> = emptyList(),
)
data class CropEditorData(
    val fieldId: String,
    val fieldName: String,
    val fieldArea: Double,
    val seasonId: String,
    val seasonYear: String,
    val original: List<CropAllocationDraft>,
    val crops: List<CatalogOption>,
    val varieties: List<CatalogOption>,
    val reproductions: List<CatalogOption>,
)

internal fun decimal(value: String): Double? = value.trim().replace(',', '.').toDoubleOrNull()?.takeIf(Double::isFinite)

/** Early input feedback only. The existing server validates role, season and every identity again. */
fun validateCropDraft(context: CropEditorData, rows: List<CropAllocationDraft>): String? {
    if (rows.size > 100) return "Не больше 100 строк на поле."
    if (rows.mapNotNull { it.id }.distinct().size != rows.mapNotNull { it.id }.size) return "Повторяющиеся строки структуры."
    val oldIds = context.original.mapNotNull { it.id }.toSet()
    if (rows.any { it.id != null && it.id !in oldIds }) return "Строка принадлежит другому полю."
    fun identity(crop: String?, variety: String?, reproduction: String?): Boolean =
        context.crops.any { it.id == crop } &&
            (variety == null || context.varieties.any { it.id == variety && it.parentId == crop }) &&
            (reproduction == null || context.reproductions.any { it.id == reproduction })
    var total = 0.0
    rows.forEachIndexed { index, row ->
        val prefix = "Строка ${index + 1}: "
        val area = decimal(row.area) ?: return prefix + "укажите площадь числом."
        if (area <= 0) return prefix + "площадь должна быть больше нуля."
        total += area
        if (row.irrigation !in setOf("drip", "sprinkler", "dryland", "unknown")) return prefix + "неизвестный тип орошения."
        if (row.landUse !in setOf("crop", "crop_mix", "fallow")) return prefix + "неизвестный тип использования."
        if (row.landUse == "crop" && !identity(row.cropId, row.varietyId, row.reproductionId)) return prefix + "проверьте культуру, сорт и репродукцию."
        if (row.landUse == "crop_mix") {
            if (row.mix.size !in 2..10) return prefix + "нужно от двух до десяти компонентов смеси."
            if (row.mix.map { listOf(it.cropId, it.varietyId, it.reproductionId) }.distinct().size != row.mix.size) return prefix + "компоненты смеси повторяются."
            row.mix.forEach {
                if (it.varietyId == null || it.reproductionId == null || !identity(it.cropId, it.varietyId, it.reproductionId)) return prefix + "заполните культуру, сорт и репродукцию каждого компонента."
                if ((decimal(it.seedRate) ?: 0.0) <= 0) return prefix + "норма компонента должна быть больше нуля."
            }
        }
        if (row.landUse == "crop") {
            listOf(row.rowSpacing, row.seedSpacing).forEach { if (it.isNotBlank() && (decimal(it) ?: 0.0) <= 0) return prefix + "расстояние должно быть положительным числом." }
            val cropName = context.crops.firstOrNull { it.id == row.cropId }?.name.orEmpty()
            if ((cropName.contains("карто", true) || cropName.contains("potato", true)) && (decimal(row.seedSpacing) ?: 0.0) <= 0) return prefix + "для картофеля требуется межсемянное расстояние."
        }
    }
    if (total > context.fieldArea + 0.0001) return "Сумма площадей превышает площадь поля."
    return null
}
