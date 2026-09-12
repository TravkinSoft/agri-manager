package com.travkin.flow.ui

import android.graphics.Color
import android.graphics.pdf.PdfDocument
import android.text.Html
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.travkin.flow.data.printableFieldBody
import com.travkin.flow.domain.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

/** No embedded browser, external URL, auth token in a filename, or automatic storage write. */
internal suspend fun renderExport(document: DocumentExport): ByteArray = withContext(Dispatchers.Default) {
    if (document is DocumentExport.Pdf) return@withContext document.bytes
    val field = document as DocumentExport.FieldCard
    val text = Html.fromHtml(printableFieldBody(field.html), Html.FROM_HTML_MODE_COMPACT).toString().trim()
    val paint = TextPaint().apply { color = Color.BLACK; textSize = 10.5f; isAntiAlias = true }
    val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, 499)
        .setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false).setLineSpacing(3f, 1f).build()
    val ranges = exportPageLineRanges((0 until layout.lineCount).map(layout::getLineBottom), 730)
    check(ranges.isNotEmpty() && ranges.size <= 100) { "Unexpected document size" }
    val pdf = PdfDocument()
    try {
        ranges.forEachIndexed { index, range ->
            val page = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, index + 1).create())
            try {
                page.canvas.save()
                page.canvas.translate(48f, 48f)
                val top = layout.getLineTop(range.first)
                page.canvas.clipRect(0, 0, 499, layout.getLineBottom(range.last) - top)
                page.canvas.translate(0f, -top.toFloat())
                layout.draw(page.canvas)
                page.canvas.restore()
                page.canvas.drawText("TravkinFlow · ${index + 1}/${ranges.size}", 48f, 812f, paint)
            } finally { pdf.finishPage(page) }
        }
        ByteArrayOutputStream().use { output -> pdf.writeTo(output); output.toByteArray() }
    } finally { pdf.close() }
}

private data class PendingExport(val actorId: String, val companyId: String?, val bytes: ByteArray)

@Composable
internal fun DocumentExportControl(state: AppUiState.SignedIn, viewModel: AppViewModel) {
    if (state.query.objectId == null || state.query.section !in setOf(CabinetSection.CROPS, CabinetSection.TICKETS)) return
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember(state.actor.authUserId, state.actor.companyId) { mutableStateOf<PendingExport?>(null) }
    var writing by remember { mutableStateOf(false) }
    var message by remember(state.query) { mutableStateOf<String?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        val document = pending
        pending = null
        if (uri != null && document != null && document.actorId == state.actor.authUserId && document.companyId == state.actor.companyId) {
            writing = true
            scope.launch {
                try {
                    withContext(Dispatchers.IO) {
                        val output = context.contentResolver.openOutputStream(uri, "w") ?: error("Storage not available")
                        output.use { it.write(document.bytes) }
                    }
                    message = "PDF сохранён в выбранное вами место."
                } catch (error: Throwable) {
                    if (error is CancellationException) throw error
                    message = "Не удалось сохранить PDF. Проверьте доступ к выбранной папке."
                } finally { writing = false }
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedButton(enabled = state.page != null && !state.actorStale && !state.refreshing && !state.saving && pending == null && !writing,
            modifier = Modifier.fillMaxWidth(), onClick = {
                message = null
                viewModel.exportDocument { name, bytes ->
                    pending = PendingExport(state.actor.authUserId, state.actor.companyId, bytes)
                    launcher.launch(name)
                }
            }) { Text(if (writing) "Сохраняем PDF…" else "Сохранить PDF") }
        message?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}
