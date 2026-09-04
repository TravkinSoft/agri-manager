package com.travkin.flow.data

import android.content.Context
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonArray
import com.travkin.flow.BuildConfig
import com.travkin.flow.domain.Actor
import com.travkin.flow.domain.SupportedRole
import com.travkin.flow.domain.CabinetPage
import com.travkin.flow.domain.CabinetQuery
import com.travkin.flow.domain.CabinetSection
import com.travkin.flow.domain.CropEditorData
import com.travkin.flow.domain.CropAllocationDraft
import com.travkin.flow.domain.TrafficEditorData
import com.travkin.flow.domain.harvestFilterParameters
import com.travkin.flow.domain.WeatherProfile
import com.travkin.flow.domain.NotificationPreferences
import com.travkin.flow.domain.DriverAssignment
import com.travkin.flow.domain.DocumentExport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
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
    private var sessionGeneration = 0L

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    private val authApi = retrofit(BuildConfig.SUPABASE_URL).create(SupabaseAuthApi::class.java)
    private val appApi = retrofit(BuildConfig.BASE_URL).create(TravkinFlowApi::class.java)
    private val cabinetApi = retrofit(BuildConfig.BASE_URL).create(CabinetApi::class.java)
    private val documentExportApi = retrofit(BuildConfig.BASE_URL).create(DocumentExportApi::class.java)
    private val supabaseReadApi = retrofit(BuildConfig.SUPABASE_URL).create(SupabaseReadApi::class.java)
    private val commandApi = Retrofit.Builder().baseUrl(BuildConfig.BASE_URL.trimEnd('/') + "/")
        .client(httpClient.newBuilder().retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false).build())
        .addConverterFactory(GsonConverterFactory.create(gson)).build().create(CabinetCommandApi::class.java)
    private val acknowledgementApi = Retrofit.Builder().baseUrl(BuildConfig.SUPABASE_URL.takeIf(::isSecureApiBaseUrl) ?: "https://invalid.local/")
        .client(httpClient.newBuilder().retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false).build())
        .addConverterFactory(GsonConverterFactory.create(gson)).build().create(NotificationAcknowledgementApi::class.java)

    suspend fun prepareDocumentExport(actor: Actor, query: CabinetQuery): DocumentExport {
        val generation = sessionGeneration
        val verified = refreshActor()
        if (verified.id != actor.id || verified.authUserId != actor.authUserId || verified.companyId != actor.companyId || generation != sessionGeneration) throw SessionExpiredException()
        val company = verified.companyId ?: throw UserFacingException("Компания не назначена.")
        val id = requireObjectId(query.objectId ?: throw UserFacingException("Откройте конкретный документ."))
        val isField = query.section == CabinetSection.CROPS
        val season = if (isField) {
            val bootstrap = readCabinet { cabinetApi.crops(it, company) }
            if (bootstrap.rows("fields").none { it.text("id") == id }) throw UserFacingException("Поле недоступно.")
            val selected = query.seasonId ?: bootstrap.text("activeSeasonId")
            if (selected == null || bootstrap.rows("seasons").none { it.text("id") == selected }) throw UserFacingException("Выберите доступный сезон.")
            requireObjectId(selected)
        } else {
            if (query.section != CabinetSection.TICKETS) throw UserFacingException("Экспорт этого раздела не предусмотрен.")
            val ticket = readCabinet { cabinetApi.ticket(it, id, company) }.obj("ticket")
            if (ticket.text("id") != id || ticket.text("company_id") != company || ticket.text("op_type") != "harvest_incoming")
                throw UserFacingException("Этот документ не относится к кабинету Агронома.")
            null
        }
        val session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        val result = if (isField) documentExportApi.field(session.bearer(), id, season!!) else documentExportApi.ticket(session.bearer(), id)
        if (generation != sessionGeneration) { result.body()?.close(); result.errorBody()?.close(); throw CancellationException("Session changed") }
        if (!result.isSuccessful) {
            try { throw result.toApiFailure("Документ не получен. Обновите раздел и повторите экспорт.") }
            finally { result.errorBody()?.close() }
        }
        val body = result.body() ?: throw UserFacingException("Сервер вернул пустой документ.")
        val document = try { withContext(Dispatchers.IO) {
            exportDocument(boundedDocumentBytes(body.byteStream()), body.contentType()?.toString(), isField, id)
        } } finally { body.close() }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        return document
    }

    suspend fun saveDriverAssignment(actor: Actor, context: DriverAssignment, personId: String?) {
        val generation = sessionGeneration
        val verified = refreshActor()
        if (verified.id != actor.id || verified.companyId != actor.companyId || context.companyId != verified.companyId || generation != sessionGeneration) throw SessionExpiredException()
        val body = driverAssignmentBody(context, personId)
        val session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        val result = try { commandApi.driverAssignment(session.bearer(), BuildConfig.BASE_URL.trimEnd('/'), body) }
        catch (error: java.io.IOException) { throw UserFacingException("Нет подтверждения сервера. Обновите привязку перед повторным сохранением.", error) }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        if (!result.isSuccessful) throw result.toApiFailure("Назначение не сохранено.")
        driverAssignment(result.body() ?: JsonObject(), context.vehicleId, context.companyId)
    }

    suspend fun saveNotificationPreferences(actor: Actor, original: NotificationPreferences, updated: NotificationPreferences) {
        val generation = sessionGeneration
        val verified = refreshActor()
        if (verified.id != actor.id || verified.companyId != actor.companyId || generation != sessionGeneration) throw SessionExpiredException()
        val company = verified.companyId ?: throw UserFacingException("Компания не назначена.")
        val fresh = notificationPreferences(readCabinet { cabinetApi.notificationPreferences(it, company) }.obj("preferences"))
        if (fresh != original) throw UserFacingException("Настройки уже изменены. Обновите раздел.")
        val session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        val result = try { commandApi.notificationPreferences(session.bearer(), preferencesBody(updated.copy(proactiveEnabled = fresh.proactiveEnabled, proactiveCadence = fresh.proactiveCadence), company)) }
        catch (error: java.io.IOException) { throw UserFacingException("Ответ не получен. Обновите настройки и проверьте результат.", error) }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        if (!result.isSuccessful) throw result.toApiFailure("Не удалось сохранить настройки.")
        notificationPreferences(result.body()?.obj("preferences") ?: JsonObject())
    }

    suspend fun markNotificationsRead(actor: Actor, id: String?) {
        val generation = sessionGeneration
        val verified = refreshActor()
        if (verified.id != actor.id || verified.authUserId != actor.authUserId || verified.companyId != actor.companyId || generation != sessionGeneration) throw SessionExpiredException()
        val company = verified.companyId ?: throw UserFacingException("Компания не назначена.")
        val session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        val body = JsonObject().apply { addProperty("read_at", java.time.Instant.now().toString()) }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        val result = try { acknowledgementApi.markRead(BuildConfig.SUPABASE_ANON_KEY, session.bearer(), company = "eq.$company",
            user = "eq.${requireObjectId(verified.authUserId)}", id = id?.let { "eq.${requireObjectId(it)}" }, body = body) }
        catch (error: java.io.IOException) { throw UserFacingException("Не удалось подтвердить прочтение. Обновите уведомления.", error) }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        if (!result.isSuccessful) throw result.toApiFailure("Не удалось отметить прочитанным.")
    }

    suspend fun changeWeatherProfile(actor: Actor, original: WeatherProfile, updated: WeatherProfile?) {
        val generation = sessionGeneration
        val verified = refreshActor()
        if (verified.id != actor.id || verified.companyId != actor.companyId || generation != sessionGeneration) throw SessionExpiredException()
        if (original.id != null) {
            val fresh = readCabinet { cabinetApi.weatherProfiles(it) }.requireRows("profiles").map(::weatherProfile).firstOrNull { it.id == original.id }
            if (fresh == null || fresh.updatedAt != original.updatedAt) throw UserFacingException("Профиль уже изменён или удалён. Закройте редактор и обновите погоду.")
        }
        if (updated == null && original.id == null) throw UserFacingException("Профиль не сохранён.")
        val body = updated?.let(::weatherProfileBody)
        val session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        val result = try {
            when {
                updated == null -> commandApi.deleteWeatherProfile(session.bearer(), requireObjectId(original.id!!))
                original.id == null -> commandApi.createWeatherProfile(session.bearer(), body!!)
                else -> commandApi.updateWeatherProfile(session.bearer(), requireObjectId(original.id), body!!)
            }
        } catch (error: java.io.IOException) { throw UserFacingException("Ответ не получен. Обновите список профилей и проверьте результат перед повтором.", error) }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        if (!result.isSuccessful) throw result.toApiFailure("Не удалось изменить погодный профиль.")
        if (updated == null && result.body()?.flag("deleted") != true || updated != null && result.body()?.obj("profile")?.text("id") == null)
            throw UserFacingException("Сервер не подтвердил изменение. Обновите профили и проверьте результат.")
    }

    suspend fun saveTraffic(actor: Actor, context: TrafficEditorData, selected: Set<String>, emptyConfirmed: Boolean) {
        val generation = sessionGeneration
        val verified = refreshActor()
        if (verified.id != actor.id || verified.companyId != actor.companyId || generation != sessionGeneration) throw SessionExpiredException()
        val fresh = trafficEditor(readCabinet { cabinetApi.traffic(it) })
        if (fresh.fieldId != context.fieldId || fresh.assignedIds != context.assignedIds) {
            throw UserFacingException("Состав машин уже изменился. Закройте настройки и обновите раздел.")
        }
        val body = trafficSaveBody(fresh, selected, emptyConfirmed)
        val session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        val result = try { commandApi.configureTraffic(session.bearer(), BuildConfig.BASE_URL.trimEnd('/'), body) }
        catch (error: java.io.IOException) { throw UserFacingException("Ответ не получен. Не повторяйте сохранение вслепую: обновите оборот машин и проверьте состав.", error) }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        if (!result.isSuccessful) throw result.toApiFailure("Машины не сохранены.")
        if (result.body()?.flag("ok") != true) throw UserFacingException("Сервер не подтвердил сохранение. Обновите список и проверьте результат.")
    }

    suspend fun saveCrop(actor: Actor, context: CropEditorData, rows: List<CropAllocationDraft>) {
        val generation = sessionGeneration
        val verified = refreshActor()
        if (verified.id != actor.id || verified.companyId != actor.companyId || generation != sessionGeneration) throw SessionExpiredException()
        val company = verified.companyId ?: throw UserFacingException("Компания не назначена.")
        val fresh = cropEditor(readCabinet { cabinetApi.crops(it, company) }, context.fieldId)
            ?: throw UserFacingException("Текущий сезон или поле недоступны для изменения.")
        if (fresh.seasonId != context.seasonId || fresh.original.sortedBy { it.id } != context.original.sortedBy { it.id }) {
            throw UserFacingException("Структура уже изменилась на сайте. Закройте редактор, обновите поле и проверьте изменения.")
        }
        val body = cropSaveBody(fresh, rows, company)
        val session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        val result = try { commandApi.saveCrop(session.bearer(), requireObjectId(context.fieldId), body) }
        catch (error: java.io.IOException) { throw UserFacingException("Ответ на сохранение не получен. Не повторяйте вслепую: закройте редактор и обновите поле, чтобы проверить результат.", error) }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        if (!result.isSuccessful) throw result.toApiFailure("Структура не сохранена.")
    }

    suspend fun loadCabinet(actor: Actor, query: CabinetQuery): CabinetPage {
        val generation = sessionGeneration
        val verified = refreshActor()
        if (generation != sessionGeneration || verified.id != actor.id || verified.companyId != actor.companyId) {
            throw SessionExpiredException("Контекст пользователя изменился. Войдите снова.")
        }
        val company = verified.companyId?.takeIf(String::isNotBlank)
            ?: throw UserFacingException("Пользователю не назначена компания.")
        val payload = when (query.section) {
            CabinetSection.NOTIFICATIONS -> JsonObject().apply { add("notifications", readSupabase { token ->
                supabaseReadApi.notifications(BuildConfig.SUPABASE_ANON_KEY, token, company = "eq.$company", user = "eq.${requireObjectId(verified.authUserId)}")
            }) }
            CabinetSection.SETTINGS -> readCabinet { cabinetApi.notificationPreferences(it, company) }
            CabinetSection.HARVEST -> {
                val filters = try { harvestFilterParameters(query.harvestFilters, query.period == "custom") }
                    catch (error: Exception) { throw UserFacingException("Проверьте период: ГГГГ-ММ-ДД ЧЧ:ММ, конец позже начала.", error) }
                val summary = readCabinet { cabinetApi.harvest(it, company, query.period, filters) }
                val options = readCabinet { cabinetApi.harvestOptions(it) }
                summary.add("filterOptions", options.get("options"))
                summary
            }
            CabinetSection.CROPS -> {
                val bootstrap = readCabinet { cabinetApi.crops(it, company) }
                val requestedSeason = query.seasonId
                if (requestedSeason != null && requestedSeason != bootstrap.text("activeSeasonId")) {
                    if (bootstrap.rows("seasons").none { it.text("id") == requestedSeason }) throw UserFacingException("Сезон недоступен.")
                    val structure = readSupabasePages { token, offset -> supabaseReadApi.cropStructure(BuildConfig.SUPABASE_ANON_KEY, token,
                        company = "eq.$company", season = "eq.${requireObjectId(requestedSeason)}", offset = offset) }
                    val ids = structure.mapNotNull { it.takeIf { item -> item.isJsonObject }?.asJsonObject?.text("id") }
                    val mixes = JsonArray()
                    ids.chunked(50).forEach { chunk -> mixes.addAll(readSupabasePages { token, offset -> supabaseReadApi.cropMix(BuildConfig.SUPABASE_ANON_KEY, token,
                        company = "eq.$company", rows = "in.(${chunk.joinToString(",") { requireObjectId(it) }})", offset = offset) }) }
                    val byRow = mixes.mapNotNull { it.takeIf { item -> item.isJsonObject }?.asJsonObject }.groupBy { it.text("crop_structure_id") }
                    structure.forEach { item -> if (item.isJsonObject) item.asJsonObject.add("mix_components", gson.toJsonTree(byRow[item.asJsonObject.text("id")].orEmpty())) }
                    bootstrap.add("cropStructure", structure)
                }
                if (query.objectId != null) {
                    val rowIds = bootstrap.rows("cropStructure").filter { it.text("field_id") == query.objectId }.mapNotNull { it.text("id") }
                    val operations = JsonArray()
                    rowIds.chunked(50).forEach { chunk -> operations.addAll(readSupabasePages { token, offset -> supabaseReadApi.operations(BuildConfig.SUPABASE_ANON_KEY, token,
                        company = "eq.$company", rows = "in.(${chunk.joinToString(",") { requireObjectId(it) }})", offset = offset) }) }
                    bootstrap.add("operations", gson.toJsonTree(operations.map { it.asJsonObject }.sortedByDescending { it.text("date") }))
                }
                bootstrap
            }
            CabinetSection.WAREHOUSES -> when {
                query.warehouseId == null -> readCabinet { cabinetApi.warehouses(it, company) }
                query.lotId != null -> readCabinet { cabinetApi.lots(it, company, requireObjectId(query.warehouseId), requireObjectId(query.lotId), detail = null) }
                query.productId != null -> readCabinet { cabinetApi.stock(it, requireObjectId(query.warehouseId), company,
                    requireObjectId(query.productId), query.unit ?: throw UserFacingException("Не указана единица остатка."), query.batchClass) }
                else -> {
                    val balances = readCabinet { cabinetApi.balances(it, company, requireObjectId(query.warehouseId)) }
                    val lots = readCabinet { cabinetApi.lots(it, company, query.warehouseId) }
                    JsonObject().apply { add("balances", balances.get("balances")); add("batches", lots.get("batches")) }
                }
            }
            CabinetSection.TICKETS -> if (query.objectId == null) readCabinet { cabinetApi.tickets(it, company) }
                else readCabinet { cabinetApi.ticket(it, requireObjectId(query.objectId), company) }
            CabinetSection.TRAFFIC -> if (query.objectId == null) readCabinet { cabinetApi.traffic(it) } else
                readCabinet { cabinetApi.driverAssignment(it, company, requireObjectId(query.objectId)) }.also { driverAssignment(it, query.objectId, company) }
            CabinetSection.WEATHER -> if (query.localityCode == null) {
                readCabinet { cabinetApi.localities(it, query.localitySearch) }
            } else {
                val location = readCabinet { cabinetApi.location(it, query.localityCode) }.obj("location")
                val lat = location.number("latitude") ?: throw UserFacingException("Координаты населённого пункта не найдены.")
                val lon = location.number("longitude") ?: throw UserFacingException("Координаты населённого пункта не найдены.")
                val forecast = readCabinet { cabinetApi.forecast(it, lat, lon, location.text("displayName") ?: query.title.orEmpty(), query.localityCode) }
                val profiles = readCabinet { cabinetApi.weatherProfiles(it) }
                forecast.add("profiles", profiles.get("profiles"))
                forecast
            }
        }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        return mapCabinet(query, payload)
    }

    private suspend fun readCabinet(request: suspend (String) -> Response<JsonObject>): JsonObject {
        val generation = sessionGeneration
        var session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        var response = request(session.bearer())
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        if (response.code() == 401) {
            session = refreshSession(force = true, fallback = session)
            response = request(session.bearer())
        }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось загрузить раздел.")
        return response.body() ?: throw UserFacingException("Сервер вернул пустой ответ.")
    }

    private fun requireObjectId(id: String): String {
        if (!id.matches(Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))) {
            throw UserFacingException("Некорректная ссылка на документ.")
        }
        return id
    }

    private suspend fun readSupabase(request: suspend (String) -> Response<JsonArray>): JsonArray {
        val generation = sessionGeneration
        var session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        var response = request(session.bearer())
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        if (response.code() == 401) {
            session = refreshSession(force = true, fallback = session)
            response = request(session.bearer())
        }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        if (!response.isSuccessful) throw response.toApiFailure("Не удалось загрузить историю сезона.")
        return response.body() ?: throw UserFacingException("Сервер вернул пустой ответ.")
    }

    private suspend fun readSupabasePages(request: suspend (String, Int) -> Response<JsonArray>): JsonArray =
        readAllPages { offset -> readSupabase { token -> request(token, offset) } }

    suspend fun signIn(email: String, password: String): Actor {
        requireConfiguration()
        val generation = ++sessionGeneration
        val normalizedEmail = email.trim().lowercase()
        if (normalizedEmail.isBlank() || password.isBlank()) {
            throw UserFacingException("Введите email и пароль.")
        }

        val response = authApi.signIn(
            apiKey = BuildConfig.SUPABASE_ANON_KEY,
            body = PasswordGrantBody(normalizedEmail, password),
        )
        val session = response.toSessionOrThrow()
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        localState.saveSession(session)

        val actor = try {
            fetchActor(session)
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            if (generation != sessionGeneration) throw CancellationException("Session changed")
            runCatching { authApi.signOut(BuildConfig.SUPABASE_ANON_KEY, session.bearer()) }
            if (generation == sessionGeneration) clearLocalSession()
            throw error
        }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
        localState.saveActor(actor)
        return actor
    }

    suspend fun restoreActor(): Actor? {
        requireConfiguration()
        val generation = sessionGeneration
        val session = localState.loadSession() ?: return null
        return try {
            fetchActor(resolveSession(session)).also {
                if (generation != sessionGeneration) throw CancellationException("Session changed")
                localState.saveActor(it)
            }
        } catch (error: SessionExpiredException) {
            if (generation == sessionGeneration) clearLocalSession()
            throw error
        } catch (error: UnsupportedRoleException) {
            if (generation == sessionGeneration) clearLocalSession()
            throw error
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            if (generation != sessionGeneration) throw CancellationException("Session changed")
            localState.loadActor(MAX_OFFLINE_ACTOR_AGE_MILLIS) ?: throw error
        }
    }

    suspend fun refreshActor(): Actor {
        val generation = sessionGeneration
        val session = resolveSession(localState.loadSession() ?: throw SessionExpiredException())
        return try {
            fetchActor(session).also {
                if (generation != sessionGeneration) throw CancellationException("Session changed")
                localState.saveActor(it)
            }
        } catch (error: UnsupportedRoleException) {
            if (generation == sessionGeneration) clearLocalSession()
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
        if (dto.isImpersonating == true) throw UserFacingException("В Android требуется собственный вход Агронома, без подмены роли.")
        if (dto.status?.lowercase() !in setOf(null, "active")) {
            throw SessionExpiredException("Профиль пользователя неактивен.")
        }
        val role = SupportedRole.fromWire(dto.role) ?: throw UnsupportedRoleException(dto.role)
        val actorId = dto.id?.takeIf(String::isNotBlank)
            ?: throw UserFacingException("Сервер не вернул идентификатор пользователя.")
        return Actor(actorId, role, dto.companyId, dto.email, dto.authUserId ?: actorId)
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
        val generation = sessionGeneration
        val latest = localState.loadSession() ?: throw SessionExpiredException()
        if (force && fallback != null && latest.accessToken != fallback.accessToken) return@withLock latest
        val now = System.currentTimeMillis() / 1_000
        if (!force && latest.expiresAtEpochSeconds > now + REFRESH_EARLY_SECONDS) return@withLock latest

        val response = try {
            authApi.refresh(
                apiKey = BuildConfig.SUPABASE_ANON_KEY,
                body = RefreshGrantBody(latest.refreshToken),
            )
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            throw UserFacingException("Нет связи для обновления сессии. Повторите при появлении сети.", error)
        }
        if (generation != sessionGeneration) throw CancellationException("Session changed")
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
        sessionGeneration++
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
