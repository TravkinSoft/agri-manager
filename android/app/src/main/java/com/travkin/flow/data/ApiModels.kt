package com.travkin.flow.data

import com.google.gson.annotations.SerializedName

data class PasswordGrantBody(
    val email: String,
    val password: String,
)

data class RefreshGrantBody(
    @SerializedName("refresh_token") val refreshToken: String,
)

data class AuthTokenDto(
    @SerializedName("access_token") val accessToken: String?,
    @SerializedName("refresh_token") val refreshToken: String?,
    @SerializedName("expires_in") val expiresInSeconds: Long?,
    @SerializedName("expires_at") val expiresAtEpochSeconds: Long?,
)

data class ApiErrorDto(
    val error: String?,
    val message: String?,
    @SerializedName("error_description") val description: String?,
)

data class ActorEnvelopeDto(
    val actor: ActorDto?,
)

data class ActorDto(
    val id: String?,
    val role: String?,
    @SerializedName(value = "companyId", alternate = ["company_id"]) val companyId: String?,
    val email: String?,
    val status: String?,
    val authUserId: String? = null,
    val isImpersonating: Boolean? = null,
)

data class StoredSession(
    val accessToken: String,
    val refreshToken: String,
    val expiresAtEpochSeconds: Long,
)

data class StoredActor(
    val id: String,
    val role: String,
    val companyId: String?,
    val email: String?,
    val savedAtEpochMillis: Long,
    val authUserId: String? = null,
)
