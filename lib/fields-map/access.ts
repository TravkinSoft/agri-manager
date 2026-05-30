import type { ServerActorContext } from "@/lib/auth/server-session";
import { SessionAuthError } from "@/lib/auth/server-session";

const FIELD_MAP_READ_ROLES = new Set([
  "global_admin",
  "company_admin",
  "director",
  "agronomist",
  "legal_operator",
] as const);

const FIELD_MAP_WRITE_ROLES = new Set([
  "global_admin",
  "company_admin",
  "director",
  "agronomist",
] as const);

export function canReadFieldMap(role?: string | null): boolean {
  return !!role && FIELD_MAP_READ_ROLES.has(role as any);
}

export function canWriteFieldMap(role?: string | null): boolean {
  return !!role && FIELD_MAP_WRITE_ROLES.has(role as any);
}

export function assertFieldMapRead(actor: ServerActorContext): void {
  if (!canReadFieldMap(actor.role)) {
    throw new SessionAuthError("Access denied for current role", 403);
  }
}

export function assertFieldMapWrite(actor: ServerActorContext): void {
  if (!canWriteFieldMap(actor.role)) {
    throw new SessionAuthError("Write access denied for current role", 403);
  }
}
