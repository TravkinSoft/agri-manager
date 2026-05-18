export const CANONICAL_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "director",
  "specialist",
  "warehouse",
  "weighman",
  "fuel_operator",
] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number];

const CANONICAL_ROLE_MAP: Record<string, CanonicalRole> = {
  global_admin: "global_admin",
  company_admin: "company_admin",
  agronomist: "agronomist",
  director: "director",
  specialist: "specialist",
  warehouse: "warehouse",
  weighman: "weighman",
  fuel_operator: "fuel_operator",
};

const LEGACY_ROLE_ALIASES: Record<string, CanonicalRole> = {
  admin: "company_admin",
  companyadmin: "company_admin",
  companyadministrator: "company_admin",
  super_admin: "global_admin",
  superadmin: "global_admin",
  globaladmin: "global_admin",
};

function allowLegacyAliases(): boolean {
  return process.env.DISABLE_LEGACY_ROLE_ALIASES !== "1";
}

export function normalizeRoleKey(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function parseCanonicalRole(raw: unknown): CanonicalRole | null {
  const key = normalizeRoleKey(raw);
  if (!key) return null;
  if (CANONICAL_ROLE_MAP[key]) return CANONICAL_ROLE_MAP[key];
  if (allowLegacyAliases()) return LEGACY_ROLE_ALIASES[key] || null;
  return null;
}

export function isCanonicalRole(raw: unknown): raw is CanonicalRole {
  const key = normalizeRoleKey(raw);
  return !!CANONICAL_ROLE_MAP[key];
}

export function isLegacyRoleAlias(raw: unknown): boolean {
  const key = normalizeRoleKey(raw);
  return !!LEGACY_ROLE_ALIASES[key];
}
