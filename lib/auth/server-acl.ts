import type { SupabaseClient } from "@supabase/supabase-js";

type AllowedRole =
  | "global_admin"
  | "company_admin"
  | "admin"
  | "agronomist"
  | "warehouse"
  | "weighman"
  | "specialist";

type NormalizedRole = Exclude<AllowedRole, "admin">;

function normalizeRole(role: string | null | undefined): NormalizedRole | null {
  const value = String(role || "").trim().toLowerCase();
  if (!value) return null;
  if (value === "admin") return "company_admin";
  if (
    value === "global_admin" ||
    value === "company_admin" ||
    value === "agronomist" ||
    value === "warehouse" ||
    value === "weighman" ||
    value === "specialist"
  ) {
    return value;
  }
  return null;
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
  const allowedNormalized = Array.from(
    new Set(
      allowedRoles.flatMap((role) => {
        if (role === "admin" || role === "company_admin") {
          return ["company_admin", "global_admin"] as const;
        }
        return [role] as const;
      })
    )
  );

  if (!normalizedRole || !allowedNormalized.includes(normalizedRole)) {
    throw new Error("Access denied for current role");
  }

  if (requireActive && String(profile.status || "active") !== "active") {
    throw new Error("Actor profile is not active");
  }

  return profile as any;
}
