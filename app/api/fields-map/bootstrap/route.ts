import { NextRequest, NextResponse } from "next/server";
import { getFieldDisplayName } from "@/lib/fields/display";
import { mapEngineeringObjectRow } from "@/lib/fields-map/engineering-objects";
import { fieldsMapErrorResponse, resolveFieldsMapContext } from "@/lib/fields-map/server";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import type { FieldEngineeringObject, FieldMapFieldCard, FieldsMapBootstrapPayload, GeoJsonGeometry } from "@/lib/types/fields-map";
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
  id: string;
  field_id: string;
  area: number;
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  crops?: { name?: string | null; name_ru?: string | null; name_kz?: string | null; name_en?: string | null; slug?: string | null } | null;
  varieties?: { name?: string | null } | null;
  seed_reproductions?: { name?: string | null; name_ru?: string | null; name_kz?: string | null; name_en?: string | null; code?: string | null } | null;
};

function isMissingEngineeringObjectsRelation(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message || error || "").toLowerCase();
  return (
    message.includes("field_engineering_objects") &&
    ((message.includes("relation") && message.includes("does not exist")) ||
      message.includes("could not find the table") ||
      message.includes("schema cache"))
  );
}

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

function getProductNameFromRow(row: any): string | null {
  const product = row?.products || row?.product || null;
  return (
    localizedName(product, "ru") ||
    brandName(product) ||
    (row?.product_name_snapshot == null ? null : String(row.product_name_snapshot)) ||
    null
  );
}

