package com.travkin.flow.domain

enum class SupportedRole(
    val wireValue: String,
    val displayName: String,
) {
    AGRONOMIST("agronomist", "Агроном");

    companion object {
        fun fromWire(value: String?): SupportedRole? =
            AGRONOMIST.takeIf { value?.trim()?.lowercase() == it.wireValue }
    }
}

data class Actor(
    val id: String,
    val role: SupportedRole,
    val companyId: String?,
    val email: String?,
    val authUserId: String = id,
)
