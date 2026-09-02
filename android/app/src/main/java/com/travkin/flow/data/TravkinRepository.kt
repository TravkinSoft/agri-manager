package com.travkin.flow.data

import android.content.Context
import com.google.gson.Gson
import com.travkin.flow.BuildConfig
import com.travkin.flow.domain.Actor
import com.travkin.flow.domain.SupportedRole
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class TravkinRepository(context: Context) {
    private val gson = Gson()
    private val localState = LocalStateStore(SecureStorage(context), gson)
    private val refreshMutex = Mutex()

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val authApi = retrofit(BuildConfig.SUPABASE_URL).create(SupabaseAuthApi::class.java)
    private val appApi = retrofit(BuildConfig.BASE_URL).create(TravkinFlowApi::class.java)

    suspend fun signIn(email: String, password: String): Actor {
        requireConfiguration()
        val normalizedEmail = email.trim().lowercase()
        if (normalizedEmail.isBlank() || password.isBlank()) {
            throw UserFacingException("Введите email и пароль.")
        }

        val response = authApi.signIn(
            apiKey = BuildConfig.SUPABASE_ANON_KEY,
            body = PasswordGrantBody(normalizedEmail, password),
        )
        val session = response.toSessionOrThrow()
        localState.saveSession(session)

        val actor = try {
            fetchActor(session)
        } catch (error: Throwable) {
            runCatching { authApi.signOut(BuildConfig.SUPABASE_ANON_KEY, session.bearer()) }
            clearLocalSession()
            throw error
        }
        localState.saveActor(actor)
        return actor
    }

    suspend fun restoreActor(): Actor? {
        requireConfiguration()
        val session = localState.loadSession() ?: return null
        return try {
            fetchActor(resolveSession(session)).also(localState::saveActor)
        } catch (error: SessionExpiredException) {
            clearLocalSession()
            throw error
        } catch (error: UnsupportedRoleException) {
            clearLocalSession()
            throw error
        } catch (error: Throwable) {
            localState.loadActor(MAX_OFFLINE_ACTOR_AGE_MILLIS) ?: throw error
        }
    }

    suspend fun refreshActor(): Actor {
        val session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        return try {
            fetchActor(session).also(localState::saveActor)
        } catch (error: UnsupportedRoleException) {
            clearLocalSession()
            throw error
        }
    }

    fun signOutLocally(): StoredSession? {
        val session = localState.loadSession()
        clearLocalSession()
        return session
    }

    suspend fun revokeSessionBestEffort(session: StoredSession?) {
        if (session == null || !configured()) return
        withTimeoutOrNull(REMOTE_LOGOUT_TIMEOUT_MILLIS) {
            runCatching { authApi.signOut(BuildConfig.SUPABASE_ANON_KEY, session.bearer()) }
        }
    }

    private suspend fun fetchActor(initialSession: StoredSession): Actor {
        var session = initialSession
        var response = appApi.actor(session.bearer())
        if (response.code() == 401) {
            session = refreshSession(force = true, fallback = session)
            response = appApi.actor(session.bearer())
        }
        if (!response.isSuccessful) {
            if (response.code() == 401 || response.code() == 403) throw SessionExpiredException()
            throw response.toApiFailure("Не удалось проверить профиль пользователя.")
        }

        val dto = response.body()?.actor ?: throw UserFacingException("Профиль пользователя не найден.")
        if (dto.status?.lowercase() !in setOf(null, "active")) {
            throw SessionExpiredException("Профиль пользователя неактивен.")
        }
        val role = SupportedRole.fromWire(dto.role) ?: throw UnsupportedRoleException(dto.role)
        val actorId = dto.id?.takeIf(String::isNotBlank)
            ?: throw UserFacingException("Сервер не вернул идентификатор пользователя.")
        return Actor(actorId, role, dto.companyId, dto.email)
    }

    private suspend fun resolveSession(session: StoredSession): StoredSession {
        val now = System.currentTimeMillis() / 1_000
        return if (session.expiresAtEpochSeconds <= now + REFRESH_EARLY_SECONDS) {
            refreshSession(force = false, fallback = session)
        } else {
            session
        }
    }

    private suspend fun refreshSession(
        force: Boolean,
        fallback: StoredSession? = null,
    ): StoredSession = refreshMutex.withLock {
        val latest = localState.loadSession() ?: fallback ?: throw SessionExpiredException()
        val now = System.currentTimeMillis() / 1_000
        if (!force && latest.expiresAtEpochSeconds > now + REFRESH_EARLY_SECONDS) return@withLock latest

        val response = try {
            authApi.refresh(
                apiKey = BuildConfig.SUPABASE_ANON_KEY,
                body = RefreshGrantBody(latest.refreshToken),
            )
        } catch (error: Throwable) {
            throw UserFacingException("Нет связи для обновления сессии. Повторите при появлении сети.", error)
        }
        if (!response.isSuccessful) {
            if (response.code() in setOf(400, 401, 403)) {
                clearLocalSession()
                throw SessionExpiredException()
            }
            throw response.toApiFailure("Не удалось обновить сессию.")
        }

        val updated = response.toSessionOrThrow()
        localState.saveSession(updated)
        updated
    }

    private fun clearLocalSession() {
        localState.clearSession()
        localState.clearActor()
    }

    private fun configured(): Boolean =
        isSecureApiBaseUrl(BuildConfig.SUPABASE_URL) &&
            isSecureApiBaseUrl(BuildConfig.BASE_URL) &&
            BuildConfig.SUPABASE_ANON_KEY.isNotBlank()

    private fun requireConfiguration() {
        if (!configured()) {
            throw UserFacingException(
                "Native Android не настроен: для сборки нужны TRAVKINFLOW_SUPABASE_URL и TRAVKINFLOW_SUPABASE_ANON_KEY.",
            )
        }
    }

    private fun retrofit(rawBaseUrl: String): Retrofit {
        val baseUrl = rawBaseUrl.trim().toHttpUrlOrNull()
            ?.takeIf { isSecureApiBaseUrl(rawBaseUrl) }
            ?: "https://invalid.local/".toHttpUrl()
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(httpClient)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
    }

    private fun Response<AuthTokenDto>.toSessionOrThrow(): StoredSession {
        if (!isSuccessful) throw toApiFailure("Неверный email или пароль.", sessionAware = false)
        val dto = body() ?: throw UserFacingException("Сервис авторизации вернул пустой ответ.")
        val accessToken = dto.accessToken?.takeIf(String::isNotBlank)
            ?: throw UserFacingException("Сервис авторизации не вернул access token.")
        val refreshToken = dto.refreshToken?.takeIf(String::isNotBlank)
            ?: throw UserFacingException("Сервис авторизации не вернул refresh token.")
        val expiresAt = dto.expiresAtEpochSeconds
            ?: (System.currentTimeMillis() / 1_000 + (dto.expiresInSeconds ?: 3_600))
        return StoredSession(accessToken, refreshToken, expiresAt)
    }

    private fun <T> Response<T>.toApiFailure(
        fallback: String,
        sessionAware: Boolean = true,
    ): UserFacingException {
        if (sessionAware && code() == 401) return SessionExpiredException()
        val payload = runCatching {
            errorBody()?.string()?.let { gson.fromJson(it, ApiErrorDto::class.java) }
        }.getOrNull()
        val safeMessage = payload?.description ?: payload?.message ?: payload?.error
        return UserFacingException(safeMessage?.takeIf(String::isNotBlank) ?: fallback)
    }

    private fun StoredSession.bearer() = "Bearer $accessToken"

    private companion object {
        const val REFRESH_EARLY_SECONDS = 90L
        const val MAX_OFFLINE_ACTOR_AGE_MILLIS = 12L * 60L * 60L * 1_000L
        const val REMOTE_LOGOUT_TIMEOUT_MILLIS = 5_000L
    }
}

internal fun isSecureApiBaseUrl(rawUrl: String): Boolean = rawUrl.trim().toHttpUrlOrNull()?.let { url ->
    url.isHttps &&
        url.encodedPath == "/" &&
        url.query == null &&
        url.fragment == null &&
        url.username.isEmpty() &&
        url.password.isEmpty()
} == true

open class UserFacingException(message: String, cause: Throwable? = null) : Exception(message, cause)

class SessionExpiredException(message: String = "Сессия истекла. Войдите снова.") :
    UserFacingException(message)

class UnsupportedRoleException(role: String?) : UserFacingException(
    "Мобильный TravkinFlow сейчас доступен только роли Агроном. Текущая роль: ${role?.takeIf(String::isNotBlank) ?: "не определена"}.",
)
