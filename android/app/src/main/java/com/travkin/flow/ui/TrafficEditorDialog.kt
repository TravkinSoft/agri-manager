package com.travkin.flow.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.travkin.flow.domain.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrafficEditorDialog(context: TrafficEditorData, accessOnly: Boolean, busy: Boolean, serverError: String?,
    onClose: () -> Unit, onSave: (Set<String>, Boolean) -> Unit) {
    var selected by remember(context) { mutableStateOf(context.assignedIds) }
    var emptyConfirmed by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }
    val close = { if (!busy) { if (selected != context.assignedIds && !accessOnly) discard = true else onClose() } }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)) {
        Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
            Scaffold(topBar = { TopAppBar(title = { Text(if (accessOnly) "Доступ сотрудников" else "Машины в работе") },
                navigationIcon = { TextButton(onClick = close, enabled = !busy) { Text("Закрыть") } }) }, bottomBar = {
                if (!accessOnly) Column(Modifier.fillMaxWidth().imePadding().padding(16.dp)) {
                    (error ?: serverError)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    Button(onClick = {
                        error = validateTrafficSelection(context, selected, emptyConfirmed)
                        if (error == null) confirm = true
                    }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Сохраняем…" else "Сохранить машины · ${selected.size}") }
                }
            }) { padding ->
                LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (accessOnly) {
                        item { Text("Сотрудники входят по своей почте и паролю TravkinFlow. Для приглашения или изменения роли обратитесь к администратору компании.") }
                        item { Text("Механизатор → Комбайнёр. Бригадир овощной → Приёмка картофеля. Эти кабинеты не открываются от имени Агронома.") }
                        items(context.accounts, key = { it.id }) { account -> Card {
                            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(account.name, style = MaterialTheme.typography.titleMedium)
                                Text(account.roleLabel)
                                Text(account.statusLabel)
                            }
                        } }
                        if (context.accounts.isEmpty()) item { Text("Пока нет аккаунтов с рабочими ролями.") }
                    } else {
                        item { Text("Выберите машины. Новые машины начинают со статуса «Пустая». Загруженную машину или машину на выгрузке можно убрать только после разгрузки.") }
                        item { OutlinedTextField(value = search, onValueChange = { search = it }, label = { Text("Название или номер") }, singleLine = true, modifier = Modifier.fillMaxWidth()) }
                        val visible = context.vehicles.filter { (it.name + " " + it.plate.orEmpty()).contains(search, true) }
                        items(visible, key = { it.id }) { vehicle ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                Checkbox(checked = vehicle.id in selected, enabled = !busy && !vehicle.locked, onCheckedChange = { checked ->
                                    selected = if (checked) selected + vehicle.id else selected - vehicle.id
                                    emptyConfirmed = false
                                    error = null
                                })
                                Column(Modifier.weight(1f).padding(8.dp)) {
                                    Text(vehicle.plate ?: "Номер не указан", style = MaterialTheme.typography.titleMedium)
                                    Text(vehicle.name)
                                    if (vehicle.locked) Text("В работе: снять после разгрузки", style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                        if (visible.isEmpty()) item { Text(if (context.vehicles.isEmpty()) "Нет доступных машин. Обратитесь к администратору справочника." else "Ничего не найдено.") }
                        if ((selected - context.assignedIds).isNotEmpty()) item {
                            Row { Checkbox(checked = emptyConfirmed, enabled = !busy, onCheckedChange = { emptyConfirmed = it }); Text("Добавляемые машины сейчас пустые.", Modifier.padding(12.dp)) }
                        }
                    }
                }
            }
        }
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Обновить состав машин?") },
        text = { Text("Добавится: ${(selected - context.assignedIds).size}. Убирается: ${(context.assignedIds - selected).size}. Изменение будет видно на сайте и в рабочих кабинетах сотрудников.") },
        confirmButton = { TextButton(onClick = { confirm = false; onSave(selected, emptyConfirmed) }) { Text("Подтвердить") } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Отмена") } })
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Закрыть без сохранения?") },
        confirmButton = { TextButton(onClick = onClose) { Text("Закрыть") } }, dismissButton = { TextButton(onClick = { discard = false }) { Text("Продолжить") } })
}
