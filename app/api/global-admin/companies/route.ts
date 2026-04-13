import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";

async function ensureGlobalAdmin(userId: string) {
  const supabase = getServiceClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, company_id, full_name, email")
    .eq("id", userId)
    .maybeSingle();

  if (error || !profile?.id) {
    throw new Error("User profile not found");
  }

  if (String(profile.role || "").toLowerCase() !== "global_admin") {
    throw new Error("Access denied: global admin role required");
  }

  return { supabase, profile };
}

export async function GET(request: NextRequest) {
  try {
    const userId = String(request.nextUrl.searchParams.get("userId") || "").trim();
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const { supabase, profile } = await ensureGlobalAdmin(userId);
    const [{ data: companies, error: companiesError }, { data: context }] = await Promise.all([
      supabase.from("companies").select("id, name, created_at").order("created_at", { ascending: true }),
      supabase
        .from("global_admin_company_contexts")
        .select("company_id")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    if (companiesError) {
      return NextResponse.json({ error: companiesError.message }, { status: 400 });
    }

    return NextResponse.json({
      currentCompanyId: context?.company_id || null,
      homeCompanyId: profile.company_id || null,
      companies: (companies || []).map((row) => ({
        id: String((row as any).id),
        name: String((row as any).name || "Компания"),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = String(body?.userId || "").trim();
    const companyIdRaw = body?.companyId;
    const companyId = companyIdRaw == null ? null : String(companyIdRaw).trim();

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const { supabase } = await ensureGlobalAdmin(userId);

    if (companyId) {
      const { data: company, error: companyError } = await supabase
        .from("companies")
        .select("id")
        .eq("id", companyId)
        .maybeSingle();

      if (companyError || !company?.id) {
        return NextResponse.json({ error: "Target company not found" }, { status: 400 });
      }
    }

    const { error: contextError } = await supabase.from("global_admin_company_contexts").upsert(
      {
        user_id: userId,
        company_id: companyId || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (contextError) {
      return NextResponse.json({ error: contextError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, companyId: companyId || null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
