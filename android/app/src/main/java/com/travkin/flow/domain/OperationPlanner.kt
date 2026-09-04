package com.travkin.flow.domain

import java.time.LocalDate

data class OperationTypeOption(
    val categorySlug: String,
    val categoryLabel: String,
    val slug: String,
    val label: String,
    val requiresMachine: Boolean,
    val supportsMaterials: Boolean,
)

data class OperationAsset(val id: String, val name: String)

data class OperationAllocation(
    val id: String,
    val label: String,
    val landUse: String,
    val areaHa: Double,
    val cropId: String?,
    val varietyId: String?,
    val reproductionId: String?,
    val cropName: String?,
    val varietyName: String?,
    val irrigationType: String,
    val rowSpacingM: Double?,
    val seedSpacingCm: Double?,
)

data class OperationPlannerData(
    val fieldId: String,
    val fieldName: String,
    val fieldAreaHa: Double,
    val seasonId: String,
    val seasonYear: String,
    val allocations: List<OperationAllocation>,
    val specialists: List<OperationAsset>,
    val machines: List<OperationAsset>,
    val equipment: List<OperationAsset>,
    val transports: List<OperationAsset>,
    val types: List<OperationTypeOption>,
)

data class OperationPlanDraft(
    val allocationId: String? = null,
    val wholeField: Boolean = false,
    val typeSlug: String? = null,
    val date: String = LocalDate.now().toString(),
    val areaHa: String = "",
    val responsibleId: String? = null,
    val machineId: String? = null,
    val equipmentId: String? = null,
    val transportId: String? = null,
    val depthCm: String = "",
    val waterNormMm: String = "",
    val waterVolumeM3: String = "",
    val irrigationZone: String = "",
    val durationHours: String = "",
    val notes: String = "",
)

private val cropIndependentWorks = setOf("plowing", "snow_retention")
private val depthWorks = setOf(
    "stubble_peeling", "disking", "plowing", "deep_ripping", "cultivation",
    "interrow_cultivation", "harrowing", "rotary_tilling", "ridge_forming", "hilling",
)
private val nativeCreateCategories = setOf("soil_operation", "scouting", "sampling", "harvesting", "irrigation")
private val dripOnlyWorks = setOf("drip_irrigation")
private val sprinklerOnlyWorks = setOf("sprinkler_irrigation")

fun operationUsesDepth(slug: String?) = slug in depthWorks
fun operationNeedsWater(type: OperationTypeOption?) = type?.categorySlug == "irrigation"

/**
 * Only complete native workflows are exposed. Material-heavy categories remain hidden until their
 * product, batch, rate-basis and multi-target forms have the same guarantees as the web form.
 */
fun availableOperationTypes(context: OperationPlannerData, draft: OperationPlanDraft): List<OperationTypeOption> {
    val allocation = context.allocations.firstOrNull { it.id == draft.allocationId }
    return context.types.filter { type ->
        if (type.supportsMaterials || type.categorySlug !in nativeCreateCategories) return@filter false
        val cropIndependent = type.slug in cropIndependentWorks
        if (draft.wholeField) return@filter cropIndependent
        if (allocation == null) return@filter false
        if (allocation.landUse == "fallow") return@filter cropIndependent
        if (cropIndependent) return@filter false
        if (type.categorySlug == "harvesting" && allocation.landUse != "crop_mix" &&
            listOf(allocation.cropId, allocation.varietyId, allocation.reproductionId).any { it == null }) return@filter false
        if (type.categorySlug == "irrigation" && allocation.irrigationType == "dryland") return@filter false
        if (type.slug in dripOnlyWorks && allocation.irrigationType != "drip") return@filter false
        if (type.slug in sprinklerOnlyWorks && allocation.irrigationType != "sprinkler") return@filter false
        if (type.slug == "irrigation_cycle" && allocation.irrigationType in setOf("drip", "sprinkler")) return@filter false
        true
    }.sortedWith(compareBy(OperationTypeOption::categoryLabel, OperationTypeOption::label))
}

fun validateOperationPlan(context: OperationPlannerData, draft: OperationPlanDraft): String? {
    if (draft.wholeField == (draft.allocationId != null)) return "Выберите участок структуры или всё поле."
    val allocation = context.allocations.firstOrNull { it.id == draft.allocationId }
    if (!draft.wholeField && allocation == null) return "Выбранный участок структуры недоступен."
    val type = availableOperationTypes(context, draft).firstOrNull { it.slug == draft.typeSlug }
        ?: return "Выберите доступную работу."
    val area = decimal(draft.areaHa) ?: return "Укажите площадь числом."
    val maxArea = if (draft.wholeField) context.fieldAreaHa else allocation!!.areaHa
    if (area <= 0 || area > maxArea + 0.0001) return "Площадь должна быть больше нуля и не превышать ${formatOperationNumber(maxArea)} га."
    if (runCatching { LocalDate.parse(draft.date.trim()) }.getOrNull() == null) return "Дата должна быть в формате ГГГГ-ММ-ДД."
    if (context.specialists.none { it.id == draft.responsibleId }) return "Выберите ответственного специалиста."
    if (type.requiresMachine && context.machines.none { it.id == draft.machineId }) return "Выберите доступную машину."
    if (draft.machineId != null && context.machines.none { it.id == draft.machineId }) return "Выбранная машина недоступна."
    if (draft.equipmentId != null && context.equipment.none { it.id == draft.equipmentId }) return "Выбранное оборудование недоступно."
    if (draft.transportId != null && context.transports.none { it.id == draft.transportId }) return "Выбранный транспорт недоступен."
    if (operationUsesDepth(type.slug) && draft.depthCm.isNotBlank() && (decimal(draft.depthCm) ?: 0.0) <= 0) return "Глубина должна быть положительным числом."
    if (operationNeedsWater(type)) {
        val norm = decimal(draft.waterNormMm)
        val volume = decimal(draft.waterVolumeM3)
        if ((norm ?: 0.0) <= 0 && (volume ?: 0.0) <= 0) return "Укажите норму воды или общий объём воды."
        if (draft.durationHours.isNotBlank() && (decimal(draft.durationHours) ?: 0.0) <= 0) return "Длительность должна быть положительным числом."
    }
    if (draft.notes.length > 2000) return "Примечание не должно превышать 2000 символов."
    return null
}

internal fun formatOperationNumber(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else value.toString().trimEnd('0').trimEnd('.')
