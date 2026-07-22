import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, getUserScopedClientFromRequest, resolveCompanyForActor } from "@/lib/auth/server-session";

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(request.nextUrl.searchParams.get("companyId") || "").trim() || null);
    const supabase = await getUserScopedClientFromRequest(request);
    await assertActorAccess({ supabase, actorUserId: actor.id, companyId, allowedRoles: ["company_admin", "global_admin"] });
    const { data, error } = await supabase.from("profiles")
      .select("id,full_name,email,role,status")
      .eq("company_id", companyId)
      .eq("status", "active")
      .in("role", ["warehouse", "warehouse_operator", "weighman"])
      .order("full_name");
    if (error) throw new Error(error.message);
    return NextResponse.json({ assignees: (data || []).map((row: any) => ({
      id: String(row.id), name: String(row.full_name || row.email || "Пользователь"), role: String(row.role),
    })) });
  } catch (error) {
    if (error instanceof SessionAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить ответственных" }, { status: 500 });
  }
}
