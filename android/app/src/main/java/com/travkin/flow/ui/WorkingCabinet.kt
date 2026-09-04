package com.travkin.flow.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.travkin.flow.domain.*
import com.travkin.flow.data.serverDate
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkingCabinet(state: AppUiState.SignedIn, viewModel: AppViewModel) {
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var profileOpen by remember { mutableStateOf(false) }
    var cropEdit by remember { mutableStateOf<CropEditorData?>(null) }
    var trafficEdit by remember { mutableStateOf<TrafficEditorData?>(null) }
    var trafficAccessOnly by remember { mutableStateOf(false) }
    var harvestFilterOpen by remember { mutableStateOf(false) }
    var weatherEdit by remember { mutableStateOf<WeatherProfile?>(null) }
    var search by rememberSaveable(state.query) { mutableStateOf("") }
    var weatherSearch by rememberSaveable { mutableStateOf(state.query.localitySearch) }
    val listState = rememberLazyListState()
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    LaunchedEffect(state.query) {
        listState.scrollToItem(0)
    }
    LaunchedEffect(state.query, lifecycle, cropEdit != null, trafficEdit != null, weatherEdit != null) {
        if (cropEdit != null || trafficEdit != null || weatherEdit != null) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            viewModel.refresh()
            while (true) {
                delay(when(state.query.section) { CabinetSection.TRAFFIC -> 5_000L; CabinetSection.WEATHER -> 300_000L; CabinetSection.NOTIFICATIONS -> 15_000L; else -> 30_000L })
                viewModel.refresh()
            }
        }
    }
    BackHandler(enabled = drawer.isOpen || profileOpen || state.backStack.isNotEmpty()) {
        when {
            drawer.isOpen -> scope.launch { drawer.close() }
            profileOpen -> profileOpen = false
            else -> viewModel.back()
        }
    }

    ModalNavigationDrawer(drawerState = drawer, drawerContent = {
        ModalDrawerSheet {
            Text("TravkinFlow", Modifier.padding(24.dp), style = MaterialTheme.typography.headlineSmall, color = Color(0xFFF2C94C))
            Text("Агроном", Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            CabinetSection.entries.filter { it.primary }.forEach { section ->
                NavigationDrawerItem(label = { Text(section.label) }, selected = state.query.section == section,
                    icon = { Icon(section.icon(), contentDescription = null) },
                    onClick = { scope.launch { drawer.close() }; viewModel.openSection(section) },
                    modifier = Modifier.padding(horizontal = 12.dp))
            }
            HorizontalDivider(Modifier.padding(16.dp))
            NavigationDrawerItem(label = { Text("Настройки уведомлений") }, selected = state.query.section == CabinetSection.SETTINGS,
                icon = { Icon(Icons.Outlined.Settings, null) }, onClick = { scope.launch { drawer.close() }; viewModel.openSection(CabinetSection.SETTINGS) })
            NavigationDrawerItem(label = { Text("Учётная запись") }, selected = false,
                icon = { Icon(Icons.Outlined.Person, null) }, onClick = { scope.launch { drawer.close() }; profileOpen = true })
        }
    }) {
        Scaffold(containerColor = Color.Transparent, topBar = {
            TopAppBar(title = { Text(state.query.title ?: state.query.section.label, style = MaterialTheme.typography.titleLarge) },
                navigationIcon = {
                    if (state.backStack.isNotEmpty()) IconButton(onClick = viewModel::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Назад") }
                    else IconButton(onClick = { scope.launch { drawer.open() } }) { Icon(Icons.Outlined.Menu, "Открыть меню") }
                }, actions = {
                    IconButton(onClick = { viewModel.openSection(CabinetSection.NOTIFICATIONS) }, enabled = !state.saving) { Icon(Icons.Outlined.Notifications, "Уведомления") }
                    IconButton(onClick = viewModel::refresh, enabled = !state.refreshing) { Icon(Icons.Outlined.Refresh, "Обновить данные") }
                })
        }) { padding ->
            LazyColumn(state = listState, modifier = Modifier.fillMaxSize().padding(padding).imePadding(),
                contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Text("Кабинет Агронома", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                }
                if (state.query.section == CabinetSection.HARVEST) item {
                    Choices(listOf("current_day" to "Сегодня", "previous_day" to "Вчера", "last_24_hours" to "24 часа", "current_shift" to "Смена", "season" to "Сезон"), state.query.period) {
                        viewModel.changeQuery(state.query.copy(period = it))
                    }
                }
                if (state.query.section == CabinetSection.TICKETS && state.query.objectId == null) item {
                    Choices(listOf("open" to "Открытые", "today" to "Сегодня завершены", "history" to "История"), state.query.ticketMode) {
                        viewModel.changeQuery(state.query.copy(ticketMode = it))
                    }
                }
                if (state.query.section == CabinetSection.CROPS && state.page?.seasons?.isNotEmpty() == true) item {
                    Choices(state.page.seasons.map { it.id to it.label }, state.page.seasons.firstOrNull { it.active }?.id.orEmpty()) {
                        viewModel.changeQuery(state.query.copy(seasonId = it, objectId = null, title = null))
                    }
                }
                if (state.query.section == CabinetSection.WEATHER && state.query.localityCode != null) item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { viewModel.changeQuery(state.query.copy(localityCode = null, title = null)) }, modifier = Modifier.fillMaxWidth()) { Text("Сменить населённый пункт") }
                        Choices(weatherModes.toList() + ("custom" to "Мой профиль"), state.query.weatherMode) { viewModel.changeQuery(state.query.copy(weatherMode = it)) }
                        if (state.query.weatherMode == "custom") {
                            val profiles = state.page?.weatherProfiles.orEmpty()
                            if (profiles.isEmpty()) Text("Погодные профили пока не созданы.")
                            else SelectOption("Профиль условий", state.query.weatherProfileId ?: profiles.firstOrNull { it.isDefault }?.id ?: profiles.first().id,
                                profiles.mapNotNull { profile -> profile.id?.let { CatalogOption(it, profile.name) } }, state.refreshing) {
                                viewModel.changeQuery(state.query.copy(weatherProfileId = it))
                            }
                            val selectedProfile = profiles.firstOrNull { it.id == state.query.weatherProfileId } ?: profiles.firstOrNull { it.isDefault } ?: profiles.firstOrNull()
                            if (selectedProfile != null) OutlinedButton(onClick = { viewModel.clearCommandError(); weatherEdit = selectedProfile }, enabled = !state.actorStale && !state.refreshing,
                                modifier = Modifier.fillMaxWidth()) { Text("Изменить профиль") }
                            OutlinedButton(onClick = { viewModel.clearCommandError(); weatherEdit = WeatherProfile() }, enabled = !state.actorStale && !state.refreshing && state.page != null,
                                modifier = Modifier.fillMaxWidth()) { Text("Создать погодный профиль") }
                        }
                    }
                }
                if (state.query.section == CabinetSection.WEATHER && state.query.localityCode == null) item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(value = weatherSearch, onValueChange = { weatherSearch = it }, label = { Text("Населённый пункт") },
                            modifier = Modifier.fillMaxWidth(), singleLine = true)
                        Button(onClick = { viewModel.changeQuery(state.query.copy(localitySearch = weatherSearch.trim())) },
                            modifier = Modifier.fillMaxWidth(), enabled = weatherSearch.trim().length >= 2 && !state.refreshing) { Text("Найти") }
                    }
                } else item {
                    OutlinedTextField(value = search, onValueChange = { search = it }, label = { Text("Поиск в разделе") },
                        modifier = Modifier.fillMaxWidth(), singleLine = true, leadingIcon = { Icon(Icons.Outlined.Search, null) })
                }
                if (state.refreshing) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
                state.message?.let { message -> item {
                    Notice(message + if (state.page != null) "\nНа экране остались ранее загруженные данные." else "", true)
                    TextButton(onClick = viewModel::refresh, enabled = !state.refreshing) { Text("Повторить") }
                } }
                if (cropEdit == null && trafficEdit == null && weatherEdit == null) state.commandError?.let { error -> item { Notice(error, true) } }
                state.page?.let { page ->
                    item { DocumentExportControl(state, viewModel) }
                    page.driverAssignment?.let { assignment -> item {
                        DriverAssignmentControls(assignment, state.saving || state.refreshing || state.actorStale) { viewModel.saveDriverAssignment(assignment, it) }
                    } }
                    page.notifications?.let { notifications ->
                        item { Button(onClick = { viewModel.markNotificationsRead(null) }, enabled = !state.saving && !state.actorStale && notifications.any { !it.read }, modifier = Modifier.fillMaxWidth()) { Text("Прочитать все") } }
                        items(notifications.filter { search.isBlank() || (it.title + " " + it.body.orEmpty()).contains(search, true) }, key = { it.id }) { notification ->
                            NotificationCard(notification, state.saving || state.actorStale,
                                onRead = { viewModel.markNotificationsRead(notification.id) },
                                onOpen = { if (notification.read) notification.destination?.let(viewModel::open) else viewModel.markNotificationsRead(notification.id, notification.destination) })
                        }
                        if (notifications.isEmpty()) item { Text("Уведомлений пока нет.") }
                    }
                    page.notificationPreferences?.let { preferences -> item {
                        NotificationSettings(preferences, state.saving || state.refreshing || state.actorStale) { viewModel.saveNotificationPreferences(preferences, it) }
                    } }
                    page.harvestOptions?.let { options -> item {
                        OutlinedButton(onClick = { harvestFilterOpen = true }, modifier = Modifier.fillMaxWidth()) { Text("Фильтры и свой период") }
                    } }
                    page.trafficEditor?.let { editor -> item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { viewModel.clearCommandError(); trafficAccessOnly = false; trafficEdit = editor },
                                enabled = !state.actorStale && !state.refreshing, modifier = Modifier.fillMaxWidth()) { Text("Выбрать машины") }
                            OutlinedButton(onClick = { trafficAccessOnly = true; trafficEdit = editor }, modifier = Modifier.fillMaxWidth()) { Text("Доступ сотрудников") }
                        }
                    } }
                    page.cropEditor?.let { editor -> item {
                        Button(onClick = { viewModel.clearCommandError(); cropEdit = editor }, enabled = !state.actorStale && !state.refreshing,
                            modifier = Modifier.fillMaxWidth()) { Text("Редактор структуры") }
                    } }
                    page.notice?.let { notice -> item { Notice(notice) } }
                    item { Text("Получено: ${serverDate(Instant.ofEpochMilli(page.fetchedAt).toString())}", style = MaterialTheme.typography.labelSmall) }
                    val groups = page.groups.map { group -> group.copy(cards = group.cards.filter { card ->
                        search.isBlank() || (card.title + " " + card.subtitle.orEmpty() + " " + card.rows.joinToString(" ") { it.value }).contains(search, ignoreCase = true)
                    }) }
                    if (page.notifications == null && page.notificationPreferences == null && page.driverAssignment == null && groups.all { it.cards.isEmpty() }) item {
                        Text(if (search.isBlank()) "В этом разделе пока нет записей." else "По вашему запросу ничего не найдено.", Modifier.padding(vertical = 24.dp))
                    }
                    groups.forEachIndexed { index, group ->
                        if (group.cards.isNotEmpty()) {
                            item("heading-$index") { Text(group.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
                            items(group.cards.size, key = { "$index-${group.cards[it].id}-$it" }) { cardIndex ->
                                WorkingCard(group.cards[cardIndex], viewModel::open)
                            }
                        }
                    }
                }
                if (state.page == null && state.refreshing) item {
                    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { Text("Получаем данные TravkinFlow…") }
                }
            }
        }
    }
    if (profileOpen) AlertDialog(onDismissRequest = { profileOpen = false }, title = { Text("Учётная запись") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Роль: Агроном")
            Text(state.actor.email ?: "Email не указан")
            Text("Компания: ${state.actor.companyId ?: "не назначена"}")
            Text("Рабочие данные загружаются с того же сервера, что и на сайте.")
        } }, confirmButton = { TextButton(onClick = { profileOpen = false }) { Text("Закрыть") } },
        dismissButton = { TextButton(onClick = { profileOpen = false; viewModel.signOut() }) { Text("Выйти") } })
    cropEdit?.let { editor -> CropEditorDialog(editor, state.saving, state.commandError, onClose = { cropEdit = null },
        onSave = { rows -> viewModel.saveCrop(editor, rows) { cropEdit = null } }) }
    trafficEdit?.let { editor -> TrafficEditorDialog(editor, trafficAccessOnly, state.saving, state.commandError,
        onClose = { trafficEdit = null }, onSave = { selected, emptyConfirmed -> viewModel.saveTraffic(editor, selected, emptyConfirmed) { trafficEdit = null } }) }
    if (harvestFilterOpen) HarvestFilterDialog(state.query, state.page?.harvestOptions.orEmpty(), onClose = { harvestFilterOpen = false },
        onApply = { harvestFilterOpen = false; viewModel.changeQuery(it) })
    weatherEdit?.let { original -> WeatherProfileDialog(original, state.saving, state.commandError, onClose = { weatherEdit = null },
        onSave = { updated -> viewModel.changeWeatherProfile(original, updated) { weatherEdit = null } }) }
}

