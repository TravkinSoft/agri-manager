package com.travkin.flow.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.travkin.flow.domain.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CropEditorDialog(context: CropEditorData, busy: Boolean, serverError: String?, onClose: () -> Unit,
    onSave: (List<CropAllocationDraft>) -> Unit) {
    var rows by remember(context) { mutableStateOf(context.original) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmation by remember { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }
    val close = { if (!busy) { if (rows != context.original) discard = true else onClose() } }
    BackHandler { close() }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = false, dismissOnClickOutside = false)) {
        Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
            Scaffold(topBar = { TopAppBar(title = { Text("Редактор структуры") }, navigationIcon = {
                TextButton(onClick = close, enabled = !busy) { Text("Закрыть") }
            }) }, bottomBar = {
                Column(Modifier.fillMaxWidth().imePadding().padding(16.dp)) {
                    (error ?: serverError)?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 8.dp)) }
                    Button(modifier = Modifier.fillMaxWidth(), enabled = !busy && rows != context.original, onClick = {
                        error = validateCropDraft(context, rows)
                        if (error == null) confirmation = true
                    }) { Text(if (busy) "Сохраняем…" else "Проверить и сохранить") }
                }
            }) { padding ->
                LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    item { Text("${context.fieldName} · сезон ${context.seasonYear} · ${context.fieldArea} га") }
                    items(rows.size) { index ->
                        val row = rows[index]
                        val change: (CropAllocationDraft) -> Unit = { replacement -> rows = rows.toMutableList().also { it[index] = replacement }; error = null }
                        Card {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text("Строка ${index + 1}", style = MaterialTheme.typography.titleMedium)
                                SelectOption("Использование", row.landUse, listOf(CatalogOption("crop", "Культура"), CatalogOption("crop_mix", "Зерносмесь"), CatalogOption("fallow", "Пар")), busy) {
                                    change(row.copy(landUse = it ?: "crop", cropId = null, varietyId = null, reproductionId = null,
                                        rowSpacing = "", seedSpacing = "", mix = if (it == "crop_mix") listOf(CropMixDraft(), CropMixDraft()) else emptyList()))
                                }
                                if (row.landUse == "crop") {
                                    SelectOption("Культура", row.cropId, context.crops, busy) { change(row.copy(cropId = it, varietyId = null, reproductionId = null)) }
                                    SelectOption("Сорт", row.varietyId, context.varieties.filter { it.parentId == row.cropId }, busy, optional = true) { change(row.copy(varietyId = it)) }
                                    SelectOption("Репродукция", row.reproductionId, context.reproductions, busy, optional = true) { change(row.copy(reproductionId = it)) }
                                }
                                NumberInput("Площадь, га", row.area, busy) { change(row.copy(area = it)) }
                                SelectOption("Орошение", row.irrigation, listOf(CatalogOption("unknown", "Не указано"), CatalogOption("drip", "Капельное"), CatalogOption("sprinkler", "Дождевание"), CatalogOption("dryland", "Богара")), busy) { change(row.copy(irrigation = it ?: "unknown")) }
                                if (row.landUse == "crop") {
                                    NumberInput("Междурядье, м", row.rowSpacing, busy) { change(row.copy(rowSpacing = it)) }
                                    NumberInput("Межсемянное расстояние, см", row.seedSpacing, busy) { change(row.copy(seedSpacing = it)) }
                                }
                                if (row.landUse == "crop_mix") {
                                    row.mix.forEachIndexed { componentIndex, component ->
                                        HorizontalDivider()
                                        Text("Компонент ${componentIndex + 1}")
                                        val mixChange: (CropMixDraft) -> Unit = { replacement -> change(row.copy(mix = row.mix.toMutableList().also { it[componentIndex] = replacement })) }
                                        SelectOption("Культура", component.cropId, context.crops, busy) { mixChange(component.copy(cropId = it, varietyId = null, reproductionId = null)) }
                                        SelectOption("Сорт", component.varietyId, context.varieties.filter { it.parentId == component.cropId }, busy) { mixChange(component.copy(varietyId = it)) }
                                        SelectOption("Репродукция", component.reproductionId, context.reproductions, busy) { mixChange(component.copy(reproductionId = it)) }
                                        NumberInput("Норма, кг/га", component.seedRate, busy) { mixChange(component.copy(seedRate = it)) }
                                        TextButton(enabled = !busy, onClick = { change(row.copy(mix = row.mix.filterIndexed { i, _ -> i != componentIndex })) }) { Text("Удалить компонент") }
                                    }
                                    OutlinedButton(enabled = !busy && row.mix.size < 10, onClick = { change(row.copy(mix = row.mix + CropMixDraft())) }) { Text("Добавить компонент") }
                                }
                                OutlinedTextField(value = row.notes, onValueChange = { change(row.copy(notes = it)) }, label = { Text("Примечание") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
                                TextButton(enabled = !busy, onClick = { rows = rows.filterIndexed { i, _ -> i != index } }) { Text("Убрать строку из проекта изменений") }
                            }
                        }
                    }
                    item { OutlinedButton(enabled = !busy && rows.size < 100, onClick = { rows = rows + CropAllocationDraft() }, modifier = Modifier.fillMaxWidth()) { Text("Добавить строку") } }
                }
            }
        }
    }
    if (confirmation) AlertDialog(onDismissRequest = { confirmation = false }, title = { Text("Сохранить структуру поля?") },
        text = { Text("${context.fieldName}, сезон ${context.seasonYear}.\nБыло строк: ${context.original.size}; станет: ${rows.size}.\nУдаляется существующих строк: ${context.original.count { old -> rows.none { it.id == old.id } }}.\nИзменения будут видны и на сайте. Сервер проверит связанные операции и материалы.") },
        confirmButton = { TextButton(onClick = { confirmation = false; onSave(rows) }) { Text("Сохранить") } },
        dismissButton = { TextButton(onClick = { confirmation = false }) { Text("Вернуться") } })
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Закрыть без сохранения?") }, text = { Text("Изменения в редакторе будут потеряны. Данные сайта не изменятся.") },
        confirmButton = { TextButton(onClick = onClose) { Text("Закрыть") } }, dismissButton = { TextButton(onClick = { discard = false }) { Text("Продолжить") } })
}

@Composable
internal fun SelectOption(label: String, selected: String?, options: List<CatalogOption>, busy: Boolean,
    optional: Boolean = false, onChange: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    OutlinedButton(onClick = { search = ""; open = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        Text("$label: ${options.firstOrNull { it.id == selected }?.name ?: if (selected == null) "не выбрано" else "недоступная запись"}")
    }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text(label) }, text = {
        Column {
            OutlinedTextField(value = search, onValueChange = { search = it }, label = { Text("Поиск") }, singleLine = true)
            Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                if (optional) TextButton(onClick = { onChange(null); open = false }, modifier = Modifier.fillMaxWidth()) { Text("Не указано") }
                options.filter { it.name.contains(search, true) }.forEach { option ->
                    TextButton(onClick = { onChange(option.id); open = false }, modifier = Modifier.fillMaxWidth()) { Text(option.name) }
                }
            }
        }
    }, confirmButton = { TextButton(onClick = { open = false }) { Text("Отмена") } })
}

@Composable
private fun NumberInput(label: String, value: String, busy: Boolean, onChange: (String) -> Unit) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) }, modifier = Modifier.fillMaxWidth(),
        singleLine = true, enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
}
