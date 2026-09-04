package com.travkin.flow

import com.google.gson.Gson
import com.travkin.flow.data.ActorEnvelopeDto
import org.junit.Assert.*
import org.junit.Test

class ActorContractTest {
    @Test fun `current actor camelCase companyId is decoded`() {
        val dto = Gson().fromJson("""{"actor":{"id":"profile","authUserId":"user","role":"agronomist","companyId":"company","isImpersonating":false,"status":"active"}}""", ActorEnvelopeDto::class.java).actor!!
        assertEquals("company", dto.companyId)
        assertEquals("user", dto.authUserId)
        assertEquals(false, dto.isImpersonating)
    }
    @Test fun `legacy snakeCase company key remains readable`() {
        assertEquals("legacy", Gson().fromJson("""{"actor":{"company_id":"legacy"}}""", ActorEnvelopeDto::class.java).actor!!.companyId)
    }
}
