package com.travkin.flow.data

import com.google.gson.JsonArray

internal suspend fun readAllPages(pageSize: Int = 500, read: suspend (Int) -> JsonArray): JsonArray {
    val result = JsonArray()
    var offset = 0
    while (true) {
        val page = read(offset)
        if (page.any { !it.isJsonObject }) throw UserFacingException("Некорректный ответ сервера.")
        result.addAll(page)
        if (page.size() < pageSize) return result
        offset += page.size()
        if (offset >= 100_000) throw UserFacingException("Слишком много записей для одного раздела. Неполные итоги не показаны.")
    }
}
