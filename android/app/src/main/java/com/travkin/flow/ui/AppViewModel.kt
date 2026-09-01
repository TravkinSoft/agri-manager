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
        val overview: OperationalOverview?,
        val refreshing: Boolean,
        val stale: Boolean,
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
                val actor = repository.signIn(email, password)
                loadOverview(actor)
            } catch (error: Throwable) {
                _state.value = AppUiState.SignedOut(message = error.userMessage())
            }
        }
    }

    fun refresh() {
        val actor = (_state.value as? AppUiState.SignedIn)?.actor ?: return
        viewModelScope.launch { loadOverview(actor) }
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

    private suspend fun loadOverview(actor: Actor) {
        val cached = repository.cachedOverview(actor)
        _state.value = AppUiState.SignedIn(
            actor = actor,
            overview = cached,
            refreshing = true,
            stale = cached != null,
        )
        try {
            val live = repository.refreshOverview(actor)
            _state.value = AppUiState.SignedIn(
                actor = actor,
                overview = live,
                refreshing = false,
                stale = false,
            )
        } catch (error: SessionExpiredException) {
            repository.signOut()
            _state.value = AppUiState.SignedOut(message = error.userMessage())
        } catch (error: Throwable) {
            _state.value = AppUiState.SignedIn(
                actor = actor,
                overview = cached,
                refreshing = false,
                stale = cached != null,
                message = error.userMessage(),
            )
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
