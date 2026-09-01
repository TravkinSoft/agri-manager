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
    @SerializedName("requires_confirmation") val requiresConfirmation: Boolean? = null,
    val code: String? = null,
    @SerializedName("previous_tare_kg") val previousTareKg: Double? = null,
    @SerializedName("current_tare_kg") val currentTareKg: Double? = null,
    @SerializedName("difference_percent") val differencePercent: Double? = null,
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
    @SerializedName("harvest_lot_id") val harvestLotId: String? = null,
    @SerializedName("linked_processing_id") val linkedProcessingId: String? = null,
)

data class TicketLineDto(
    @SerializedName("product_name") val productName: String?,
    @SerializedName("variety_name") val varietyName: String?,
    @SerializedName("reproduction_name") val reproductionName: String?,
    val quantity: Double?,
    val uom: String?,
    @SerializedName("moisture_percent") val moisturePercent: Double?,
    @SerializedName("lot_id") val lotId: String? = null,
    @SerializedName("batch_class") val batchClass: String? = null,
)

data class HarvestOverviewDto(
    val period: HarvestPeriodDto?,
    val completedTripCount: Int?,
    val openTicketCount: Int?,
    val cropTotals: List<HarvestCropTotalDto>?,
    val fields: List<HarvestFieldSummaryDto>?,
    val moisture: List<HarvestMoistureSummaryDto>?,
    val issues: List<HarvestIssueDto>?,
)

data class HarvestPeriodDto(
    val label: String?,
    val start: String?,
    val end: String?,
)

data class HarvestCropTotalDto(
    val key: String?,
    val cropName: String?,
    val receivedKg: Double?,
    val trips: Int?,
)

data class HarvestFieldSummaryDto(
    val key: String?,
    val fieldName: String?,
    val identityLabel: String?,
    val destinationName: String?,
    val receivedKg: Double?,
    val trips: Int?,
    val lastTripAt: String?,
)

data class HarvestMoistureSummaryDto(
    val key: String?,
    val fieldName: String?,
    val cropName: String?,
    val latestPercent: Double?,
    val averagePercent: Double?,
    val measuredTrips: Int?,
    val totalTrips: Int?,
)

data class HarvestIssueDto(
    val key: String?,
    val title: String?,
    val detail: String?,
)

data class WarehouseSummariesEnvelopeDto(
    val summaries: List<WarehouseSummaryDto>?,
)

data class WarehouseSummaryDto(
    val warehouse: WarehouseDto?,
    @SerializedName("position_count") val positionCount: Int?,
    @SerializedName("harvest_lot_count") val harvestLotCount: Int?,
    @SerializedName("harvest_weight_kg") val harvestWeightKg: Double?,
    @SerializedName("total_weight_kg") val totalWeightKg: Double?,
    @SerializedName("seed_weight_kg") val seedWeightKg: Double?,
    @SerializedName("other_material_weight_kg") val otherMaterialWeightKg: Double?,
    @SerializedName("last_movement_at") val lastMovementAt: String?,
)

data class WarehouseDto(
    val id: String?,
    val name: String?,
    @SerializedName("place_type") val placeType: String?,
    @SerializedName("warehouse_type") val warehouseType: String?,
    @SerializedName("capacity_value") val capacityValue: Double?,
    @SerializedName("capacity_unit") val capacityUnit: String?,
    val location: String?,
    val description: String?,
)

data class OperatorStateDto(
    val shift: WeighbridgeShiftDto?,
    val unlocked: Boolean?,
    @SerializedName("session_expires_at") val sessionExpiresAt: String?,
    val operator: WeighbridgeOperatorDto?,
    val operators: List<WeighbridgeOperatorDto>?,
    @SerializedName("unconfigured_operator_count") val unconfiguredOperatorCount: Int?,
    @SerializedName("initial_workspace") val initialWorkspace: InitialWeighbridgeWorkspaceDto?,
)

data class WeighbridgeShiftDto(
    val id: String?,
    val status: String?,
    @SerializedName("operator_person_id") val operatorPersonId: String?,
    @SerializedName("opened_at") val openedAt: String?,
)

data class WeighbridgeOperatorDto(
    val id: String?,
    val name: String?,
    @SerializedName("has_pin") val hasPin: Boolean?,
    @SerializedName("pin_active") val pinActive: Boolean?,
    @SerializedName("locked_until") val lockedUntil: String?,
)

data class InitialWeighbridgeWorkspaceDto(
    val resources: WeighbridgeResourcesDto?,
    val harvestAllocations: HarvestAllocationsDto?,
)

data class WeighbridgeResourcesDto(
    val fields: List<ResourceOptionDto>?,
    val destinations: List<ResourceOptionDto>?,
    val vehicles: List<VehicleOptionDto>?,
    val drivers: List<DriverOptionDto>?,
    val resourceErrors: List<ResourceErrorDto>?,
)

data class ResourceOptionDto(
    val id: String?,
    val name: String?,
    val area: Double? = null,
    val warehouseType: String? = null,
    val placeType: String? = null,
)

data class VehicleOptionDto(
    val id: String?,
    val name: String?,
    val model: String?,
    val plate: String?,
)

data class DriverOptionDto(
    val id: String?,
    val name: String?,
    val roleType: String?,
    val position: String?,
)

data class ResourceErrorDto(
    val resource: String?,
    val code: String?,
    val message: String?,
)

