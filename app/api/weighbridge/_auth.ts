import type { NextRequest } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

export const WEIGHBRIDGE_READ_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "director",
  "warehouse",
  "warehouse_operator",
  "weighman",
  "specialist",
] as const;

export const WEIGHBRIDGE_WRITE_ROLES = [
  "global_admin",
  "company_admin",
  "warehouse",
  "warehouse_operator",
  "weighman",
] as const;

export async function resolveWeighbridgeSession(
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
  const queryCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
  const requestedCompanyId = options?.requestedCompanyId ?? queryCompanyId;
  const companyId = resolveCompanyForActor(actor, requestedCompanyId);
  const supabase = getServiceClient();

  await assertActorAccess({
    supabase,
    actorUserId: actor.id,
    companyId,
    allowedRoles: [...(options?.allowedRoles || WEIGHBRIDGE_READ_ROLES)],
  });

  return { actor, companyId, supabase };
}

export function asSessionErrorResponse(error: unknown) {
  if (error instanceof SessionAuthError) {
    return { error: error.message, status: error.status };
  }
  return null;
}

