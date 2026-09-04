package com.travkin.flow.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.travkin.flow.domain.DriverAssignment

@Composable
fun DriverAssignmentControls(assignment: DriverAssignment, busy: Boolean, onSave: (String?) -> Unit) {
    var selected by remember(assignment.vehicleId, assignment.assignmentId) { mutableStateOf(assignment.driverPersonId) }
    var confirm by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(assignment.vehicleName, style = MaterialTheme.typography.titleLarge)
        Text(assignment.plate ?: "Номер не указан")
        Text("Сейчас: ${assignment.driverName ?: "водитель не назначен"}")
        Text("Постоянное назначение, общее с сайтом. Исторические талоны не переписываются; с других машин водитель автоматически не снимается.")
        SelectOption("Водитель", selected, assignment.drivers, busy || !assignment.canEdit, optional = true) { selected = it }
        if (!assignment.canEdit) Text("Изменение недоступно для этого аккаунта.")
        Button(onClick = { confirm = true }, enabled = !busy && assignment.canEdit && selected != assignment.driverPersonId, modifier = Modifier.fillMaxWidth()) { Text("Сохранить назначение") }
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Изменить водителя?") },
        text = { Text("${assignment.vehicleName}: ${assignment.drivers.firstOrNull { it.id == selected }?.name ?: "без назначения"}. Изменение будет видно на сайте и в обороте машин.") },
        confirmButton = { TextButton(onClick = { confirm = false; onSave(selected) }) { Text("Подтвердить") } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Отмена") } })
}
