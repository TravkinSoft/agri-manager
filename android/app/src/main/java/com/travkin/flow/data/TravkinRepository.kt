package com.travkin.flow.data

import android.content.Context
import com.google.gson.Gson
import com.travkin.flow.BuildConfig
import com.travkin.flow.domain.Actor
import com.travkin.flow.domain.CachedOverview
import com.travkin.flow.domain.CachedHarvestOverview
import com.travkin.flow.domain.CachedTicketPage
import com.travkin.flow.domain.CachedWarehouseOverview
import com.travkin.flow.domain.OperationalOverview
import com.travkin.flow.domain.HarvestOverview
import com.travkin.flow.domain.TicketDetails
import com.travkin.flow.domain.TicketPage
import com.travkin.flow.domain.WarehouseOverview
import com.travkin.flow.domain.SupportedRole
import com.travkin.flow.domain.HarvestTicketDraft
import com.travkin.flow.domain.PendingWeighbridgeCommand
import com.travkin.flow.domain.PendingWeighbridgeQueue
import com.travkin.flow.domain.TicketSummary
import com.travkin.flow.domain.WeighbridgeWorkspace
import com.travkin.flow.domain.WeighbridgeWritePolicy
import com.travkin.flow.domain.CachedWeatherForecast
import com.travkin.flow.domain.KatoLocality
import com.travkin.flow.domain.WeatherForecast
import com.travkin.flow.domain.WeatherLocation
import com.travkin.flow.domain.CachedNotificationCenter
import com.travkin.flow.domain.NotificationCenterData
import com.travkin.flow.domain.ProfileSessionSnapshot
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException
import java.util.UUID
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class TravkinRepository(context: Context) {
    private val gson = Gson()
    private val secureStorage = SecureStorage(context)
    private val localState = LocalStateStore(secureStorage, gson)
    private val operatorCookieJar = OperatorCookieJar(secureStorage, BuildConfig.BASE_URL.toHttpUrl())
    private val refreshMutex = Mutex()

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .cookieJar(operatorCookieJar)
        .build()

    private val authApi = retrofit(BuildConfig.SUPABASE_URL).create(SupabaseAuthApi::class.java)
    private val restApi = retrofit(BuildConfig.SUPABASE_URL).create(SupabaseRestApi::class.java)
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

    fun cachedHarvestOverview(actor: Actor): HarvestOverview? {
        val companyId = actor.companyId ?: return null
        return localState.loadHarvestOverview(actor.id, companyId)?.overview
    }

    suspend fun refreshHarvestOverview(actor: Actor): HarvestOverview {
        if (!actor.role.canViewHarvest) throw UnsupportedRoleException(actor.role.wireValue)
        val companyId = actor.companyId
            ?: throw UserFacingException("Для сводки урожая сначала выберите контекст компании.")
        var session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        var response = appApi.harvestOverview(session.bearer(), companyId)
        if (response.code() == 401) {
            session = refreshSession(force = true)
            response = appApi.harvestOverview(session.bearer(), companyId)
        }
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось загрузить сводку урожая.")
        val overview = response.body()?.toHarvestOverview()
            ?: throw UserFacingException("Сервер вернул пустую сводку урожая.")
        localState.saveHarvestOverview(CachedHarvestOverview(actor.id, companyId, overview))
        return overview
    }

    fun cachedWarehouseOverview(actor: Actor): WarehouseOverview? {
        val companyId = actor.companyId ?: return null
        return localState.loadWarehouseOverview(actor.id, companyId)?.overview
    }

    suspend fun refreshWarehouseOverview(actor: Actor): WarehouseOverview {
        if (!actor.role.canViewWarehouses) throw UnsupportedRoleException(actor.role.wireValue)
        val companyId = actor.companyId
            ?: throw UserFacingException("Для складов сначала выберите контекст компании.")
        var session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        var response = appApi.warehouseSummaries(session.bearer(), companyId)
        if (response.code() == 401) {
            session = refreshSession(force = true)
            response = appApi.warehouseSummaries(session.bearer(), companyId)
        }
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось загрузить склады и объекты.")
        val overview = response.body()?.toWarehouseOverview()
            ?: throw UserFacingException("Сервер вернул пустой список складов и объектов.")
        localState.saveWarehouseOverview(CachedWarehouseOverview(actor.id, companyId, overview))
        return overview
    }

    fun cachedWeatherForecast(actor: Actor): WeatherForecast? {
        if (!actor.role.canViewWeather) return null
        return localState.loadWeatherForecast(actor.id, actor.companyId)?.forecast
    }

    fun profileSessionSnapshot(actor: Actor): ProfileSessionSnapshot = ProfileSessionSnapshot(
        actorVerifiedAtEpochMillis = localState.loadActorSavedAt(actor.id),
        sessionExpiresAtEpochSeconds = localState.loadSession()?.expiresAtEpochSeconds,
    )

    fun cachedNotificationCenter(actor: Actor): NotificationCenterData? =
        localState.loadNotificationCenter(actor.id, actor.companyId)?.center

    suspend fun refreshNotificationCenter(actor: Actor): NotificationCenterData {
        var session = currentSession()
        val companyFilter = actor.companyId?.let { "eq.$it" }
        var response = restApi.notifications(
            apiKey = BuildConfig.SUPABASE_ANON_KEY,
            authorization = session.bearer(),
            columns = NOTIFICATION_COLUMNS,
            recipientFilter = "eq.${actor.id}",
            companyFilter = companyFilter,
        )
        if (response.code() == 401) {
            session = refreshSession(force = true)
            response = restApi.notifications(
                apiKey = BuildConfig.SUPABASE_ANON_KEY,
                authorization = session.bearer(),
                columns = NOTIFICATION_COLUMNS,
                recipientFilter = "eq.${actor.id}",
                companyFilter = companyFilter,
            )
        }
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось загрузить уведомления.")
        val center = response.body().orEmpty().toNotificationCenter(actor.id, actor.companyId)
        localState.saveNotificationCenter(CachedNotificationCenter(actor.id, actor.companyId, center))
        return center
    }

    suspend fun searchWeatherLocalities(actor: Actor, rawQuery: String): List<KatoLocality> {
        requireWeatherRole(actor)
        val query = rawQuery.trim()
        if (query.length < 2) return emptyList()
        var session = currentSession()
        var response = appApi.searchKatoLocalities(session.bearer(), query = query)
        if (response.code() == 401) {
            session = refreshSession(force = true)
            response = appApi.searchKatoLocalities(session.bearer(), query = query)
        }
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось выполнить поиск населённого пункта.")
        return response.body()?.toKatoLocalities().orEmpty()
    }

    suspend fun resolveWeatherLocation(actor: Actor, katoCode: String): WeatherLocation {
        requireWeatherRole(actor)
        if (katoCode.isBlank()) throw UserFacingException("Код КАТО не указан.")
        var session = currentSession()
        var response = appApi.resolveWeatherLocation(session.bearer(), katoCode)
        if (response.code() == 401) {
            session = refreshSession(force = true)
            response = appApi.resolveWeatherLocation(session.bearer(), katoCode)
        }
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось определить координаты населённого пункта.")
        return response.body()?.toWeatherLocation()
            ?: throw UserFacingException("Сервер вернул некорректное местоположение.")
    }

    suspend fun refreshWeatherForecast(
        actor: Actor,
        location: WeatherLocation,
        forceRefresh: Boolean,
    ): WeatherForecast {
        requireWeatherRole(actor)
        var session = currentSession()
        val request: suspend (StoredSession) -> Response<WeatherForecastEnvelopeDto> = { activeSession ->
            appApi.weatherForecast(
                authorization = activeSession.bearer(),
                latitude = location.latitude,
                longitude = location.longitude,
                displayName = location.displayName,
                region = location.region,
                district = location.district,
                locality = location.locality,
                katoCode = location.katoCode,
                refresh = if (forceRefresh) 1 else null,
            )
        }
        var response = request(session)
        if (response.code() == 401) {
            session = refreshSession(force = true)
            response = request(session)
        }
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось получить прогноз погоды.")
        val forecast = response.body()?.toWeatherForecast()
            ?: throw UserFacingException("Сервер вернул некорректный прогноз погоды.")
        localState.saveWeatherForecast(CachedWeatherForecast(actor.id, actor.companyId, forecast))
        return forecast
    }

    fun weighbridgeWritesEnabled(actor: Actor): Boolean = WeighbridgeWritePolicy.isAllowed(
        enabled = BuildConfig.WEIGHBRIDGE_WRITE_ENABLED,
        appChannel = BuildConfig.APP_CHANNEL,
        baseUrl = BuildConfig.BASE_URL,
        role = actor.role,
    )

    suspend fun loadWeighbridgeWorkspace(actor: Actor): WeighbridgeWorkspace {
        if (!actor.role.canUseWeighbridgeWorkspace) throw UnsupportedRoleException(actor.role.wireValue)
        val companyId = actor.companyId
            ?: throw UserFacingException("Для Весовой сначала выберите контекст компании.")
        var session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        var response = appApi.operatorState(session.bearer(), companyId)
        if (response.code() == 401) {
            session = refreshSession(force = true)
            response = appApi.operatorState(session.bearer(), companyId)
        }
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось загрузить рабочее место Весовой.")
        val dto = response.body() ?: throw UserFacingException("Сервер вернул пустое рабочее место Весовой.")
        return dto.toWeighbridgeWorkspace(
            localWorkstationId = localState.loadOrCreateWorkstationId(),
            writesEnabled = weighbridgeWritesEnabled(actor),
            pendingCommandCount = pendingCommands(actor).size,
        )
    }

    suspend fun unlockWeighbridgeOperator(
        actor: Actor,
        personId: String,
        pin: String,
        handover: Boolean,
        note: String?,
    ): WeighbridgeWorkspace {
        val companyId = requireWeighbridgeWrites(actor)
        if (personId.isBlank()) throw UserFacingException("Выберите сменщика.")
        if (!pin.matches(Regex("^\\d{6}$"))) throw UserFacingException("PIN должен содержать 6 цифр.")
        val response = appApi.mutateOperatorSession(
            authorization = currentSession().bearer(),
            body = OperatorMutationBody(
                action = if (handover) "handover" else "unlock",
                companyId = companyId,
                personId = personId,
                pin = pin,
                note = note?.trim()?.takeIf(String::isNotEmpty),
            ),
        )
        // 401 here can mean an invalid PIN. Retrying would consume a second PIN attempt.
        if (!response.isSuccessful) throw response.toApiFailure(
            "Не удалось подтвердить весовщика.",
            sessionAware = false,
        )
        return loadWeighbridgeWorkspace(actor)
    }

    suspend fun lockWeighbridgeOperator(actor: Actor): WeighbridgeWorkspace {
        val companyId = requireWeighbridgeWrites(actor)
        val response = appApi.mutateOperatorSession(
            authorization = currentSession().bearer(),
            body = OperatorMutationBody(action = "lock", companyId = companyId),
        )
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось заблокировать терминал.")
        operatorCookieJar.clear()
        return loadWeighbridgeWorkspace(actor)
    }

    suspend fun createHarvestTicket(actor: Actor, draft: HarvestTicketDraft): TicketSummary {
        val companyId = requireWeighbridgeWrites(actor)
        validateHarvestDraft(draft)
        val command = PendingWeighbridgeCommand(
            idempotencyKey = UUID.randomUUID().toString(),
            type = COMMAND_CREATE_HARVEST,
            actorId = actor.id,
            companyId = companyId,
            draft = draft,
            createdAtEpochMillis = System.currentTimeMillis(),
        )
        enqueue(command)
        return executePendingCommand(actor, command)
    }

    suspend fun saveGrossWeight(actor: Actor, ticketId: String, grossWeightKg: Double): TicketSummary {
        val companyId = requireWeighbridgeWrites(actor)
        if (ticketId.isBlank() || !grossWeightKg.isFinite() || grossWeightKg <= 0) {
            throw UserFacingException("Укажите корректное брутто больше нуля.")
        }
        val command = PendingWeighbridgeCommand(
            idempotencyKey = UUID.randomUUID().toString(),
            type = COMMAND_PATCH_GROSS,
            actorId = actor.id,
            companyId = companyId,
            ticketId = ticketId,
            grossWeightKg = grossWeightKg,
            createdAtEpochMillis = System.currentTimeMillis(),
        )
        enqueue(command)
        return executePendingCommand(actor, command)
    }

    suspend fun finalizeWeighbridgeTicket(
        actor: Actor,
        ticketId: String,
        grossWeightKg: Double,
        tareWeightKg: Double,
        confirmTareVariance: Boolean = false,
    ): TicketSummary {
        val companyId = requireWeighbridgeWrites(actor)
        if (ticketId.isBlank() || !grossWeightKg.isFinite() || !tareWeightKg.isFinite() || grossWeightKg <= 0 || tareWeightKg < 0 || tareWeightKg >= grossWeightKg) {
            throw UserFacingException("Тара должна быть неотрицательной и меньше брутто.")
        }
        val existing = pendingCommands(actor).firstOrNull {
            it.type == COMMAND_FINALIZE && it.ticketId == ticketId
        }
        val command = (existing ?: PendingWeighbridgeCommand(
            idempotencyKey = UUID.randomUUID().toString(),
            type = COMMAND_FINALIZE,
            actorId = actor.id,
            companyId = companyId,
            ticketId = ticketId,
            grossWeightKg = grossWeightKg,
            tareWeightKg = tareWeightKg,
            createdAtEpochMillis = System.currentTimeMillis(),
        )).copy(confirmTareVariance = confirmTareVariance)
        replaceOrEnqueue(command)
        return executePendingCommand(actor, command)
    }

    suspend fun retryPendingWeighbridgeCommands(actor: Actor): Int {
        requireWeighbridgeWrites(actor)
        var completed = 0
        for (command in pendingCommands(actor).sortedBy(PendingWeighbridgeCommand::createdAtEpochMillis)) {
            executePendingCommand(actor, command)
            completed += 1
        }
        return completed
    }

    fun pendingWeighbridgeCommandCount(actor: Actor): Int = pendingCommands(actor).size

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

    suspend fun signOut() {
        revokeSessionBestEffort(signOutLocally())
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

    private suspend fun executePendingCommand(
        actor: Actor,
        command: PendingWeighbridgeCommand,
    ): TicketSummary {
        requireWeighbridgeWrites(actor)
        var session = currentSession()
        val request: suspend (StoredSession) -> Response<TicketMutationEnvelopeDto> = { activeSession ->
            when (command.type) {
                COMMAND_CREATE_HARVEST -> {
                    val draft = command.draft ?: throw UserFacingException("Черновик талона повреждён.")
                    appApi.createTicket(
                        authorization = activeSession.bearer(),
                        idempotencyKey = command.idempotencyKey,
                        body = CreateTicketEnvelope(
                            ticket = NativeTicketInputDto(
                                companyId = command.companyId,
                                sourceId = draft.fieldId,
                                destinationId = draft.destinationId,
                                fieldId = draft.fieldId,
                                allocationId = draft.allocationId,
                                warehouseToId = draft.destinationId,
                                vehicleId = draft.vehicleId,
                                driverId = draft.driverId,
                                grossWeightKg = draft.grossWeightKg,
                                createdBy = command.actorId,
                                notes = draft.notes,
                            ),
                            lines = listOf(
                                NativeTicketLineInputDto(
                                    productId = draft.cropId,
                                    cropId = draft.cropId,
                                    quantity = draft.grossWeightKg,
                                    warehouseToId = draft.destinationId,
                                    varietyId = draft.varietyId,
                                    reproductionId = draft.reproductionId,
                                ),
                            ),
                        ),
                    )
                }
                COMMAND_PATCH_GROSS -> appApi.patchTicketWeight(
                    authorization = activeSession.bearer(),
                    ticketId = command.ticketId ?: throw UserFacingException("Талон не указан."),
                    companyId = command.companyId,
                    body = TicketWeightPatchBody(
                        companyId = command.companyId,
                        grossWeightKg = command.grossWeightKg,
                        status = "active",
                    ),
                )
                COMMAND_FINALIZE -> appApi.finalizeTicket(
                    authorization = activeSession.bearer(),
                    idempotencyKey = command.idempotencyKey,
                    ticketId = command.ticketId ?: throw UserFacingException("Талон не указан."),
                    companyId = command.companyId,
                    body = FinalizeTicketBody(
                        companyId = command.companyId,
                        tareWeightKg = command.tareWeightKg
                            ?: throw UserFacingException("Тара не указана."),
                        confirmTareVariance = command.confirmTareVariance,
                        idempotencyKey = command.idempotencyKey,
                    ),
                )
                else -> throw UserFacingException("Неизвестная команда Весовой.")
            }
        }

        val response = try {
            var result = request(session)
            if (result.code() == 401) {
                session = refreshSession(force = true)
                result = request(session)
            }
            result
        } catch (error: IOException) {
            incrementAttempt(command)
            throw OfflineQueuedException(cause = error)
        }

        if (!response.isSuccessful) {
            if (response.code() == 401) throw SessionExpiredException()
            val payload = response.readErrorPayload()
            incrementAttempt(command)
            if (payload?.requiresConfirmation == true && command.type == COMMAND_FINALIZE) {
                throw TareVarianceConfirmationException(
                    previousTareKg = payload.previousTareKg,
                    currentTareKg = payload.currentTareKg ?: command.tareWeightKg,
                    differencePercent = payload.differencePercent,
                )
            }
            if (response.code() !in RETRYABLE_WRITE_CODES) removeCommand(command.idempotencyKey)
            val safeMessage = payload?.description ?: payload?.message ?: payload?.error
            throw UserFacingException(safeMessage?.takeIf(String::isNotBlank) ?: "Команда Весовой не выполнена.")
        }

        val ticket = response.body()?.ticket?.toTicketSummary()
            ?: throw UserFacingException("Сервер не вернул обновлённый талон.")
        removeCommand(command.idempotencyKey)
        return ticket
    }

    private suspend fun currentSession(): StoredSession =
        resolveSession(localState.loadSession() ?: throw SessionExpiredException())

    private fun requireWeighbridgeWrites(actor: Actor): String {
        if (!weighbridgeWritesEnabled(actor)) {
            throw UserFacingException("Запись Весовой отключена. Она разрешается только отдельным QA feature flag.")
        }
        return actor.companyId ?: throw UserFacingException("Для Весовой выберите контекст компании.")
    }

    private fun requireWeatherRole(actor: Actor) {
        if (!actor.role.canViewWeather) {
            throw UnsupportedRoleException(actor.role.wireValue)
        }
    }

    private fun validateHarvestDraft(draft: HarvestTicketDraft) {
        if (listOf(draft.allocationId, draft.fieldId, draft.cropId, draft.destinationId).any(String::isBlank)) {
            throw UserFacingException("Выберите поле, культуру и место приёмки.")
        }
        if (!draft.grossWeightKg.isFinite() || draft.grossWeightKg <= 0) {
            throw UserFacingException("Брутто должно быть больше нуля.")
        }
    }

    private fun pendingCommands(actor: Actor): List<PendingWeighbridgeCommand> =
        localState.loadPendingWeighbridgeQueue().commands.filter {
            it.actorId == actor.id && it.companyId == actor.companyId
        }

    private fun enqueue(command: PendingWeighbridgeCommand) {
        val current = localState.loadPendingWeighbridgeQueue().commands
        if (current.any { it.idempotencyKey == command.idempotencyKey }) return
        localState.savePendingWeighbridgeQueue(PendingWeighbridgeQueue((current + command).takeLast(MAX_PENDING_COMMANDS)))
    }

    private fun replaceOrEnqueue(command: PendingWeighbridgeCommand) {
        val current = localState.loadPendingWeighbridgeQueue().commands
        val updated = current.filterNot { it.idempotencyKey == command.idempotencyKey } + command
        localState.savePendingWeighbridgeQueue(PendingWeighbridgeQueue(updated.takeLast(MAX_PENDING_COMMANDS)))
    }

    private fun incrementAttempt(command: PendingWeighbridgeCommand) {
        replaceOrEnqueue(command.copy(attempts = command.attempts + 1))
    }

    private fun removeCommand(idempotencyKey: String) {
        val remaining = localState.loadPendingWeighbridgeQueue().commands.filterNot {
            it.idempotencyKey == idempotencyKey
        }
        localState.savePendingWeighbridgeQueue(PendingWeighbridgeQueue(remaining))
    }

    private fun <T> Response<T>.readErrorPayload(): ApiErrorDto? = runCatching {
        errorBody()?.string()?.let { gson.fromJson(it, ApiErrorDto::class.java) }
    }.getOrNull()

    private fun clearLocalSession() {
        localState.clearSession()
        localState.clearActor()
        localState.clearOverview()
        localState.clearTicketPage()
        localState.clearHarvestOverview()
        localState.clearWarehouseOverview()
        localState.clearWeatherForecast()
        localState.clearNotificationCenter()
        localState.clearPendingWeighbridgeQueue()
        operatorCookieJar.clear()
    }

    private fun configured(): Boolean =
        isSecureApiBaseUrl(BuildConfig.SUPABASE_URL) && BuildConfig.SUPABASE_ANON_KEY.isNotBlank()

    private fun requireConfiguration() {
        if (!configured()) {
            throw UserFacingException(
                "Native QA build не настроен: перед сборкой задайте TRAVKINFLOW_SUPABASE_URL и TRAVKINFLOW_SUPABASE_ANON_KEY.",
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
        const val MIN_TICKET_HISTORY = 10
        const val MAX_TICKET_HISTORY = 100
        const val MAX_PENDING_COMMANDS = 20
        const val REMOTE_LOGOUT_TIMEOUT_MILLIS = 5_000L
        const val NOTIFICATION_COLUMNS = "id,company_id,recipient_user_id,category,event_type,title,body,href,entity_type,entity_id,read_at,created_at"
        const val COMMAND_CREATE_HARVEST = "create_harvest"
        const val COMMAND_PATCH_GROSS = "patch_gross"
        const val COMMAND_FINALIZE = "finalize"
        val RETRYABLE_WRITE_CODES = setOf(408, 423, 425, 429, 500, 502, 503, 504)
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
    "Роль ${role?.takeIf(String::isNotBlank) ?: "не определена"} пока не входит в native Android scope.",
)

class OfflineQueuedException(cause: Throwable? = null) : UserFacingException(
    "Нет связи. Команда сохранена зашифрованно и будет повторена только с тем же ключом без дубля.",
    cause,
)

class TareVarianceConfirmationException(
    val previousTareKg: Double?,
    val currentTareKg: Double?,
    val differencePercent: Double?,
) : UserFacingException("Текущая тара заметно отличается от предыдущей. Требуется повторное подтверждение.")
