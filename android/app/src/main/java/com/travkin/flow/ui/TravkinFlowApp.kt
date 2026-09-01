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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Scale
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import com.travkin.flow.domain.HarvestFieldSummary
import com.travkin.flow.domain.HarvestIssue
import com.travkin.flow.domain.HarvestMoistureSummary
import com.travkin.flow.domain.HarvestOverview
import com.travkin.flow.domain.HarvestAllocationOption
import com.travkin.flow.domain.HarvestTicketDraft
import com.travkin.flow.domain.OperationalOverview
import com.travkin.flow.domain.SupportedRole
import com.travkin.flow.domain.TicketDetails
import com.travkin.flow.domain.TicketLine
import com.travkin.flow.domain.TicketSummary
import com.travkin.flow.domain.WarehouseObjectSummary
import com.travkin.flow.domain.WarehouseOverview
import com.travkin.flow.domain.WeighbridgeResourceOption
import com.travkin.flow.domain.WeighbridgeWorkspace
import com.travkin.flow.domain.KatoLocality
import com.travkin.flow.domain.WeatherForecast
import com.travkin.flow.domain.WeatherPoint
import com.travkin.flow.domain.UserNotification
import java.text.DateFormat
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
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
                onOpenHarvest = viewModel::openHarvestOverview,
                onOpenWarehouses = viewModel::openWarehouses,
                onOpenWeighbridge = viewModel::openWeighbridge,
                onOpenWeather = viewModel::openWeather,
                onOpenProfile = viewModel::openProfile,
                onOpenNotifications = viewModel::openNotifications,
                onSearchWeather = viewModel::searchWeatherLocations,
                onSelectWeatherLocation = viewModel::selectWeatherLocation,
                onSelectWeighbridgeTicket = viewModel::selectWeighbridgeTicket,
                onUnlockOperator = viewModel::unlockWeighbridgeOperator,
                onLockOperator = viewModel::lockWeighbridgeOperator,
                onCreateHarvestTicket = viewModel::createHarvestTicket,
                onSaveGrossWeight = viewModel::saveGrossWeight,
                onFinalizeTicket = viewModel::finalizeWeighbridgeTicket,
                onRetryPending = viewModel::retryPendingWeighbridgeCommands,
                onConfirmTareVariance = viewModel::confirmTareVariance,
                onDismissTareVariance = viewModel::dismissTareVariance,
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
    var password by remember { mutableStateOf("") }
    val submit = { if (!state.signingIn) onSignIn(email, password) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(vertical = 24.dp),
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
    onOpenHarvest: () -> Unit,
    onOpenWarehouses: () -> Unit,
    onOpenWeighbridge: () -> Unit,
    onOpenWeather: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenNotifications: () -> Unit,
    onSearchWeather: (String) -> Unit,
    onSelectWeatherLocation: (KatoLocality) -> Unit,
    onSelectWeighbridgeTicket: (TicketSummary?) -> Unit,
    onUnlockOperator: (String, String, String?) -> Unit,
    onLockOperator: () -> Unit,
    onCreateHarvestTicket: (HarvestTicketDraft) -> Unit,
    onSaveGrossWeight: (TicketSummary, Double) -> Unit,
    onFinalizeTicket: (TicketSummary, Double, Boolean) -> Unit,
    onRetryPending: () -> Unit,
    onConfirmTareVariance: () -> Unit,
    onDismissTareVariance: () -> Unit,
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
                                SignedInDestination.HARVEST -> "Урожай"
                                SignedInDestination.WAREHOUSES -> "Склады и объекты"
                                SignedInDestination.WEIGHBRIDGE -> "Весовая"
                                SignedInDestination.WEATHER -> "Погода"
                                SignedInDestination.PROFILE -> "Профиль"
                                SignedInDestination.NOTIFICATIONS -> "Уведомления"
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
                onOpenHarvest = onOpenHarvest,
                onOpenWarehouses = onOpenWarehouses,
                onOpenWeighbridge = onOpenWeighbridge,
                onOpenWeather = onOpenWeather,
                onOpenProfile = onOpenProfile,
                onOpenNotifications = onOpenNotifications,
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
            SignedInDestination.HARVEST -> HarvestOverviewContent(
                state = state,
                contentPadding = contentPadding,
                onRefresh = onRefresh,
            )
            SignedInDestination.WAREHOUSES -> WarehouseOverviewContent(
                state = state,
                contentPadding = contentPadding,
                onRefresh = onRefresh,
            )
            SignedInDestination.WEIGHBRIDGE -> WeighbridgeWorkspaceContent(
                state = state,
                contentPadding = contentPadding,
                onRefresh = onRefresh,
                onSelectTicket = onSelectWeighbridgeTicket,
                onUnlockOperator = onUnlockOperator,
                onLockOperator = onLockOperator,
                onCreateHarvestTicket = onCreateHarvestTicket,
                onSaveGrossWeight = onSaveGrossWeight,
                onFinalizeTicket = onFinalizeTicket,
                onRetryPending = onRetryPending,
                onConfirmTareVariance = onConfirmTareVariance,
                onDismissTareVariance = onDismissTareVariance,
            )
            SignedInDestination.WEATHER -> WeatherContent(
                state = state,
                contentPadding = contentPadding,
                onRefresh = onRefresh,
                onSearch = onSearchWeather,
                onSelectLocation = onSelectWeatherLocation,
            )
            SignedInDestination.PROFILE -> ProfileContent(
                state = state,
                contentPadding = contentPadding,
                onSignOut = onSignOut,
            )
            SignedInDestination.NOTIFICATIONS -> NotificationCenterContent(
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
    onOpenHarvest: () -> Unit,
    onOpenWarehouses: () -> Unit,
    onOpenWeighbridge: () -> Unit,
    onOpenWeather: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenNotifications: () -> Unit,
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
            if (state.actor.role.canViewHarvest) {
                item {
                    OutlinedButton(
                        onClick = onOpenHarvest,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = state.actor.companyId != null,
                    ) {
                        Text(
                            if (state.actor.companyId == null) "Сначала выберите компанию" else "Сводка урожая",
                        )
                    }
                }
            }
            if (state.actor.role.canViewWarehouses) {
                item {
                    OutlinedButton(
                        onClick = onOpenWarehouses,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = state.actor.companyId != null,
                    ) {
                        Text(
                            if (state.actor.companyId == null) "Сначала выберите компанию" else "Склады и объекты",
                        )
                    }
                }
            }
            if (state.actor.role.canUseWeighbridgeWorkspace) {
                item {
                    OutlinedButton(
                        onClick = onOpenWeighbridge,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = state.actor.companyId != null,
                    ) {
                        Text(if (state.actor.companyId == null) "Сначала выберите компанию" else "Весовая")
                    }
                }
            }
            if (state.actor.role.canViewWeather) {
                item {
                    OutlinedButton(onClick = onOpenWeather, modifier = Modifier.fillMaxWidth()) {
                        Text("Погода")
                    }
                }
            }
            item {
                OutlinedButton(onClick = onOpenNotifications, modifier = Modifier.fillMaxWidth()) {
                    Text("Уведомления")
                }
            }
            item {
                OutlinedButton(onClick = onOpenProfile, modifier = Modifier.fillMaxWidth()) {
                    Text("Профиль и сессия")
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
private fun HarvestOverviewContent(
    state: AppUiState.SignedIn,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
) {
    val overview = state.harvestOverview
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(16.dp),
    ) {
        item { ReadOnlyCard("Сводка урожая доступна только для чтения и ограничена контекстом компании.") }
        if (state.refreshing) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        if (state.harvestStale) {
            item { MessageCard("Показана последняя защищённая локальная сводка.", offline = true) }
        }
        state.message?.let { message -> item { MessageCard(message, offline = overview != null) } }

        when {
            overview == null && state.refreshing -> item { LoadingCard("Собираем сводку урожая…") }
            overview == null -> item { EmptyState("Сводка урожая недоступна.", onRefresh) }
            else -> {
                item { HarvestHeadlineCard(overview) }
                if (overview.cropTotals.isNotEmpty()) {
                    item { SectionTitle("По культурам") }
                    items(overview.cropTotals, key = { it.key.ifBlank { it.cropName } }) { crop ->
                        InfoCard(
                            title = crop.cropName,
                            value = "${formatKg(crop.receivedKg)} · ${crop.trips} рейсов",
                        )
                    }
                }
                if (overview.fields.isNotEmpty()) {
                    item { SectionTitle("По полям") }
                    items(overview.fields, key = { it.key.ifBlank { it.fieldName } }) { field ->
                        HarvestFieldCard(field)
                    }
                }
                if (overview.moisture.isNotEmpty()) {
                    item { SectionTitle("Влажность") }
                    items(overview.moisture, key = { it.key.ifBlank { "${it.fieldName}-${it.cropName}" } }) { row ->
                        HarvestMoistureCard(row)
                    }
                }
                if (overview.issues.isNotEmpty()) {
                    item { SectionTitle("Требует внимания") }
                    items(overview.issues, key = { it.key.ifBlank { it.title } }) { issue ->
                        HarvestIssueCard(issue)
                    }
                }
                item { UpdatedAt(overview.fetchedAtEpochMillis) }
            }
        }
    }
}

@Composable
private fun WeighbridgeWorkspaceContent(
    state: AppUiState.SignedIn,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
    onSelectTicket: (TicketSummary?) -> Unit,
    onUnlockOperator: (String, String, String?) -> Unit,
    onLockOperator: () -> Unit,
    onCreateHarvestTicket: (HarvestTicketDraft) -> Unit,
    onSaveGrossWeight: (TicketSummary, Double) -> Unit,
    onFinalizeTicket: (TicketSummary, Double, Boolean) -> Unit,
    onRetryPending: () -> Unit,
    onConfirmTareVariance: () -> Unit,
    onDismissTareVariance: () -> Unit,
) {
    val workspace = state.weighbridgeWorkspace
    val writesAvailable = workspace?.writesEnabled == true && workspace.stationContractAvailable
    val queue = state.tickets?.tickets.orEmpty().filter { ticket ->
        ticket.operationType.equals("harvest_incoming", ignoreCase = true) &&
            ticket.status.lowercase() !in setOf("finalized", "voided", "cancelled")
    }

    state.tareVarianceConfirmation?.let { confirmation ->
        AlertDialog(
            onDismissRequest = onDismissTareVariance,
            title = { Text("Подтвердите отклонение тары") },
            text = {
                Text(
                    listOfNotNull(
                        confirmation.previousTareKg?.let { "Предыдущая: ${formatKg(it)}" },
                        confirmation.currentTareKg?.let { "Текущая: ${formatKg(it)}" },
                        confirmation.differencePercent?.let { "Отклонение: ${formatQuantity(it)} %" },
                    ).joinToString("\n").ifBlank { "Тара заметно отличается от предыдущей." },
                )
            },
            confirmButton = {
                TextButton(onClick = onConfirmTareVariance, enabled = !state.writeBusy) {
                    Text("Подтвердить повторно")
                }
            },
            dismissButton = { TextButton(onClick = onDismissTareVariance) { Text("Отмена") } },
        )
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(16.dp),
    ) {
        if (state.refreshing) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        state.message?.let { message -> item { MessageCard(message, offline = workspace != null) } }
        if (workspace == null) {
            item { EmptyState("Рабочее место Весовой пока недоступно.", onRefresh) }
        } else {
            item { WeighbridgeStationCard(workspace) }
            item {
                WeighbridgeOperatorCard(
                    workspace = workspace,
                    writesAvailable = writesAvailable,
                    busy = state.writeBusy,
                    onUnlockOperator = onUnlockOperator,
                    onLockOperator = onLockOperator,
                )
            }
            if (workspace.resourceErrors.isNotEmpty()) {
                item { MessageCard("Не все справочники доступны: ${workspace.resourceErrors.joinToString()}") }
            }
            if (workspace.pendingCommandCount > 0) {
                item {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Ожидают отправки: ${workspace.pendingCommandCount}", fontWeight = FontWeight.SemiBold)
                            Text("Команды хранятся зашифрованно и повторяются с теми же ключами без дублей.")
                            Button(onClick = onRetryPending, enabled = writesAvailable && !state.writeBusy) {
                                Text("Повторить отправку")
                            }
                        }
                    }
                }
            }
            item { SectionTitle("Очередь приёмки") }
            if (queue.isEmpty()) {
                item { ReadOnlyCard("Открытых талонов приёмки урожая нет.") }
            } else {
                items(queue, key = TicketSummary::id) { ticket ->
                    TicketSummaryCard(ticket) { onSelectTicket(ticket) }
                }
            }
            state.selectedWeighbridgeTicket?.let { selected ->
                item {
                    WeighbridgeTicketWorkCard(
                        ticket = selected,
                        writesAvailable = writesAvailable,
                        unlocked = workspace.unlocked,
                        busy = state.writeBusy,
                        onClose = { onSelectTicket(null) },
                        onSaveGrossWeight = onSaveGrossWeight,
                        onFinalizeTicket = onFinalizeTicket,
                    )
                }
            }
            if (state.selectedWeighbridgeTicket == null && writesAvailable && workspace.unlocked && workspace.shift != null) {
                item {
                    CreateHarvestTicketCard(
                        workspace = workspace,
                        busy = state.writeBusy,
                        onCreate = onCreateHarvestTicket,
                    )
                }
            }
            if (!writesAvailable) {
                item {
                    ReadOnlyCard(
                        "Запись закрыта fail-closed. Backend gap: нет серверного каталога весовых станций и API подтверждения выбранной станции. Локальный ID не даёт права записи.",
                    )
                }
            }
            item { UpdatedAt(workspace.fetchedAtEpochMillis) }
        }
    }
}

@Composable
private fun WeighbridgeStationCard(workspace: WeighbridgeWorkspace) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Весовая станция", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text("Локальное устройство: ${workspace.localWorkstationId}")
            Text(
                if (workspace.stationContractAvailable) "Станция подтверждена сервером."
                else "Станция не подтверждена сервером: выбор и запись заблокированы.",
                color = if (workspace.stationContractAvailable) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun WeighbridgeOperatorCard(
    workspace: WeighbridgeWorkspace,
    writesAvailable: Boolean,
    busy: Boolean,
    onUnlockOperator: (String, String, String?) -> Unit,
    onLockOperator: () -> Unit,
) {
    var operatorId by rememberSaveable(workspace.localWorkstationId) { mutableStateOf<String?>(workspace.operator?.id) }
    var pin by remember { mutableStateOf("") }
    var note by rememberSaveable(workspace.localWorkstationId) { mutableStateOf("") }
    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Смена и оператор", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            DetailRow("Статус смены", workspace.shift?.status ?: "Нет открытой смены")
            DetailRow("Открыта", workspace.shift?.openedAt?.let(::formatServerDate))
            DetailRow("Сменщик", workspace.operator?.name)
            if (!writesAvailable) {
                Text("PIN-вход и открытие/передача смены заблокированы до появления серверного station contract.")
            } else if (workspace.unlocked) {
                Button(onClick = onLockOperator, enabled = !busy) { Text("Заблокировать терминал") }
            } else {
                ChoiceField(
                    label = "Сменщик",
                    selectedId = operatorId,
                    choices = workspace.operators.map { Choice(it.id, it.name) },
                    enabled = !busy,
                    onSelect = { operatorId = it },
                )
                OutlinedTextField(
                    value = pin,
                    onValueChange = { value -> pin = value.filter(Char::isDigit).take(6) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("PIN, 6 цифр") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    singleLine = true,
                    enabled = !busy,
                )
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it.take(300) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Комментарий передачи смены (необязательно)") },
                    enabled = !busy,
                )
                Button(
                    onClick = {
                        val selected = operatorId ?: return@Button
                        onUnlockOperator(selected, pin, note.takeIf(String::isNotBlank))
                        pin = ""
                    },
                    enabled = !busy && operatorId != null && pin.length == 6,
                ) { Text(if (workspace.shift == null) "Открыть смену" else "Подтвердить сменщика") }
            }
        }
    }
}

