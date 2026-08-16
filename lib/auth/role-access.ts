import type { AppRole } from "@/lib/auth/roles";

const HIDDEN_PILOT_PREFIXES = [
  "/fields-map",
  "/map",
  "/land-legal",
  "/care-systems",
  "/field-history",
  "/meal-thermoses",
  "/fuel",
  "/import",
  "/machines",
  "/technique",
];

const AUTHENTICATED_SHARED_PREFIXES = ["/notifications"];

const COMPANY_ADMIN_ALLOWED_PREFIXES = [
  "/dashboard",
  "/fields",
  "/crop-structure",
  "/operations",
  "/weighbridge",
  "/analytics",
  "/references",
  "/users",
  "/settings",
  "/auth",
];

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
  "/weighbridge",
  "/auth",
];

const WEIGHMAN_ALLOWED_PREFIXES = [
  "/dashboard",
  "/warehouses",
  "/weighbridge",
  "/ledger",
  "/auth",
];

const SPECIALIST_ALLOWED_PREFIXES = [
  "/dashboard",
  "/tasks",
  "/auth",
];

const FUEL_OPERATOR_ALLOWED_PREFIXES = ["/dashboard", "/auth"];

const BRIGADIER_ALLOWED_PREFIXES = [
  "/dashboard",
  "/operations",
  "/fields",
  "/auth",
];

const LEGAL_OPERATOR_ALLOWED_PREFIXES = [
  "/dashboard",
  "/fields",
  "/analytics",
  "/reports",
  "/auth",
];

const AGRONOMIST_ALLOWED_PREFIXES = [
  "/dashboard",
  "/crop-structure",
  "/weather-lab",
  "/tickets",
  "/auth",
];

const AGRONOMIST_ALLOWED_EXACT = ["/warehouses"];

const DIRECTOR_ALLOWED_PREFIXES = [
  "/dashboard",
  "/auth",
];

const DIRECTOR_ALLOWED_EXACT: string[] = [];

export function canAccessPath(role: AppRole, pathname: string): boolean {
  const path = String(pathname || "").toLowerCase();
  if (!path || path === "/") return true;

  if (role === "global_admin") return true;

  if (AUTHENTICATED_SHARED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return true;
  }

  if (HIDDEN_PILOT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return false;
  }

  const isWeighbridgeDashboardPath = path === "/weighbridge/dashboard" || path.startsWith("/weighbridge/dashboard/");
  if (isWeighbridgeDashboardPath) {
    return role === "company_admin";
  }

  // Legacy assistant page is deprecated and should be reachable only by global admin.
  if (path === "/specialist" || path.startsWith("/specialist/")) {
    return false;
  }

  if (path === "/platform" || path.startsWith("/platform/")) {
    return false;
  }

  if (path === "/warehouses/manage" || path.startsWith("/warehouses/manage/")) {
    return role === "company_admin";
  }

  if (role === "company_admin") {
    if (path === "/warehouses") return true;
    return COMPANY_ADMIN_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
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
    const hasPrefixAccess = DIRECTOR_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    return hasPrefixAccess || DIRECTOR_ALLOWED_EXACT.includes(path);
  }

  return false;
}

export function getDefaultPathForRole(role: AppRole): string {
  if (role === "global_admin") return "/platform";
  if (role === "warehouse") return "/warehouses";
  if (role === "warehouse_operator") return "/warehouses";
  if (role === "weighman") return "/weighbridge";
  if (role === "fuel_operator") return "/dashboard";
  if (role === "brigadier") return "/operations";
  if (role === "legal_operator") return "/dashboard";
  if (role === "specialist") return "/tasks";
  return "/dashboard";
}