data class HarvestAllocationsDto(
    val seasonId: String?,
    val seasonYear: Int?,
    val byField: Map<String, List<HarvestAllocationDto>>?,
    val incompleteByField: Map<String, Boolean>?,
)

data class HarvestAllocationDto(
    val allocationId: String?,
    val areaHa: Double?,
    val cropId: String?,
    val cropName: String?,
    val varietyId: String?,
    val varietyName: String?,
    val reproductionId: String?,
    val reproductionName: String?,
    val isIncomplete: Boolean?,
)

data class OperatorMutationBody(
    val action: String,
    val companyId: String,
    val personId: String? = null,
    val pin: String? = null,
    val note: String? = null,
)

data class CreateTicketEnvelope(
    val ticket: NativeTicketInputDto,
    val lines: List<NativeTicketLineInputDto>,
    val weighings: List<Any> = emptyList(),
)

data class NativeTicketInputDto(
    @SerializedName("company_id") val companyId: String,
    @SerializedName("ticket_type") val ticketType: String = "harvest",
    @SerializedName("op_type") val operationType: String = "harvest_incoming",
    val direction: String = "incoming",
    @SerializedName("source_kind") val sourceKind: String = "field",
    @SerializedName("source_id") val sourceId: String,
    @SerializedName("destination_kind") val destinationKind: String = "warehouse",
    @SerializedName("destination_id") val destinationId: String,
    @SerializedName("field_id") val fieldId: String,
    @SerializedName("crop_structure_allocation_id") val allocationId: String,
    @SerializedName("warehouse_to_id") val warehouseToId: String,
    @SerializedName("vehicle_id") val vehicleId: String?,
    @SerializedName("driver_id") val driverId: String?,
    @SerializedName("gross_weight_kg") val grossWeightKg: Double,
    @SerializedName("tare_weight_kg") val tareWeightKg: Double? = null,
    @SerializedName("weigh_method") val weighMethod: String = "preset_tare",
    @SerializedName("created_by") val createdBy: String,
    val notes: String?,
)

data class NativeTicketLineInputDto(
    @SerializedName("product_id") val productId: String,
    @SerializedName("crop_id") val cropId: String,
    val quantity: Double,
    val uom: String = "kg",
    @SerializedName("warehouse_to_id") val warehouseToId: String,
    @SerializedName("variety_id") val varietyId: String?,
    @SerializedName("reproduction_id") val reproductionId: String?,
    val notes: String = "Приемка урожая",
)

data class TicketMutationEnvelopeDto(
    val ticket: TicketDto?,
    val finalize: Map<String, Any?>? = null,
    @SerializedName("idempotent_replay") val idempotentReplay: Boolean? = null,
    @SerializedName("requires_confirmation") val requiresConfirmation: Boolean? = null,
)

data class TicketWeightPatchBody(
    val companyId: String,
    @SerializedName("gross_weight_kg") val grossWeightKg: Double? = null,
    @SerializedName("tare_weight_kg") val tareWeightKg: Double? = null,
    val status: String? = null,
)

data class FinalizeTicketBody(
    val companyId: String,
    @SerializedName("tare_weight_kg") val tareWeightKg: Double,
    @SerializedName("confirm_tare_variance") val confirmTareVariance: Boolean,
    @SerializedName("idempotency_key") val idempotencyKey: String,
)

data class KatoSearchEnvelopeDto(
    val items: List<KatoLocalityDto>?,
)

data class KatoLocalityDto(
    val code: String?,
    val nameRu: String?,
    val nameKz: String?,
    val districtRu: String?,
    val regionRu: String?,
)

data class WeatherLocationEnvelopeDto(
    val location: WeatherLocationDto?,
)

data class WeatherForecastEnvelopeDto(
    val weather: WeatherForecastDto?,
)

data class WeatherLocationDto(
    val latitude: Double?,
    val longitude: Double?,
    val region: String?,
    val district: String?,
    val locality: String?,
    val displayName: String?,
    val katoCode: String?,
)

data class WeatherPointDto(
    val time: String?,
    val temperatureC: Double?,
    val dewPointC: Double?,
    val windMs: Double?,
    val gustMs: Double?,
    val precipitationProbabilityPct: Double?,
    val precipitationRateMmH: Double?,
    val precipitationType: String?,
    val cloudCoverPct: Double?,
    val visibilityKm: Double?,
    val humidityPct: Double?,
    val pressureMslHpa: Double?,
)

data class WeatherSunDto(
    val date: String?,
    val sunrise: String?,
    val sunset: String?,
)

data class WeatherProviderMetaDto(
    val provider: String?,
    val timezone: String?,
    val cache: String?,
    val forecastHours: Int?,
)

data class WeatherForecastDto(
    val location: WeatherLocationDto?,
    val current: WeatherPointDto?,
    val hourlyForecast: List<WeatherPointDto>?,
    val sun: List<WeatherSunDto>?,
    val providerMeta: WeatherProviderMetaDto?,
    val updatedAt: String?,
    val stale: Boolean?,
)

data class UserNotificationDto(
    val id: String?,
    @SerializedName("company_id") val companyId: String?,
    @SerializedName("recipient_user_id") val recipientUserId: String?,
    val category: String?,
    @SerializedName("event_type") val eventType: String?,
    val title: String?,
    val body: String?,
    val href: String?,
    @SerializedName("entity_type") val entityType: String?,
    @SerializedName("entity_id") val entityId: String?,
    @SerializedName("read_at") val readAt: String?,
    @SerializedName("created_at") val createdAt: String?,
)
