package com.travkin.flow.domain

data class TrafficVehicle(val id: String, val name: String, val plate: String?, val assigned: Boolean, val state: String?) {
    val locked: Boolean get() = assigned && state != "empty"
}
data class TrafficAccount(val id: String, val name: String, val roleLabel: String, val statusLabel: String)
data class TrafficEditorData(val fieldId: String?, val vehicles: List<TrafficVehicle>, val accounts: List<TrafficAccount>) {
    val assignedIds: Set<String> get() = vehicles.filter { it.assigned }.map { it.id }.toSet()
}

fun validateTrafficSelection(context: TrafficEditorData, selected: Set<String>, emptyConfirmed: Boolean): String? {
    if (selected.size > 100) return "Не больше 100 машин в работе."
    if (selected.any { id -> context.vehicles.none { it.id == id } }) return "Список машин изменился. Обновите раздел."
    if (context.vehicles.any { it.locked && it.id !in selected }) return "Загруженную машину или машину на выгрузке нельзя убрать до разгрузки."
    if ((selected - context.assignedIds).isNotEmpty() && !emptyConfirmed) return "Подтвердите, что добавляемые машины сейчас пустые."
    return null
}