@Composable
private fun CreateHarvestTicketCard(
    workspace: WeighbridgeWorkspace,
    busy: Boolean,
    onCreate: (HarvestTicketDraft) -> Unit,
) {
    val allocations = workspace.allocations.filterNot(HarvestAllocationOption::incomplete)
    var allocationId by rememberSaveable { mutableStateOf<String?>(null) }
    var destinationId by rememberSaveable { mutableStateOf<String?>(null) }
    var vehicleId by rememberSaveable { mutableStateOf<String?>(null) }
    var driverId by rememberSaveable { mutableStateOf<String?>(null) }
    var gross by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var pendingDraft by remember { mutableStateOf<HarvestTicketDraft?>(null) }
    val allocation = allocations.firstOrNull { it.id == allocationId }
    val grossValue = gross.replace(',', '.').toDoubleOrNull()

    pendingDraft?.let { draft ->
        AlertDialog(
            onDismissRequest = { pendingDraft = null },
            title = { Text("Создать талон приёмки?") },
            text = { Text("${allocation?.fieldName} → ${workspace.destinations.firstOrNull { it.id == draft.destinationId }?.name}\nБрутто: ${formatKg(draft.grossWeightKg)}") },
            confirmButton = {
                TextButton(onClick = { pendingDraft = null; onCreate(draft) }) { Text("Создать") }
            },
            dismissButton = { TextButton(onClick = { pendingDraft = null }) { Text("Отмена") } },
        )
    }

    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Новый талон приёмки", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            ChoiceField(
                label = "Поле и культура",
                selectedId = allocationId,
                choices = allocations.map { Choice(it.id, "${it.fieldName} · ${it.cropName}") },
                enabled = !busy,
                onSelect = { allocationId = it },
            )
            ChoiceField("Место приёмки", destinationId, workspace.destinations.toChoices(), !busy) { destinationId = it }
            ChoiceField("Транспорт (необязательно)", vehicleId, workspace.vehicles.toChoices(optional = true), !busy) { vehicleId = it }
            ChoiceField("Водитель (необязательно)", driverId, workspace.drivers.toChoices(optional = true), !busy) { driverId = it }
            OutlinedTextField(
                value = gross,
                onValueChange = { gross = it.filter { char -> char.isDigit() || char == ',' || char == '.' }.take(12) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Брутто, кг") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                enabled = !busy,
                singleLine = true,
            )
            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it.take(500) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Примечание") },
                enabled = !busy,
            )
            Button(
                onClick = {
                    val selected = allocation ?: return@Button
                    val destination = destinationId ?: return@Button
                    val weight = grossValue ?: return@Button
                    pendingDraft = HarvestTicketDraft(
                        allocationId = selected.id,
                        fieldId = selected.fieldId,
                        cropId = selected.cropId,
                        varietyId = selected.varietyId,
                        reproductionId = selected.reproductionId,
                        destinationId = destination,
                        vehicleId = vehicleId,
                        driverId = driverId,
                        grossWeightKg = weight,
                        notes = notes.trim().takeIf(String::isNotEmpty),
                    )
                },
                enabled = !busy && allocation != null && destinationId != null && grossValue != null && grossValue > 0,
            ) { Text("Проверить и создать") }
        }
    }
}

