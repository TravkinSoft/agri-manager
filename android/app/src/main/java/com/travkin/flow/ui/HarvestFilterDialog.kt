package com.travkin.flow.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.travkin.flow.domain.*

@Composable
fun HarvestFilterDialog(query: CabinetQuery, options: Map<String, List<CatalogOption>>, onClose: () -> Unit, onApply: (CabinetQuery) -> Unit) {
    var filters by remember { mutableStateOf(query.harvestFilters) }
    var custom by remember { mutableStateOf(query.period == "custom") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = onClose, title = { Text("Фильтры сводки") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SelectOption("Культура", filters.cropId, options["crops"].orEmpty(), false, true) { filters = filters.copy(cropId = it) }
            SelectOption("Сорт", filters.varietyId, options["varieties"].orEmpty(), false, true) { filters = filters.copy(varietyId = it) }
            SelectOption("Репродукция", filters.reproductionId, options["reproductions"].orEmpty(), false, true) { filters = filters.copy(reproductionId = it) }
            SelectOption("Поле", filters.fieldId, options["fields"].orEmpty(), false, true) { filters = filters.copy(fieldId = it) }
            SelectOption("Склад", filters.warehouseId, options["warehouses"].orEmpty(), false, true) { filters = filters.copy(warehouseId = it) }
            Row { Checkbox(checked = custom, onCheckedChange = { custom = it }); Text("Свой период (Кызылорда)", Modifier.padding(top = 12.dp)) }
            if (custom) {
                Text("Формат: ГГГГ-ММ-ДД ЧЧ:ММ")
                OutlinedTextField(value = filters.start, onValueChange = { filters = filters.copy(start = it) }, label = { Text("Начало") }, singleLine = true)
                OutlinedTextField(value = filters.end, onValueChange = { filters = filters.copy(end = it) }, label = { Text("Конец") }, singleLine = true)
            }
            TextButton(onClick = { filters = HarvestFilters(); custom = false }) { Text("Сбросить фильтры") }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }, confirmButton = { TextButton(onClick = {
        error = runCatching { harvestFilterParameters(filters, custom) }.exceptionOrNull()?.let { "Проверьте даты: ГГГГ-ММ-ДД ЧЧ:ММ; конец позже начала." }
        if (error == null) onApply(query.copy(harvestFilters = filters, period = if (custom) "custom" else if (query.period == "custom") "current_day" else query.period, partyKey = null))
    }) { Text("Применить") } }, dismissButton = { TextButton(onClick = onClose) { Text("Отмена") } })
}
