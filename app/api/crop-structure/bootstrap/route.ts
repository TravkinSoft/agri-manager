import { NextRequest, NextResponse } from "next/server";
import { getServerActorFromSession, resolveCompanyForActor, SessionAuthError } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadCropStructureBootstrap(companyId: string) {
  const supabase = getServiceClient();

  const [fieldsRes, seasonsRes, cropsRes, varietiesRes, reproductionsRes, specialistsRes] = await Promise.all([
    supabase
      .from("fields")
      .select("id,name,notes,area")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("name"),
    supabase
      .from("seasons")
      .select("id,year")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("year", { ascending: false }),
    supabase.from("crops").select("id,name,name_ru,name_kz,name_en,slug,company_id,archived,is_active"),
    supabase.from("varieties").select("id,name,crop_id,company_id,archived,is_active"),
    supabase
      .from("seed_reproductions")
      .select("id,name,name_ru,name_kz,name_en,code,company_id,archived,is_active,level_order")
      .order("level_order"),
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("role", "specialist")
      .order("full_name", { ascending: true, nullsFirst: false })
      .order("email", { ascending: true }),
  ]);

  const error =
    fieldsRes.error ||
    seasonsRes.error ||
    cropsRes.error ||
    varietiesRes.error ||
    reproductionsRes.error ||
    specialistsRes.error;
  if (error) {
    throw new Error(error.message || "Failed to load crop structure bootstrap");
  }

  return {
    fields: fieldsRes.data || [],
    seasons: seasonsRes.data || [],
    crops: cropsRes.data || [],
    varieties: varietiesRes.data || [],
    reproductions: reproductionsRes.data || [],
    specialists: specialistsRes.data || [],
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = request.nextUrl.searchParams.get("companyId");
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const payload = await loadCropStructureBootstrap(companyId);

    return NextResponse.json({
      companyId,
      ...payload,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load crop structure bootstrap" },
      { status: 500 }
    );
  }
}