@Composable
private fun WeighbridgeTicketWorkCard(
    ticket: TicketSummary,
    writesAvailable: Boolean,
    unlocked: Boolean,
    busy: Boolean,
    onClose: () -> Unit,
    onSaveGrossWeight: (TicketSummary, Double) -> Unit,
    onFinalizeTicket: (TicketSummary, Double, Boolean) -> Unit,
) {
    var grossInput by rememberSaveable(ticket.id) { mutableStateOf(ticket.grossWeightKg?.toString().orEmpty()) }
    var tareInput by rememberSaveable(ticket.id) { mutableStateOf("") }
    var confirmGross by remember { mutableStateOf<Double?>(null) }
    var confirmTare by remember { mutableStateOf<Double?>(null) }
    val gross = ticket.grossWeightKg ?: grossInput.replace(',', '.').toDoubleOrNull()
    val tare = tareInput.replace(',', '.').toDoubleOrNull()

    confirmGross?.let { value ->
        AlertDialog(
            onDismissRequest = { confirmGross = null },
            title = { Text("Сохранить брутто?") },
            text = { Text("Талон ${ticket.ticketNo}: ${formatKg(value)}") },
            confirmButton = { TextButton(onClick = { confirmGross = null; onSaveGrossWeight(ticket, value) }) { Text("Сохранить") } },
            dismissButton = { TextButton(onClick = { confirmGross = null }) { Text("Отмена") } },
        )
    }
    confirmTare?.let { value ->
        AlertDialog(
            onDismissRequest = { confirmTare = null },
            title = { Text("Завершить талон?") },
            text = { Text("Тара: ${formatKg(value)}\nНетто: ${formatKg((ticket.grossWeightKg ?: 0.0) - value)}") },
            confirmButton = { TextButton(onClick = { confirmTare = null; onFinalizeTicket(ticket, value, false) }) { Text("Завершить") } },
            dismissButton = { TextButton(onClick = { confirmTare = null }) { Text("Отмена") } },
        )
    }

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Продолжить ${ticket.ticketNo}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                TextButton(onClick = onClose) { Text("Закрыть") }
            }
            DetailRow("Маршрут", listOfNotNull(ticket.fieldName, ticket.destinationName).joinToString(" → "))
            DetailRow("Обработка", ticket.linkedProcessingId)
            DetailRow("Партия", ticket.harvestLotId)
            DetailRow("Брутто", ticket.grossWeightKg?.let(::formatKg))
            DetailRow("Тара", ticket.tareWeightKg?.let(::formatKg))
            DetailRow("Нетто", ticket.netWeightKg?.let(::formatKg))
            if (!writesAvailable || !unlocked) {
                Text("Изменение веса недоступно: нужна подтверждённая станция и разблокированный сменщик.")
            } else if (ticket.grossWeightKg == null) {
                OutlinedTextField(
                    value = grossInput,
                    onValueChange = { grossInput = it.filter { char -> char.isDigit() || char == ',' || char == '.' }.take(12) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Брутто, кг") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    enabled = !busy,
                    singleLine = true,
                )
                Button(onClick = { gross?.takeIf { it > 0 }?.let { confirmGross = it } }, enabled = !busy && gross != null && gross > 0) {
                    Text("Проверить брутто")
                }
            } else {
                OutlinedTextField(
                    value = tareInput,
                    onValueChange = { tareInput = it.filter { char -> char.isDigit() || char == ',' || char == '.' }.take(12) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Тара, кг") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    enabled = !busy,
                    singleLine = true,
                )
                if (tare != null && tare >= 0 && tare < ticket.grossWeightKg) {
                    Text("Расчётное нетто: ${formatKg(ticket.grossWeightKg - tare)}", fontWeight = FontWeight.SemiBold)
                }
                Button(
                    onClick = { tare?.let { confirmTare = it } },
                    enabled = !busy && tare != null && tare >= 0 && tare < ticket.grossWeightKg,
                ) { Text("Проверить и завершить") }
            }
        }
    }
}

