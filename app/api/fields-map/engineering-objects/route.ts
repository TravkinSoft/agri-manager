import { NextRequest, NextResponse } from "next/server";
import {
  mapEngineeringObjectRow,
  normalizeEngineeringGeometry,
  normalizeEngineeringObjectType,
  objectTypeSupportsGeometry,
} from "@/lib/fields-map/engineering-objects";
import { fieldsMapErrorResponse, resolveFieldsMapContext } from "@/lib/fields-map/server";

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeUuid(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(raw) ? raw : null;
}

function normalizeProperties(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function buildProfileNames(supabase: any, rows: any[]) {
  const ids = Array.from(new Set(rows.map((row) => String(row.created_by || "")).filter(Boolean)));
  const names = new Map<string, string>();
  if (!ids.length) return names;
  const res = await supabase.from("profiles").select("id,full_name,email").in("id", ids);
  if (!res.error) {
    (res.data || []).forEach((row: any) => {
      const label = normalizeText(row.full_name) || normalizeText(row.email);
      if (label) names.set(String(row.id), label);
    });
  }
  return names;
}

async function assertCompanyFieldLinks(params: {
  supabase: any;
  companyId: string;
  seasonId: string | null;
  fieldId: string | null;
  cropStructureId: string | null;
}) {
  const { supabase, companyId, seasonId, fieldId, cropStructureId } = params;
  if (seasonId) {
    const res = await supabase.from("seasons").select("id").eq("company_id", companyId).eq("id", seasonId).maybeSingle();
    if (res.error || !res.data?.id) return "Сезон не найден в текущей компании";
  }
  if (fieldId) {
    const res = await supabase.from("fields").select("id").eq("company_id", companyId).eq("id", fieldId).maybeSingle();
    if (res.error || !res.data?.id) return "Поле не найдено в текущей компании";
  }
  if (cropStructureId) {
    const res = await supabase
      .from("crop_structure")
      .select("id,field_id,season_id")
      .eq("company_id", companyId)
      .eq("id", cropStructureId)
      .eq("archived", false)
      .maybeSingle();
    if (res.error || !res.data?.id) return "Участок структуры не найден в текущей компании";
    if (fieldId && String(res.data.field_id || "") !== fieldId) return "Участок структуры не относится к выбранному полю";
    if (seasonId && String(res.data.season_id || "") !== seasonId) return "Участок структуры не относится к выбранному сезону";
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const context = await resolveFieldsMapContext(request, { write: false });
    const { companyId, supabase } = context;
    const seasonId = normalizeUuid(request.nextUrl.searchParams.get("seasonId"));

    let query = supabase
      .from("field_engineering_objects")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (seasonId) query = query.or(`season_id.eq.${seasonId},season_id.is.null`);

    const res = await query;
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 400 });

    const rows = res.data || [];
    const names = await buildProfileNames(supabase, rows);
    return NextResponse.json({ engineering_objects: rows.map((row: any) => mapEngineeringObjectRow(row, names)) });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveFieldsMapContext(request, { write: true });
    const { companyId, supabase, actor } = context;
    const body = await request.json();

    const objectType = normalizeEngineeringObjectType(body.object_type);
    const name = normalizeText(body.name);
    const normalizedGeometry = normalizeEngineeringGeometry(body.geometry);
    const seasonId = normalizeUuid(body.season_id);
    const fieldId = normalizeUuid(body.field_id);
    const cropStructureId = normalizeUuid(body.crop_structure_id);

    if (!objectType) return NextResponse.json({ error: "Выберите тип инженерного объекта" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Укажите название объекта" }, { status: 400 });
    if (!normalizedGeometry) return NextResponse.json({ error: "Нарисуйте геометрию объекта на карте" }, { status: 400 });
    if (!objectTypeSupportsGeometry(objectType, normalizedGeometry.geometryType)) {
      return NextResponse.json({ error: "Тип объекта не соответствует выбранной геометрии" }, { status: 400 });
    }

    const linkError = await assertCompanyFieldLinks({ supabase, companyId, seasonId, fieldId, cropStructureId });
    if (linkError) return NextResponse.json({ error: linkError }, { status: 400 });

    const insertRes = await supabase
      .from("field_engineering_objects")
      .insert({
        company_id: companyId,
        season_id: seasonId,
        field_id: fieldId,
        crop_structure_id: cropStructureId,
        object_type: objectType,
        name,
        description: normalizeText(body.description) || null,
        geometry: normalizedGeometry.geometry,
        geometry_type: normalizedGeometry.geometryType,
        properties: normalizeProperties(body.properties),
        created_by: actor.id,
        is_active: true,
      })
      .select("*")
      .single();

    if (insertRes.error || !insertRes.data?.id) {
      return NextResponse.json({ error: insertRes.error?.message || "Не удалось сохранить объект" }, { status: 400 });
    }

    const names = await buildProfileNames(supabase, [insertRes.data]);
    return NextResponse.json({ engineering_object: mapEngineeringObjectRow(insertRes.data, names) });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}
