package com.travkin.flow.data

import android.content.Context
import com.google.gson.Gson
import com.travkin.flow.BuildConfig
import com.travkin.flow.domain.Actor
import com.travkin.flow.domain.CachedOverview
import com.travkin.flow.domain.CachedTicketPage
import com.travkin.flow.domain.OperationalOverview
import com.travkin.flow.domain.TicketDetails
import com.travkin.flow.domain.TicketPage
import com.travkin.flow.domain.SupportedRole
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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

    fun cachedOverview(actor: Actor): OperationalOverview? =
        localState.loadOverview(actor.id, actor.companyId)?.overview

    suspend fun refreshOverview(actor: Actor): OperationalOverview {
        var session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        var response = appApi.operationalOverview(session.bearer(), companyId = actor.companyId)
        if (response.code() == 401) {
            session = refreshSession(force = true)
            response = appApi.operationalOverview(session.bearer(), companyId = actor.companyId)
        }
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось загрузить оперативную сводку.")
        val overview = response.body()?.toOperationalOverview()
            ?: throw UserFacingException("Сервер вернул пустую оперативную сводку.")
        localState.saveOverview(CachedOverview(actor.id, actor.companyId, overview))
        return overview
    }

    fun cachedTicketPage(actor: Actor): TicketPage? =
        localState.loadTicketPage(actor.id, actor.companyId)?.page

    suspend fun refreshTickets(actor: Actor, requestedHistoryLimit: Int): TicketPage {
        val historyLimit = requestedHistoryLimit.coerceIn(MIN_TICKET_HISTORY, MAX_TICKET_HISTORY)
        var session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        var response = appApi.tickets(
            authorization = session.bearer(),
            companyId = actor.companyId,
            historyLimit = historyLimit,
        )
        if (response.code() == 401) {
            session = refreshSession(force = true)
            response = appApi.tickets(
                authorization = session.bearer(),
                companyId = actor.companyId,
                historyLimit = historyLimit,
            )
        }
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось загрузить талоны.")
        val page = response.body()?.toTicketPage(historyLimit)
            ?: throw UserFacingException("Сервер вернул пустой список талонов.")
        localState.saveTicketPage(CachedTicketPage(actor.id, actor.companyId, page))
        return page
    }

    suspend fun ticketDetails(actor: Actor, ticketId: String): TicketDetails {
        val normalizedId = ticketId.trim().takeIf(String::isNotEmpty)
            ?: throw UserFacingException("Не указан талон.")
        var session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        var response = appApi.ticketDetails(session.bearer(), normalizedId, actor.companyId)
        if (response.code() == 401) {
            session = refreshSession(force = true)
            response = appApi.ticketDetails(session.bearer(), normalizedId, actor.companyId)
        }
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось загрузить талон.")
        return response.body()?.toTicketDetails()
            ?: throw UserFacingException("Сервер вернул пустой талон.")
    }

    suspend fun signOut() {
        val session = localState.loadSession()
        if (session != null && configured()) {
            runCatching { authApi.signOut(BuildConfig.SUPABASE_ANON_KEY, session.bearer()) }
        }
        clearLocalSession()
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
        localState.clearOverview()
        localState.clearTicketPage()
    }

    private fun configured(): Boolean =
        BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_ANON_KEY.isNotBlank()

    private fun requireConfiguration() {
        if (!configured()) {
            throw UserFacingException(
                "Native QA build не настроен: перед сборкой задайте TRAVKINFLOW_SUPABASE_URL и TRAVKINFLOW_SUPABASE_ANON_KEY.",
            )
        }
    }

    private fun retrofit(rawBaseUrl: String): Retrofit {
        val baseUrl = rawBaseUrl.trim().takeIf(String::isNotEmpty) ?: "https://invalid.local/"
        return Retrofit.Builder()
            .baseUrl(if (baseUrl.endsWith('/')) baseUrl else "$baseUrl/")
            .client(httpClient)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
    }

    private fun Response<AuthTokenDto>.toSessionOrThrow(): StoredSession {
        if (!isSuccessful) throw toApiFailure("Неверный email или пароль.")
        val dto = body() ?: throw UserFacingException("Сервис авторизации вернул пустой ответ.")
        val accessToken = dto.accessToken?.takeIf(String::isNotBlank)
            ?: throw UserFacingException("Сервис авторизации не вернул access token.")
        val refreshToken = dto.refreshToken?.takeIf(String::isNotBlank)
            ?: throw UserFacingException("Сервис авторизации не вернул refresh token.")
        val expiresAt = dto.expiresAtEpochSeconds
            ?: (System.currentTimeMillis() / 1_000 + (dto.expiresInSeconds ?: 3_600))
        return StoredSession(accessToken, refreshToken, expiresAt)
    }

    private fun <T> Response<T>.toApiFailure(fallback: String): UserFacingException {
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
        const val MIN_TICKET_HISTORY = 10
        const val MAX_TICKET_HISTORY = 100
    }
}

open class UserFacingException(message: String, cause: Throwable? = null) : Exception(message, cause)

class SessionExpiredException(message: String = "Сессия истекла. Войдите снова.") :
    UserFacingException(message)

class UnsupportedRoleException(role: String?) : UserFacingException(
    "Роль ${role?.takeIf(String::isNotBlank) ?: "не определена"} пока не входит в native Android scope.",
)
