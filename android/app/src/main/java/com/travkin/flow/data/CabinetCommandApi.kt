package com.travkin.flow.data

import com.google.gson.JsonObject
import retrofit2.Response
import retrofit2.http.*

/** Explicit Agronomist actions only. No station/operator actions or retry queue. */
interface CabinetCommandApi {
    @POST("api/vehicles/driver-assignment")
    suspend fun driverAssignment(@Header("Authorization") auth: String, @Header("Origin") origin: String, @Body body: JsonObject): Response<JsonObject>

    @PATCH("api/settings/notifications")
    suspend fun notificationPreferences(@Header("Authorization") auth: String, @Body body: JsonObject): Response<JsonObject>

    @PUT("api/crop-structure/fields/{id}")
    suspend fun saveCrop(@Header("Authorization") auth: String, @Path("id") fieldId: String, @Body body: JsonObject): Response<JsonObject>

    @POST("api/traffic")
    suspend fun configureTraffic(@Header("Authorization") auth: String, @Header("Origin") origin: String, @Body body: JsonObject): Response<JsonObject>

    @POST("api/weather-lab/profiles")
    suspend fun createWeatherProfile(@Header("Authorization") auth: String, @Body body: JsonObject): Response<JsonObject>

    @PATCH("api/weather-lab/profiles/{id}")
    suspend fun updateWeatherProfile(@Header("Authorization") auth: String, @Path("id") id: String, @Body body: JsonObject): Response<JsonObject>

    @DELETE("api/weather-lab/profiles/{id}")
    suspend fun deleteWeatherProfile(@Header("Authorization") auth: String, @Path("id") id: String): Response<JsonObject>
}
