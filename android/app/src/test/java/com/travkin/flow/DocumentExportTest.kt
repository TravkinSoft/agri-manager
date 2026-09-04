package com.travkin.flow

import com.travkin.flow.data.*
import com.travkin.flow.domain.*
import org.junit.Assert.*
import org.junit.Test
import retrofit2.http.GET
import java.io.ByteArrayInputStream

class DocumentExportTest {
    @Test fun `only fixed GET export endpoints are exposed`() {
        val paths = DocumentExportApi::class.java.declaredMethods.map { it.getAnnotation(GET::class.java)?.value }.toSet()
        assertEquals(setOf("api/weighbridge/tickets/{id}/pdf", "api/crop-structure/fields/{id}/pdf"), paths)
    }
    @Test fun `pdf bytes preserved exactly and login HTML rejected`() {
        val bytes = "%PDF-1.4\nserver document".toByteArray()
        assertArrayEquals(bytes, (exportDocument(bytes, "application/pdf", false, "id") as DocumentExport.Pdf).bytes)
        assertThrows(UserFacingException::class.java) { exportDocument("<html>Login</html>".toByteArray(), "text/html", false, "id") }
        assertThrows(UserFacingException::class.java) { exportDocument("<html>Login</html>".toByteArray(), "application/pdf", false, "id") }
    }
    @Test fun `field needs expected template and HTML mime`() {
        val html = "<html><body>Карточка поля · История севооборота</body></html>"
        assertTrue(exportDocument(html.toByteArray(), "text/html; charset=utf-8", true, "id") is DocumentExport.FieldCard)
        assertThrows(UserFacingException::class.java) { exportDocument(html.toByteArray(), "application/json", true, "id") }
        assertThrows(UserFacingException::class.java) { exportDocument("<html>Login</html>".toByteArray(), "text/html", true, "id") }
    }
    @Test fun `HTML scripts styles removed and table boundaries retained`() {
        val body = printableFieldBody("<html><head>not printed</head><body><script>window.print()</script><style>hidden</style><table><tr><td>Пшеница</td><td>20</td></tr></table><p>История</p></body></html>")
        assertFalse(body.contains("script")); assertFalse(body.contains("window")); assertFalse(body.contains("hidden")); assertFalse(body.contains("not printed"))
        assertTrue(body.contains("Пшеница | 20<br>")); assertTrue(body.contains("История"))
    }
    @Test fun `bounded response never consumes unbounded document`() {
        assertEquals(3, boundedDocumentBytes(ByteArrayInputStream(byteArrayOf(1, 2, 3))).size)
        assertThrows(UserFacingException::class.java) { boundedDocumentBytes(ByteArrayInputStream(ByteArray(MAX_EXPORT_BYTES + 1))) }
    }
    @Test fun `pagination keeps complete lines and all pages`() {
        assertEquals(listOf(0..1, 2..3, 4..4), exportPageLineRanges(listOf(16, 32, 48, 64, 80), 32))
        assertEquals(listOf(0..0), exportPageLineRanges(listOf(32), 32))
        assertTrue(exportPageLineRanges(emptyList(), 32).isEmpty())
        assertThrows(IllegalArgumentException::class.java) { exportPageLineRanges(listOf(33), 32) }
        assertThrows(IllegalArgumentException::class.java) { exportPageLineRanges(listOf(16, 16), 32) }
    }
}
