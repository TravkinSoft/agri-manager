import { NextRequest, NextResponse } from "next/server";
import { getServerActorFromSession, resolveCompanyForActor, SessionAuthError } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Language = "ru" | "kz" | "en";

function localizedName(row: any, language: Language) {
  if (!row) return "";
  if (language === "kz") return row.name_kz || row.name_kk || row.name_ru || row.name || "";
  if (language === "en") return row.name_en || row.name_ru || row.name || "";
  return row.name_ru || row.name || row.name_en || "";
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, request.nextUrl.searchParams.get("companyId"));
    const language = (["ru", "kz", "en"].includes(request.nextUrl.searchParams.get("language") || "")
      ? request.nextUrl.searchParams.get("language")
      : "ru") as Language;
    const supabase = getServiceClient();

    const { data: seasons, error: seasonError } = await supabase
      .from("seasons")
      .select("id,year")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("year", { ascending: false })
      .limit(1);
    if (seasonError) throw new Error(seasonError.message);

    const season = (seasons || [])[0] as { id: string; year: number | null } | undefined;
    if (!season?.id) return NextResponse.json({ companyId, season: null, rows: [] });

    const { data: structure, error: structureError } = await supabase
      .from("crop_structure")
      .select("id,field_id,crop_id,variety_id,reproduction_id,area")
      .eq("company_id", companyId)
      .eq("season_id", season.id)
      .eq("archived", false);
    if (structureError) throw new Error(structureError.message);

    const sourceRows = structure || [];
    const ids = (key: string) => Array.from(new Set(sourceRows.map((row: any) => String(row[key] || "")).filter(Boolean)));
    const fieldIds = ids("field_id");
    const cropIds = ids("crop_id");
    const varietyIds = ids("variety_id");
    const reproductionIds = ids("reproduction_id");

    const [fieldsRes, cropsRes, varietiesRes, reproductionsRes] = await Promise.all([
      fieldIds.length
        ? supabase.from("fields").select("id,name").eq("company_id", companyId).in("id", fieldIds)
        : Promise.resolve({ data: [], error: null } as any),
      cropIds.length
        ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en").in("id", cropIds)
        : Promise.resolve({ data: [], error: null } as any),
      varietyIds.length
        ? supabase.from("varieties").select("id,name,name_ru,name_kz,name_en").in("id", varietyIds)
        : Promise.resolve({ data: [], error: null } as any),
      reproductionIds.length
        ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").in("id", reproductionIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    const queryError = fieldsRes.error || cropsRes.error || varietiesRes.error || reproductionsRes.error;
    if (queryError) throw new Error(queryError.message);

    const fieldMap = new Map((fieldsRes.data || []).map((row: any) => [String(row.id), String(row.name || "-")]));
    const cropMap = new Map((cropsRes.data || []).map((row: any) => [String(row.id), localizedName(row, language) || "-"]));
    const varietyMap = new Map((varietiesRes.data || []).map((row: any) => [String(row.id), localizedName(row, language) || "-"]));
    const reproductionMap = new Map((reproductionsRes.data || []).map((row: any) => [String(row.id), localizedName(row, language) || row.code || "-"]));
    const grouped = new Map<string, any>();

    for (const row of sourceRows as any[]) {
      const cropId = row.crop_id ? String(row.crop_id) : null;
      const varietyId = row.variety_id ? String(row.variety_id) : null;
      const reproductionId = row.reproduction_id ? String(row.reproduction_id) : null;
      const key = [cropId || "none", varietyId || "none", reproductionId || "none"].join("|");
      const current = grouped.get(key) || {
        season_id: season.id,
        season_year: season.year == null ? null : Number(season.year),
        crop_id: cropId,
        crop_name: cropId ? cropMap.get(cropId) || "-" : "Не указано",
        variety_id: varietyId,
        variety_name: varietyId ? varietyMap.get(varietyId) || null : null,
        reproduction_id: reproductionId,
        reproduction_name: reproductionId ? reproductionMap.get(reproductionId) || null : null,
        area_ha: 0,
        field_names: [],
        fieldIds: new Set<string>(),
      };
      current.area_ha += Number(row.area || 0);
      const fieldId = String(row.field_id || "");
      if (fieldId && !current.fieldIds.has(fieldId)) {
        current.fieldIds.add(fieldId);
        const fieldName = fieldMap.get(fieldId);
        if (fieldName) current.field_names.push(fieldName);
      }
      grouped.set(key, current);
    }

    const rows = Array.from(grouped.values())
      .map(({ fieldIds: groupedFieldIds, ...row }) => ({
        ...row,
        area_ha: Number(Number(row.area_ha || 0).toFixed(4)),
        field_count: groupedFieldIds.size,
        field_names: row.field_names.sort((a: string, b: string) => a.localeCompare(b, "ru")),
      }))
      .sort((a, b) => b.area_ha - a.area_ha || a.crop_name.localeCompare(b.crop_name, "ru"));

    return NextResponse.json({ companyId, season, rows });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load season agronomy" },
      { status: 500 }
    );
  }
}