private data class Choice(val id: String?, val label: String)

@Composable
private fun ChoiceField(
    label: String,
    selectedId: String?,
    choices: List<Choice>,
    enabled: Boolean,
    onSelect: (String?) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selected = choices.firstOrNull { it.id == selectedId }?.label ?: "Не выбрано"
    Box(modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth(), enabled = enabled) {
            Text("$label: $selected", maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            choices.forEach { choice ->
                DropdownMenuItem(
                    text = { Text(choice.label) },
                    onClick = { expanded = false; onSelect(choice.id) },
                )
            }
        }
    }
}

private fun List<WeighbridgeResourceOption>.toChoices(optional: Boolean = false): List<Choice> =
    (if (optional) listOf(Choice(null, "Не указано")) else emptyList()) + map { option ->
        Choice(option.id, listOfNotNull(option.name, option.secondary).joinToString(" · "))
    }

@Composable
private fun WeatherContent(
    state: AppUiState.SignedIn,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
    onSearch: (String) -> Unit,
    onSelectLocation: (KatoLocality) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val forecast = state.weatherForecast
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(16.dp),
    ) {
        item {
            ReadOnlyCard(
                "Нативный прогноз работает только через подтверждённые read-only API КАТО и UAV Forecast. Weather Lab profiles не изменяются.",
            )
        }
        if (state.refreshing) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        state.message?.let { message -> item { MessageCard(message, offline = forecast != null) } }
        item {
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Населённый пункт", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it.take(100) },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Название на русском или казахском") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { if (query.trim().length >= 2) onSearch(query) }),
                    )
                    Button(
                        onClick = { onSearch(query) },
                        enabled = query.trim().length >= 2 && !state.weatherSearching,
                    ) {
                        if (state.weatherSearching) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                        } else {
                            Text("Найти по КАТО")
                        }
                    }
                }
            }
        }
        if (state.weatherSearchResults.isNotEmpty()) {
            item { SectionTitle("Результаты поиска") }
            items(state.weatherSearchResults, key = KatoLocality::code) { locality ->
                Card(onClick = { onSelectLocation(locality) }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(locality.nameRu, fontWeight = FontWeight.SemiBold)
                        locality.nameKz?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        Text(
                            listOfNotNull(locality.districtRu, locality.regionRu).distinct().joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        } else if (state.weatherQuery.trim().length >= 2 && !state.weatherSearching) {
            item { ReadOnlyCard("По запросу ничего не найдено.") }
        }
        if (forecast == null) {
            item { ReadOnlyCard("Выберите населённый пункт, чтобы загрузить прогноз.") }
        } else {
            item { WeatherCurrentCard(forecast, state.weatherStale) }
            forecast.sun.firstOrNull()?.let { sun ->
                item {
                    InfoCard(
                        "Солнце",
                        "Восход: ${sun.sunrise?.let { formatWeatherTime(it, forecast.providerMeta.timezone) } ?: "—"} · Закат: ${sun.sunset?.let { formatWeatherTime(it, forecast.providerMeta.timezone) } ?: "—"}",
                    )
                }
            }
            item { SectionTitle("Ближайшие 24 часа") }
            if (forecast.hourlyForecast.isEmpty()) {
                item { ReadOnlyCard("Почасовой прогноз не получен.") }
            } else {
                items(forecast.hourlyForecast.take(24), key = WeatherPoint::time) { point ->
                    WeatherHourCard(point, forecast.providerMeta.timezone)
                }
            }
            item {
                Text(
                    "Источник: ${forecast.providerMeta.provider} · кэш: ${forecast.providerMeta.cache} · горизонт: ${forecast.providerMeta.forecastHours} ч",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item { UpdatedAt(forecast.fetchedAtEpochMillis) }
        }
    }
}

@Composable
private fun WeatherCurrentCard(forecast: WeatherForecast, stale: Boolean) {
    val point = forecast.current
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(forecast.location.displayName, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(point.temperatureC?.let { "${formatQuantity(it)} °C" } ?: "Температура не указана", style = MaterialTheme.typography.headlineMedium)
            DetailRow("Ветер", point.windMs?.let { "${formatQuantity(it)} м/с" })
            DetailRow("Порывы", point.gustMs?.let { "${formatQuantity(it)} м/с" })
            DetailRow("Осадки", weatherPrecipitation(point))
            DetailRow("Влажность", point.humidityPct?.let { "${formatQuantity(it)} %" })
            DetailRow("Видимость", point.visibilityKm?.let { "${formatQuantity(it)} км" })
            if (stale || forecast.stale) {
                Text("Показан последний защищённый локальный прогноз.", color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun WeatherHourCard(point: WeatherPoint, timezone: String?) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(formatWeatherTime(point.time, timezone), modifier = Modifier.weight(1.2f), fontWeight = FontWeight.SemiBold)
            Text(point.temperatureC?.let { "${formatQuantity(it)} °C" } ?: "—", modifier = Modifier.weight(0.8f))
            Text(point.windMs?.let { "${formatQuantity(it)} м/с" } ?: "—", modifier = Modifier.weight(0.8f))
            Text(
                point.precipitationProbabilityPct?.let { "${formatQuantity(it)} %" } ?: "—",
                modifier = Modifier.weight(0.7f),
            )
        }
    }
}

private fun weatherPrecipitation(point: WeatherPoint): String? {
    val values = listOfNotNull(
        point.precipitationProbabilityPct?.let { "${formatQuantity(it)} %" },
        point.precipitationRateMmH?.let { "${formatQuantity(it)} мм/ч" },
        point.precipitationType?.takeIf(String::isNotBlank),
    )
    return values.joinToString(" · ").takeIf(String::isNotEmpty)
}

private fun formatWeatherTime(value: String, timezone: String?): String = runCatching {
    val zone = timezone?.let(ZoneId::of) ?: ZoneId.systemDefault()
    Instant.parse(value).atZone(zone).format(DateTimeFormatter.ofPattern("dd.MM HH:mm", RUSSIAN_LOCALE))
}.getOrElse { formatServerDate(value) }

@Composable
private fun ProfileContent(
    state: AppUiState.SignedIn,
    contentPadding: PaddingValues,
    onSignOut: () -> Unit,
) {
    val snapshot = state.profileSession
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(16.dp),
    ) {
        item {
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Text("Текущий пользователь", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    DetailRow("Email", state.actor.email ?: "Не указан сервером")
                    DetailRow("Роль", state.actor.role.displayName)
                    DetailRow("Actor ID", state.actor.id)
                    DetailRow("Компания", state.actor.companyId ?: "Контекст компании не выбран")
                    DetailRow("Канал приложения", com.travkin.flow.BuildConfig.APP_CHANNEL)
                }
            }
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Защищённая сессия", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    DetailRow(
                        "Actor подтверждён",
                        snapshot?.actorVerifiedAtEpochMillis?.let(::formatDateTime) ?: "Время проверки недоступно",
                    )
                    DetailRow(
                        "Сессия действует до",
                        snapshot?.sessionExpiresAtEpochSeconds?.let { formatDateTime(it * 1_000) }
                            ?: "Срок недоступен",
                    )
                    Text(
                        "Токены и пароль не показываются. Сессия и actor-scoped cache хранятся в Android Keystore AES-GCM.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        item {
            Button(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) {
                Text("Безопасно выйти")
            }
        }
        item {
            ReadOnlyCard(
                "Logout сначала локально удаляет сессию, actor, operator cookie и все actor-scoped encrypted caches, сразу возвращает login, затем best-effort отзывает серверную сессию.",
            )
        }
    }
}

@Composable
private fun NotificationCenterContent(
    state: AppUiState.SignedIn,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
) {
    val center = state.notificationCenter
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(16.dp),
    ) {
        item {
            ReadOnlyCard(
                "Read-only центр загружается напрямую через Supabase PostgREST. RLS возвращает только записи, где recipient_user_id совпадает с текущим auth.uid().",
            )
        }
        if (state.refreshing) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        state.message?.let { message -> item { MessageCard(message, offline = center != null) } }
        if (state.notificationsStale && center != null) {
            item { ReadOnlyCard("Показаны последние защищённые локальные уведомления.") }
        }
        if (center == null) {
            item { EmptyState("Уведомления пока недоступны.", onRefresh) }
        } else {
            item {
                InfoCard("Непрочитанные", center.unreadCount.toString())
            }
            if (center.notifications.isEmpty()) {
                item { ReadOnlyCard("Событий пока нет.") }
            } else {
                items(center.notifications, key = UserNotification::id) { notification ->
                    NotificationCard(notification)
                }
            }
            item { UpdatedAt(center.fetchedAtEpochMillis) }
        }
        item {
            ReadOnlyCard(
                "Push gap: Firebase/FCM SDK, регистрация device token и backend отправки push отсутствуют. Native push не симулируется; новые события появляются после ручного обновления.",
            )
        }
        item {
            ReadOnlyCard(
                "Отметка «прочитано», переход по web href и Realtime в этом slice отключены: экран выполняет только SELECT и не делает DB writes.",
            )
        }
    }
}

@Composable
private fun NotificationCard(notification: UserNotification) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (notification.readAt == null) {
                MaterialTheme.colorScheme.secondaryContainer
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(notification.title, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                if (notification.readAt == null) Text("Новое", color = MaterialTheme.colorScheme.primary)
            }
            notification.body?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Text(
                "${notificationCategoryLabel(notification.category)} · ${formatServerDate(notification.createdAt)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun notificationCategoryLabel(category: String): String = when (category.lowercase()) {
    "operation" -> "Операция"
    "warehouse" -> "Склад"
    "weighbridge" -> "Весовая"
    "assistant" -> "Ассистент"
    else -> "Система"
}

@Composable
private fun WarehouseOverviewContent(
    state: AppUiState.SignedIn,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
) {
    val overview = state.warehouseOverview
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(16.dp),
    ) {
        item { ReadOnlyCard("Склады, площадки и объекты показаны только для чтения в контексте компании.") }
        if (state.refreshing) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        if (state.warehousesStale) {
            item { MessageCard("Показан последний защищённый локальный список объектов.", offline = true) }
        }
        state.message?.let { message -> item { MessageCard(message, offline = overview != null) } }

        when {
            overview == null && state.refreshing -> item { LoadingCard("Загружаем склады и объекты…") }
            overview == null -> item { EmptyState("Склады и объекты недоступны.", onRefresh) }
            overview.objects.isEmpty() -> item { EmptyState("Активных складов и объектов пока нет.", onRefresh) }
            else -> {
                item { WarehouseHeadlineCard(overview) }
                items(overview.objects, key = WarehouseObjectSummary::id) { warehouse ->
                    WarehouseObjectCard(warehouse)
                }
                item { UpdatedAt(overview.fetchedAtEpochMillis) }
            }
        }
    }
}

@Composable
private fun WarehouseHeadlineCard(overview: WarehouseOverview) {
    val totalPositions = overview.objects.sumOf { it.positionCount }
    val totalWeightKg = overview.objects.sumOf { it.totalWeightKg }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Объекты компании", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text("${overview.objects.size}", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            HorizontalDivider()
            Text("Позиций: $totalPositions · подтверждённая масса: ${formatKg(totalWeightKg)}")
        }
    }
}

