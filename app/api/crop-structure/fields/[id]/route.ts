import { NextRequest, NextResponse } from "next/server";
import { getServerActorFromSession, resolveCompanyForActor, SessionAuthError } from "@/lib/auth/server-session";
import {
  isFallowLandUse,
  validateAndNormalizeCropStructureRows,
  type CropIdentity,
  type CropStructureSeedAttributes,
} from "@/lib/crop-structure/fallow";
import { isPotatoCropContext, normalizeIrrigationType, type IrrigationType } from "@/lib/operations/operation-engine";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDIT_ALLOWED_ROLES = ["global_admin", "agronomist"] as const;
const CROP_STRUCTURE_BASE_SELECT = "id,field_id,land_use_type,crop_id,variety_id,reproduction_id,notes,area,seeding_rate,expected_yield";
const CROP_STRUCTURE_V4_SELECT = `${CROP_STRUCTURE_BASE_SELECT},irrigation_type,row_spacing_m,seed_spacing_cm`;

type InputRow = CropStructureSeedAttributes & {
  id?: string;
  notes?: string | null;
  irrigation_type?: IrrigationType | null;
};

type CropRow = CropIdentity & {
  id: string;
  name: string | null;
  name_ru: string | null;
  name_en: string | null;
  company_id: string | null;
  archived: boolean | null;
  is_active: boolean | null;
};

type VarietyRow = {
  id: string;
  name: string | null;
  crop_id: string;
  company_id: string | null;
  archived: boolean | null;
  is_active: boolean | null;
};

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());

const nullableUuid = (value: unknown): string | null => {
  const normalized = String(value || "").trim();
  return normalized && isUuid(normalized) ? normalized : null;
};

const nullableNumber = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const isVisibleCatalogRow = (
  row: { company_id?: string | null; archived?: boolean | null; is_active?: boolean | null },
  companyId: string
) => (row.company_id == null || row.company_id === companyId) && !row.archived && row.is_active !== false;

const isMissingCropStructureV4Column = (error: unknown) => {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("irrigation_type") ||
    message.includes("row_spacing_m") ||
    message.includes("seed_spacing_cm") ||
    message.includes("schema cache")
  );
};

function parseRows(value: unknown): InputRow[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new SessionAuthError("rows must be an array with at most 100 items", 400);
  }

  return value.map((raw, index) => {
    const row = (raw || {}) as Record<string, unknown>;
    const idValue = String(row.id || "").trim();
    if (idValue && !isUuid(idValue)) {
      throw new SessionAuthError(`Invalid crop structure row id at index ${index}`, 400);
    }

    const cropIdValue = String(row.crop_id || "").trim();
    if (cropIdValue && !isUuid(cropIdValue)) {
      throw new SessionAuthError(`Invalid crop id at index ${index}`, 400);
    }
    const landUseType = String(row.land_use_type || "crop").trim().toLowerCase();
    if (landUseType !== "crop" && landUseType !== "fallow") {
      throw new SessionAuthError(`Invalid land_use_type at index ${index}`, 400);
    }

    for (const [key, value] of [
      ["variety_id", row.variety_id],
      ["reproduction_id", row.reproduction_id],
    ] as const) {
      const normalized = String(value || "").trim();
      if (normalized && !isUuid(normalized)) {
        throw new SessionAuthError(`Invalid ${key} at index ${index}`, 400);
      }
    }

    return {
      ...(idValue ? { id: idValue } : {}),
      land_use_type: landUseType,
      crop_id: nullableUuid(row.crop_id),
      variety_id: nullableUuid(row.variety_id),
      reproduction_id: nullableUuid(row.reproduction_id),
      notes: row.notes == null ? null : String(row.notes).trim().slice(0, 5000) || null,
      area: nullableNumber(row.area),
      irrigation_type: normalizeIrrigationType(row.irrigation_type == null ? null : String(row.irrigation_type)),
      row_spacing_m: nullableNumber(row.row_spacing_m),
      seed_spacing_cm: nullableNumber(row.seed_spacing_cm),
    };
  });
}

