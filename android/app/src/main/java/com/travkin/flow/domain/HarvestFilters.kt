package com.travkin.flow.domain

import java.time.LocalDateTime
import java.time.ZoneId

data class HarvestFilters(val cropId: String? = null, val varietyId: String? = null, val reproductionId: String? = null,
    val fieldId: String? = null, val warehouseId: String? = null, val start: String = "", val end: String = "")

fun harvestFilterParameters(filters: HarvestFilters, custom: Boolean): Map<String, String> {
    val result = mutableMapOf<String, String>()
    listOf("cropId" to filters.cropId, "varietyId" to filters.varietyId, "reproductionId" to filters.reproductionId,
        "fieldId" to filters.fieldId, "warehouseId" to filters.warehouseId).forEach { (key, id) -> if (id != null) result[key] = id }
    if (custom) {
        // Harvest dashboard operates in Qyzylorda time, independently of the phone's zone.
        val zone = ZoneId.of("Asia/Qyzylorda")
        val start = LocalDateTime.parse(filters.start.replace(' ', 'T')).atZone(zone).toInstant()
        val end = LocalDateTime.parse(filters.end.replace(' ', 'T')).atZone(zone).toInstant()
        require(end > start) { "Конец периода должен быть позже начала." }
        result["start"] = start.toString()
        result["end"] = end.toString()
    }
    return result
}
