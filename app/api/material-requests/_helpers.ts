import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

export const MATERIAL_REQUEST_READ_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "director",
  "warehouse",
  "warehouse_operator",
  "specialist",
  "brigadier",
  "weighman",
] as const;

export const MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES = [
  "global_admin",
  "company_admin",
  "warehouse",
  "warehouse_operator",
] as const;

export const MATERIAL_REQUEST_SPECIALIST_WRITE_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "specialist",
  "brigadier",
] as const;

export type WorkflowStatus =
  | "active"
  | "preparing"
  | "ready"
  | "issued"
  | "partially_issued"
  | "cancelled";

export function toWorkflowStatus(rawStatus: unknown): WorkflowStatus {
  const normalized = String(rawStatus || "").trim();
  if (normalized === "new") return "active";
  if (normalized === "active") return "active";
  if (normalized === "preparing") return "preparing";
  if (normalized === "ready") return "ready";
  if (normalized === "issued") return "issued";
  if (normalized === "issued_by_warehouse") return "issued";
  if (normalized === "partially_issued") return "partially_issued";
  if (normalized === "cancelled") return "cancelled";
  if (normalized === "received_confirmed") return "issued";
  return "active";
}

export async function resolveMaterialRequestSession(
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
  const sessionSupabase = createSessionSupabaseClient(request);

  await assertActorAccess({
    supabase,
    actorUserId: actor.id,
    companyId,
    allowedRoles: [...(options?.allowedRoles || MATERIAL_REQUEST_READ_ROLES)],
  });

  return { actor, companyId, supabase, sessionSupabase };
}

export function asMaterialRequestError(error: unknown): { status: number; error: string } | null {
  if (error instanceof SessionAuthError) {
    return { status: error.status, error: error.message };
  }
  return null;
}

function createSessionSupabaseClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new SessionAuthError("Supabase anon credentials are not configured", 500);
  }

  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const token = String(authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || "").trim();
  if (!token) {
    throw new SessionAuthError("Missing authorization token", 401);
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}
