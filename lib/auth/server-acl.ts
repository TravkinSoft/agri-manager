import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCanonicalRole, type CanonicalRole } from "@/lib/auth/role-contract";

type AllowedRole =
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
  | "brigadier";

type NormalizedRole = CanonicalRole;

function normalizeRole(role: string | null | undefined): NormalizedRole | null {
  const parsed = parseCanonicalRole(role);
  if (!parsed) return null;
  return parsed;
}

export async function assertActorAccess(params: {
  supabase: SupabaseClient;
  actorUserId: string;
  companyId?: string | null;
  allowedRoles: AllowedRole[];
  requireActive?: boolean;
}): Promise<{ id: string; company_id: string | null; role: string; status: string | null }> {
  const { supabase, actorUserId, companyId, allowedRoles, requireActive = true } = params;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, company_id, role, status")
    .eq("id", actorUserId)
    .maybeSingle();

  if (error || !profile?.id) {
    throw new Error("Actor profile not found");
  }

  if (companyId && profile.company_id !== companyId) {
    throw new Error("Actor does not belong to the target company");
  }

  const normalizedRole = normalizeRole(profile.role);
  const allowedNormalized: string[] = Array.from(new Set(allowedRoles.flatMap((role) => {
    if (role === "admin") {
      return ["company_admin", "global_admin"] as const;
    }
    if (role === "company_admin") {
      return ["company_admin", "global_admin"] as const;
    }
    return [role] as const;
  })));

  if (!normalizedRole || !allowedNormalized.includes(normalizedRole)) {
    throw new Error("Access denied for current role");
  }

  if (requireActive && String(profile.status || "active") !== "active") {
    throw new Error("Actor profile is not active");
  }

  return profile as any;
}
