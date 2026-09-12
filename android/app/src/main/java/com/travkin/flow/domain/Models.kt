package com.travkin.flow.domain

enum class SupportedRole(
    val wireValue: String,
    val displayName: String,
) {
    AGRONOMIST("agronomist", "Агроном"),
    DIRECTOR("director", "Директор"),
    FLEET_MANAGER("fleet_manager", "Завгар · PTC"),
    RECEIVER("vegetable_brigadier", "Приёмка · PTC"),
    WEIGHMAN("weighman", "Весовая · PTC"),
    HARVESTER("mechanic_operator", "Комбайнёр · PTC");

    companion object {
        fun fromWire(value: String?): SupportedRole? =
            entries.firstOrNull { value?.trim()?.lowercase() == it.wireValue }
    }
}

data class Actor(
    val id: String,
    val role: SupportedRole,
    val companyId: String?,
    val email: String?,
    val authUserId: String = id,
)
