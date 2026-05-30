import { NextRequest, NextResponse } from "next/server";
import { getFieldDisplayName } from "@/lib/fields/display";
import { fieldsMapErrorResponse, resolveFieldsMapContext } from "@/lib/fields-map/server";
import type { FieldMapFieldCard, FieldsMapBootstrapPayload, GeoJsonGeometry } from "@/lib/types/fields-map";
import { getServiceClient } from "@/lib/supabase/service";

function normalizeUuid(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(raw)) return null;
  return raw;
}

async function resolveSeasonId(params: {
  seasonIdParam: string | null;
  companyId: string;
  supabase: ReturnType<typeof getServiceClient>;
}): Promise<{ selectedSeasonId: string | null; seasons: Array<{ id: string; year: number; name: string | null }> }> {
  const { seasonIdParam, companyId, supabase } = params;
  const seasonsRes = await supabase
    .from("seasons")
    .select("id,year,name")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("year", { ascending: false });

  if (seasonsRes.error) {
    throw new Error(seasonsRes.error.message);
  }

  const seasons = ((seasonsRes.data || []) as any[]).map((row) => ({
    id: String(row.id),
    year: Number(row.year || 0),
    name: row.name == null ? null : String(row.name),
  }));

  if (!seasons.length) {
    return { selectedSeasonId: null, seasons };
  }

  const explicitSeasonId = normalizeUuid(seasonIdParam);
  if (explicitSeasonId && seasons.some((item) => item.id === explicitSeasonId)) {
    return { selectedSeasonId: explicitSeasonId, seasons };
  }

  const season2026 = seasons.find((item) => item.year === 2026);
  if (season2026) {
    return { selectedSeasonId: season2026.id, seasons };
  }

  return { selectedSeasonId: seasons[0].id, seasons };
}

type CropRow = {
  field_id: string;
  area: number;
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  crops?: { name?: string | null } | null;
  varieties?: { name?: string | null } | null;
  seed_reproductions?: { name?: string | null } | null;
};

function resolveWorkStatus(operationRows: any[]): FieldMapFieldCard["work_status"] {
  const rows = operationRows || [];
  if (!rows.length) return "not_started";

  const statuses = rows
    .map((row) => String(row?.status || "").trim().toLowerCase())
    .filter(Boolean);

  if (!statuses.length) return "no_data";

  const problemStatuses = new Set(["failed", "cancelled", "blocked", "overdue", "error", "rejected"]);
  if (statuses.some((status) => problemStatuses.has(status))) {
    return "problem";
  }

  const activeStatuses = new Set(["active", "in_progress", "open", "pending", "draft", "assigned"]);
  if (statuses.some((status) => activeStatuses.has(status))) {
    return "in_progress";
  }

  const doneStatuses = new Set(["completed", "verified", "closed", "done", "finished", "finalized"]);
  if (statuses.every((status) => doneStatuses.has(status))) {
    return "completed";
  }

  return "no_data";
}

