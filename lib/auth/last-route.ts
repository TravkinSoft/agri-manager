import { canAccessPath } from "@/lib/auth/role-access";

export const AGRONOMIST_LAST_ROUTE_PREFIX = "travkinflow:agronomist:last-route:v1:";

export function agronomistLastRouteStorageKey(profileId: string): string {
  return `${AGRONOMIST_LAST_ROUTE_PREFIX}${profileId}`;
}

export function normalizeAgronomistLastRoute(value: string | null | undefined): string | null {
  const candidate = String(value || "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;

  try {
    const parsed = new URL(candidate, "https://travkinflow.local");
    if (parsed.origin !== "https://travkinflow.local") return null;
    const pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (pathname === "/tickets" || pathname.startsWith("/tickets/")) return null;
    if (pathname === "/auth" || pathname.startsWith("/auth/")) return null;
    if (!canAccessPath("agronomist", pathname)) return null;
    return `${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function readAgronomistLastRoute(profileId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeAgronomistLastRoute(
      window.localStorage.getItem(agronomistLastRouteStorageKey(profileId)),
    );
  } catch {
    return null;
  }
}

export function rememberAgronomistLastRoute(profileId: string, route: string): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeAgronomistLastRoute(route);
  if (!normalized) return;
  try {
    window.localStorage.setItem(agronomistLastRouteStorageKey(profileId), normalized);
  } catch {
    // The route still works when browser storage is unavailable.
  }
}
