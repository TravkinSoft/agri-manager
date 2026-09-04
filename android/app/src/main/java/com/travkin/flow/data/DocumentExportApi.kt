package com.travkin.flow.data

import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

/** Fixed GET endpoints; session credentials never enter a document URL or an external viewer. */
interface DocumentExportApi {
    @Streaming
    @GET("api/weighbridge/tickets/{id}/pdf")
    suspend fun ticket(@Header("Authorization") auth: String, @Path("id") id: String): Response<ResponseBody>

    @Streaming
    @GET("api/crop-structure/fields/{id}/pdf")
    suspend fun field(@Header("Authorization") auth: String, @Path("id") id: String,
        @Query("seasonId") season: String): Response<ResponseBody>
}
