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

data class TicketPageDto(
    val tickets: List<TicketDto>?,
    val historyHasMore: Boolean?,
)

data class TicketDetailEnvelopeDto(
    val ticket: TicketDto?,
    val lines: List<TicketLineDto>?,
)

data class TicketDto(
    val id: String?,
    @SerializedName("ticket_no") val ticketNo: String?,
    @SerializedName("op_type") val operationType: String?,
    val direction: String?,
    val status: String?,
    @SerializedName("created_at") val createdAt: String?,
    @SerializedName("company_name") val companyName: String?,
    @SerializedName("field_name_snapshot") val fieldName: String?,
    @SerializedName("vehicle_name_snapshot") val vehicleName: String?,
    @SerializedName("vehicle_plate_snapshot") val vehiclePlate: String?,
    @SerializedName("driver_name_snapshot") val driverName: String?,
    @SerializedName("warehouse_from_name_snapshot") val warehouseFrom: String?,
    @SerializedName("warehouse_to_name_snapshot") val warehouseTo: String?,
    @SerializedName("supplier_name_snapshot") val supplierName: String?,
    @SerializedName("buyer_name_snapshot") val buyerName: String?,
    @SerializedName("destination_text") val destinationText: String?,
    @SerializedName("gross_weight_kg") val grossWeightKg: Double?,
    @SerializedName("tare_weight_kg") val tareWeightKg: Double?,
    @SerializedName("net_weight_kg") val netWeightKg: Double?,
    @SerializedName("physical_net_kg") val physicalNetKg: Double?,
    @SerializedName("requires_review") val requiresReview: Boolean?,
    val notes: String?,
    val lines: List<TicketLineDto>?,
)

data class TicketLineDto(
    @SerializedName("product_name") val productName: String?,
    @SerializedName("variety_name") val varietyName: String?,
    @SerializedName("reproduction_name") val reproductionName: String?,
    val quantity: Double?,
    val uom: String?,
    @SerializedName("moisture_percent") val moisturePercent: Double?,
)
