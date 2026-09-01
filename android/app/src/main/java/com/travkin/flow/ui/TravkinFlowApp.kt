package com.travkin.flow.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Scale
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.travkin.flow.domain.Actor
import com.travkin.flow.domain.OperationalOverview
import com.travkin.flow.domain.SupportedRole
import java.text.DateFormat
import java.text.NumberFormat
import java.util.Date
import java.util.Locale

@Composable
fun TravkinFlowApp(viewModel: AppViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when (val current = state) {
            AppUiState.Booting -> BootScreen()
            is AppUiState.SignedOut -> LoginScreen(
                state = current,
                onSignIn = viewModel::signIn,
            )
            is AppUiState.SignedIn -> OperationalOverviewScreen(
                state = current,
                onRefresh = viewModel::refresh,
                onSignOut = viewModel::signOut,
            )
        }
    }
}

@Composable
private fun BootScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
            Spacer(Modifier.height(16.dp))
            Text("Проверяем защищённую сессию…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun LoginScreen(
    state: AppUiState.SignedOut,
    onSignIn: (String, String) -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val submit = { if (!state.signingIn) onSignIn(email, password) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Icon(
                imageVector = Icons.Default.Scale,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(44.dp),
            )
            Text(
                text = "TravkinFlow",
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Native Android",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                text = "Войдите в рабочий аккаунт. Пароль не сохраняется на устройстве.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (state.message != null) {
                MessageCard(state.message)
            }

            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Email") },
                singleLine = true,
                enabled = !state.signingIn,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next,
                ),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Пароль") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                enabled = !state.signingIn,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(onDone = { submit() }),
            )
            Button(
                onClick = submit,
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.signingIn && email.isNotBlank() && password.isNotBlank(),
            ) {
                if (state.signingIn) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Text("Войти")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OperationalOverviewScreen(
    state: AppUiState.SignedIn,
    onRefresh: () -> Unit,
    onSignOut: () -> Unit,
) {
    Scaffold(
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("TravkinFlow", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            state.actor.role.displayName,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                },
                actions = {
                    IconButton(onClick = onRefresh, enabled = !state.refreshing) {
                        Icon(Icons.Default.Refresh, contentDescription = "Обновить")
                    }
                    IconButton(onClick = onSignOut) {
                        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Выйти")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
    ) { contentPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        ) {
            item {
                RoleHeader(state.actor, state.stale)
            }

            if (state.refreshing) {
                item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
            }

            if (state.message != null) {
                item { MessageCard(state.message, offline = state.overview != null) }
            }

            val overview = state.overview
            if (overview == null) {
                item {
                    EmptyOverview(onRefresh)
                }
            } else {
                item { ShiftCard(overview) }
                items(metricRows(overview)) { row ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        MetricCard(row.first, modifier = Modifier.weight(1f))
                        MetricCard(row.second, modifier = Modifier.weight(1f))
                    }
                }
                item { RoleNextStepCard(state.actor.role) }
                item {
                    Text(
                        text = "Обновлено: ${formatDateTime(overview.fetchedAtEpochMillis)}",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun RoleHeader(actor: Actor, stale: Boolean) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("Оперативная сводка", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(
                text = actor.email ?: "Авторизованный пользователь",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = actor.companyId?.let { "Контекст компании подтверждён сервером" }
                    ?: "Контекст компании не выбран",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (stale) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.CloudOff,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        "Показан защищённый локальный cache",
                        modifier = Modifier.padding(start = 8.dp),
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

@Composable
private fun ShiftCard(overview: OperationalOverview) {
    Card {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Смена весовой", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                when {
                    overview.shiftStale -> "Открытая смена требует проверки"
                    overview.shiftOpen -> "Смена открыта"
                    else -> "Открытой смены нет"
                },
                color = if (overview.shiftStale) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            )
            HorizontalDivider()
            Text("${overview.shiftTrips} рейсов · ${formatKg(overview.shiftNetKg)}")
        }
    }
}

private data class Metric(val label: String, val value: String)

private fun metricRows(overview: OperationalOverview): List<Pair<Metric, Metric>> = listOf(
    Metric("Собрано сегодня", formatKg(overview.harvestedTodayKg)) to
        Metric("Активные талоны", overview.activeTickets.toString()),
    Metric("Требуют проверки", overview.requiresReview.toString()) to
        Metric("Зависшие", overview.stuckTickets.toString()),
    Metric("Не синхронизированы", overview.unsyncedTickets.toString()) to
        Metric("Ручные коррекции", overview.manualCorrections.toString()),
)

@Composable
private fun MetricCard(metric: Metric, modifier: Modifier = Modifier) {
    Card(modifier = modifier) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                metric.label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(metric.value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun RoleNextStepCard(role: SupportedRole) {
    val message = when (role) {
        SupportedRole.AGRONOMIST -> "Следующий native-модуль: урожай, структура посевов и талоны в режиме чтения."
        SupportedRole.WEIGHMAN -> "Следующий native-модуль: активные талоны, затем PIN-смена и взвешивание после E2E-гейта."
        SupportedRole.SPECIALIST -> "Следующий native-модуль: мои задачи и детали операций."
        SupportedRole.COMPANY_ADMIN -> "Следующий native-модуль: состояние компании и контроль операций."
        SupportedRole.GLOBAL_ADMIN -> "Следующий native-модуль: platform overview и выбор контекста компании."
    }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Native roadmap", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                "Бизнес-интерфейс полностью нативный.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

@Composable
private fun MessageCard(message: String, offline: Boolean = false) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (offline) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.errorContainer,
        ),
    ) {
        Text(
            text = message,
            modifier = Modifier.padding(14.dp),
            color = if (offline) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onErrorContainer,
        )
    }
}

@Composable
private fun EmptyOverview(onRefresh: () -> Unit) {
    Card {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Оперативная сводка пока недоступна.")
            Button(onClick = onRefresh) { Text("Повторить") }
        }
    }
}

private fun formatKg(value: Double): String =
    "${NumberFormat.getNumberInstance(RUSSIAN_LOCALE).apply { maximumFractionDigits = 1 }.format(value)} кг"

private fun formatDateTime(epochMillis: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, RUSSIAN_LOCALE)
        .format(Date(epochMillis))

private val RUSSIAN_LOCALE = Locale.forLanguageTag("ru-RU")
