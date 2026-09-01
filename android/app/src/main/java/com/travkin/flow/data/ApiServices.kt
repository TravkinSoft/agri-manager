package com.travkin.flow.data

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
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
}
