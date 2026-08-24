package com.travkin.flow;

import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class NativeRoutePolicy {
    private static final Set<String> TRUSTED_HOSTS = Set.of(
            "travkinflow.com",
            "www.travkinflow.com",
            "qa.travkinflow.com"
    );

    private static final List<String> APP_PATHS = List.of(
            "/auth",
            "/dashboard",
            "/weather-lab",
            "/fields",
            "/fields-map",
            "/map",
            "/crop-structure",
            "/warehouses",
            "/weighbridge",
            "/fuel",
            "/analytics",
            "/references",
            "/users",
            "/tickets",
            "/notifications",
            "/platform",
            "/settings"
    );

    private NativeRoutePolicy() {}

    public static boolean isTrustedHost(String host) {
        return host != null && TRUSTED_HOSTS.contains(host.toLowerCase(Locale.ROOT));
    }

    public static boolean isAllowedPath(String path) {
        if (path == null || path.isBlank() || "/".equals(path)) return true;
        String normalized = path.startsWith("/") ? path : "/" + path;
        return APP_PATHS.stream().anyMatch(prefix ->
                normalized.equals(prefix) || normalized.startsWith(prefix + "/")
        );
    }

    public static String normalizeDeepLink(String rawUrl, String baseUrl) {
        try {
            URI raw = URI.create(rawUrl);
            URI base = URI.create(baseUrl);
            if (!"https".equalsIgnoreCase(raw.getScheme()) || !isTrustedHost(raw.getHost())) return null;
            if (!isAllowedPath(raw.getPath())) return null;
            return new URI(
                    "https",
                    base.getAuthority(),
                    raw.getPath() == null || raw.getPath().isBlank() ? "/" : raw.getPath(),
                    raw.getQuery(),
                    raw.getFragment()
            ).toString();
        } catch (RuntimeException | java.net.URISyntaxException ignored) {
            return null;
        }
    }
}
