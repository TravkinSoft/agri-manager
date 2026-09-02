package com.travkin.flow.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.travkin.flow.data.SessionExpiredException
import com.travkin.flow.data.TravkinRepository
import com.travkin.flow.data.UserFacingException
import com.travkin.flow.domain.Actor
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface AppUiState {
    data object Booting : AppUiState

    data class SignedOut(
        val message: String? = null,
        val signingIn: Boolean = false,
    ) : AppUiState

    data class SignedIn(
        val actor: Actor,
        val actorStale: Boolean = false,
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
                _state.value = AppUiState.SignedIn(repository.signIn(email, password))
            } catch (error: Throwable) {
                _state.value = AppUiState.SignedOut(message = error.userMessage())
            }
        }
    }

    fun refresh() {
        val current = _state.value as? AppUiState.SignedIn ?: return
        if (current.refreshing) return
        val loading = current.copy(refreshing = true, message = null)
        _state.value = loading
        viewModelScope.launch {
            try {
                _state.value = loading.copy(
                    actor = repository.refreshActor(),
                    actorStale = false,
                    refreshing = false,
                    message = "Профиль Агронома обновлён.",
                )
            } catch (error: Throwable) {
                if (error is SessionExpiredException) {
                    repository.signOutLocally()
                    _state.value = AppUiState.SignedOut(message = error.userMessage())
                } else {
                    _state.value = loading.copy(
                        actorStale = true,
                        refreshing = false,
                        message = error.userMessage(),
                    )
                }
            }
        }
    }

    fun openDashboard() {
        if (_state.value is AppUiState.SignedIn) refresh()
    }

    fun signOut() {
        val session = repository.signOutLocally()
        _state.value = AppUiState.SignedOut()
        viewModelScope.launch { repository.revokeSessionBestEffort(session) }
    }

    private fun restoreSession() {
        viewModelScope.launch {
            try {
                val actor = repository.restoreActor()
                _state.value = if (actor == null) AppUiState.SignedOut() else AppUiState.SignedIn(actor)
            } catch (error: Throwable) {
                _state.value = AppUiState.SignedOut(message = error.userMessage())
            }
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
}
