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
    val error: String? = null,
    val message: String? = null,
    @SerializedName("error_description") val description: String? = null,
)

data class ActorEnvelopeDto(
    val actor: ActorDto?,
)

data class ActorDto(
    val id: String?,
    val role: String?,
    val companyId: String?,
    val status: String?,
    val email: String?,
)

data class OperationalBootstrapDto(
    val shift: ShiftDto?,
    val shiftGuard: ShiftGuardDto?,
    val harvestSummary: HarvestSummaryDto?,
    val shiftSummary: ShiftSummaryDto?,
    val counters: CountersDto?,
)

data class ShiftDto(
    val id: String?,
    val status: String?,
)

data class ShiftGuardDto(
    val stale: Boolean?,
)

data class HarvestSummaryDto(
    val today: HarvestAggregateDto?,
)

data class HarvestAggregateDto(
    val netKg: Double?,
    val cleanMassKg: Double?,
    val totalKg: Double?,
)

data class ShiftSummaryDto(
    val trips: Int?,
    val netKg: Double?,
    val open: Int?,
    val voided: Int?,
    val manualCorrections: Int?,
)

data class CountersDto(
    val activeTickets: Int?,
    val stuckTickets: Int?,
    val unsynced: Int?,
    val requiresReview: Int?,
    val manualCorrections: Int?,
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
)
