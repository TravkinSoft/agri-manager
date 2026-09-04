package com.travkin.flow.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.travkin.flow.domain.*
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OperationPlannerDialog(
    context: OperationPlannerData,
    busy: Boolean,
    serverError: String?,
    onClose: () -> Unit,
    onSave: (OperationPlanDraft, String) -> Unit,
) {
    val firstAllocation = context.allocations.firstOrNull { it.landUse != "fallow" } ?: context.allocations.firstOrNull()
    val initial = remember(context) { OperationPlanDraft(allocationId = firstAllocation?.id, areaHa = firstAllocation?.areaHa?.let(::formatOperationNumber).orEmpty()) }
    var draft by remember(context) { mutableStateOf(initial) }
    var localError by remember { mutableStateOf<String?>(null) }
    var confirmation by remember { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }
    var submittedDraft by remember { mutableStateOf<OperationPlanDraft?>(null) }
    var idempotencyKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    val selectedType = availableOperationTypes(context, draft).firstOrNull { it.slug == draft.typeSlug }
    val selectedAllocation = context.allocations.firstOrNull { it.id == draft.allocationId }
    val change: ((OperationPlanDraft) -> OperationPlanDraft) -> Unit = { transform ->
        draft = transform(draft)
        localError = null
    }
    val close = {
        if (!busy) {
            if (draft != initial) discard = true else onClose()
        }
    }
    BackHandler { close() }

    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = false, dismissOnClickOutside = false)) {
        Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
            Scaffold(topBar = {
                TopAppBar(title = { Text("Создать план работы") }, navigationIcon = {
                    TextButton(onClick = close, enabled = !busy) { Text("Закрыть") }
                })
            }, bottomBar = {
                Column(Modifier.fillMaxWidth().imePadding().padding(16.dp)) {
                    (localError ?: serverError)?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 8.dp)) }
                    Button(modifier = Modifier.fillMaxWidth(), enabled = !busy, onClick = {
                        localError = validateOperationPlan(context, draft)
                        if (localError == null) confirmation = true
                    }) { Text(if (busy) "Создаём…" else "Проверить и создать") }
                }
            }) { padding ->
                LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    item { Text("${context.fieldName} · сезон ${context.seasonYear} · ${formatOperationNumber(context.fieldAreaHa)} га") }
                    item {
                        val scopes = listOf(CatalogOption("whole-field", "Всё поле — ${formatOperationNumber(context.fieldAreaHa)} га")) +
                            context.allocations.map { CatalogOption(it.id, it.label) }
                        SelectOption("Что обрабатываем", if (draft.wholeField) "whole-field" else draft.allocationId, scopes, busy) { selected ->
                            if (selected == "whole-field") change { it.copy(wholeField = true, allocationId = null, typeSlug = null, areaHa = formatOperationNumber(context.fieldAreaHa)) }
                            else {
                                val allocation = context.allocations.firstOrNull { it.id == selected }
                                change { it.copy(wholeField = false, allocationId = selected, typeSlug = null, areaHa = allocation?.areaHa?.let(::formatOperationNumber).orEmpty()) }
                            }
                        }
                    }
                    item {
                        val types = availableOperationTypes(context, draft).map { CatalogOption(it.slug, "${it.categoryLabel} · ${it.label}") }
                        SelectOption("Работа", draft.typeSlug, types, busy) { slug -> change { it.copy(typeSlug = slug, machineId = null, equipmentId = null, transportId = null) } }
                    }
                    item { DecimalField("Площадь, га", draft.areaHa, busy) { value -> change { it.copy(areaHa = value) } } }
                    item {
                        OutlinedTextField(value = draft.date, onValueChange = { value -> change { it.copy(date = value) } },
                            label = { Text("Дата, ГГГГ-ММ-ДД") }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
                    }
                    item {
                        SelectOption("Ответственный специалист", draft.responsibleId,
                            context.specialists.map { CatalogOption(it.id, it.name) }, busy) { value -> change { it.copy(responsibleId = value) } }
                    }
                    if (selectedType?.requiresMachine == true) item {
                        SelectOption("Машина", draft.machineId, context.machines.map { CatalogOption(it.id, it.name) }, busy) { value -> change { it.copy(machineId = value) } }
                    }
                    if (selectedType != null) item {
                        SelectOption("Оборудование", draft.equipmentId, context.equipment.map { CatalogOption(it.id, it.name) }, busy, optional = true) { value -> change { it.copy(equipmentId = value) } }
                    }
                    if (selectedType?.categorySlug == "harvesting") item {
                        SelectOption("Транспорт", draft.transportId, context.transports.map { CatalogOption(it.id, it.name) }, busy, optional = true) { value -> change { it.copy(transportId = value) } }
                    }
                    if (operationUsesDepth(selectedType?.slug)) item {
                        DecimalField("Глубина обработки, см", draft.depthCm, busy) { value -> change { it.copy(depthCm = value) } }
                    }
                    if (operationNeedsWater(selectedType)) {
                        item { Text("Параметры полива", style = MaterialTheme.typography.titleMedium) }
                        item { DecimalField("Норма воды, мм", draft.waterNormMm, busy) { value -> change { it.copy(waterNormMm = value) } } }
                        item { DecimalField("Общий объём воды, м³", draft.waterVolumeM3, busy) { value -> change { it.copy(waterVolumeM3 = value) } } }
                        item { OutlinedTextField(value = draft.irrigationZone, onValueChange = { value -> change { it.copy(irrigationZone = value) } }, label = { Text("Зона полива") }, enabled = !busy, modifier = Modifier.fillMaxWidth()) }
                        item { DecimalField("Длительность, ч", draft.durationHours, busy) { value -> change { it.copy(durationHours = value) } } }
                    }
                    item {
                        OutlinedTextField(value = draft.notes, onValueChange = { value -> change { it.copy(notes = value) } },
                            label = { Text("Примечание") }, enabled = !busy, modifier = Modifier.fillMaxWidth(), minLines = 3)
                    }
                    if (selectedType == null && draft.typeSlug == null) item {
                        Text("Доступные работы зависят от культуры, типа орошения и выбранного участка.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }

    if (confirmation) AlertDialog(onDismissRequest = { confirmation = false }, title = { Text("Создать план работы?") }, text = {
        Text("Поле: ${context.fieldName}\nУчасток: ${if (draft.wholeField) "Всё поле" else selectedAllocation?.label ?: "не выбран"}\nРабота: ${selectedType?.label ?: "не выбрана"}\nПлощадь: ${draft.areaHa} га\nДата: ${draft.date}\nОтветственный: ${context.specialists.firstOrNull { it.id == draft.responsibleId }?.name ?: "не выбран"}\n\nПлан будет создан на сервере и появится в журнале операций сайта.")
    }, confirmButton = {
        TextButton(onClick = {
            confirmation = false
            if (submittedDraft != draft) idempotencyKey = UUID.randomUUID().toString()
            submittedDraft = draft
            onSave(draft, idempotencyKey)
        }, enabled = !busy) { Text("Создать") }
    }, dismissButton = { TextButton(onClick = { confirmation = false }, enabled = !busy) { Text("Вернуться") } })

    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Закрыть без создания?") },
        text = { Text("Заполненный план будет потерян. На сайте ничего не изменится.") },
        confirmButton = { TextButton(onClick = onClose) { Text("Закрыть") } },
        dismissButton = { TextButton(onClick = { discard = false }) { Text("Продолжить") } })
}

@Composable
private fun DecimalField(label: String, value: String, busy: Boolean, onChange: (String) -> Unit) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) }, modifier = Modifier.fillMaxWidth(),
        singleLine = true, enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
}
