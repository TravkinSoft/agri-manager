package com.travkin.flow.data

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import retrofit2.Response
import retrofit2.http.*

/** User metadata only; separate from the read API and business command API. */
interface NotificationAcknowledgementApi {
    @PATCH("rest/v1/user_notifications")
    suspend fun markRead(@Header("apikey") key: String, @Header("Authorization") auth: String,
        @Header("Prefer") prefer: String = "return=representation", @Query("select") select: String = "id,read_at",
        @Query("company_id") company: String, @Query("recipient_user_id") user: String,
        @Query("category") category: String = "neq.assistant", @Query("read_at") unread: String = "is.null",
        @Query("id") id: String? = null, @Body body: JsonObject): Response<JsonArray>
}
