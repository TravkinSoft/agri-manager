import { NextRequest, NextResponse } from "next/server";
import { WEIGHBRIDGE_READ_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";
import { brandName, localizedName } from "@/lib/i18n/helpers";

type Row = {
  id: string;
  field_id: string;
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  area: number | null;
  notes: string | null;
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
      .select("id,field_id,area,crop_id,variety_id,reproduction_id,notes")
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
        ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en,slug,category_id,subcategory,crop_subcategory").in("id", cropIds)
        : Promise.resolve({ data: [], error: null } as any),
      varietyIds.length
        ? supabase.from("varieties").select("id,name,name_ru,name_kz,name_en").in("id", varietyIds)
        : Promise.resolve({ data: [], error: null } as any),
      reproductionIds.length
        ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").in("id", reproductionIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (cropsRes.error) return NextResponse.json({ error: cropsRes.error.message }, { status: 400 });
    if (varietiesRes.error) return NextResponse.json({ error: varietiesRes.error.message }, { status: 400 });
    if (reproductionsRes.error) return NextResponse.json({ error: reproductionsRes.error.message }, { status: 400 });

    const categoryIds = Array.from(new Set((cropsRes.data || []).map((crop: any) => String(crop.category_id || "")).filter(Boolean)));
    const categoriesRes = categoryIds.length
      ? await supabase.from("crop_categories").select("id,slug,name_ru").in("id", categoryIds)
      : { data: [], error: null } as any;
    if (categoriesRes.error) return NextResponse.json({ error: categoriesRes.error.message }, { status: 400 });

    const cropsById = new Map<string, any>((cropsRes.data || []).map((x: any) => [String(x.id), x]));
    const varietiesById = new Map<string, any>((varietiesRes.data || []).map((x: any) => [String(x.id), x]));
    const reproductionsById = new Map<string, any>((reproductionsRes.data || []).map((x: any) => [String(x.id), x]));
    const categoriesById = new Map<string, any>((categoriesRes.data || []).map((x: any) => [String(x.id), x]));

    const byField: Record<string, any[]> = {};
    const incompleteByField: Record<string, boolean> = {};

    const rowsByField = new Map<string, Row[]>();
    for (const row of rows) {
      const fieldId = String(row.field_id || "").trim();
      if (!fieldId) continue;
      rowsByField.set(fieldId, [...(rowsByField.get(fieldId) || []), row]);
    }

    for (const [groupFieldId, fieldRows] of Array.from(rowsByField.entries())) {
      const orderedRows = fieldRows.slice().sort((left, right) => String(left.id).localeCompare(String(right.id)));
      for (let rowIndex = 0; rowIndex < orderedRows.length; rowIndex += 1) {
      const row = orderedRows[rowIndex];
      const fieldId = groupFieldId;
      const cropId = String(row.crop_id || "").trim();
      const varietyId = String(row.variety_id || "").trim();
      const reproductionId = String(row.reproduction_id || "").trim();
      if (!fieldId || !cropId) continue;

      const cropRef = cropsById.get(cropId) || null;
      const categoryRef = categoriesById.get(String(cropRef?.category_id || "")) || null;
      const varietyRef = varietyId ? varietiesById.get(varietyId) || null : null;
      const reproductionRef = reproductionId ? reproductionsById.get(reproductionId) || null : null;

      const isIncomplete = !varietyId || !reproductionId || !varietyRef || !reproductionRef;
      if (isIncomplete) incompleteByField[fieldId] = true;

      byField[fieldId] = byField[fieldId] || [];
      byField[fieldId].push({
        allocationId: String(row.id || ""),
        areaHa: Number(row.area || 0),
        cropId,
        cropName: localizedName(cropRef, "ru") || "",
        cropSlug: String(cropRef?.slug || ""),
        cropCategorySlug: String(categoryRef?.slug || ""),
        cropCategoryName: String(categoryRef?.name_ru || ""),
        cropSubcategory: String(cropRef?.subcategory || cropRef?.crop_subcategory || ""),
        varietyId,
        varietyName: brandName(varietyRef) || "",
        reproductionId,
        reproductionName: localizedName(reproductionRef, "ru", ["name", "code"]) || "",
        allocationCode: String(row.id || "").slice(0, 8).toUpperCase(),
        plotOrdinal: rowIndex + 1,
        plotCount: orderedRows.length,
        plotLabel: `Посевная строка №${rowIndex + 1}`,
        notes: String(row.notes || "").trim(),
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
