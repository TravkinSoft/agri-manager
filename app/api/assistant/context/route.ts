import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedServerClient } from "@/lib/supabase/server-user";
import {
  SessionAuthError,
  ensureAssistantRole,
  getServerActorFromSession,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { assertA107RuntimeGuardWhenConfigured } from "@/lib/assistant/v1/a107-runtime-guard";

export const runtime = "nodejs";

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function mapSessionErrorCode(error: SessionAuthError): string {
  const msg = String(error.message || "").toLowerCase();
  if (msg.includes("missing authorization")) return "AUTH_MISSING";
  if (msg.includes("invalid or expired")) return "AUTH_INVALID";
  if (msg.includes("profile not found")) return "PROFILE_NOT_FOUND";
  if (msg.includes("unknown user role")) return "ROLE_UNKNOWN";
  if (msg.includes("inactive user profile")) return "PROFILE_INACTIVE";
  if (msg.includes("not available for current role")) return "ROLE_FORBIDDEN";
  if (msg.includes("legacy role alias")) return "ROLE_LEGACY_ALIAS";
  if (msg.includes("company context is not selected")) return "COMPANY_CONTEXT_REQUIRED";
  if (msg.includes("company context is not configured")) return "COMPANY_CONTEXT_MISSING";
  if (msg.includes("invalid company id")) return "COMPANY_CONTEXT_INVALID";
  if (msg.includes("does not match global admin context") || msg.includes("company mismatch")) {
    return "COMPANY_CONTEXT_MISMATCH";
  }
  return "SESSION_AUTH_ERROR";
}

async function resolveActiveSeason(
  supabase: ReturnType<typeof getAuthenticatedServerClient>,
  companyId: string
): Promise<string | null> {
  const seasonRes = await supabase
    .from("seasons")
    .select("year")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("year", { ascending: false })
    .limit(1);

  if (seasonRes.error) throw seasonRes.error;
  return String(seasonRes.data?.[0]?.year || "").trim() || null;
}

export async function GET(request: NextRequest) {
  try {
    assertA107RuntimeGuardWhenConfigured();
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    const debugRequested = request.nextUrl.searchParams.get("debug") === "1";
    const debugPayload =
      (actor.role === "global_admin" || actor.role === "company_admin") && debugRequested
        ? {
            authUserId: actor.authUserId,
            profileId: actor.id,
            resolvedRole: actor.role,
            roleRawKey: actor.roleRawKey,
            roleIsLegacyAlias: actor.roleIsLegacyAlias,
            homeCompanyId: actor.homeCompanyId,
            contextCompanyId: actor.contextCompanyId,
          }
        : undefined;

    if (actor.role === "global_admin" && (!actor.contextCompanyId || !isUuidLike(actor.contextCompanyId))) {
      return NextResponse.json({
        allowed: true,
        role: actor.role,
        company: null,
        season: null,
        requiresCompanySelection: true,
        source: {
          role: "server-session",
          company: "global-admin-context",
        },
        debug: debugPayload,
      });
    }

    const companyId = resolveCompanyForActor(actor, null);
    const supabase = getAuthenticatedServerClient(request);

    const [companyRes, season] = await Promise.all([
      supabase.from("companies").select("id,name").eq("id", companyId).maybeSingle(),
      resolveActiveSeason(supabase, companyId),
    ]);

    return NextResponse.json({
      allowed: true,
      role: actor.role,
      company: {
        id: companyId,
        name: String(companyRes.data?.name || "").trim() || companyId,
      },
      season,
      requiresCompanySelection: false,
      source: {
        role: "server-session",
        company: actor.role === "global_admin" ? "global-admin-context" : "profile/rpc",
      },
      debug: debugPayload
        ? {
            ...debugPayload,
            resolvedCompanyId: companyId,
          }
        : undefined,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json(
        { error: error.message, code: mapSessionErrorCode(error), allowed: false },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to resolve assistant context",
        code: "ASSISTANT_CONTEXT_FAILED",
        allowed: false,
      },
      { status: 500 }
    );
  }
}
