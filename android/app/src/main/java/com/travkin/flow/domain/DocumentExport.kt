package com.travkin.flow.domain

sealed interface DocumentExport {
    val name: String
    data class Pdf(override val name: String, val bytes: ByteArray) : DocumentExport
    data class FieldCard(override val name: String, val html: String) : DocumentExport
}

/** Break only between complete text lines, never in the middle of a Cyrillic glyph. */
fun exportPageLineRanges(lineBottoms: List<Int>, pageHeight: Int): List<IntRange> {
    require(pageHeight > 0)
    if (lineBottoms.isEmpty()) return emptyList()
    require(lineBottoms.first() > 0 && lineBottoms.zipWithNext().all { it.second > it.first })
    val pages = mutableListOf<IntRange>()
    var first = 0
    while (first < lineBottoms.size) {
        val top = if (first == 0) 0 else lineBottoms[first - 1]
        require(lineBottoms[first] - top <= pageHeight) { "A line exceeds the printable page height" }
        var last = first
        while (last + 1 < lineBottoms.size && lineBottoms[last + 1] - top <= pageHeight) last++
        pages += first..last
        first = last + 1
    }
    return pages
}
