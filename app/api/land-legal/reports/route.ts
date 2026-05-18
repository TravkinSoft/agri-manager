import { NextRequest, NextResponse } from "next/server";
import { getBreakdownRowsForCompany, inferOwnerBySourceDocument } from "@/lib/land-legal/breakdown";
import { isUuidLike, normalizeText } from "@/lib/land-legal/normalizers";
import { landLegalErrorResponse, resolveLandLegalContext } from "@/lib/land-legal/server";

type ReportMode = "sowing_by_cadastre" | "by_parcel" | "by_entity" | "mismatches";

const OWNER_NOT_SET_LABEL = "Нет данных";
const DISTRICT_NOT_SET_LABEL = "Нет данных";
const CROP_NOT_SET_LABEL = "Культура не указана";
const CADASTRE_NOT_SET_LABEL = "Нет данных";

function parseMode(value: string | null): ReportMode {
  const raw = normalizeText(value || "sowing_by_cadastre");
  const allowed = new Set<ReportMode>(["sowing_by_cadastre", "by_parcel", "by_entity", "mismatches"]);
  return allowed.has(raw as ReportMode) ? (raw as ReportMode) : "sowing_by_cadastre";
}

export async function GET(request: NextRequest) {
  try {
    const context = await resolveLandLegalContext(request, { write: false });
    const { companyId, supabase } = context;

    const seasonIdRaw = normalizeText(request.nextUrl.searchParams.get("seasonId"));
    const seasonId = isUuidLike(seasonIdRaw) ? seasonIdRaw : null;
    const mode = parseMode(request.nextUrl.searchParams.get("mode"));

    const [dataset, sowingRes, mismatchRes] = await Promise.all([
      getBreakdownRowsForCompany({ supabase, companyId, seasonId }),
      (() => {
        let query = supabase
          .from("v_land_sowing_by_cadastre")
          .select("*")
          .eq("company_id", companyId)
          .order("cadastral_number")
          .order("field_name");
        if (seasonId) query = query.eq("season_id", seasonId);
        return query;
      })(),
      (() => {
        let query = supabase.from("v_land_area_mismatches").select("*").eq("company_id", companyId).order("field_name");
        if (seasonId) query = query.eq("season_id", seasonId);
        return query;
      })(),
    ]);

    if (sowingRes.error) return NextResponse.json({ error: sowingRes.error.message }, { status: 400 });
    if (mismatchRes.error) return NextResponse.json({ error: mismatchRes.error.message }, { status: 400 });

    const fieldDisplayById = new Map(dataset.fields.map((field) => [field.id, field.name]));

    const sowingRows = (sowingRes.data || []).map((row: any) => ({
      ...row,
      field_name: fieldDisplayById.get(String(row.field_id || "")) || row.field_name,
      owner_legal_entity_name:
        row.owner_legal_entity_name || inferOwnerBySourceDocument(row.source_document) || null,
      rural_district: row.rural_district || null,
    }));

    const mismatches = (mismatchRes.data || []).map((row: any) => ({
      ...row,
      field_name: fieldDisplayById.get(String(row.field_id || "")) || row.field_name,
    }));

    const byParcelMap = new Map<
      string,
      {
        cadastral_number: string;
        rural_district: string | null;
        rural_districts: Set<string>;
        declared_area_ha: number;
        linked_area_ha: number;
        fields: Set<string>;
        crops: Set<string>;
      }
    >();

    dataset.cadastresRaw.forEach((parcel: any) => {
      byParcelMap.set(String(parcel.cadastral_number), {
        cadastral_number: String(parcel.cadastral_number),
        rural_district: String(parcel.rural_district || "").trim() || null,
        rural_districts: String(parcel.rural_district || "").trim()
          ? new Set<string>([String(parcel.rural_district).trim()])
          : new Set<string>(),
        declared_area_ha: Number(parcel.declared_area_ha || 0),
        linked_area_ha: 0,
        fields: new Set<string>(),
        crops: new Set<string>(),
      });
    });

    const byEntityMap = new Map<
      string,
      { legal_entity_name: string; area_ha: number; cadastres: Set<string>; fields: Set<string>; crops: Set<string> }
    >();
    dataset.legalEntitiesRaw.forEach((entity: any) => {
      byEntityMap.set(String(entity.name), {
        legal_entity_name: String(entity.name),
        area_ha: 0,
        cadastres: new Set<string>(),
        fields: new Set<string>(),
        crops: new Set<string>(),
      });
    });

    const legalRows = dataset.canonicalLegalRows || dataset.canonicalRows;
    legalRows.forEach((row) => {
      const owner = row.owner_name || inferOwnerBySourceDocument(row.source_document) || OWNER_NOT_SET_LABEL;
      const entity = byEntityMap.get(owner) || {
        legal_entity_name: owner,
        area_ha: 0,
        cadastres: new Set<string>(),
        fields: new Set<string>(),
        crops: new Set<string>(),
      };
      entity.area_ha += Number(row.area_ha || 0);
      if (row.cadastral_number) entity.cadastres.add(row.cadastral_number);
      if (row.field_display_name) entity.fields.add(row.field_display_name);
      if (row.crop_name) entity.crops.add(row.crop_name);
      byEntityMap.set(owner, entity);

      if (row.cadastral_number) {
        const parcel = byParcelMap.get(row.cadastral_number) || {
          cadastral_number: row.cadastral_number,
          rural_district: row.rural_district || null,
          rural_districts: row.rural_district ? new Set<string>([row.rural_district]) : new Set<string>(),
          declared_area_ha: 0,
          linked_area_ha: 0,
          fields: new Set<string>(),
          crops: new Set<string>(),
        };
        parcel.linked_area_ha += Number(row.area_ha || 0);
        if (row.field_display_name) parcel.fields.add(row.field_display_name);
        if (row.crop_name) parcel.crops.add(row.crop_name);
        if (row.rural_district) {
          parcel.rural_districts.add(row.rural_district);
          if (!parcel.rural_district) parcel.rural_district = row.rural_district;
        }
        byParcelMap.set(row.cadastral_number, parcel);
      }
    });

    const byParcel = Array.from(byParcelMap.values())
      .map((row) => ({
        cadastral_number: row.cadastral_number || CADASTRE_NOT_SET_LABEL,
        rural_district: row.rural_district || null,
        rural_districts: Array.from(row.rural_districts).sort((a, b) => a.localeCompare(b, "ru")),
        has_rural_district_conflict: row.rural_districts.size > 1,
        declared_area_ha: row.declared_area_ha,
        linked_area_ha: row.linked_area_ha,
        fields: Array.from(row.fields).sort((a, b) => a.localeCompare(b, "ru")),
        crops: Array.from(row.crops).sort((a, b) => a.localeCompare(b, "ru")),
      }))
      .sort((a, b) => a.cadastral_number.localeCompare(b.cadastral_number, "ru"));

    const byEntity = Array.from(byEntityMap.values())
      .map((row) => ({
        legal_entity_name: row.legal_entity_name || OWNER_NOT_SET_LABEL,
        area_ha: row.area_ha,
        cadastre_count: row.cadastres.size,
        fields: Array.from(row.fields).sort((a, b) => a.localeCompare(b, "ru")),
        crops: Array.from(row.crops).sort((a, b) => a.localeCompare(b, "ru")),
      }))
      .sort((a, b) => b.area_ha - a.area_ha || a.legal_entity_name.localeCompare(b.legal_entity_name, "ru"));

    return NextResponse.json({
      mode,
      sowingRows:
        mode === "mismatches"
          ? []
          : sowingRows.map((row: any) => ({
              ...row,
              owner_legal_entity_name: row.owner_legal_entity_name || OWNER_NOT_SET_LABEL,
              rural_district: row.rural_district || DISTRICT_NOT_SET_LABEL,
              crop_name: row.crop_name || CROP_NOT_SET_LABEL,
            })),
      mismatches,
      byParcel,
      byEntity,
    });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}
