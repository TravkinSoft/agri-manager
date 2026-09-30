import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import {
  SessionAuthError,
  clearServerActorContextCacheForRequest,
  getServerActorFromSession,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function requireGlobalAdmin(role: string | null | undefined) {
  if (role !== "global_admin") {
    throw new SessionAuthError("Only global_admin can manage platform company context", 403);
  }
}

function isMissingRelationError(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return text.includes("does not exist") || text.includes("schema cache");
}

function resolveContextOwnerIds(actor: { id: string; authUserId?: string | null }): string[] {
  const ids = [String(actor.authUserId || "").trim(), String(actor.id || "").trim()].filter(Boolean);
  return Array.from(new Set(ids));
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    requireGlobalAdmin(actor.role);

    const supabase = getServiceClient();

    const ownerIds = resolveContextOwnerIds(actor);
    const [companiesRes, contextRes] = await Promise.all([
      supabase.from("companies").select("id,name").order("name", { ascending: true }).limit(2000),
      supabase
        .from("global_admin_company_contexts")
        .select("company_id")
        .in("user_id", ownerIds)
        .order("updated_at", { ascending: false })
        .limit(1),
    ]);

    if (companiesRes.error) {
      throw new Error(companiesRes.error.message || "Failed to load companies");
    }

    if (contextRes.error && !isMissingRelationError(contextRes.error.message)) {
      throw new Error(contextRes.error.message || "Failed to resolve selected company context");
    }

    return NextResponse.json({
      companies: (companiesRes.data || []).map((row) => ({
        id: String(row.id),
        name: String(row.name || row.id),
      })),
      selectedCompanyId: contextRes.data?.[0]?.company_id ? String(contextRes.data[0].company_id) : null,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load companies" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    requireGlobalAdmin(actor.role);

    const payload = await request.json().catch(() => ({}));
    const rawCompanyId = String(payload?.companyId || "").trim();
    const companyId = rawCompanyId === "__none__" ? "" : rawCompanyId;

    if (companyId && !isUuidLike(companyId)) {
      return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
    }

    const supabase = getServiceClient();

    if (companyId) {
      const companyRes = await supabase.from("companies").select("id,name").eq("id", companyId).maybeSingle();
      if (companyRes.error) {
        throw new Error(companyRes.error.message || "Failed to validate selected company");
      }
      if (!companyRes.data?.id) {
        return NextResponse.json({ error: "Company not found" }, { status: 404 });
      }
    }

    const ownerIds = resolveContextOwnerIds(actor);
    let upsertRes: { data?: { company_id?: string | null } } | null = null;
    let lastErrorMessage = "";
    for (const ownerId of ownerIds) {
      const attempt = await supabase
        .from("global_admin_company_contexts")
        .upsert(
          {
            user_id: ownerId,
            company_id: companyId || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        )
        .select("company_id")
        .maybeSingle();

      if (!attempt.error) {
        upsertRes = { data: attempt.data as any };
        break;
      }
      lastErrorMessage = attempt.error.message || "Failed to update company context";
    }

    if (!upsertRes) {
      throw new Error(lastErrorMessage || "Failed to update company context");
    }

    clearServerActorContextCacheForRequest(request);

    return NextResponse.json({
      ok: true,
      selectedCompanyId: upsertRes.data?.company_id ? String(upsertRes.data.company_id) : null,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to switch company context" },
      { status: 500 }
    );
  }
}
