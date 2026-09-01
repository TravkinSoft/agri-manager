package com.travkin.flow.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.travkin.flow.data.SessionExpiredException
import com.travkin.flow.data.TravkinRepository
import com.travkin.flow.data.UserFacingException
import com.travkin.flow.domain.Actor
import com.travkin.flow.domain.OperationalOverview
import com.travkin.flow.domain.TicketDetails
import com.travkin.flow.domain.TicketPage
import com.travkin.flow.domain.TicketSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class SignedInDestination {
    OVERVIEW,
    TICKETS,
    TICKET_DETAIL,
}

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
        val destination: SignedInDestination = SignedInDestination.OVERVIEW,
        val refreshing: Boolean = false,
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
            SignedInDestination.OVERVIEW -> current
        }
    }

    fun signOut() {
        _state.value = AppUiState.Booting
        viewModelScope.launch {
            repository.signOut()
            _state.value = AppUiState.SignedOut()
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

    private suspend fun handleLoadError(error: Throwable, fallback: AppUiState.SignedIn) {
        if (error is SessionExpiredException) {
            repository.signOut()
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