function buildFieldCards(params: {
  fields: any[];
  geometryRows: any[];
  cropRows: CropRow[];
  operationRows: any[];
  materialRows: any[];
  harvestRows: any[];
}): FieldMapFieldCard[] {
  const { fields, geometryRows, cropRows, operationRows, materialRows, harvestRows } = params;
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

  const materialsByField = new Map<string, any[]>();
  materialRows.forEach((row) => {
    const key = String(row.field_id || "");
    if (!key) return;
    if (!materialsByField.has(key)) materialsByField.set(key, []);
    materialsByField.get(key)?.push(row);
  });

  const harvestsByField = new Map<string, any[]>();
  harvestRows.forEach((row) => {
    const key = String(row.field_id || "");
    if (!key) return;
    if (!harvestsByField.has(key)) harvestsByField.set(key, []);
    harvestsByField.get(key)?.push(row);
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
        operation_subtype: item.operation_subtype == null ? null : String(item.operation_subtype),
        operation_template: item.operation_template == null ? null : String(item.operation_template),
        crop_structure_id: item.crop_structure_id == null ? null : String(item.crop_structure_id),
        date: item.operation_date == null ? null : String(item.operation_date),
        status: item.status == null ? null : String(item.status),
      }));
    const fieldOperations = operationsByField.get(fieldId) || [];
    const materialSummary = (materialsByField.get(fieldId) || [])
      .sort((a, b) => new Date(String(b.consumed_at || b.created_at || 0)).getTime() - new Date(String(a.consumed_at || a.created_at || 0)).getTime())
      .slice(0, 6)
      .map((item) => ({
        id: String(item.id),
        crop_structure_id: item.crop_structure_row_id == null ? null : String(item.crop_structure_row_id),
        product_name: getProductNameFromRow(item),
        material_category: item.material_category == null ? null : String(item.material_category),
        operation_type: item.operation_type == null ? null : String(item.operation_type),
        quantity_kg: Number(item.quantity_kg || 0),
        area_ha: item.area_ha == null ? null : Number(item.area_ha),
        consumed_at: item.consumed_at == null ? null : String(item.consumed_at),
      }));
    const harvestSummary = (harvestsByField.get(fieldId) || [])
      .sort((a, b) => new Date(String(b.finalized_at || b.created_at || 0)).getTime() - new Date(String(a.finalized_at || a.created_at || 0)).getTime())
      .slice(0, 4)
      .flatMap((ticket) => {
        const lines = Array.isArray(ticket.ticket_lines) && ticket.ticket_lines.length > 0 ? ticket.ticket_lines : [null];
        return lines.slice(0, 3).map((line: any) => ({
          id: String(line?.id || ticket.id),
          ticket_no: ticket.ticket_no == null ? null : String(ticket.ticket_no),
          product_name: line ? getProductNameFromRow(line) : null,
          quantity: line?.quantity == null ? null : Number(line.quantity),
          unit: line?.uom == null ? null : String(line.uom),
          net_weight_kg: ticket.net_weight_kg == null ? null : Number(ticket.net_weight_kg),
          finalized_at: ticket.finalized_at == null ? (ticket.created_at == null ? null : String(ticket.created_at)) : String(ticket.finalized_at),
          status: ticket.status == null ? null : String(ticket.status),
        }));
      })
      .slice(0, 4);

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
            crop_name: localizedName(mainCrop.crops, "ru") || null,
            variety_name: brandName(mainCrop.varieties) || null,
            reproduction_name:
              localizedName(mainCrop.seed_reproductions, "ru", ["name", "code"]) || null,
            planned_area_ha: Number(mainCrop.area || 0),
          }
        : null,
      crop_structure: cropCandidates
        .sort((a, b) => Number(b.area || 0) - Number(a.area || 0))
        .map((row) => ({
          id: String(row.id),
          crop_id: row.crop_id ? String(row.crop_id) : null,
          crop_name: localizedName(row.crops, "ru") || null,
          variety_name: brandName(row.varieties) || null,
          reproduction_name: localizedName(row.seed_reproductions, "ru", ["name", "code"]) || null,
          area_ha: Number(row.area || 0),
        })),
      recent_operations: recentOps,
      material_summary: materialSummary,
      harvest_summary: harvestSummary,
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
    const selectedSeason = seasons.find((item) => item.id === selectedSeasonId) || null;
    const selectedYear = selectedSeason?.year ? Number(selectedSeason.year) : null;

    const companyPromise = supabase.from("companies").select("id,name").eq("id", companyId).maybeSingle();
    const fieldsPromise = supabase
      .from("fields")
      .select("id,name,area,notes")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("name", { ascending: true });
    const geometryPromise = supabase
      .from("field_geometries")
      .select("id,field_id,geometry_geojson,area_from_kml_ha")
      .eq("company_id", companyId)
      .eq("is_active", true);
    const cropPromise = selectedSeasonId
      ? supabase
          .from("crop_structure")
          .select("id,field_id,area,crop_id,variety_id,reproduction_id,crops(name,name_ru,name_kz,name_en,slug),varieties(name),seed_reproductions(name,name_ru,name_kz,name_en,code)")
          .eq("company_id", companyId)
          .eq("season_id", selectedSeasonId)
          .eq("archived", false)
      : Promise.resolve({ data: [], error: null } as any);
    const operationsPromise = selectedYear
      ? supabase
          .from("operations")
          .select("id,field_id,crop_structure_id,operation_type,operation_subtype,operation_template,date,status,work_status,created_at")
          .eq("company_id", companyId)
          .eq("archived", false)
          .gte("date", `${selectedYear}-01-01`)
          .lte("date", `${selectedYear}-12-31`)
          .order("date", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [], error: null } as any);
    const materialPromise = selectedYear
      ? supabase
          .from("field_material_consumptions")
          .select("id,field_id,crop_structure_row_id,operation_id,operation_type,material_category,product_id,quantity_kg,area_ha,consumed_at,created_at,products(name,name_ru,name_en)")
          .eq("company_id", companyId)
          .gte("consumed_at", `${selectedYear}-01-01`)
          .lte("consumed_at", `${selectedYear}-12-31`)
          .order("consumed_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null } as any);
    const harvestPromise = selectedYear
      ? supabase
          .from("tickets")
          .select("id,ticket_no,field_id,status,op_type,net_weight_kg,finalized_at,created_at,is_voided,ticket_lines(id,product_name_snapshot,quantity,uom,products(name,name_ru,name_en))")
          .eq("company_id", companyId)
          .eq("op_type", "harvest_incoming")
          .eq("is_voided", false)
          .gte("created_at", `${selectedYear}-01-01`)
          .lte("created_at", `${selectedYear}-12-31`)
          .order("created_at", { ascending: false })
          .limit(120)
      : Promise.resolve({ data: [], error: null } as any);
    const engineeringPromise = supabase
      .from("field_engineering_objects")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    const [companyRes, fieldsRes, geometryRes, cropRes, operationsRes, materialRes, harvestRes, engineeringRes] = await Promise.all([
      companyPromise,
      fieldsPromise,
      geometryPromise,
      cropPromise,
      operationsPromise,
      materialPromise,
      harvestPromise,
      engineeringPromise,
    ]);
    if (companyRes.error || !companyRes.data?.id) {
      return NextResponse.json({ error: companyRes.error?.message || "Компания не найдена" }, { status: 400 });
    }

    if (fieldsRes.error) {
      return NextResponse.json({ error: fieldsRes.error.message }, { status: 400 });
    }

    if (geometryRes.error) {
      throw new Error(geometryRes.error.message);
    }

    const cropRows: CropRow[] = cropRes.error ? [] : ((cropRes.data || []) as CropRow[]);
    const operationRows: any[] = operationsRes.error
      ? []
      : (operationsRes.data || []).map((row: any) => ({
          ...row,
          operation_date: row.date,
          status: row.work_status || row.status,
        }));
    const materialRows: any[] = materialRes.error ? [] : ((materialRes.data || []) as any[]);
    const harvestRows: any[] = harvestRes.error ? [] : ((harvestRes.data || []) as any[]);
    if (engineeringRes.error && !isMissingEngineeringObjectsRelation(engineeringRes.error)) {
      throw new Error(engineeringRes.error.message);
    }

    const engineeringRows = engineeringRes.error ? [] : ((engineeringRes.data || []) as any[]);
    const profileIds = Array.from(new Set(engineeringRows.map((row) => String(row.created_by || "")).filter(Boolean)));
    const namesByProfileId = new Map<string, string>();
    if (profileIds.length > 0) {
      const profilesRes = await supabase.from("profiles").select("id,full_name,email").in("id", profileIds);
      if (!profilesRes.error) {
        (profilesRes.data || []).forEach((profile: any) => {
          const label = String(profile.full_name || profile.email || "").trim();
          if (label) namesByProfileId.set(String(profile.id), label);
        });
      }
    }
    const engineeringObjects: FieldEngineeringObject[] = engineeringRows.map((row) =>
      mapEngineeringObjectRow(row, namesByProfileId)
    );

    const payload: FieldsMapBootstrapPayload = {
      company: { id: String(companyRes.data.id), name: String(companyRes.data.name || "") },
      seasons,
      selected_season_id: selectedSeasonId,
      fields: buildFieldCards({
        fields: fieldsRes.data || [],
        geometryRows: geometryRes.data || [],
        cropRows,
        operationRows,
        materialRows,
        harvestRows,
      }),
      engineering_objects: engineeringObjects,
    };

    return NextResponse.json(payload);
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}
