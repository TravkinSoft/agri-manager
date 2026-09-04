package com.travkin.flow.domain

import java.net.URI

data class CabinetNotification(val id: String, val title: String, val body: String?, val createdAt: String?, val read: Boolean, val destination: CabinetQuery?)
data class NotificationPreferences(val email: Boolean, val operations: Boolean, val warehouses: Boolean, val tickets: Boolean,
    val proactiveEnabled: Boolean, val proactiveCadence: String)

/** Notification text cannot supply arbitrary URLs, operator sessions or administrator routes. */
fun notificationDestination(href: String?): CabinetQuery? {
    if (href == null || !href.startsWith('/') || href.startsWith("//") || '\\' in href) return null
    val uri = runCatching { URI(href) }.getOrNull() ?: return null
    if (uri.scheme != null || uri.host != null || uri.rawAuthority != null) return null
    return CabinetSection.fromPath(uri.path)?.let { CabinetQuery(it) }
}
