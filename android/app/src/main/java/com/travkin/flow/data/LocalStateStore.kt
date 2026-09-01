package com.travkin.flow.data

import com.google.gson.Gson
import com.travkin.flow.domain.CachedOverview
import com.travkin.flow.domain.Actor
import com.travkin.flow.domain.SupportedRole

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

    private fun <T> decode(key: String, type: Class<T>): T? = runCatching {
        storage.get(key)?.let { gson.fromJson(it, type) }
    }.getOrNull()

    private companion object {
        const val SESSION_KEY = "session"
        const val ACTOR_KEY = "actor"
        const val OVERVIEW_KEY = "operational_overview"
    }
}
