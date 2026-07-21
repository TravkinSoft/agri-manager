import type { NextRequest } from "next/server";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";

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
  const supabase = await getUserScopedClientFromRequest(request);
  const allowedRoles = options?.allowedRoles || MATERIAL_REQUEST_READ_ROLES;
  if (String(actor.status || "active") !== "active" || !allowedRoles.includes(actor.role as never)) {
    throw new SessionAuthError("Access denied for current role", 403);
  }
  if (actor.role !== "global_admin" && actor.companyId !== companyId) {
    throw new SessionAuthError("Actor does not belong to the target company", 403);
  }

  return { actor, companyId, supabase, sessionSupabase: supabase };
}

export function asMaterialRequestError(error: unknown): { status: number; error: string } | null {
  if (error instanceof SessionAuthError) {
    return { status: error.status, error: error.message };
  }
  return null;
}
