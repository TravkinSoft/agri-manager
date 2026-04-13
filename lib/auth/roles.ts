export type AppRole =
  | "global_admin"
  | "company_admin"
  | "admin"
  | "agronomist"
  | "specialist"
  | "warehouse"
  | "weighman"
  | null
  | undefined;

export function isGlobalAdmin(role: AppRole): boolean {
  return role === "global_admin";
}

export function isCompanyAdmin(role: AppRole): boolean {
  return role === "company_admin" || role === "admin";
}

export function isAnyAdmin(role: AppRole): boolean {
  return isGlobalAdmin(role) || isCompanyAdmin(role);
}

