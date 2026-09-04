package com.travkin.flow.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.travkin.flow.data.serverDate
import com.travkin.flow.domain.*

@Composable
fun NotificationCard(notification: CabinetNotification, busy: Boolean, onRead: () -> Unit, onOpen: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text((if (notification.read) "" else "● ") + notification.title, style = MaterialTheme.typography.titleMedium)
            notification.body?.let { Text(it) }
            Text(serverDate(notification.createdAt), style = MaterialTheme.typography.labelSmall)
            if (notification.destination != null) OutlinedButton(onClick = onOpen, enabled = !busy) { Text("Открыть раздел") }
            else Text("Ссылка ведёт за пределы кабинета Агронома.", style = MaterialTheme.typography.labelSmall)
            if (!notification.read) TextButton(onClick = onRead, enabled = !busy) { Text("Отметить прочитанным") }
        }
    }
}

@Composable
fun NotificationSettings(preferences: NotificationPreferences, busy: Boolean, onSave: (NotificationPreferences) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Настройки синхронизируются с сайтом. Это параметры событий аккаунта, не разрешение на системные Android push-уведомления.")
        listOf("Email-уведомления" to preferences.email, "Операции" to preferences.operations, "Склады" to preferences.warehouses, "Талоны" to preferences.tickets).forEachIndexed { index, (label, checked) ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(label, Modifier.weight(1f).padding(top = 12.dp))
                Switch(checked = checked, enabled = !busy, onCheckedChange = { value -> onSave(when(index) {
                    0 -> preferences.copy(email = value); 1 -> preferences.copy(operations = value); 2 -> preferences.copy(warehouses = value); else -> preferences.copy(tickets = value)
                }) })
            }
        }
    }
}
