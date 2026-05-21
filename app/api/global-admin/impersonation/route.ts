import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { parseCanonicalRole } from "@/lib/auth/role-contract";

export const runtime = "nodejs";

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function requireGlobalAdmin(role: string | null | undefined) {
  if (role !== "global_admin") {
    throw new SessionAuthError("Only global_admin can use impersonation", 403);
  }
}

function resolveContextOwnerIds(actor: { id: string; authUserId?: string | null }): string[] {
  const ids = [String(actor.id || "").trim(), String(actor.authUserId || "").trim()].filter(Boolean);
  return Array.from(new Set(ids)).filter((value) => isUuidLike(value));
}

function extractRequestMeta(request: NextRequest) {
  const sourceIp =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    null;
  const userAgent = request.headers.get("user-agent");
  return {
    source_ip: sourceIp ? String(sourceIp).slice(0, 512) : null,
    user_agent: userAgent ? String(userAgent).slice(0, 2048) : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const adminActor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    requireGlobalAdmin(adminActor.role);
    const effectiveActor = await getServerActorFromSession(request);
    const supabase = getServiceClient();
    const ownerIds = resolveContextOwnerIds(adminActor);
    const contextRes = await supabase
      .from("global_admin_impersonation_contexts")
      .select("impersonated_profile_id,impersonated_company_id,started_at,updated_at,reason")
      .in("admin_user_id", ownerIds)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (contextRes.error) throw new Error(contextRes.error.message || "Failed to load impersonation context");
    const context = contextRes.data?.[0] || null;

    let impersonatedProfile: Record<string, unknown> | null = null;
    const targetProfileId = String(context?.impersonated_profile_id || "").trim();
    if (isUuidLike(targetProfileId)) {
      const profileRes = await supabase
        .from("profiles")
        .select("id,full_name,email,role,company_id,status")
        .eq("id", targetProfileId)
        .maybeSingle();
      if (!profileRes.error && profileRes.data?.id) {
        impersonatedProfile = profileRes.data as Record<string, unknown>;
      }
    }

    return NextResponse.json({
      isImpersonating: effectiveActor.isImpersonating,
      effectiveRole: effectiveActor.role,
      effectiveProfileId: effectiveActor.id,
      context: context || null,
      impersonatedProfile,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load impersonation context" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const adminActor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    requireGlobalAdmin(adminActor.role);
    const payload = await request.json().catch(() => ({}));
    const targetProfileId = String(payload?.targetProfileId || "").trim();
    const reason = String(payload?.reason || "").trim() || null;
    if (!isUuidLike(targetProfileId)) {
      return NextResponse.json({ error: "Invalid target profile id" }, { status: 400 });
    }
    if (targetProfileId === adminActor.id) {
      return NextResponse.json({ error: "Cannot impersonate self profile" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const targetRes = await supabase
      .from("profiles")
      .select("id,full_name,email,role,company_id,status")
      .eq("id", targetProfileId)
      .maybeSingle();
    if (targetRes.error) throw new Error(targetRes.error.message || "Failed to load target profile");
    if (!targetRes.data?.id) return NextResponse.json({ error: "Target profile not found" }, { status: 404 });

    const targetRole = parseCanonicalRole(targetRes.data.role);
    const targetCompanyId = String(targetRes.data.company_id || "").trim();
    if (!targetRole) return NextResponse.json({ error: "Target profile has unsupported role" }, { status: 400 });
    if (String(targetRes.data.status || "") !== "active") {
      return NextResponse.json({ error: "Target profile is not active" }, { status: 400 });
    }
    if (!isUuidLike(targetCompanyId)) return NextResponse.json({ error: "Target company context is invalid" }, { status: 400 });

    const ownerIds = resolveContextOwnerIds(adminActor);
    const nowIso = new Date().toISOString();
    for (const ownerId of ownerIds) {
      const upsertRes = await supabase
        .from("global_admin_impersonation_contexts")
        .upsert(
          {
            admin_user_id: ownerId,
            impersonated_profile_id: targetProfileId,
            impersonated_company_id: targetCompanyId,
            reason,
            metadata: {
              target_role: targetRole,
              target_email: targetRes.data.email || null,
              target_name: targetRes.data.full_name || null,
            },
            started_at: nowIso,
            updated_at: nowIso,
          },
          { onConflict: "admin_user_id" }
        );
      if (upsertRes.error) throw new Error(upsertRes.error.message || "Failed to save impersonation context");
    }

    const requestMeta = extractRequestMeta(request);
    const auditPayload = ownerIds.map((ownerId) => ({
      admin_user_id: ownerId,
      impersonated_profile_id: targetProfileId,
      impersonated_company_id: targetCompanyId,
      event_type: "start",
      source_ip: requestMeta.source_ip,
      user_agent: requestMeta.user_agent,
      metadata: {
        reason,
        effective_target_role: targetRole,
      },
    }));
    const auditRes = await supabase.from("global_admin_impersonation_audit_logs").insert(auditPayload);
    if (auditRes.error) {
      console.error("Failed to write impersonation audit start event:", auditRes.error.message);
    }

    const effectiveActor = await getServerActorFromSession(request);
    return NextResponse.json({
      ok: true,
      isImpersonating: effectiveActor.isImpersonating,
      effectiveRole: effectiveActor.role,
      effectiveProfileId: effectiveActor.id,
      targetProfile: targetRes.data,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start impersonation" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const adminActor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    requireGlobalAdmin(adminActor.role);
    const supabase = getServiceClient();
    const ownerIds = resolveContextOwnerIds(adminActor);

    const existingContextRes = await supabase
      .from("global_admin_impersonation_contexts")
      .select("admin_user_id,impersonated_profile_id,impersonated_company_id")
      .in("admin_user_id", ownerIds);
    if (existingContextRes.error) throw new Error(existingContextRes.error.message || "Failed to load context");

    for (const ownerId of ownerIds) {
      const resetRes = await supabase
        .from("global_admin_impersonation_contexts")
        .upsert(
          {
            admin_user_id: ownerId,
            impersonated_profile_id: null,
            impersonated_company_id: null,
            reason: null,
            metadata: {},
            updated_at: new Date().toISOString(),
          },
          { onConflict: "admin_user_id" }
        );
      if (resetRes.error) throw new Error(resetRes.error.message || "Failed to reset impersonation context");
    }

    const existingContext = Array.isArray(existingContextRes.data) ? existingContextRes.data[0] : null;
    const requestMeta = extractRequestMeta(request);
    const auditPayload = ownerIds.map((ownerId) => ({
      admin_user_id: ownerId,
      impersonated_profile_id: existingContext?.impersonated_profile_id || null,
      impersonated_company_id: existingContext?.impersonated_company_id || null,
      event_type: "stop",
      source_ip: requestMeta.source_ip,
      user_agent: requestMeta.user_agent,
      metadata: {},
    }));
    const auditRes = await supabase.from("global_admin_impersonation_audit_logs").insert(auditPayload);
    if (auditRes.error) {
      console.error("Failed to write impersonation audit stop event:", auditRes.error.message);
    }

    return NextResponse.json({ ok: true, isImpersonating: false });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop impersonation" },
      { status: 500 }
    );
  }
}
