import { NextRequest, NextResponse } from "next/server";
import {
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
  SessionAuthError,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CROP_STRUCTURE_BASE_SELECT = "id,field_id,land_use_type,crop_id,variety_id,reproduction_id,notes,area,seeding_rate,expected_yield";
const CROP_STRUCTURE_V4_SELECT = `${CROP_STRUCTURE_BASE_SELECT},irrigation_type,row_spacing_m,seed_spacing_cm`;
const CROP_STRUCTURE_REVIEW_SELECT = `${CROP_STRUCTURE_V4_SELECT},identity_review_required,identity_review_reason`;
const isMissingIdentityReviewColumn = (error: unknown) => {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return message.includes("identity_review_required") || message.includes("identity_review_reason");
};

const isMissingCropStructureV4Column = (error: unknown) => {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("irrigation_type") ||
    message.includes("row_spacing_m") ||
    message.includes("seed_spacing_cm") ||
    message.includes("identity_review_required") ||
    message.includes("identity_review_reason") ||
    message.includes("schema cache")
  );
};

async function loadCropStructureBootstrap(
  supabase: Awaited<ReturnType<typeof getUserScopedClientFromRequest>>,
  companyId: string
) {
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
      supabase.from("varieties").select("id,name,name_ru,name_kz,name_en,crop_id,company_id,archived,is_active"),
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
      .select(CROP_STRUCTURE_REVIEW_SELECT)
      .eq("company_id", companyId)
      .eq("season_id", activeSeasonId)
      .eq("archived", false);

    if (cropStructureRes.error && isMissingIdentityReviewColumn(cropStructureRes.error)) {
      cropStructureRes = await supabase
        .from("crop_structure")
        .select(CROP_STRUCTURE_V4_SELECT)
        .eq("company_id", companyId)
        .eq("season_id", activeSeasonId)
        .eq("archived", false);
    }

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
    const structureRows = cropStructureRes.data || [];
    const structureIds = structureRows.map((row: any) => String(row.id || "")).filter(Boolean);
    let mixComponents: any[] = [];
    if (structureIds.length) {
      const mixRes = await supabase
        .from("crop_structure_mix_components")
        .select("id,company_id,crop_structure_id,crop_id,variety_id,reproduction_id,seed_rate_kg_ha,sort_order")
        .eq("company_id", companyId)
        .in("crop_structure_id", structureIds)
        .order("sort_order");
      if (mixRes.error) {
        throw new Error(mixRes.error.message || "Failed to load crop mix components");
      }
      mixComponents = mixRes.data || [];
    }
    const componentsByStructure = new Map<string, any[]>();
    for (const component of mixComponents) {
      const key = String(component.crop_structure_id || "");
      componentsByStructure.set(key, [...(componentsByStructure.get(key) || []), component]);
    }
    cropStructureRows = structureRows.map((row: any) => ({
      ...row,
      mix_components: componentsByStructure.get(String(row.id || "")) || [],
    }));
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
    const supabase = await getUserScopedClientFromRequest(request);
    const payload = await loadCropStructureBootstrap(supabase, companyId);

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
