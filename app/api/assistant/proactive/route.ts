import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  ensureAssistantRole,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    ensureAssistantRole(actor);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const supabase = await getUserScopedClientFromRequest(request);
    const { data, error } = await supabase.rpc("run_my_proactive_assist_audit_v1", {
      p_company_id: companyId,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ checked: true, signals: Number(data || 0) });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Proactive Assist audit failed" },
      { status: 500 }
    );
  }
}
