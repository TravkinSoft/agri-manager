package com.travkin.flow.data

import com.google.gson.JsonObject
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.QueryMap

/** No arbitrary URL, service key, operator session, or business write endpoint. */
interface CabinetApi {
    @GET("api/vehicles/driver-assignment")
    suspend fun driverAssignment(@Header("Authorization") auth: String, @Query("companyId") company: String, @Query("vehicleId") vehicle: String): Response<JsonObject>

    @GET("api/settings/notifications")
    suspend fun notificationPreferences(@Header("Authorization") auth: String, @Query("companyId") company: String): Response<JsonObject>

    @GET("api/dashboard/harvest-summary")
    suspend fun harvest(@Header("Authorization") auth: String, @Query("companyId") company: String,
        @Query("period") period: String, @QueryMap filters: Map<String, String> = emptyMap()): Response<JsonObject>

    @GET("api/dashboard/harvest-summary")
    suspend fun harvestOptions(@Header("Authorization") auth: String, @Query("section") section: String = "filters"): Response<JsonObject>

    @GET("api/crop-structure/bootstrap")
    suspend fun crops(@Header("Authorization") auth: String, @Query("companyId") company: String): Response<JsonObject>

    @GET("api/references/company-assets")
    suspend fun companyAssets(@Header("Authorization") auth: String, @Query("companyId") company: String): Response<JsonObject>

    @GET("api/warehouses/summaries")
    suspend fun warehouses(@Header("Authorization") auth: String, @Query("companyId") company: String): Response<JsonObject>

    @GET("api/warehouses/balances")
    suspend fun balances(@Header("Authorization") auth: String, @Query("companyId") company: String,
        @Query("warehouseId") warehouseId: String): Response<JsonObject>

    @GET("api/warehouses/{id}/stock-details")
    suspend fun stock(@Header("Authorization") auth: String, @Path("id") warehouseId: String,
        @Query("companyId") company: String, @Query("productId") product: String,
        @Query("unit") unit: String, @Query("batchClass") batchClass: String?): Response<JsonObject>

    @GET("api/weighbridge/harvest-batches")
    suspend fun lots(@Header("Authorization") auth: String, @Query("companyId") company: String,
        @Query("warehouseId") warehouse: String, @Query("lotId") lotId: String? = null,
        @Query("view") view: String = "lots", @Query("detail") detail: String? = "summary"): Response<JsonObject>

    @GET("api/weighbridge/tickets")
    suspend fun tickets(@Header("Authorization") auth: String, @Query("companyId") company: String): Response<JsonObject>

    @GET("api/weighbridge/tickets/{id}")
    suspend fun ticket(@Header("Authorization") auth: String, @Path("id") id: String,
        @Query("companyId") company: String): Response<JsonObject>

    @GET("api/traffic")
    suspend fun traffic(@Header("Authorization") auth: String): Response<JsonObject>

    @GET("api/traffic/operator")
    suspend fun trafficOperator(@Header("Authorization") auth: String): Response<JsonObject>

    @GET("api/weather-lab/kato")
    suspend fun localities(@Header("Authorization") auth: String, @Query("q") query: String,
        @Query("mode") mode: String = "search"): Response<JsonObject>

    @GET("api/weather-lab/profiles")
    suspend fun weatherProfiles(@Header("Authorization") auth: String): Response<JsonObject>

    @GET("api/weather-lab/location")
    suspend fun location(@Header("Authorization") auth: String, @Query("katoCode") code: String): Response<JsonObject>

    @GET("api/weather-lab/forecast")
    suspend fun forecast(@Header("Authorization") auth: String,
        @Query("lat") lat: Double, @Query("lon") lon: Double,
        @Query("displayName") displayName: String, @Query("katoCode") code: String): Response<JsonObject>
}
