import type { NextRequest } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

export const MEAL_THERMOS_READ_ROLES = [
  "global_admin",
  "company_admin",
  "warehouse",
  "warehouse_operator",
  "brigadier",
] as const;

export const MEAL_THERMOS_BRIGADIER_WRITE_ROLES = [
  "global_admin",
  "company_admin",
  "brigadier",
] as const;

export const MEAL_THERMOS_KITCHEN_WRITE_ROLES = [
  "global_admin",
  "company_admin",
  "warehouse",
  "warehouse_operator",
] as const;

export const MEAL_THERMOS_ADMIN_WRITE_ROLES = [
  "global_admin",
  "company_admin",
  "warehouse",
  "warehouse_operator",
] as const;

export type MealOrderStatus =
  | "new"
  | "accepted"
  | "cooking"
  | "ready"
  | "issued"
  | "partially_returned"
  | "returned"
  | "cancelled";

export type MealOrderPersonStatus =
  | "pending"
  | "assigned"
  | "issued"
  | "returned"
  | "lost"
  | "damaged";

export type ThermosStatus =
  | "available"
  | "assigned"
  | "issued"
  | "returned_dirty"
  | "cleaning"
  | "damaged"
  | "lost"
  | "inactive";

export const MEAL_TYPE_VALUES = ["breakfast", "lunch", "dinner", "other"] as const;
export type MealType = (typeof MEAL_TYPE_VALUES)[number];
export const THERMOS_STATUS_VALUES = [
  "available",
  "assigned",
  "issued",
  "returned_dirty",
  "cleaning",
  "damaged",
  "lost",
  "inactive",
] as const;

export function cleanString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function isKitchenRole(role: string): boolean {
  return MEAL_THERMOS_KITCHEN_WRITE_ROLES.includes(role as any);
}

export async function resolveMealThermosSession(
  request: NextRequest,
  options?: {
    allowedRoles?: readonly (
      | "admin"
      | "global_admin"
      | "company_admin"
      | "agronomist"
      | "director"
      | "legal_operator"
      | "warehouse"
      | "warehouse_operator"
      | "weighman"
      | "specialist"
      | "fuel_operator"
      | "brigadier"
    )[];
    requestedCompanyId?: string | null;
  }
) {
  const actor = await getServerActorFromSession(request);
  const requestedCompanyFromQuery = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
  const requestedCompanyId = options?.requestedCompanyId ?? requestedCompanyFromQuery;
  const companyId = resolveCompanyForActor(actor, requestedCompanyId);
  const supabase = getServiceClient();

  await assertActorAccess({
    supabase,
    actorUserId: actor.id,
    companyId,
    allowedRoles: [...(options?.allowedRoles || MEAL_THERMOS_READ_ROLES)],
  });

  return { actor, companyId, supabase };
}

export function asMealThermosError(error: unknown): { status: number; error: string } | null {
  if (error instanceof SessionAuthError) {
    return { status: error.status, error: error.message };
  }
  return null;
}
