import type { AppRole } from "@/lib/auth/roles";
import { isAnyAdmin } from "@/lib/auth/roles";

const WAREHOUSE_ALLOWED_PREFIXES = [
  "/dashboard",
  "/warehouses",
  "/inventory",
  "/auth",
];

const WEIGHMAN_ALLOWED_PREFIXES = [
  "/dashboard",
  "/weighbridge",
  "/processing",
  "/containers",
  "/ledger",
  "/auth",
];

const SPECIALIST_ALLOWED_PREFIXES = [
  "/dashboard",
  "/specialist",
  "/tasks",
  "/auth",
];

const AGRONOMIST_ALLOWED_PREFIXES = [
  "/dashboard",
  "/fields",
  "/crop-structure",
  "/field-history",
  "/operations",
  "/analytics",
  "/specialist",
  "/references",
  "/auth",
];

const AGRONOMIST_ALLOWED_EXACT = [
  "/warehouses",
  "/weighbridge/dashboard",
];

export function canAccessPath(role: AppRole, pathname: string): boolean {
  const path = String(pathname || "").toLowerCase();
  if (!path || path === "/") return true;
  if (path === "/platform" || path.startsWith("/platform/")) {
    return role === "global_admin";
  }

  if (role === "warehouse") {
    return WAREHOUSE_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  if (role === "weighman") {
    return WEIGHMAN_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  if (role === "specialist") {
    return SPECIALIST_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  if (role === "agronomist") {
    const hasPrefixAccess = AGRONOMIST_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    const hasExactAccess = AGRONOMIST_ALLOWED_EXACT.includes(path);
    return hasPrefixAccess || hasExactAccess;
  }

  // global/company admin keep full company access
  return isAnyAdmin(role);
}

export function getDefaultPathForRole(role: AppRole): string {
  if (role === "global_admin") return "/platform";
  if (role === "warehouse") return "/warehouses";
  if (role === "weighman") return "/weighbridge/dashboard";
  if (role === "specialist") return "/specialist";
  return "/dashboard";
}
