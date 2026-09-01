package com.travkin.flow.data

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PATCH
import retrofit2.http.Path
import retrofit2.http.Query

interface SupabaseAuthApi {
    @POST("auth/v1/token")
    suspend fun signIn(
        @Query("grant_type") grantType: String = "password",
        @Header("apikey") apiKey: String,
        @Body body: PasswordGrantBody,
    ): Response<AuthTokenDto>

    @POST("auth/v1/token")
    suspend fun refresh(
        @Query("grant_type") grantType: String = "refresh_token",
        @Header("apikey") apiKey: String,
        @Body body: RefreshGrantBody,
    ): Response<AuthTokenDto>

    @POST("auth/v1/logout")
    suspend fun signOut(
        @Header("apikey") apiKey: String,
        @Header("Authorization") authorization: String,
    ): Response<Unit>
}

interface SupabaseRestApi {
    @GET("rest/v1/user_notifications")
    suspend fun notifications(
        @Header("apikey") apiKey: String,
        @Header("Authorization") authorization: String,
        @Query("select") columns: String,
        @Query("recipient_user_id") recipientFilter: String,
        @Query("company_id") companyFilter: String?,
        @Query("order") order: String = "created_at.desc",
        @Query("limit") limit: Int = 30,
    ): Response<List<UserNotificationDto>>
}

interface TravkinFlowApi {
    @GET("api/auth/actor")
    suspend fun actor(
        @Header("Authorization") authorization: String,
    ): Response<ActorEnvelopeDto>

    @GET("api/weighbridge/bootstrap")
    suspend fun operationalOverview(
        @Header("Authorization") authorization: String,
        @Query("summary") includeSummary: Boolean = true,
        @Query("companyId") companyId: String? = null,
    ): Response<OperationalBootstrapDto>

    @GET("api/weighbridge/tickets")
    suspend fun tickets(
        @Header("Authorization") authorization: String,
        @Query("companyId") companyId: String? = null,
        @Query("workspace") workspace: Boolean = true,
        @Query("historyLimit") historyLimit: Int,
    ): Response<TicketPageDto>

    @GET("api/weighbridge/tickets/{id}")
    suspend fun ticketDetails(
        @Header("Authorization") authorization: String,
        @Path("id") ticketId: String,
        @Query("companyId") companyId: String? = null,
    ): Response<TicketDetailEnvelopeDto>

    @GET("api/dashboard/harvest-summary")
    suspend fun harvestOverview(
        @Header("Authorization") authorization: String,
        @Query("companyId") companyId: String,
        @Query("period") period: String = "current_day",
        @Query("section") section: String = "summary",
    ): Response<HarvestOverviewDto>

    @GET("api/warehouses/summaries")
    suspend fun warehouseSummaries(
        @Header("Authorization") authorization: String,
        @Query("companyId") companyId: String,
        @Query("includeArchived") includeArchived: Boolean = false,
    ): Response<WarehouseSummariesEnvelopeDto>

    @GET("api/weighbridge/operator-session")
    suspend fun operatorState(
        @Header("Authorization") authorization: String,
        @Query("companyId") companyId: String,
        @Query("workspace") includeWorkspace: Boolean = true,
    ): Response<OperatorStateDto>

    @POST("api/weighbridge/operator-session")
    suspend fun mutateOperatorSession(
        @Header("Authorization") authorization: String,
        @Body body: OperatorMutationBody,
    ): Response<OperatorStateDto>

    @POST("api/weighbridge/tickets")
    suspend fun createTicket(
        @Header("Authorization") authorization: String,
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body body: CreateTicketEnvelope,
    ): Response<TicketMutationEnvelopeDto>

    @PATCH("api/weighbridge/tickets/{id}")
    suspend fun patchTicketWeight(
        @Header("Authorization") authorization: String,
        @Path("id") ticketId: String,
        @Query("companyId") companyId: String,
        @Body body: TicketWeightPatchBody,
    ): Response<TicketMutationEnvelopeDto>

    @POST("api/weighbridge/tickets/{id}/finalize")
    suspend fun finalizeTicket(
        @Header("Authorization") authorization: String,
        @Header("Idempotency-Key") idempotencyKey: String,
        @Path("id") ticketId: String,
        @Query("companyId") companyId: String,
        @Body body: FinalizeTicketBody,
    ): Response<TicketMutationEnvelopeDto>

    @GET("api/weather-lab/kato")
    suspend fun searchKatoLocalities(
        @Header("Authorization") authorization: String,
        @Query("mode") mode: String = "search",
        @Query("q") query: String,
    ): Response<KatoSearchEnvelopeDto>

    @GET("api/weather-lab/location")
    suspend fun resolveWeatherLocation(
        @Header("Authorization") authorization: String,
        @Query("katoCode") katoCode: String,
    ): Response<WeatherLocationEnvelopeDto>

    @GET("api/weather-lab/forecast")
    suspend fun weatherForecast(
        @Header("Authorization") authorization: String,
        @Query("lat") latitude: Double,
        @Query("lon") longitude: Double,
        @Query("displayName") displayName: String,
        @Query("region") region: String?,
        @Query("district") district: String?,
        @Query("locality") locality: String?,
        @Query("katoCode") katoCode: String?,
        @Query("refresh") refresh: Int? = null,
    ): Response<WeatherForecastEnvelopeDto>
}
