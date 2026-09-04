package com.travkin.flow.data

import com.travkin.flow.domain.DocumentExport
import java.io.InputStream

internal const val MAX_EXPORT_BYTES = 2 * 1024 * 1024

internal fun boundedDocumentBytes(input: InputStream): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        if (output.size() + count > MAX_EXPORT_BYTES) throw UserFacingException("Документ слишком большой для экспорта. Обратитесь к администратору.")
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}

internal fun exportDocument(bytes: ByteArray, mime: String?, isField: Boolean, id: String): DocumentExport {
    val type = mime?.substringBefore(';')?.trim()?.lowercase()
    if (!isField) {
        if (type != "application/pdf" || bytes.size < 5 || !bytes.take(5).toByteArray().contentEquals("%PDF-".toByteArray()))
            throw UserFacingException("Сервер не вернул PDF. Вход или переадресацию нельзя сохранить вместо документа.")
        return DocumentExport.Pdf("TravkinFlow-ticket-$id.pdf", bytes)
    }
    val html = bytes.toString(Charsets.UTF_8)
    if (type != "text/html" || !html.contains("Карточка поля") || !html.contains("История севооборота"))
        throw UserFacingException("Сервер не вернул карточку поля. Экспорт отменён.")
    return DocumentExport.FieldCard("TravkinFlow-field-$id.pdf", html)
}

/** The existing server template is data, never an executable page. Preserve table cell boundaries. */
internal fun printableFieldBody(html: String): String {
    val body = Regex("(?is)<body\\b[^>]*>(.*?)</body>").find(html)?.groupValues?.get(1)
        ?: throw UserFacingException("Формат карточки поля изменился. Экспорт требует проверки.")
    return body.replace(Regex("(?is)<(script|style)\\b[^>]*>.*?</\\1>"), "")
        .replace(Regex("(?i)</t[dh]>\\s*<t[dh]\\b[^>]*>"), " | ")
        .replace(Regex("(?i)</tr>"), "<br>")
        .replace(Regex("(?i)<tr\\b[^>]*>|</?t[dh]\\b[^>]*>|</?(table|thead|tbody)\\b[^>]*>"), "")
}
