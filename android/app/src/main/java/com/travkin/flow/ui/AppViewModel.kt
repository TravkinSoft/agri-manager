package com.travkin.flow.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.travkin.flow.data.SessionExpiredException
import com.travkin.flow.data.UnsupportedRoleException
import com.travkin.flow.data.TravkinRepository
import com.travkin.flow.data.UserFacingException
import com.travkin.flow.domain.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface AppUiState {
    data object Booting : AppUiState
    data class SignedOut(val message: String? = null, val signingIn: Boolean = false) : AppUiState
    data class SignedIn(
        val actor: Actor,
        val actorStale: Boolean = false,
        val refreshing: Boolean = false,
        val message: String? = null,
        val query: CabinetQuery = CabinetQuery(),
        val page: CabinetPage? = null,
        val backStack: List<CabinetQuery> = emptyList(),
        val saving: Boolean = false,
        val commandError: String? = null,
    ) : AppUiState
}

class AppViewModel(private val repository: TravkinRepository) : ViewModel() {
    private val _state = MutableStateFlow<AppUiState>(AppUiState.Booting)
    val state: StateFlow<AppUiState> = _state.asStateFlow()
    private val generation = RequestGeneration()
    private var job: Job? = null
    private var pendingRoute: CabinetSection? = null

    init { restoreSession() }

    fun signIn(email: String, password: String) {
        if ((_state.value as? AppUiState.SignedOut)?.signingIn == true) return
        job?.cancel()
        val request = generation.next()
        _state.value = AppUiState.SignedOut(signingIn = true)
        job = viewModelScope.launch {
            try {
                val actor = repository.signIn(email, password)
                if (generation.isCurrent(request)) signedIn(actor)
            } catch (error: Throwable) { signedOutOnError(error, request) }
        }
    }

    fun openSection(section: CabinetSection) {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.saving) return
        _state.value = current.copy(query = CabinetQuery(section), page = null, message = null, commandError = null, backStack = emptyList(), refreshing = false)
        refresh()
    }

    fun open(query: CabinetQuery) {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.saving) return
        _state.value = current.copy(query = query, page = null, message = null, commandError = null, backStack = current.backStack + current.query, refreshing = false)
        refresh()
    }

    fun changeQuery(query: CabinetQuery) {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.saving) return
        _state.value = current.copy(query = query, page = null, message = null, commandError = null, refreshing = false)
        refresh()
    }

    fun back() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.saving) return
        val previous = current.backStack.lastOrNull() ?: return
        _state.value = current.copy(query = previous, backStack = current.backStack.dropLast(1), page = null, message = null, commandError = null, refreshing = false)
        refresh()
    }

    fun refresh() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.refreshing || current.saving) return
        job?.cancel()
        val request = generation.next()
        _state.value = current.copy(refreshing = true, message = null)
        job = viewModelScope.launch {
            try {
                val page = repository.loadCabinet(current.actor, current.query)
                if (generation.isCurrent(request)) _state.value = current.copy(page = page, refreshing = false, actorStale = false, message = null)
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                if (!generation.isCurrent(request)) return@launch
                if (error is SessionExpiredException || error is UnsupportedRoleException) {
                    repository.signOutLocally()
                    _state.value = AppUiState.SignedOut(message = error.userMessage())
                } else _state.value = current.copy(refreshing = false, actorStale = true, message = error.userMessage())
            }
        }
    }

    fun openDashboard() = route(CabinetSection.HARVEST)

    fun clearCommandError() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        _state.value = current.copy(commandError = null)
    }

    fun saveCrop(context: CropEditorData, rows: List<CropAllocationDraft>, onSuccess: () -> Unit) {
        runCommand(onSuccess) { actor -> repository.saveCrop(actor, context, rows) }
    }

    fun exportDocument(onReady: (String, ByteArray) -> Unit) {
        val query = (_state.value as? AppUiState.SignedIn)?.query ?: return
        var prepared: Pair<String, ByteArray>? = null
        runCommand({ prepared?.let { (name, bytes) -> onReady(name, bytes) } }) { actor ->
            val document = repository.prepareDocumentExport(actor, query)
            prepared = document.name to renderExport(document)
        }
    }

    fun saveTraffic(context: TrafficEditorData, selected: Set<String>, emptyConfirmed: Boolean, onSuccess: () -> Unit) {
        runCommand(onSuccess) { actor -> repository.saveTraffic(actor, context, selected, emptyConfirmed) }
    }

    fun saveDriverAssignment(context: DriverAssignment, personId: String?) {
        runCommand({}) { actor -> repository.saveDriverAssignment(actor, context, personId) }
    }

    fun changeWeatherProfile(original: WeatherProfile, updated: WeatherProfile?, onSuccess: () -> Unit) {
        runCommand(onSuccess) { actor -> repository.changeWeatherProfile(actor, original, updated) }
    }

    fun saveNotificationPreferences(original: NotificationPreferences, updated: NotificationPreferences) {
        runCommand({}) { actor -> repository.saveNotificationPreferences(actor, original, updated) }
    }

    fun markNotificationsRead(id: String?, destination: CabinetQuery? = null) {
        runCommand({ if (destination != null) open(destination) }) { actor -> repository.markNotificationsRead(actor, id) }
    }

    private fun runCommand(onSuccess: () -> Unit, action: suspend (Actor) -> Unit) {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.saving) return
        job?.cancel()
        val request = generation.next()
        _state.value = current.copy(saving = true, refreshing = false, commandError = null)
        job = viewModelScope.launch {
            try {
                action(current.actor)
                if (!generation.isCurrent(request)) return@launch
                _state.value = current.copy(saving = false, refreshing = false, commandError = null)
                job = null
                onSuccess()
                refresh()
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                if (!generation.isCurrent(request)) return@launch
                if (error is SessionExpiredException || error is UnsupportedRoleException) {
                    repository.signOutLocally()
                    _state.value = AppUiState.SignedOut(message = error.userMessage())
                } else _state.value = current.copy(saving = false, refreshing = false, commandError = error.userMessage())
            }
        }
    }

    fun route(section: CabinetSection) {
        if (_state.value is AppUiState.SignedIn) openSection(section) else pendingRoute = section
    }

    fun signOut() {
        generation.next()
        job?.cancel()
        pendingRoute = null
        val session = repository.signOutLocally()
        _state.value = AppUiState.SignedOut()
        viewModelScope.launch { repository.revokeSessionBestEffort(session) }
    }

    private fun signedIn(actor: Actor) {
        _state.value = AppUiState.SignedIn(actor, query = CabinetQuery(pendingRoute ?: CabinetSection.HARVEST))
        pendingRoute = null
        job = null
        refresh()
    }

    private fun restoreSession() {
        val request = generation.next()
        job = viewModelScope.launch {
            try {
                val actor = repository.restoreActor()
                if (generation.isCurrent(request)) {
                    if (actor == null) _state.value = AppUiState.SignedOut() else signedIn(actor)
                }
            } catch (error: Throwable) { signedOutOnError(error, request) }
        }
    }

    private fun signedOutOnError(error: Throwable, request: Long) {
        if (error is CancellationException) throw error
        if (generation.isCurrent(request)) _state.value = AppUiState.SignedOut(message = error.userMessage())
    }

    private fun Throwable.userMessage() = (this as? UserFacingException)?.message ?: "Нет связи с TravkinFlow. Проверьте интернет и повторите."

    class Factory(context: Context) : ViewModelProvider.Factory {
        private val appContext = context.applicationContext
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(AppViewModel::class.java))
            return AppViewModel(TravkinRepository(appContext)) as T
        }
    }
}
