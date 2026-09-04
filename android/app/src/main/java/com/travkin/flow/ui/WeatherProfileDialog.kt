package com.travkin.flow.ui

import androidx.compose.foundation.layout.*
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
fun WeatherProfileDialog(original: WeatherProfile, busy: Boolean, serverError: String?, onClose: () -> Unit, onSave: (WeatherProfile?) -> Unit) {
    var draft by remember(original) { mutableStateOf(original) }
    var values by remember(original) { mutableStateOf(listOf(original.maxWindMs, original.maxGustMs, original.maxPrecipitationMmH,
        original.maxPrecipitationProbabilityPct, original.minTemperatureC, original.maxTemperatureC).map { it?.toString().orEmpty() }) }
    var error by remember { mutableStateOf<String?>(null) }
    var delete by remember { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }
    val initialValues = remember(original) { values }
    val close = { if (!busy) { if (draft != original || values != initialValues) discard = true else onClose() } }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)) {
        Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
            Scaffold(topBar = { TopAppBar(title = { Text("Профиль погоды") }, navigationIcon = { TextButton(onClick = close, enabled = !busy) { Text("Закрыть") } }) }, bottomBar = {
                Column(Modifier.fillMaxWidth().imePadding().padding(16.dp)) {
                    (error ?: serverError)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    Button(onClick = {
                        if (values.any { it.isNotBlank() && decimal(it) == null }) error = "Введите числовые пределы."
                        else {
                            val numbers = values.map(::decimal)
                            val updated = draft.copy(maxWindMs = numbers[0], maxGustMs = numbers[1], maxPrecipitationMmH = numbers[2],
                                maxPrecipitationProbabilityPct = numbers[3], minTemperatureC = numbers[4], maxTemperatureC = numbers[5])
                            error = validateWeatherProfile(updated)
                            if (error == null) onSave(updated)
                        }
                    }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Сохраняем…" else "Сохранить профиль") }
                }
            }) { padding ->
                Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Личные настройки Агронома. Сохранённый профиль будет доступен и на сайте.")
                    OutlinedTextField(value = draft.name, onValueChange = { draft = draft.copy(name = it) }, label = { Text("Название") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
                    val toggles = listOf("Ветер" to draft.windEnabled, "Порывы" to draft.gustEnabled, "Осадки" to draft.precipitationEnabled,
                        "Вероятность осадков" to draft.precipitationProbabilityEnabled, "Температура" to draft.temperatureEnabled)
                    toggles.forEachIndexed { index, (label, enabled) ->
                        Row { Checkbox(checked = enabled, enabled = !busy, onCheckedChange = { value -> draft = when(index) {
                            0 -> draft.copy(windEnabled = value); 1 -> draft.copy(gustEnabled = value); 2 -> draft.copy(precipitationEnabled = value);
                            3 -> draft.copy(precipitationProbabilityEnabled = value); else -> draft.copy(temperatureEnabled = value)
                        } }); Text(label, Modifier.padding(12.dp)) }
                        if (index == 2 && enabled) SelectOption("Режим осадков", draft.precipitationMode,
                            listOf(CatalogOption("forbidden", "Без осадков"), CatalogOption("maximum", "Не выше предела")), busy) { draft = draft.copy(precipitationMode = it ?: "forbidden") }
                        if (enabled && !(index == 2 && draft.precipitationMode == "forbidden")) {
                            val indices = if (index == 4) listOf(4, 5) else listOf(index)
                            indices.forEach { numberIndex ->
                                val labels = listOf("Ветер максимум, м/с", "Порывы максимум, м/с", "Осадки максимум, мм/ч", "Вероятность максимум, %", "Температура минимум, °C", "Температура максимум, °C")
                                OutlinedTextField(value = values[numberIndex], onValueChange = { value -> values = values.toMutableList().also { it[numberIndex] = value } },
                                    label = { Text(labels[numberIndex]) }, enabled = !busy, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                            }
                        }
                    }
                    Row { Checkbox(checked = draft.isDefault, enabled = !busy, onCheckedChange = { draft = draft.copy(isDefault = it) }); Text("Использовать по умолчанию", Modifier.padding(12.dp)) }
                    if (original.id != null) TextButton(onClick = { delete = true }, enabled = !busy) { Text("Удалить этот профиль") }
                }
            }
        }
    }
    if (delete) AlertDialog(onDismissRequest = { delete = false }, title = { Text("Удалить профиль «${original.name}»?") }, text = { Text("Он исчезнет из ваших погодных профилей и на сайте. Сам прогноз и рабочие данные не удаляются.") },
        confirmButton = { TextButton(onClick = { delete = false; onSave(null) }) { Text("Удалить") } }, dismissButton = { TextButton(onClick = { delete = false }) { Text("Отмена") } })
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Закрыть без сохранения?") },
        confirmButton = { TextButton(onClick = onClose) { Text("Закрыть") } }, dismissButton = { TextButton(onClick = { discard = false }) { Text("Продолжить") } })
}
