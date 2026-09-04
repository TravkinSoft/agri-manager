package com.travkin.flow.data

import com.google.gson.JsonArray
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Query

/** User-JWT reads only. The publishable/anon key selects the API; PostgreSQL RLS authorizes rows. */
interface SupabaseReadApi {
    @GET("rest/v1/user_notifications")
    suspend fun notifications(@Header("apikey") apiKey: String, @Header("Authorization") auth: String,
        @Query("select") select: String = "id,company_id,recipient_user_id,category,title,body,href,read_at,created_at",
        @Query("company_id") company: String, @Query("recipient_user_id") user: String,
        @Query("category") category: String = "neq.assistant", @Query("order") order: String = "created_at.desc,id.desc",
        @Query("limit") limit: Int = 100): Response<JsonArray>

    @GET("rest/v1/crop_structure")
    suspend fun cropStructure(@Header("apikey") apiKey: String, @Header("Authorization") auth: String,
        @Query("select") select: String = "id,field_id,land_use_type,crop_id,variety_id,reproduction_id,notes,area,seeding_rate,expected_yield,irrigation_type,row_spacing_m,seed_spacing_cm",
        @Query("company_id") company: String, @Query("season_id") season: String,
        @Query("archived") archived: String = "eq.false", @Query("order") order: String = "id.asc",
        @Query("offset") offset: Int, @Query("limit") limit: Int = 500): Response<JsonArray>

    @GET("rest/v1/crop_structure_mix_components")
    suspend fun cropMix(@Header("apikey") apiKey: String, @Header("Authorization") auth: String,
        @Query("select") select: String = "id,crop_structure_id,crop_id,variety_id,reproduction_id,seed_rate_kg_ha,sort_order",
        @Query("company_id") company: String, @Query("crop_structure_id") rows: String,
        @Query("order") order: String = "sort_order.asc,id.asc",
        @Query("offset") offset: Int, @Query("limit") limit: Int = 500): Response<JsonArray>

    @GET("rest/v1/operations")
    suspend fun operations(@Header("apikey") apiKey: String, @Header("Authorization") auth: String,
        @Query("select") select: String = "*,responsible_profile:responsible_user_id(full_name,email),operation_lines:operation_lines(id,planned_area_ha,actual_area_ha),operation_materials:operation_materials(*,products:product_id(name,trade_name),crops:crop_id(name,name_ru),varieties:variety_id(name),reproductions:reproduction_id(name,name_ru))",
        @Query("company_id") company: String, @Query("crop_structure_id") rows: String,
        @Query("archived") archived: String = "eq.false", @Query("order") order: String = "date.desc,id.desc",
        @Query("offset") offset: Int, @Query("limit") limit: Int = 500): Response<JsonArray>
}