@Composable
private fun WarehouseObjectCard(warehouse: WarehouseObjectSummary) {
    val occupied = warehouse.positionCount > 0 || warehouse.harvestLotCount > 0 || warehouse.totalWeightKg > 0.0001
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(warehouse.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        placeTypeLabel(warehouse.placeType),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Surface(
                    color = if (occupied) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                    shape = MaterialTheme.shapes.small,
                ) {
                    Text(
                        if (occupied) "Есть остаток" else "Пусто",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
            warehouse.warehouseType?.takeIf(String::isNotBlank)?.let {
                Text("Тип склада: ${warehouseTypeLabel(it)}")
            }
            warehouse.location?.takeIf(String::isNotBlank)?.let { Text("Место: $it") }
            if (warehouse.totalWeightKg > 0.0001) {
                Text("Всего: ${formatKg(warehouse.totalWeightKg)}", fontWeight = FontWeight.SemiBold)
            }
            Text("Материальных позиций: ${warehouse.positionCount}")
            if (warehouse.harvestLotCount > 0 || warehouse.harvestWeightKg > 0.0001) {
                Text("Партий урожая: ${warehouse.harvestLotCount} · ${formatKg(warehouse.harvestWeightKg)}")
            }
            if (warehouse.seedWeightKg > 0.0001) Text("Семена: ${formatKg(warehouse.seedWeightKg)}")
            if (warehouse.otherMaterialWeightKg > 0.0001) {
                Text("Прочие материалы: ${formatKg(warehouse.otherMaterialWeightKg)}")
            }
            capacityLabel(warehouse)?.let { Text("Вместимость: $it") }
            warehouse.lastMovementAt?.takeIf(String::isNotBlank)?.let {
                Text("Последнее движение: ${formatServerDate(it)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            warehouse.description?.takeIf(String::isNotBlank)?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun HarvestHeadlineCard(overview: HarvestOverview) {
    val totalKg = overview.cropTotals.sumOf { it.receivedKg }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(overview.periodLabel, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(formatKg(totalKg), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            HorizontalDivider()
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Завершено: ${overview.completedTripCount}")
                Text("Открыто: ${overview.openTicketCount}")
            }
        }
    }
}

@Composable
private fun HarvestFieldCard(field: HarvestFieldSummary) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(field.fieldName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            field.identityLabel.takeIf(String::isNotBlank)?.let { Text(it) }
            field.destinationName.takeIf(String::isNotBlank)?.let { Text("Назначение: $it") }
            Text("${formatKg(field.receivedKg)} · ${field.trips} рейсов")
            field.lastTripAt.takeIf(String::isNotBlank)?.let {
                Text("Последний рейс: ${formatServerDate(it)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun HarvestMoistureCard(row: HarvestMoistureSummary) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(row.fieldName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(row.cropName, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Средняя: ${formatQuantity(row.averagePercent)} % · последняя: ${formatQuantity(row.latestPercent)} %")
            Text("Замеры: ${row.measuredTrips} из ${row.totalTrips}", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun HarvestIssueCard(issue: HarvestIssue) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(issue.title, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onErrorContainer)
            issue.detail.takeIf(String::isNotBlank)?.let {
                Text(it, color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
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
        SupportedRole.AGRONOMIST -> "Сводка урожая, талоны, склады и погода доступны в режиме чтения."
        SupportedRole.WEIGHMAN -> "Талоны и склады доступны в режиме чтения; запись веса закрыта до отдельного E2E-гейта."
        SupportedRole.SPECIALIST -> "Следующий native-модуль: мои задачи и детали операций."
        SupportedRole.COMPANY_ADMIN -> "Сводка урожая, талоны и склады доступны в режиме чтения; управление не включено."
        SupportedRole.GLOBAL_ADMIN -> "Доступны native-сводки и погода; для данных компании нужен подтверждённый контекст."
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

private fun placeTypeLabel(value: String): String = when (value.uppercase()) {
    "WAREHOUSE" -> "Склад"
    "YARD" -> "Площадка"
    "DRYER" -> "Сушилка"
    "CLEANER" -> "Очистка"
    else -> value.replace('_', ' ').ifBlank { "Объект" }
}

private fun warehouseTypeLabel(value: String): String = when (value.lowercase()) {
    "agrochemical" -> "Агрохимия"
    "grain" -> "Зерно"
    "vegetable" -> "Овощи"
    "seed" -> "Семена"
    "fertilizer" -> "Удобрения"
    "pesticide" -> "СЗР"
    "universal" -> "Универсальный"
    "potato_storage" -> "Картофелехранилище"
    "fuel" -> "Топливо"
    "temporary" -> "Временный"
    else -> value.replace('_', ' ')
}

private fun capacityLabel(warehouse: WarehouseObjectSummary): String? {
    val value = warehouse.capacityValue ?: return null
    val unit = warehouse.capacityUnit?.takeIf(String::isNotBlank) ?: return null
    return "${formatQuantity(value)} $unit"
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
