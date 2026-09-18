import { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { failed, noStore, operator, TrafficError } from "@/lib/traffic/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedVegetables = new Set(["картофель", "potato", "морковь", "carrot"]);

function normalizedNames(row: Record<string, unknown> | null | undefined) {
  return [row?.name_ru, row?.name, row?.name_kz, row?.name_en]
    .map((value) => String(value || "").trim().toLocaleLowerCase("ru-RU"))
    .filter(Boolean);
}

function displayName(row: Record<string, unknown> | null | undefined, fallback = "") {
  return String(row?.name_ru || row?.name || row?.name_kz || row?.name_en || fallback).trim();
}

export async function GET(request: NextRequest) {
  try {
    const actor = await operator(request);
    if (actor.role !== "harvester") throw new TrafficError("PTC_SHIFT_FORBIDDEN", 403);
    const db = getServiceClient();
    const { data: seasons, error: seasonError } = await db
      .from("seasons")
      .select("id,year")
      .eq("company_id", actor.companyId)
      .eq("archived", false)
      .order("year", { ascending: false })
      .limit(1);
    if (seasonError) throw seasonError;
    const season = seasons?.[0];
    if (!season?.id) return noStore({ seasonId: null, seasonYear: null, suggestedCropStructureId: null, plots: [] });

    const [structureResult, lastShiftResult] = await Promise.all([
      db.from("crop_structure")
        .select("id,field_id,crop_id,variety_id,reproduction_id,area")
        .eq("company_id", actor.companyId)
        .eq("season_id", season.id)
        .eq("land_use_type", "crop")
        .eq("archived", false),
      db.from("ptc_combine_shifts")
        .select("current_crop_structure_id")
        .eq("company_id", actor.companyId)
        .eq("operator_user_id", actor.actorId)
        .order("opened_at", { ascending: false })
        .limit(1),
    ]);
    if (structureResult.error) throw structureResult.error;
    if (lastShiftResult.error) throw lastShiftResult.error;
    const structures = structureResult.data;
    const lastShiftStructureId = String(lastShiftResult.data?.[0]?.current_crop_structure_id || "");
    const rows = structures || [];
    const ids = (key: string) => Array.from(new Set(rows.map((row: any) => String(row[key] || "")).filter(Boolean)));
    const [fieldsResult, cropsResult, varietiesResult, reproductionsResult, progressResult] = await Promise.all([
      ids("field_id").length
        ? db.from("fields").select("id,name").eq("company_id", actor.companyId).in("id", ids("field_id"))
        : Promise.resolve({ data: [], error: null } as any),
      ids("crop_id").length
        ? db.from("crops").select("id,name,name_ru,name_kz,name_en").in("id", ids("crop_id"))
        : Promise.resolve({ data: [], error: null } as any),
      ids("variety_id").length
        ? db.from("varieties").select("id,name,name_ru,name_kz,name_en").in("id", ids("variety_id"))
        : Promise.resolve({ data: [], error: null } as any),
      ids("reproduction_id").length
        ? db.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").in("id", ids("reproduction_id"))
        : Promise.resolve({ data: [], error: null } as any),
      db.from("ptc_field_progress")
        .select("crop_structure_id,planned_area_ha,actual_completed_ha,status,version")
        .eq("company_id", actor.companyId),
    ]);
    const error = fieldsResult.error || cropsResult.error || varietiesResult.error || reproductionsResult.error || progressResult.error;
    if (error) throw error;
    const map = (items: any[]) => new Map((items || []).map((item) => [String(item.id), item]));
    const fieldById = map(fieldsResult.data || []);
    const cropById = map(cropsResult.data || []);
    const varietyById = map(varietiesResult.data || []);
    const reproductionById = map(reproductionsResult.data || []);
    const progressByStructure = new Map((progressResult.data || []).map((item: any) => [String(item.crop_structure_id), item]));

    const plots = rows.flatMap((row: any) => {
      const crop = cropById.get(String(row.crop_id || ""));
      if (!normalizedNames(crop).some((name) => allowedVegetables.has(name))) return [];
      const field = fieldById.get(String(row.field_id || ""));
      const variety = varietyById.get(String(row.variety_id || ""));
      const reproduction = reproductionById.get(String(row.reproduction_id || ""));
      if (!field || !variety || !reproduction) return [];
      const progress = progressByStructure.get(String(row.id));
      const plannedAreaHa = Number(progress?.planned_area_ha ?? row.area ?? 0);
      if (!(plannedAreaHa > 0)) return [];
      const actualCompletedHa = Number(progress?.actual_completed_ha ?? 0);
      return [{
        cropStructureId: String(row.id),
        fieldId: String(row.field_id),
        fieldName: String(field?.name || "Поле"),
        cropName: displayName(crop, "Овощи"),
        varietyName: displayName(variety),
        reproductionName: displayName(reproduction, String(reproduction?.code || "")),
        plannedAreaHa,
        actualCompletedHa,
        remainingAreaHa: Math.max(0, plannedAreaHa - actualCompletedHa),
        status: String(progress?.status || "active"),
        version: Number(progress?.version || 0),
      }];
    });
    const suggestedCropStructureId = plots.some((plot) =>
      plot.cropStructureId === lastShiftStructureId && plot.status !== "completed")
      ? lastShiftStructureId
      : null;
    plots.sort((left, right) =>
      Number(right.cropStructureId === suggestedCropStructureId)
      - Number(left.cropStructureId === suggestedCropStructureId)
      || left.cropName.localeCompare(right.cropName, "ru")
      || left.fieldName.localeCompare(right.fieldName, "ru", { numeric: true })
      || left.varietyName.localeCompare(right.varietyName, "ru")
    );
    return noStore({
      seasonId: String(season.id),
      seasonYear: Number(season.year),
      suggestedCropStructureId,
      plots,
    });
  } catch (error) {
    return failed(error);
  }
}
