package com.travkin.flow.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.travkin.flow.data.SessionExpiredException
import com.travkin.flow.data.TareVarianceConfirmationException
import com.travkin.flow.data.TravkinRepository
import com.travkin.flow.data.UserFacingException
import com.travkin.flow.domain.Actor
import com.travkin.flow.domain.HarvestTicketDraft
import com.travkin.flow.domain.HarvestOverview
import com.travkin.flow.domain.OperationalOverview
import com.travkin.flow.domain.TicketDetails
import com.travkin.flow.domain.TicketPage
import com.travkin.flow.domain.TicketSummary
import com.travkin.flow.domain.WarehouseOverview
import com.travkin.flow.domain.WeighbridgeWorkspace
import com.travkin.flow.domain.KatoLocality
import com.travkin.flow.domain.WeatherForecast
import com.travkin.flow.domain.WeatherLocation
import com.travkin.flow.domain.NotificationCenterData
import com.travkin.flow.domain.ProfileSessionSnapshot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class SignedInDestination {
    OVERVIEW,
    TICKETS,
    TICKET_DETAIL,
    HARVEST,
    WAREHOUSES,
    WEIGHBRIDGE,
    WEATHER,
    PROFILE,
    NOTIFICATIONS,
}

data class TareVarianceConfirmation(
    val ticket: TicketSummary,
    val tareWeightKg: Double,
    val previousTareKg: Double?,
    val currentTareKg: Double?,
    val differencePercent: Double?,
)

sealed interface AppUiState {
    data object Booting : AppUiState

    data class SignedOut(
        val message: String? = null,
        val signingIn: Boolean = false,
    ) : AppUiState

    data class SignedIn(
        val actor: Actor,
        val overview: OperationalOverview?,
        val overviewStale: Boolean = false,
        val tickets: TicketPage? = null,
        val ticketsStale: Boolean = false,
        val selectedTicket: TicketDetails? = null,
        val selectedTicketFallback: TicketSummary? = null,
        val harvestOverview: HarvestOverview? = null,
        val harvestStale: Boolean = false,
        val warehouseOverview: WarehouseOverview? = null,
        val warehousesStale: Boolean = false,
        val weighbridgeWorkspace: WeighbridgeWorkspace? = null,
        val selectedWeighbridgeTicket: TicketSummary? = null,
        val tareVarianceConfirmation: TareVarianceConfirmation? = null,
        val weatherForecast: WeatherForecast? = null,
        val weatherStale: Boolean = false,
        val weatherSearchResults: List<KatoLocality> = emptyList(),
        val weatherQuery: String = "",
        val weatherSearching: Boolean = false,
        val profileSession: ProfileSessionSnapshot? = null,
        val notificationCenter: NotificationCenterData? = null,
        val notificationsStale: Boolean = false,
        val destination: SignedInDestination = SignedInDestination.OVERVIEW,
        val refreshing: Boolean = false,
        val writeBusy: Boolean = false,
        val message: String? = null,
    ) : AppUiState
}