@Composable
private fun Choices(items: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEach { (key, label) -> FilterChip(selected = key == selected, onClick = { onSelect(key) }, label = { Text(label) }) }
    }
}

@Composable
private fun WorkingCard(card: CabinetCard, onOpen: (CabinetQuery) -> Unit) {
    val color = when (card.tone) {
        "loaded" -> Color(0xFF12392E)
        "unloading", "warning" -> Color(0xFF3A3119)
        else -> MaterialTheme.colorScheme.surfaceContainer
    }
    Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = color)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(card.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            card.subtitle?.takeIf(String::isNotBlank)?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            card.rows.forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(row.label, Modifier.weight(0.45f), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Text(row.value, Modifier.weight(0.55f), style = MaterialTheme.typography.bodyMedium)
                }
            }
            card.destination?.let { target -> OutlinedButton(onClick = { onOpen(target) }, Modifier.fillMaxWidth()) { Text("Открыть") } }
        }
    }
}

@Composable
private fun Notice(message: String, error: Boolean = false) {
    Card(colors = CardDefaults.cardColors(containerColor = if (error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer)) {
        Text(message, Modifier.padding(14.dp), style = MaterialTheme.typography.bodyMedium)
    }
}

private fun CabinetSection.icon() = when(this) {
    CabinetSection.HARVEST -> Icons.Outlined.Dashboard
    CabinetSection.CROPS -> Icons.Outlined.Grass
    CabinetSection.WAREHOUSES -> Icons.Outlined.Inventory2
    CabinetSection.TICKETS -> Icons.Outlined.Description
    CabinetSection.TRAFFIC -> Icons.Outlined.LocalShipping
    CabinetSection.WEATHER -> Icons.Outlined.Cloud
    CabinetSection.NOTIFICATIONS -> Icons.Outlined.Notifications
    CabinetSection.SETTINGS -> Icons.Outlined.Settings
}
