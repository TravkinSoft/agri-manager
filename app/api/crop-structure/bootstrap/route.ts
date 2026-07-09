import { NextRequest, NextResponse } from "next/server";
import { getServerActorFromSession, resolveCompanyForActor, SessionAuthError } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CROP_STRUCTURE_BASE_SELECT = "id,field_id,crop_id,variety_id,reproduction_id,notes,area,seeding_rate,expected_yield";
const CROP_STRUCTURE_V4_SELECT = `${CROP_STRUCTURE_BASE_SELECT},irrigation_type,row_spacing_m,seed_spacing_cm`;

const isMissingCropStructureV4Column = (error: unknown) => {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("irrigation_type") ||
    message.includes("row_spacing_m") ||
    message.includes("seed_spacing_cm") ||
    message.includes("schema cache")
  );
};

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

  const activeSeasonId = seasonsRes.data?.[0]?.id || null;
  let cropStructureRows: unknown[] = [];
  if (activeSeasonId) {
    let cropStructureRes: any = await supabase
      .from("crop_structure")
      .select(CROP_STRUCTURE_V4_SELECT)
      .eq("company_id", companyId)
      .eq("season_id", activeSeasonId)
      .eq("archived", false);

    if (cropStructureRes.error && isMissingCropStructureV4Column(cropStructureRes.error)) {
      cropStructureRes = await supabase
        .from("crop_structure")
        .select(CROP_STRUCTURE_BASE_SELECT)
        .eq("company_id", companyId)
        .eq("season_id", activeSeasonId)
        .eq("archived", false);
    }

    if (cropStructureRes.error) {
      throw new Error(cropStructureRes.error.message || "Failed to load crop structure rows");
    }
    cropStructureRows = cropStructureRes.data || [];
  }

  return {
    fields: fieldsRes.data || [],
    seasons: seasonsRes.data || [],
    cropStructure: cropStructureRows,
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
