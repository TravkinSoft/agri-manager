package com.travkin.flow

import com.travkin.flow.data.isSecureApiBaseUrl
import com.travkin.flow.domain.SupportedRole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeFoundationTest {
    @Test
    fun `API base URL requires a root HTTPS origin`() {
        assertTrue(isSecureApiBaseUrl("https://travkinflow.com"))
        assertTrue(isSecureApiBaseUrl("https://qa.travkinflow.com/"))
        assertFalse(isSecureApiBaseUrl("http://travkinflow.com"))
        assertFalse(isSecureApiBaseUrl("https://travkinflow.com/api"))
        assertFalse(isSecureApiBaseUrl("https://user:pass@travkinflow.com"))
        assertFalse(isSecureApiBaseUrl("https://travkinflow.com/?token=secret"))
    }

    @Test
    fun `native Android accepts the six product roles only`() {
        assertEquals(6, SupportedRole.entries.size)
        assertSame(SupportedRole.AGRONOMIST, SupportedRole.fromWire("agronomist"))
        assertSame(SupportedRole.AGRONOMIST, SupportedRole.fromWire(" AGRONOMIST "))
        assertSame(SupportedRole.DIRECTOR, SupportedRole.fromWire("director"))
        assertSame(SupportedRole.FLEET_MANAGER, SupportedRole.fromWire("fleet_manager"))
        assertSame(SupportedRole.RECEIVER, SupportedRole.fromWire("vegetable_brigadier"))
        assertSame(SupportedRole.WEIGHMAN, SupportedRole.fromWire("weighman"))
        assertSame(SupportedRole.HARVESTER, SupportedRole.fromWire("mechanic_operator"))
        assertNull(SupportedRole.fromWire("global_admin"))
        assertNull(SupportedRole.fromWire("company_admin"))
        assertNull(SupportedRole.fromWire("specialist"))
        assertNull(SupportedRole.fromWire("warehouse"))
        assertNull(SupportedRole.fromWire(null))
    }
}
