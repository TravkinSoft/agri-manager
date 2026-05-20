import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { WEIGHBRIDGE_READ_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";

type Row = {
  id: string;
  field_id: string;
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  area: number | null;
};

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });

    const { data: seasonsRows, error: seasonError } = await supabase
      .from("seasons")
      .select("id,year,archived")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("year", { ascending: false });
    if (seasonError) return NextResponse.json({ error: seasonError.message }, { status: 400 });

    const nowYear = new Date().getFullYear();
    const activeSeason =
      (seasonsRows || []).find((s: any) => Number(s.year) === nowYear) ||
      (seasonsRows || [])[0];
    if (!activeSeason?.id) {
      return NextResponse.json({ seasonId: null, byField: {}, incompleteByField: {} });
    }

    const { data: structureRows, error: structureError } = await supabase
      .from("crop_structure")
      .select("id,field_id,area,crop_id,variety_id,reproduction_id")
      .eq("company_id", companyId)
      .eq("season_id", activeSeason.id)
      .eq("archived", false);
    if (structureError) return NextResponse.json({ error: structureError.message }, { status: 400 });

    const rows = (structureRows || []) as Row[];
    const cropIds = Array.from(new Set(rows.map((x) => String(x.crop_id || "")).filter(Boolean)));
    const varietyIds = Array.from(new Set(rows.map((x) => String(x.variety_id || "")).filter(Boolean)));
    const reproductionIds = Array.from(new Set(rows.map((x) => String(x.reproduction_id || "")).filter(Boolean)));

    const [cropsRes, varietiesRes, reproductionsRes] = await Promise.all([
      cropIds.length
        ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en").in("id", cropIds)
        : Promise.resolve({ data: [], error: null } as any),
      varietyIds.length
        ? supabase.from("varieties").select("id,name,name_ru,name_kz,name_en").in("id", varietyIds)
        : Promise.resolve({ data: [], error: null } as any),
      reproductionIds.length
        ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en").in("id", reproductionIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (cropsRes.error) return NextResponse.json({ error: cropsRes.error.message }, { status: 400 });
    if (varietiesRes.error) return NextResponse.json({ error: varietiesRes.error.message }, { status: 400 });
    if (reproductionsRes.error) return NextResponse.json({ error: reproductionsRes.error.message }, { status: 400 });

    const cropsById = new Map<string, any>((cropsRes.data || []).map((x: any) => [String(x.id), x]));
    const varietiesById = new Map<string, any>((varietiesRes.data || []).map((x: any) => [String(x.id), x]));
    const reproductionsById = new Map<string, any>((reproductionsRes.data || []).map((x: any) => [String(x.id), x]));

    const byField: Record<string, any[]> = {};
    const incompleteByField: Record<string, boolean> = {};

    for (const row of rows) {
      const fieldId = String(row.field_id || "").trim();
      const cropId = String(row.crop_id || "").trim();
      const varietyId = String(row.variety_id || "").trim();
      const reproductionId = String(row.reproduction_id || "").trim();
      if (!fieldId || !cropId) continue;

      const cropRef = cropsById.get(cropId) || null;
      const varietyRef = varietyId ? varietiesById.get(varietyId) || null : null;
      const reproductionRef = reproductionId ? reproductionsById.get(reproductionId) || null : null;

      const isIncomplete = !varietyId || !reproductionId || !varietyRef || !reproductionRef;
      if (isIncomplete) incompleteByField[fieldId] = true;

      byField[fieldId] = byField[fieldId] || [];
      byField[fieldId].push({
        allocationId: String(row.id || ""),
        areaHa: Number(row.area || 0),
        cropId,
        cropName: cropRef?.name_ru || cropRef?.name || "",
        varietyId,
        varietyName: varietyRef?.name_ru || varietyRef?.name || "",
        reproductionId,
        reproductionName: reproductionRef?.name_ru || reproductionRef?.name || "",
        isIncomplete,
        debug: {
          cropId,
          varietyId,
          reproductionId,
          hasVarietyRef: Boolean(varietyRef),
          hasReproductionRef: Boolean(reproductionRef),
        },
      });
    }

    return NextResponse.json({
      seasonId: String(activeSeason.id),
      seasonYear: Number(activeSeason.year),
      byField,
      incompleteByField,
    });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
