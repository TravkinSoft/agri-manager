// Shared role predicates only. Keep server auth, clients and environment out of this module.
const FIELD_MAP_READ_ROLES = new Set<string>([
  "global_admin", "company_admin", "director", "agronomist", "legal_operator",
]);
const FIELD_MAP_WRITE_ROLES = new Set<string>([
  "global_admin", "company_admin", "director",
]);
const FIELD_MAP_MUTATION_ROLES = new Set<string>(["global_admin"]);

export function canReadFieldMap(role?: string | null): boolean {
  return !!role && FIELD_MAP_READ_ROLES.has(role);
}

export function canWriteFieldMap(role?: string | null): boolean {
  return !!role && FIELD_MAP_WRITE_ROLES.has(role);
}

export function canMutateFieldMap(role?: string | null): boolean {
  return !!role && FIELD_MAP_MUTATION_ROLES.has(role);
}
