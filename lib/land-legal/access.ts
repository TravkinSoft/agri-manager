import type { ServerActorContext } from "@/lib/auth/server-session";

export const LAND_LEGAL_READ_ROLES = new Set([
  "global_admin",
  "company_admin",
  "director",
  "agronomist",
] as const);

export const LAND_LEGAL_WRITE_ROLES = new Set([
  "global_admin",
  "company_admin",
] as const);

export function canReadLandLegal(role?: string | null): boolean {
  return !!role && LAND_LEGAL_READ_ROLES.has(role as any);
}

export function canWriteLandLegal(role?: string | null): boolean {
  return !!role && LAND_LEGAL_WRITE_ROLES.has(role as any);
}

export function assertLandLegalRead(actor: ServerActorContext): void {
  if (!canReadLandLegal(actor.role)) {
    throw new Error("Access denied for current role");
  }
}

export function assertLandLegalWrite(actor: ServerActorContext): void {
  if (!canWriteLandLegal(actor.role)) {
    throw new Error("Write access denied for current role");
  }
}
