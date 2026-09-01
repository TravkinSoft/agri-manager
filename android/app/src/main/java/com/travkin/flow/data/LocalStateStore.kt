package com.travkin.flow.data

import com.google.gson.Gson
import com.travkin.flow.domain.CachedOverview
import com.travkin.flow.domain.CachedHarvestOverview
import com.travkin.flow.domain.CachedTicketPage
import com.travkin.flow.domain.CachedWarehouseOverview
import com.travkin.flow.domain.Actor
import com.travkin.flow.domain.SupportedRole
import com.travkin.flow.domain.PendingWeighbridgeQueue
import java.util.UUID

class LocalStateStore(
    private val storage: SecureStorage,
    private val gson: Gson,
) {
    fun loadSession(): StoredSession? = decode(SESSION_KEY, StoredSession::class.java)

    fun saveSession(session: StoredSession) {
        storage.put(SESSION_KEY, gson.toJson(session))
    }

    fun clearSession() {
        storage.remove(SESSION_KEY)
    }

    fun loadActor(maxAgeMillis: Long): Actor? {
        val stored = decode(ACTOR_KEY, StoredActor::class.java) ?: return null
        if (System.currentTimeMillis() - stored.savedAtEpochMillis !in 0..maxAgeMillis) return null
        val role = SupportedRole.fromWire(stored.role) ?: return null
        return Actor(stored.id, role, stored.companyId, stored.email)
    }

    fun saveActor(actor: Actor) {
        storage.put(
            ACTOR_KEY,
            gson.toJson(
                StoredActor(
                    id = actor.id,
                    role = actor.role.wireValue,
                    companyId = actor.companyId,
                    email = actor.email,
                    savedAtEpochMillis = System.currentTimeMillis(),
                ),
            ),
        )
    }

    fun clearActor() {
        storage.remove(ACTOR_KEY)
    }

    fun loadOverview(actorId: String, companyId: String?): CachedOverview? {
        val cached = decode(OVERVIEW_KEY, CachedOverview::class.java) ?: return null
        return cached.takeIf { it.matchesScope(actorId, companyId) }
    }

    fun saveOverview(cache: CachedOverview) {
        storage.put(OVERVIEW_KEY, gson.toJson(cache))
    }

    fun clearOverview() {
        storage.remove(OVERVIEW_KEY)
    }

    fun loadTicketPage(actorId: String, companyId: String?): CachedTicketPage? {
        val cached = decode(TICKET_PAGE_KEY, CachedTicketPage::class.java) ?: return null
        return cached.takeIf { it.matchesScope(actorId, companyId) }
    }

    fun saveTicketPage(cache: CachedTicketPage) {
        storage.put(TICKET_PAGE_KEY, gson.toJson(cache))
    }

    fun clearTicketPage() {
        storage.remove(TICKET_PAGE_KEY)
    }

    fun loadHarvestOverview(actorId: String, companyId: String): CachedHarvestOverview? {
        val cached = decode(HARVEST_OVERVIEW_KEY, CachedHarvestOverview::class.java) ?: return null
        return cached.takeIf { it.matchesScope(actorId, companyId) }
    }

    fun saveHarvestOverview(cache: CachedHarvestOverview) {
        storage.put(HARVEST_OVERVIEW_KEY, gson.toJson(cache))
    }

    fun clearHarvestOverview() {
        storage.remove(HARVEST_OVERVIEW_KEY)
    }

    fun loadWarehouseOverview(actorId: String, companyId: String): CachedWarehouseOverview? {
        val cached = decode(WAREHOUSE_OVERVIEW_KEY, CachedWarehouseOverview::class.java) ?: return null
        return cached.takeIf { it.matchesScope(actorId, companyId) }
    }

    fun saveWarehouseOverview(cache: CachedWarehouseOverview) {
        storage.put(WAREHOUSE_OVERVIEW_KEY, gson.toJson(cache))
    }

    fun clearWarehouseOverview() {
        storage.remove(WAREHOUSE_OVERVIEW_KEY)
    }

    fun loadPendingWeighbridgeQueue(): PendingWeighbridgeQueue =
        decode(WEIGHBRIDGE_QUEUE_KEY, PendingWeighbridgeQueue::class.java) ?: PendingWeighbridgeQueue(emptyList())

    fun savePendingWeighbridgeQueue(queue: PendingWeighbridgeQueue) {
        if (queue.commands.isEmpty()) storage.remove(WEIGHBRIDGE_QUEUE_KEY)
        else storage.put(WEIGHBRIDGE_QUEUE_KEY, gson.toJson(queue))
    }

    fun clearPendingWeighbridgeQueue() {
        storage.remove(WEIGHBRIDGE_QUEUE_KEY)
    }

    fun loadOrCreateWorkstationId(): String {
        storage.get(WORKSTATION_ID_KEY)?.takeIf(String::isNotBlank)?.let { return it }
        return UUID.randomUUID().toString().also { storage.put(WORKSTATION_ID_KEY, it) }
    }

    private fun <T> decode(key: String, type: Class<T>): T? = runCatching {
        storage.get(key)?.let { gson.fromJson(it, type) }
    }.getOrNull()

    private companion object {
        const val SESSION_KEY = "session"
        const val ACTOR_KEY = "actor"
        const val OVERVIEW_KEY = "operational_overview"
        const val TICKET_PAGE_KEY = "ticket_page"
        const val HARVEST_OVERVIEW_KEY = "harvest_overview"
        const val WAREHOUSE_OVERVIEW_KEY = "warehouse_overview"
        const val WEIGHBRIDGE_QUEUE_KEY = "weighbridge_pending_commands"
        const val WORKSTATION_ID_KEY = "weighbridge_workstation_id"
    }
}