class AppViewModel(
    private val repository: TravkinRepository,
) : ViewModel() {
    private val _state = MutableStateFlow<AppUiState>(AppUiState.Booting)
    val state: StateFlow<AppUiState> = _state.asStateFlow()

    init {
        restoreSession()
    }

    fun signIn(email: String, password: String) {
        if ((_state.value as? AppUiState.SignedOut)?.signingIn == true) return
        _state.value = AppUiState.SignedOut(signingIn = true)
        viewModelScope.launch {
            try {
                loadOverview(repository.signIn(email, password))
            } catch (error: Throwable) {
                _state.value = AppUiState.SignedOut(message = error.userMessage())
            }
        }
    }

    fun refresh() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.refreshing) return
        viewModelScope.launch {
            when (current.destination) {
                SignedInDestination.OVERVIEW -> loadOverview(current.actor, current)
                SignedInDestination.TICKETS -> loadTickets(
                    current = current,
                    historyLimit = current.tickets?.historyLimit ?: INITIAL_TICKET_HISTORY,
                )
                SignedInDestination.TICKET_DETAIL -> current.selectedTicketFallback?.let {
                    loadTicketDetails(current, it)
                }
                SignedInDestination.HARVEST -> loadHarvestOverview(current)
                SignedInDestination.WAREHOUSES -> loadWarehouseOverview(current)
                SignedInDestination.WEIGHBRIDGE -> loadWeighbridge(current)
                SignedInDestination.WEATHER -> current.weatherForecast?.location?.let { location ->
                    loadWeatherForecast(current, location, forceRefresh = true)
                } ?: run {
                    _state.value = current.copy(message = "Найдите и выберите населённый пункт.")
                }
                SignedInDestination.PROFILE -> _state.value = current.copy(
                    profileSession = repository.profileSessionSnapshot(current.actor),
                    message = null,
                )
                SignedInDestination.NOTIFICATIONS -> loadNotificationCenter(current)
            }
        }
    }

    fun openTickets() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.refreshing) return
        viewModelScope.launch {
            val cached = current.tickets ?: repository.cachedTicketPage(current.actor)
            loadTickets(
                current = current.copy(
                    destination = SignedInDestination.TICKETS,
                    tickets = cached,
                    ticketsStale = cached != null,
                    selectedTicket = null,
                    selectedTicketFallback = null,
                    message = null,
                ),
                historyLimit = cached?.historyLimit ?: INITIAL_TICKET_HISTORY,
            )
        }
    }

    fun loadMoreTickets() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        val page = current.tickets ?: return
        if (current.destination != SignedInDestination.TICKETS || current.refreshing || !page.historyHasMore) return
        val nextLimit = (page.historyLimit + TICKET_HISTORY_STEP).coerceAtMost(MAX_TICKET_HISTORY)
        if (nextLimit == page.historyLimit) return
        viewModelScope.launch { loadTickets(current, nextLimit) }
    }

    fun openTicket(ticket: TicketSummary) {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.refreshing) return
        viewModelScope.launch { loadTicketDetails(current, ticket) }
    }

    fun openHarvestOverview() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.refreshing || !current.actor.role.canViewHarvest) return
        viewModelScope.launch {
            val cached = current.harvestOverview ?: repository.cachedHarvestOverview(current.actor)
            loadHarvestOverview(
                current.copy(
                    destination = SignedInDestination.HARVEST,
                    harvestOverview = cached,
                    harvestStale = cached != null,
                    message = null,
                ),
            )
        }
    }

    fun openWarehouses() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.refreshing || !current.actor.role.canViewWarehouses) return
        viewModelScope.launch {
            val cached = current.warehouseOverview ?: repository.cachedWarehouseOverview(current.actor)
            loadWarehouseOverview(
                current.copy(
                    destination = SignedInDestination.WAREHOUSES,
                    warehouseOverview = cached,
                    warehousesStale = cached != null,
                    message = null,
                ),
            )
        }
    }

    fun openWeighbridge() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.refreshing || !current.actor.role.canUseWeighbridgeWorkspace) return
        viewModelScope.launch {
            loadWeighbridge(
                current.copy(
                    destination = SignedInDestination.WEIGHBRIDGE,
                    selectedWeighbridgeTicket = null,
                    tareVarianceConfirmation = null,
                    message = null,
                ),
            )
        }
    }

    fun openWeather() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.refreshing || !current.actor.role.canViewWeather) return
        val cached = current.weatherForecast ?: repository.cachedWeatherForecast(current.actor)
        val weatherState = current.copy(
            destination = SignedInDestination.WEATHER,
            weatherForecast = cached,
            weatherStale = cached != null,
            weatherSearchResults = emptyList(),
            weatherQuery = "",
            weatherSearching = false,
            message = null,
        )
        _state.value = weatherState
        if (cached != null) {
            viewModelScope.launch { loadWeatherForecast(weatherState, cached.location, forceRefresh = false) }
        }
    }

    fun openProfile() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.refreshing) return
        _state.value = current.copy(
            destination = SignedInDestination.PROFILE,
            profileSession = repository.profileSessionSnapshot(current.actor),
            message = null,
        )
    }

    fun openNotifications() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.refreshing) return
        val cached = current.notificationCenter ?: repository.cachedNotificationCenter(current.actor)
        val loading = current.copy(
            destination = SignedInDestination.NOTIFICATIONS,
            notificationCenter = cached,
            notificationsStale = cached != null,
            message = null,
        )
        viewModelScope.launch { loadNotificationCenter(loading) }
    }

    fun searchWeatherLocations(rawQuery: String) {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.destination != SignedInDestination.WEATHER || !current.actor.role.canViewWeather) return
        val query = rawQuery.trim()
        if (query.length < 2) {
            _state.value = current.copy(
                weatherQuery = rawQuery,
                weatherSearchResults = emptyList(),
                weatherSearching = false,
                message = null,
            )
            return
        }
        _state.value = current.copy(
            weatherQuery = rawQuery,
            weatherSearching = true,
            message = null,
        )
        viewModelScope.launch {
            try {
                val results = repository.searchWeatherLocalities(current.actor, query)
                val latest = _state.value as? AppUiState.SignedIn ?: return@launch
                if (latest.destination == SignedInDestination.WEATHER && latest.weatherQuery.trim() == query) {
                    _state.value = latest.copy(weatherSearchResults = results, weatherSearching = false)
                }
            } catch (error: Throwable) {
                val latest = _state.value as? AppUiState.SignedIn ?: return@launch
                if (error is SessionExpiredException) {
                    handleLoadError(error, latest.copy(weatherSearching = false))
                } else if (latest.destination == SignedInDestination.WEATHER && latest.weatherQuery.trim() == query) {
                    _state.value = latest.copy(weatherSearching = false, message = error.userMessage())
                }
            }
        }
    }

    fun selectWeatherLocation(locality: KatoLocality) {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.destination != SignedInDestination.WEATHER || current.refreshing || !current.actor.role.canViewWeather) return
        val loading = current.copy(refreshing = true, weatherSearching = false, message = null)
        _state.value = loading
        viewModelScope.launch {
            try {
                val location = repository.resolveWeatherLocation(current.actor, locality.code)
                loadWeatherForecast(
                    loading.copy(weatherSearchResults = emptyList(), weatherQuery = ""),
                    location,
                    forceRefresh = false,
                )
            } catch (error: Throwable) {
                handleLoadError(
                    error,
                    loading.copy(refreshing = false, message = error.userMessage()),
                )
            }
        }
    }

    fun selectWeighbridgeTicket(ticket: TicketSummary?) {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.destination != SignedInDestination.WEIGHBRIDGE || current.writeBusy) return
        _state.value = current.copy(
            selectedWeighbridgeTicket = ticket,
            tareVarianceConfirmation = null,
            message = null,
        )
    }

    fun unlockWeighbridgeOperator(personId: String, pin: String, note: String?) {
        mutateWeighbridge { current ->
            val activeOperator = current.weighbridgeWorkspace?.shift?.operatorPersonId
            repository.unlockWeighbridgeOperator(
                actor = current.actor,
                personId = personId,
                pin = pin,
                handover = activeOperator != null && activeOperator != personId,
                note = note,
            )
            "Сменщик подтверждён."
        }
    }

    fun lockWeighbridgeOperator() {
        mutateWeighbridge { current ->
            repository.lockWeighbridgeOperator(current.actor)
            "Терминал Весовой заблокирован."
        }
    }

    fun createHarvestTicket(draft: HarvestTicketDraft) {
        mutateWeighbridge { current ->
            repository.createHarvestTicket(current.actor, draft)
            "Талон создан без повторной отправки."
        }
    }

    fun saveGrossWeight(ticket: TicketSummary, grossWeightKg: Double) {
        mutateWeighbridge { current ->
            repository.saveGrossWeight(current.actor, ticket.id, grossWeightKg)
            "Брутто сохранено."
        }
    }

    fun finalizeWeighbridgeTicket(
        ticket: TicketSummary,
        tareWeightKg: Double,
        confirmTareVariance: Boolean = false,
    ) {
        mutateWeighbridge(
            clearSelectedTicket = true,
            onTareConfirmation = { error ->
                TareVarianceConfirmation(
                    ticket = ticket,
                    tareWeightKg = tareWeightKg,
                    previousTareKg = error.previousTareKg,
                    currentTareKg = error.currentTareKg,
                    differencePercent = error.differencePercent,
                )
            },
        ) { current ->
            val gross = ticket.grossWeightKg
                ?: throw UserFacingException("Сначала сохраните брутто.")
            repository.finalizeWeighbridgeTicket(
                actor = current.actor,
                ticketId = ticket.id,
                grossWeightKg = gross,
                tareWeightKg = tareWeightKg,
                confirmTareVariance = confirmTareVariance,
            )
            "Талон завершён. Нетто рассчитано сервером."
        }
    }

    fun confirmTareVariance() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        val confirmation = current.tareVarianceConfirmation ?: return
        finalizeWeighbridgeTicket(
            ticket = confirmation.ticket,
            tareWeightKg = confirmation.tareWeightKg,
            confirmTareVariance = true,
        )
    }

    fun dismissTareVariance() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        _state.value = current.copy(tareVarianceConfirmation = null, writeBusy = false)
    }

    fun retryPendingWeighbridgeCommands() {
        mutateWeighbridge { current ->
            val completed = repository.retryPendingWeighbridgeCommands(current.actor)
            "Повторено команд: $completed."
        }
    }

    fun navigateBack() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        _state.value = when (current.destination) {
            SignedInDestination.TICKET_DETAIL -> current.copy(
                destination = SignedInDestination.TICKETS,
                selectedTicket = null,
                selectedTicketFallback = null,
                refreshing = false,
                message = null,
            )
            SignedInDestination.TICKETS -> current.copy(
                destination = SignedInDestination.OVERVIEW,
                refreshing = false,
                message = null,
            )
            SignedInDestination.HARVEST -> current.copy(
                destination = SignedInDestination.OVERVIEW,
                refreshing = false,
                message = null,
            )
            SignedInDestination.WAREHOUSES -> current.copy(
                destination = SignedInDestination.OVERVIEW,
                refreshing = false,
                message = null,
            )
            SignedInDestination.WEIGHBRIDGE -> current.copy(
                destination = SignedInDestination.OVERVIEW,
                selectedWeighbridgeTicket = null,
                tareVarianceConfirmation = null,
                refreshing = false,
                writeBusy = false,
                message = null,
            )
            SignedInDestination.WEATHER -> current.copy(
                destination = SignedInDestination.OVERVIEW,
                weatherSearchResults = emptyList(),
                weatherQuery = "",
                weatherSearching = false,
                refreshing = false,
                message = null,
            )
            SignedInDestination.PROFILE,
            SignedInDestination.NOTIFICATIONS -> current.copy(
                destination = SignedInDestination.OVERVIEW,
                refreshing = false,
                message = null,
            )
            SignedInDestination.OVERVIEW -> current
        }
    }

    fun signOut() {
        val session = repository.signOutLocally()
        _state.value = AppUiState.SignedOut()
        viewModelScope.launch {
            repository.revokeSessionBestEffort(session)
        }
    }

    private fun restoreSession() {
        viewModelScope.launch {
            try {
                val actor = repository.restoreActor()
                if (actor == null) {
                    _state.value = AppUiState.SignedOut()
                } else {
                    loadOverview(actor)
                }
            } catch (error: Throwable) {
                _state.value = AppUiState.SignedOut(message = error.userMessage())
            }
        }
    }

    private suspend fun loadOverview(actor: Actor, previous: AppUiState.SignedIn? = null) {
        val cached = previous?.overview ?: repository.cachedOverview(actor)
        val loading = previous?.copy(
            destination = SignedInDestination.OVERVIEW,
            overview = cached,
            overviewStale = previous.overviewStale || cached != null,
            refreshing = true,
            message = null,
        ) ?: AppUiState.SignedIn(
            actor = actor,
            overview = cached,
            overviewStale = cached != null,
            refreshing = true,
        )
        _state.value = loading
        try {
            val live = repository.refreshOverview(actor)
            _state.value = loading.copy(
                overview = live,
                overviewStale = false,
                refreshing = false,
            )
        } catch (error: Throwable) {
            handleLoadError(
                error = error,
                fallback = loading.copy(
                    overview = cached,
                    overviewStale = cached != null,
                    refreshing = false,
                    message = error.userMessage(),
                ),
            )
        }
    }

    private suspend fun loadTickets(current: AppUiState.SignedIn, historyLimit: Int) {
        val existing = current.tickets
        val loading = current.copy(
            destination = SignedInDestination.TICKETS,
            refreshing = true,
            message = null,
        )
        _state.value = loading
        try {
            val live = repository.refreshTickets(current.actor, historyLimit)
            _state.value = loading.copy(
                tickets = live,
                ticketsStale = false,
                refreshing = false,
            )
        } catch (error: Throwable) {
            handleLoadError(
                error = error,
                fallback = loading.copy(
                    tickets = existing,
                    ticketsStale = existing != null,
                    refreshing = false,
                    message = error.userMessage(),
                ),
            )
        }
    }

    private suspend fun loadTicketDetails(current: AppUiState.SignedIn, ticket: TicketSummary) {
        val loading = current.copy(
            destination = SignedInDestination.TICKET_DETAIL,
            selectedTicket = null,
            selectedTicketFallback = ticket,
            refreshing = true,
            message = null,
        )
        _state.value = loading
        try {
            val live = repository.ticketDetails(current.actor, ticket.id)
            _state.value = loading.copy(selectedTicket = live, refreshing = false)
        } catch (error: Throwable) {
            handleLoadError(
                error = error,
                fallback = loading.copy(
                    refreshing = false,
                    message = error.userMessage(),
                ),
            )
        }
    }

    private suspend fun loadHarvestOverview(current: AppUiState.SignedIn) {
        val existing = current.harvestOverview
        val loading = current.copy(
            destination = SignedInDestination.HARVEST,
            refreshing = true,
            message = null,
        )
        _state.value = loading
        try {
            val live = repository.refreshHarvestOverview(current.actor)
            _state.value = loading.copy(
                harvestOverview = live,
                harvestStale = false,
                refreshing = false,
            )
        } catch (error: Throwable) {
            handleLoadError(
                error = error,
                fallback = loading.copy(
                    harvestOverview = existing,
                    harvestStale = existing != null,
                    refreshing = false,
                    message = error.userMessage(),
                ),
            )
        }
    }

    private suspend fun loadWarehouseOverview(current: AppUiState.SignedIn) {
        val existing = current.warehouseOverview
        val loading = current.copy(
            destination = SignedInDestination.WAREHOUSES,
            refreshing = true,
            message = null,
        )
        _state.value = loading
        try {
            val live = repository.refreshWarehouseOverview(current.actor)
            _state.value = loading.copy(
                warehouseOverview = live,
                warehousesStale = false,
                refreshing = false,
            )
        } catch (error: Throwable) {
            handleLoadError(
                error = error,
                fallback = loading.copy(
                    warehouseOverview = existing,
                    warehousesStale = existing != null,
                    refreshing = false,
                    message = error.userMessage(),
                ),
            )
        }
    }

    private suspend fun loadWeighbridge(
        current: AppUiState.SignedIn,
        completionMessage: String? = null,
    ) {
        val existingTickets = current.tickets
        val loading = current.copy(
            destination = SignedInDestination.WEIGHBRIDGE,
            refreshing = true,
            writeBusy = false,
            message = null,
        )
        _state.value = loading
        try {
            val workspace = repository.loadWeighbridgeWorkspace(current.actor)
            var ticketMessage: String? = null
            val tickets = try {
                repository.refreshTickets(current.actor, MAX_TICKET_HISTORY)
            } catch (error: Throwable) {
                if (error is SessionExpiredException) throw error
                ticketMessage = "Рабочее место загружено, но очередь талонов не обновилась: ${error.userMessage()}"
                existingTickets
            }
            _state.value = loading.copy(
                weighbridgeWorkspace = workspace,
                tickets = tickets,
                ticketsStale = ticketMessage != null && tickets != null,
                refreshing = false,
                message = ticketMessage ?: completionMessage,
            )
        } catch (error: Throwable) {
            handleLoadError(
                error = error,
                fallback = loading.copy(
                    refreshing = false,
                    message = error.userMessage(),
                ),
            )
        }
    }

    private fun mutateWeighbridge(
        clearSelectedTicket: Boolean = false,
        onTareConfirmation: ((TareVarianceConfirmationException) -> TareVarianceConfirmation)? = null,
        operation: suspend (AppUiState.SignedIn) -> String,
    ) {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.destination != SignedInDestination.WEIGHBRIDGE || current.writeBusy || current.refreshing) return
        val workspace = current.weighbridgeWorkspace ?: return
        if (!workspace.writesEnabled || !workspace.stationContractAvailable) {
            _state.value = current.copy(
                message = "Запись заблокирована: сервер не предоставляет каталог и подтверждение весовой станции для native-клиента.",
            )
            return
        }
        val working = current.copy(
            writeBusy = true,
            message = null,
            tareVarianceConfirmation = null,
        )
        _state.value = working
        viewModelScope.launch {
            try {
                val successMessage = operation(working)
                loadWeighbridge(
                    working.copy(
                        writeBusy = false,
                        selectedWeighbridgeTicket = if (clearSelectedTicket) null else working.selectedWeighbridgeTicket,
                    ),
                    completionMessage = successMessage,
                )
            } catch (error: TareVarianceConfirmationException) {
                val confirmation = onTareConfirmation?.invoke(error)
                _state.value = working.copy(
                    writeBusy = false,
                    tareVarianceConfirmation = confirmation,
                    message = if (confirmation == null) error.userMessage() else null,
                )
            } catch (error: Throwable) {
                if (error is SessionExpiredException) {
                    handleLoadError(error, working.copy(writeBusy = false))
                } else {
                    val pendingCount = repository.pendingWeighbridgeCommandCount(working.actor)
                    _state.value = working.copy(
                        weighbridgeWorkspace = working.weighbridgeWorkspace?.copy(pendingCommandCount = pendingCount),
                        writeBusy = false,
                        message = error.userMessage(),
                    )
                }
            }
        }
    }

    private suspend fun loadWeatherForecast(
        current: AppUiState.SignedIn,
        location: WeatherLocation,
        forceRefresh: Boolean,
    ) {
        val existing = current.weatherForecast
        val loading = current.copy(
            destination = SignedInDestination.WEATHER,
            refreshing = true,
            weatherSearching = false,
            message = null,
        )
        _state.value = loading
        try {
            val live = repository.refreshWeatherForecast(current.actor, location, forceRefresh)
            _state.value = loading.copy(
                weatherForecast = live,
                weatherStale = live.stale,
                refreshing = false,
            )
        } catch (error: Throwable) {
            handleLoadError(
                error,
                loading.copy(
                    weatherForecast = existing,
                    weatherStale = existing != null,
                    refreshing = false,
                    message = error.userMessage(),
                ),
            )
        }
    }

    private suspend fun loadNotificationCenter(current: AppUiState.SignedIn) {
        val existing = current.notificationCenter
        val loading = current.copy(
            destination = SignedInDestination.NOTIFICATIONS,
            refreshing = true,
            message = null,
        )
        _state.value = loading
        try {
            val live = repository.refreshNotificationCenter(current.actor)
            _state.value = loading.copy(
                notificationCenter = live,
                notificationsStale = false,
                refreshing = false,
            )
        } catch (error: Throwable) {
            handleLoadError(
                error,
                loading.copy(
                    notificationCenter = existing,
                    notificationsStale = existing != null,
                    refreshing = false,
                    message = error.userMessage(),
                ),
            )
        }
    }

    private suspend fun handleLoadError(error: Throwable, fallback: AppUiState.SignedIn) {
        if (error is SessionExpiredException) {
            repository.signOutLocally()
            _state.value = AppUiState.SignedOut(message = error.userMessage())
        } else {
            _state.value = fallback
        }
    }

    private fun Throwable.userMessage(): String = when (this) {
        is UserFacingException -> message ?: "Операция не выполнена."
        else -> "Нет связи с TravkinFlow. Проверьте интернет и повторите."
    }

    class Factory(context: Context) : ViewModelProvider.Factory {
        private val appContext = context.applicationContext

        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(AppViewModel::class.java))
            return AppViewModel(TravkinRepository(appContext)) as T
        }
    }

    private companion object {
        const val INITIAL_TICKET_HISTORY = 20
        const val TICKET_HISTORY_STEP = 20
        const val MAX_TICKET_HISTORY = 100
    }
}
