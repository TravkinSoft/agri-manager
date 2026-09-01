package com.travkin.flow.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
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
import androidx.compose.material3.OutlinedButton
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
import com.travkin.flow.domain.TicketDetails
import com.travkin.flow.domain.TicketLine
import com.travkin.flow.domain.TicketSummary
import java.text.DateFormat
import java.text.NumberFormat
import java.time.Instant
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
            is AppUiState.SignedIn -> SignedInScreen(
                state = current,
                onRefresh = viewModel::refresh,
                onSignOut = viewModel::signOut,
                onOpenTickets = viewModel::openTickets,
                onOpenTicket = viewModel::openTicket,
                onLoadMore = viewModel::loadMoreTickets,
                onBack = viewModel::navigateBack,
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

            state.message?.let { MessageCard(it) }

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
private fun SignedInScreen(
    state: AppUiState.SignedIn,
    onRefresh: () -> Unit,
    onSignOut: () -> Unit,
    onOpenTickets: () -> Unit,
    onOpenTicket: (TicketSummary) -> Unit,
    onLoadMore: () -> Unit,
    onBack: () -> Unit,
) {
    Scaffold(
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            TopAppBar(
                navigationIcon = {
                    if (state.destination != SignedInDestination.OVERVIEW) {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад")
                        }
                    }
                },
                title = {
                    Column {
                        Text(
                            text = when (state.destination) {
                                SignedInDestination.OVERVIEW -> "TravkinFlow"
                                SignedInDestination.TICKETS -> "Талоны"
                                SignedInDestination.TICKET_DETAIL -> "Талон"
                            },
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
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
        when (state.destination) {
            SignedInDestination.OVERVIEW -> OperationalOverviewContent(
                state = state,
                contentPadding = contentPadding,
                onRefresh = onRefresh,
                onOpenTickets = onOpenTickets,
            )
            SignedInDestination.TICKETS -> TicketListContent(
                state = state,
                contentPadding = contentPadding,
                onRefresh = onRefresh,
                onOpenTicket = onOpenTicket,
                onLoadMore = onLoadMore,
            )
            SignedInDestination.TICKET_DETAIL -> TicketDetailContent(
                state = state,
                contentPadding = contentPadding,
                onRefresh = onRefresh,
            )
        }
    }
}

@Composable
private fun OperationalOverviewContent(
    state: AppUiState.SignedIn,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
    onOpenTickets: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(16.dp),
    ) {
        item { RoleHeader(state.actor, state.overviewStale) }
        if (state.refreshing) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        state.message?.let { message -> item { MessageCard(message, offline = state.overview != null) } }

        val overview = state.overview
        if (overview == null) {
            item { EmptyState("Оперативная сводка пока недоступна.", onRefresh) }
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
            item {
                Button(onClick = onOpenTickets, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.AutoMirrored.Filled.List, contentDescription = null)
                    Text("Открыть талоны", modifier = Modifier.padding(start = 8.dp))
                }
            }
            item { RoleNextStepCard(state.actor.role) }
            item { UpdatedAt(overview.fetchedAtEpochMillis) }
        }
    }
}

@Composable
private fun TicketListContent(
    state: AppUiState.SignedIn,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
    onOpenTicket: (TicketSummary) -> Unit,
    onLoadMore: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(16.dp),
    ) {
        item {
            ReadOnlyCard("Нативный список доступен только для чтения. Доступ проверяет сервер.")
        }
        if (state.refreshing) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        if (state.ticketsStale) {
            item { MessageCard("Показан последний защищённый локальный список.", offline = true) }
        }
        state.message?.let { message -> item { MessageCard(message, offline = state.tickets != null) } }

        val page = state.tickets
        when {
            page == null && state.refreshing -> item { LoadingCard("Загружаем талоны…") }
            page == null -> item { EmptyState("Список талонов недоступен.", onRefresh) }
            page.tickets.isEmpty() -> item { EmptyState("Талонов пока нет.", onRefresh) }
            else -> {
                items(page.tickets, key = TicketSummary::id) { ticket ->
                    TicketSummaryCard(ticket = ticket, onClick = { onOpenTicket(ticket) })
                }
                if (page.historyHasMore) {
                    item {
                        OutlinedButton(
                            onClick = onLoadMore,
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !state.refreshing && page.historyLimit < 100,
                        ) {
                            Text("Загрузить ещё")
                        }
                    }
                }
                item { UpdatedAt(page.fetchedAtEpochMillis) }
            }
        }
    }
}

@Composable
private fun TicketDetailContent(
    state: AppUiState.SignedIn,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
) {
    val details = state.selectedTicket
    val summary = details?.summary ?: state.selectedTicketFallback
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(16.dp),
    ) {
        item { ReadOnlyCard("Карточка талона открыта в режиме чтения.") }
        if (state.refreshing) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        state.message?.let { message -> item { MessageCard(message, offline = summary != null) } }

        if (summary == null) {
            item { EmptyState("Талон недоступен.", onRefresh) }
        } else {
            item { TicketHeaderCard(summary) }
            item { TicketRouteCard(summary, details) }
            item { TicketWeightCard(summary, details) }
            if (details != null) {
                item { TicketPartiesCard(details) }
                if (details.lines.isNotEmpty()) {
                    item {
                        Text("Позиции", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    }
                    items(details.lines) { line -> TicketLineCard(line) }
                }
                details.notes?.takeIf(String::isNotBlank)?.let { notes ->
                    item { InfoCard("Примечание", notes) }
                }
            } else if (!state.refreshing) {
                item { MessageCard("Подробности не загружены; показаны данные из списка.", offline = true) }
            }
        }
    }
}

@Composable
private fun TicketSummaryCard(ticket: TicketSummary, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(ticket.ticketNo, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                StatusLabel(ticket.status)
            }
            Text(
                operationLabel(ticket.operationType, ticket.direction),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            ticket.fieldName?.takeIf(String::isNotBlank)?.let { Text("Поле: $it") }
            transportLabel(ticket)?.let { Text("Транспорт: $it") }
            ticket.destinationName?.takeIf(String::isNotBlank)?.let { Text("Назначение: $it") }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(ticket.netWeightKg?.let(::formatKg) ?: "Вес не указан", fontWeight = FontWeight.SemiBold)
                Text(formatServerDate(ticket.createdAt), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (ticket.requiresReview) {
                Text("Требует проверки", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun TicketHeaderCard(ticket: TicketSummary) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(ticket.ticketNo, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            StatusLabel(ticket.status)
            Text(operationLabel(ticket.operationType, ticket.direction))
            Text(formatServerDate(ticket.createdAt), color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (ticket.requiresReview) {
                Text("Требует проверки", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun TicketRouteCard(summary: TicketSummary, details: TicketDetails?) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Маршрут", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            DetailRow("Поле", summary.fieldName)
            DetailRow("Транспорт", transportLabel(summary))
            DetailRow("Водитель", summary.driverName)
            DetailRow("Со склада", details?.warehouseFrom)
            DetailRow("На склад", details?.warehouseTo ?: summary.destinationName)
        }
    }
}

@Composable
private fun TicketWeightCard(summary: TicketSummary, details: TicketDetails?) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Вес", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            DetailRow("Брутто", details?.grossWeightKg?.let(::formatKg))
            DetailRow("Тара", details?.tareWeightKg?.let(::formatKg))
            DetailRow("Нетто", summary.netWeightKg?.let(::formatKg))
        }
    }
}

@Composable
private fun TicketPartiesCard(details: TicketDetails) {
    val hasValues = listOf(details.companyName, details.supplierName, details.buyerName).any { !it.isNullOrBlank() }
    if (!hasValues) return
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Участники", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            DetailRow("Компания", details.companyName)
            DetailRow("Поставщик", details.supplierName)
            DetailRow("Покупатель", details.buyerName)
        }
    }
}

@Composable
private fun TicketLineCard(line: TicketLine) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(line.productName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            line.varietyName?.takeIf(String::isNotBlank)?.let { Text("Сорт: $it") }
            line.reproductionName?.takeIf(String::isNotBlank)?.let { Text("Репродукция: $it") }
            Text("Количество: ${formatQuantity(line.quantity)} ${line.unit}")
            line.moisturePercent?.let { Text("Влажность: ${formatQuantity(it)} %") }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String?) {
    val normalized = value?.takeIf(String::isNotBlank) ?: return
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(normalized, modifier = Modifier.weight(1.4f), fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun StatusLabel(status: String) {
    Surface(
        color = if (status.lowercase() in setOf("voided", "cancelled")) {
            MaterialTheme.colorScheme.errorContainer
        } else {
            MaterialTheme.colorScheme.secondaryContainer
        },
        shape = MaterialTheme.shapes.small,
    ) {
        Text(
            text = statusLabel(status),
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            style = MaterialTheme.typography.labelMedium,
        )
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
            Text(actor.email ?: "Авторизованный пользователь", color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                        "Показаны последние защищённые локальные данные",
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
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(metric.label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(metric.value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun RoleNextStepCard(role: SupportedRole) {
    val message = when (role) {
        SupportedRole.AGRONOMIST -> "Следующий native-модуль: урожай и структура посевов в режиме чтения."
        SupportedRole.WEIGHMAN -> "Запись веса остаётся закрыта до отдельного E2E-гейта."
        SupportedRole.SPECIALIST -> "Следующий native-модуль: мои задачи и детали операций."
        SupportedRole.COMPANY_ADMIN -> "Следующий native-модуль: состояние компании и контроль операций."
        SupportedRole.GLOBAL_ADMIN -> "Следующий native-модуль: platform overview и выбор контекста компании."
    }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Native roadmap", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Бизнес-интерфейс полностью нативный.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun ReadOnlyCard(message: String) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Text(message, modifier = Modifier.padding(14.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
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
private fun LoadingCard(message: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(20.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
            Text(message)
        }
    }
}

@Composable
private fun EmptyState(message: String, onRefresh: () -> Unit) {
    Card {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(message)
            Button(onClick = onRefresh) { Text("Повторить") }
        }
    }
}

@Composable
private fun InfoCard(title: String, value: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(value)
        }
    }
}

@Composable
private fun UpdatedAt(epochMillis: Long) {
    Text(
        text = "Обновлено: ${formatDateTime(epochMillis)}",
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

private fun transportLabel(ticket: TicketSummary): String? =
    listOf(ticket.vehicleName, ticket.vehiclePlate)
        .mapNotNull { it?.trim()?.takeIf(String::isNotEmpty) }
        .distinct()
        .joinToString(" · ")
        .takeIf(String::isNotEmpty)

private fun operationLabel(operationType: String, direction: String): String {
    val operation = when (operationType.lowercase()) {
        "harvest_incoming" -> "Приём урожая"
        "supplier_receipt" -> "Приём от поставщика"
        "warehouse_transfer" -> "Перемещение"
        "issue_to_field" -> "Выдача на поле"
        else -> operationType.replace('_', ' ').takeIf(String::isNotBlank) ?: "Операция"
    }
    val directionLabel = when (direction.lowercase()) {
        "incoming" -> "приход"
        "outgoing" -> "расход"
        "transfer" -> "перемещение"
        else -> direction.replace('_', ' ')
    }
    return listOf(operation, directionLabel.takeIf(String::isNotBlank)).filterNotNull().joinToString(" · ")
}

private fun statusLabel(status: String): String = when (status.lowercase()) {
    "draft" -> "Черновик"
    "active" -> "Активен"
    "ready_to_close" -> "Готов к закрытию"
    "finalized" -> "Завершён"
    "voided" -> "Аннулирован"
    else -> status.replace('_', ' ').takeIf(String::isNotBlank) ?: "Статус не указан"
}

private fun formatKg(value: Double): String = "${formatQuantity(value)} кг"

private fun formatQuantity(value: Double): String =
    NumberFormat.getNumberInstance(RUSSIAN_LOCALE).apply { maximumFractionDigits = 2 }.format(value)

private fun formatDateTime(epochMillis: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, RUSSIAN_LOCALE)
        .format(Date(epochMillis))

private fun formatServerDate(value: String): String = runCatching {
    formatDateTime(Date.from(Instant.parse(value)).time)
}.getOrElse { value.take(16).replace('T', ' ').ifBlank { "Дата не указана" } }

private val RUSSIAN_LOCALE = Locale.forLanguageTag("ru-RU")
