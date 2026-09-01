package com.travkin.flow.data

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

class OperatorCookieJar(
    private val storage: SecureStorage,
    private val allowedOrigin: HttpUrl,
) : CookieJar {
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (!isAllowed(url)) return
        cookies.firstOrNull { it.name == COOKIE_NAME }?.let { cookie ->
            if (cookie.value.isBlank() || cookie.expiresAt <= System.currentTimeMillis()) {
                clear()
            } else {
                storage.put(COOKIE_KEY, cookie.toString())
            }
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        if (!isAllowed(url)) return emptyList()
        val raw = storage.get(COOKIE_KEY) ?: return emptyList()
        val cookie = Cookie.parse(url, raw) ?: run {
            clear()
            return emptyList()
        }
        if (cookie.expiresAt <= System.currentTimeMillis() || !cookie.matches(url)) {
            clear()
            return emptyList()
        }
        return listOf(cookie)
    }

    private fun isAllowed(url: HttpUrl): Boolean = isSameSecureOrigin(url, allowedOrigin)

    fun clear() {
        storage.remove(COOKIE_KEY)
    }

    private companion object {
        const val COOKIE_NAME = "travkin_wb_operator"
        const val COOKIE_KEY = "weighbridge_operator_cookie"
    }
}

internal fun isSameSecureOrigin(url: HttpUrl, allowedOrigin: HttpUrl): Boolean =
    url.isHttps && allowedOrigin.isHttps && url.host == allowedOrigin.host && url.port == allowedOrigin.port
