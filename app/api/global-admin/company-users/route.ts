import { NextRequest, NextResponse } from "next/server";
import { getServerActorFromSession, SessionAuthError } from "@/lib/auth/server-session";
import { isGlobalAdmin } from "@/lib/auth/roles";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizeProfileName(row: { full_name?: string | null; name?: string | null; email?: string | null; id: string }) {
  return String(row.full_name || row.name || row.email || row.id).trim();
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    if (!isGlobalAdmin(actor.role)) {
      throw new SessionAuthError("Only global_admin can list company users", 403);
    }

    const companyId = String(request.nextUrl.searchParams.get("companyId") || "").trim();
    if (!companyId || !isUuidLike(companyId)) {
      return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
    }

    const supabase = getServiceClient();

    const companyRes = await supabase.from("companies").select("id,name").eq("id", companyId).maybeSingle();
    if (companyRes.error) {
      throw new Error(companyRes.error.message || "Failed to validate company");
    }
    if (!companyRes.data?.id) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const profilesRes = await supabase
      .from("profiles")
      .select("id,full_name,name,email,role,status,company_id")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("role", { ascending: true })
      .order("full_name", { ascending: true });

    if (profilesRes.error) {
      throw new Error(profilesRes.error.message || "Failed to load company users");
    }

    const users = (profilesRes.data || [])
      .filter((row) => !isGlobalAdmin(row.role))
      .map((row) => ({
        id: String(row.id),
        name: normalizeProfileName({
          id: String(row.id),
          full_name: row.full_name,
          name: row.name,
          email: row.email,
        }),
        email: row.email ? String(row.email) : null,
        role: row.role ? String(row.role) : null,
      }));

    return NextResponse.json({
      company: {
        id: String(companyRes.data.id),
        name: String(companyRes.data.name || companyRes.data.id),
      },
      users,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load company users" },
      { status: 500 }
    );
  }
}