function buildFieldCards(params: {
  fields: any[];
  geometryRows: any[];
  cropRows: CropRow[];
  operationRows: any[];
}): FieldMapFieldCard[] {
  const { fields, geometryRows, cropRows, operationRows } = params;
  const geometryByField = new Map<string, any>();
  geometryRows.forEach((row) => {
    geometryByField.set(String(row.field_id), row);
  });

  const cropByField = new Map<string, CropRow[]>();
  cropRows.forEach((row) => {
    const key = String(row.field_id || "");
    if (!cropByField.has(key)) cropByField.set(key, []);
    cropByField.get(key)?.push(row);
  });

  const operationsByField = new Map<string, any[]>();
  operationRows.forEach((row) => {
    const key = String(row.field_id || "");
    if (!operationsByField.has(key)) operationsByField.set(key, []);
    operationsByField.get(key)?.push(row);
  });

  return fields.map((field) => {
    const fieldId = String(field.id);
    const displayName = getFieldDisplayName(field);
    const geometryRow = geometryByField.get(fieldId) || null;
    const cropCandidates = cropByField.get(fieldId) || [];
    const mainCrop = [...cropCandidates].sort((a, b) => Number(b.area || 0) - Number(a.area || 0))[0] || null;
    const recentOps = (operationsByField.get(fieldId) || [])
      .sort((a, b) => new Date(String(b.operation_date || b.created_at || 0)).getTime() - new Date(String(a.operation_date || a.created_at || 0)).getTime())
      .slice(0, 3)
      .map((item) => ({
        id: String(item.id),
        operation_type: item.operation_type == null ? null : String(item.operation_type),
        date: item.operation_date == null ? null : String(item.operation_date),
        status: item.status == null ? null : String(item.status),
      }));
    const fieldOperations = operationsByField.get(fieldId) || [];

    return {
      field_id: fieldId,
      field_name: String(field.name || ""),
      field_display_name: displayName,
      field_area_ha: Number(field.area || 0),
      geometry_id: geometryRow ? String(geometryRow.id) : null,
      geometry_area_ha: geometryRow?.area_from_kml_ha == null ? null : Number(geometryRow.area_from_kml_ha),
      geometry: (geometryRow?.geometry_geojson || null) as GeoJsonGeometry | null,
      crop_plan: mainCrop
        ? {
            crop_id: mainCrop.crop_id ? String(mainCrop.crop_id) : null,
            crop_name: mainCrop.crops?.name == null ? null : String(mainCrop.crops.name),
            variety_name: mainCrop.varieties?.name == null ? null : String(mainCrop.varieties.name),
            reproduction_name:
              mainCrop.seed_reproductions?.name == null ? null : String(mainCrop.seed_reproductions.name),
            planned_area_ha: Number(mainCrop.area || 0),
          }
        : null,
      recent_operations: recentOps,
      work_status: resolveWorkStatus(fieldOperations),
    } as FieldMapFieldCard;
  });
}

export async function GET(request: NextRequest) {
  try {
    const context = await resolveFieldsMapContext(request, { write: false });
    const { companyId, supabase } = context;
    const seasonIdParam = request.nextUrl.searchParams.get("seasonId");
    const { selectedSeasonId, seasons } = await resolveSeasonId({ seasonIdParam, companyId, supabase });

    const companyRes = await supabase.from("companies").select("id,name").eq("id", companyId).maybeSingle();
    if (companyRes.error || !companyRes.data?.id) {
      return NextResponse.json({ error: companyRes.error?.message || "Компания не найдена" }, { status: 400 });
    }

    const fieldsRes = await supabase
      .from("fields")
      .select("id,name,area,notes")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("name", { ascending: true });

    if (fieldsRes.error) {
      return NextResponse.json({ error: fieldsRes.error.message }, { status: 400 });
    }

    const geometryRes = await supabase
      .from("field_geometries")
      .select("id,field_id,geometry_geojson,area_from_kml_ha")
      .eq("company_id", companyId)
      .eq("is_active", true);

    if (geometryRes.error) {
      return NextResponse.json({ error: geometryRes.error.message }, { status: 400 });
    }

    let cropRows: CropRow[] = [];
    if (selectedSeasonId) {
      const cropRes = await supabase
        .from("crop_structure")
        .select("field_id,area,crop_id,variety_id,reproduction_id,crops(name),varieties(name),seed_reproductions(name)")
        .eq("company_id", companyId)
        .eq("season_id", selectedSeasonId)
        .eq("archived", false);
      if (!cropRes.error) {
        cropRows = (cropRes.data || []) as CropRow[];
      }
    }

    let operationRows: any[] = [];
    if (selectedSeasonId) {
      const operationsRes = await supabase
        .from("operations")
        .select("id,field_id,operation_type,operation_date,status,created_at")
        .eq("company_id", companyId)
        .eq("season_id", selectedSeasonId)
        .order("operation_date", { ascending: false })
        .limit(300);
      if (!operationsRes.error) {
        operationRows = operationsRes.data || [];
      }
    }

    const payload: FieldsMapBootstrapPayload = {
      company: { id: String(companyRes.data.id), name: String(companyRes.data.name || "") },
      seasons,
      selected_season_id: selectedSeasonId,
      fields: buildFieldCards({
        fields: fieldsRes.data || [],
        geometryRows: geometryRes.data || [],
        cropRows,
        operationRows,
      }),
    };

    return NextResponse.json(payload);
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}
