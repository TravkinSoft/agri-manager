import type { AppRole } from "@/lib/auth/roles";
import { isAnyAdmin } from "@/lib/auth/roles";

const WAREHOUSE_ALLOWED_PREFIXES = [
  "/dashboard",
  "/warehouses",
  "/inventory",
  "/auth",
];

const WAREHOUSE_OPERATOR_ALLOWED_PREFIXES = [
  "/dashboard",
  "/warehouses",
  "/inventory",
  "/auth",
];

const WEIGHMAN_ALLOWED_PREFIXES = [
  "/dashboard",
  "/warehouses",
  "/weighbridge",
  "/processing",
  "/containers",
  "/ledger",
  "/auth",
];

const SPECIALIST_ALLOWED_PREFIXES = [
  "/dashboard",
  "/tasks",
  "/auth",
];

const FUEL_OPERATOR_ALLOWED_PREFIXES = [
  "/fuel",
  "/auth",
];

const BRIGADIER_ALLOWED_PREFIXES = [
  "/dashboard",
  "/operations",
  "/fields",
  "/auth",
];

const LEGAL_OPERATOR_ALLOWED_PREFIXES = [
  "/dashboard",
  "/land-legal",
  "/fields",
  "/analytics",
  "/reports",
  "/auth",
];

const AGRONOMIST_ALLOWED_PREFIXES = [
  "/dashboard",
  "/fields",
  "/crop-structure",
  "/field-history",
  "/operations",
  "/technique",
  "/analytics",
  "/references",
  "/auth",
];

const AGRONOMIST_ALLOWED_EXACT = [
  "/warehouses",
  "/weighbridge/dashboard",
];

const DIRECTOR_ALLOWED_PREFIXES = [
  "/dashboard",
  "/fields",
  "/crop-structure",
  "/field-history",
  "/operations",
  "/technique",
  "/analytics",
  "/warehouses",
  "/weighbridge",
  "/fuel",
  "/references",
  "/auth",
];

export function canAccessPath(role: AppRole, pathname: string): boolean {
  const path = String(pathname || "").toLowerCase();
  if (!path || path === "/") return true;

  // Legacy assistant page is deprecated and should be reachable only by global admin.
  if (path === "/specialist" || path.startsWith("/specialist/")) {
    return role === "global_admin";
  }

  if (path === "/platform" || path.startsWith("/platform/")) {
    return role === "global_admin";
  }

  if (role === "warehouse") {
    return WAREHOUSE_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  if (role === "warehouse_operator") {
    return WAREHOUSE_OPERATOR_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  if (role === "weighman") {
    return WEIGHMAN_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  if (role === "specialist") {
    return SPECIALIST_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  if (role === "fuel_operator") {
    return FUEL_OPERATOR_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  if (role === "brigadier") {
    return BRIGADIER_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  if (role === "legal_operator") {
    return LEGAL_OPERATOR_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  if (role === "agronomist") {
    const hasPrefixAccess = AGRONOMIST_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    const hasExactAccess = AGRONOMIST_ALLOWED_EXACT.includes(path);
    return hasPrefixAccess || hasExactAccess;
  }

  if (role === "director") {
    return DIRECTOR_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  // global/company admin keep full company access
  return isAnyAdmin(role);
}

export function getDefaultPathForRole(role: AppRole): string {
  if (role === "global_admin") return "/platform";
  if (role === "warehouse") return "/warehouses";
  if (role === "warehouse_operator") return "/warehouses";
  if (role === "weighman") return "/weighbridge/dashboard";
  if (role === "fuel_operator") return "/fuel";
  if (role === "brigadier") return "/operations";
  if (role === "legal_operator") return "/land-legal";
  if (role === "specialist") return "/tasks";
  return "/dashboard";
}
