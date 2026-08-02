import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
} from "@/lib/auth/server-session";
import { counterpartyMatchesSearch, isCountryCode } from "@/lib/counterparties/catalog";

function assertGlobalAdmin(role: string) {
  if (role !== "global_admin") throw new SessionAuthError("Global admin role is required", 403);
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    assertGlobalAdmin(actor.role);
    const supabase = await getUserScopedClientFromRequest(request);
    const search = String(request.nextUrl.searchParams.get("search") || "").trim();
    const country = String(request.nextUrl.searchParams.get("country") || "").trim().toUpperCase();
    const status = String(request.nextUrl.searchParams.get("status") || "all").trim().toLowerCase();
    let query = supabase.from("global_counterparties").select("*");
    if (status === "active") query = query.eq("archived", false).eq("is_active", true);
    if (status === "archived") query = query.or("archived.eq.true,is_active.eq.false");
    if (isCountryCode(country)) query = query.eq("country_code", country);
    const { data, error } = await query.order("legal_name");
    if (error) throw new Error(error.message);
    const rows = (data || []).filter((row: any) => counterpartyMatchesSearch({
      legalName: row.legal_name,
      taxId: row.tax_id,
      query: search,
    }));
    return NextResponse.json({ counterparties: rows });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Load failed" }, { status: 500 });
  }
}