function apiError(error: unknown) {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Failed to save crop structure" },
    { status: 500 }
  );
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await getServerActorFromSession(request);
    if (!EDIT_ALLOWED_ROLES.includes(actor.role as (typeof EDIT_ALLOWED_ROLES)[number])) {
      throw new SessionAuthError("Current role cannot edit crop structure", 403);
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new SessionAuthError("Invalid JSON body", 400);

    const fieldId = String(params.id || "").trim();
    const seasonId = String(body.seasonId || "").trim();
    if (!isUuid(fieldId) || !isUuid(seasonId)) {
      throw new SessionAuthError("Valid fieldId and seasonId are required", 400);
    }

    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const requestedRows = parseRows(body.rows);
    const supabase = getServiceClient();

    const [fieldRes, seasonRes, existingRes, activeSeasonsRes] = await Promise.all([
      supabase.from("fields").select("id,company_id,area,archived").eq("id", fieldId).eq("company_id", companyId).maybeSingle(),
      supabase.from("seasons").select("id,company_id,archived").eq("id", seasonId).eq("company_id", companyId).maybeSingle(),
      supabase
        .from("crop_structure")
        .select("id")
        .eq("company_id", companyId)
        .eq("field_id", fieldId)
        .eq("season_id", seasonId)
        .eq("archived", false),
      supabase
        .from("seasons")
        .select("id,year,archived")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("year", { ascending: false }),
    ]);

    const lookupError = fieldRes.error || seasonRes.error || existingRes.error || activeSeasonsRes.error;
    if (lookupError) throw new Error(lookupError.message);
    if (!fieldRes.data || fieldRes.data.archived) throw new SessionAuthError("Field is not available", 404);
    if (!seasonRes.data) throw new SessionAuthError("Season is not available", 404);
    if (seasonRes.data.archived) throw new SessionAuthError("Closed season is read-only", 409);
    const currentYear = new Date().getFullYear();
    const currentSeason =
      (activeSeasonsRes.data || []).find((row: any) => Number(row.year) === currentYear) ||
      (activeSeasonsRes.data || [])[0];
    if (!currentSeason?.id || String(currentSeason.id) !== seasonId) {
      throw new SessionAuthError("Only the current season crop structure can be edited", 409);
    }

    const cropIds = Array.from(new Set(requestedRows.map((row) => row.crop_id).filter((id): id is string => Boolean(id))));
    const varietyIds = Array.from(new Set(requestedRows.map((row) => row.variety_id).filter((id): id is string => Boolean(id))));
    const reproductionIds = Array.from(new Set(requestedRows.map((row) => row.reproduction_id).filter((id): id is string => Boolean(id))));

    const [cropsRes, varietiesRes, reproductionsRes] = await Promise.all([
      cropIds.length
        ? supabase.from("crops").select("id,name,name_ru,name_en,slug,company_id,archived,is_active").in("id", cropIds)
        : Promise.resolve({ data: [], error: null }),
      varietyIds.length
        ? supabase.from("varieties").select("id,name,crop_id,company_id,archived,is_active").in("id", varietyIds)
        : Promise.resolve({ data: [], error: null }),
      reproductionIds.length
        ? supabase.from("seed_reproductions").select("id,company_id,archived,is_active").in("id", reproductionIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const catalogError = cropsRes.error || varietiesRes.error || reproductionsRes.error;
    if (catalogError) throw new Error(catalogError.message);

    const cropsById = new Map(
      ((cropsRes.data || []) as CropRow[])
        .filter((row) => isVisibleCatalogRow(row, companyId))
        .map((row) => [row.id, row])
    );
    const varietiesById = new Map(
      ((varietiesRes.data || []) as VarietyRow[])
        .filter((row) => isVisibleCatalogRow(row, companyId))
        .map((row) => [row.id, row])
    );
    const reproductionIdSet = new Set(
      (reproductionsRes.data || [])
        .filter((row: any) => isVisibleCatalogRow(row, companyId))
        .map((row: any) => String(row.id))
    );

    if (cropIds.some((id) => !cropsById.has(id))) {
      throw new SessionAuthError("Crop is not available for the selected company", 400);
    }
    if (varietyIds.some((id) => !varietiesById.has(id))) {
      throw new SessionAuthError("Variety is not available for the selected company", 400);
    }
    if (reproductionIds.some((id) => !reproductionIdSet.has(id))) {
      throw new SessionAuthError("Reproduction is not available for the selected company", 400);
    }

    const validation = validateAndNormalizeCropStructureRows({
      rows: requestedRows,
      cropsById,
      varietiesById,
      fieldArea: Number(fieldRes.data.area || 0),
    });
    if (!validation.ok) {
      throw new SessionAuthError(validation.message, 400);
    }

    const existingIds = new Set((existingRes.data || []).map((row) => String(row.id)));
    const submittedIds = new Set(validation.rows.map((row) => row.id).filter((id): id is string => Boolean(id)));
    if (Array.from(submittedIds).some((id) => !existingIds.has(id))) {
      throw new SessionAuthError("Crop structure row does not belong to this field and season", 403);
    }

    for (let index = 0; index < validation.rows.length; index += 1) {
      const row = validation.rows[index];
      const crop = row.crop_id ? cropsById.get(row.crop_id) : null;
      if (isFallowLandUse(row.land_use_type)) continue;

      const variety = row.variety_id ? varietiesById.get(row.variety_id) : null;
      const cropLabel = crop?.name_ru || crop?.name || crop?.name_en || "";
      if (isPotatoCropContext(cropLabel, variety?.name || "") && (!row.seed_spacing_cm || row.seed_spacing_cm <= 0)) {
        throw new SessionAuthError("Для картофеля укажите межсемянное расстояние в структуре.", 400);
      }
      if (row.row_spacing_m != null && row.row_spacing_m <= 0) {
        throw new SessionAuthError(`Междурядье должно быть больше нуля в строке ${index + 1}.`, 400);
      }
      if (row.seed_spacing_cm != null && row.seed_spacing_cm <= 0) {
        throw new SessionAuthError(`Межсемянное расстояние должно быть больше нуля в строке ${index + 1}.`, 400);
      }
    }

    const deleteIds = Array.from(existingIds).filter((id) => !submittedIds.has(id));
    if (deleteIds.length) {
      const [operationsRes, consumptionsRes] = await Promise.all([
        supabase.from("operations").select("id", { count: "exact", head: true }).in("crop_structure_id", deleteIds),
        supabase.from("field_material_consumptions").select("id", { count: "exact", head: true }).in("crop_structure_row_id", deleteIds),
      ]);
      const dependencyError = operationsRes.error || consumptionsRes.error;
      if (dependencyError) throw new Error(dependencyError.message);
      if (Number(operationsRes.count || 0) > 0 || Number(consumptionsRes.count || 0) > 0) {
        throw new SessionAuthError("Нельзя удалить участок: у него уже есть операции или материалы.", 409);
      }
    }

    const toPayload = (row: InputRow, includeTechnology: boolean) => {
      const crop = row.crop_id ? cropsById.get(row.crop_id) : null;
      const variety = row.variety_id ? varietiesById.get(row.variety_id) : null;
      const potato = !isFallowLandUse(row.land_use_type) && isPotatoCropContext(
        crop?.name_ru || crop?.name || crop?.name_en || "",
        variety?.name || ""
      );
      return {
        company_id: companyId,
        user_id: actor.id,
        field_id: fieldId,
        season_id: seasonId,
        land_use_type: row.land_use_type || "crop",
        crop_id: row.crop_id,
        variety_id: row.variety_id,
        reproduction_id: row.reproduction_id,
        notes: row.notes || null,
        area: Number(row.area || 0),
        status: "planned",
        archived: false,
        ...(includeTechnology
          ? {
              irrigation_type: normalizeIrrigationType(row.irrigation_type),
              row_spacing_m: row.row_spacing_m ?? (potato ? 0.75 : null),
              seed_spacing_cm: row.seed_spacing_cm ?? null,
            }
          : {}),
      };
    };

    const updates = validation.rows.filter((row) => row.id);
    if (updates.length) {
      let result = await supabase.from("crop_structure").upsert(
        updates.map((row) => ({ id: row.id, ...toPayload(row, true) })),
        { onConflict: "id" }
      );
      if (result.error && isMissingCropStructureV4Column(result.error)) {
        result = await supabase.from("crop_structure").upsert(
          updates.map((row) => ({ id: row.id, ...toPayload(row, false) })),
          { onConflict: "id" }
        );
      }
      if (result.error) throw new Error(result.error.message);
    }

    const inserts = validation.rows.filter((row) => !row.id);
    if (inserts.length) {
      let result = await supabase.from("crop_structure").insert(inserts.map((row) => toPayload(row, true)));
      if (result.error && isMissingCropStructureV4Column(result.error)) {
        result = await supabase.from("crop_structure").insert(inserts.map((row) => toPayload(row, false)));
      }
      if (result.error) throw new Error(result.error.message);
    }

    if (deleteIds.length) {
      const deleteRes = await supabase
        .from("crop_structure")
        .delete()
        .eq("company_id", companyId)
        .eq("field_id", fieldId)
        .eq("season_id", seasonId)
        .in("id", deleteIds);
      if (deleteRes.error) throw new Error(deleteRes.error.message);
    }

    let savedRowsRes: any = await supabase
      .from("crop_structure")
      .select(CROP_STRUCTURE_V4_SELECT)
      .eq("company_id", companyId)
      .eq("field_id", fieldId)
      .eq("season_id", seasonId)
      .eq("archived", false);
    if (savedRowsRes.error && isMissingCropStructureV4Column(savedRowsRes.error)) {
      savedRowsRes = await supabase
        .from("crop_structure")
        .select(CROP_STRUCTURE_BASE_SELECT)
        .eq("company_id", companyId)
        .eq("field_id", fieldId)
        .eq("season_id", seasonId)
        .eq("archived", false);
    }
    if (savedRowsRes.error) throw new Error(savedRowsRes.error.message);

    return NextResponse.json({ companyId, fieldId, seasonId, rows: savedRowsRes.data || [] });
  } catch (error) {
    return apiError(error);
  }
}
