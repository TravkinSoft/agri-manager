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

async function buildProfileName(supabase: any, row: any) {
  const id = normalizeUuid(row?.created_by);
  const names = new Map<string, string>();
  if (!id) return names;
  const res = await supabase.from("profiles").select("id,full_name,email").eq("id", id).maybeSingle();
  if (!res.error && res.data?.id) {
    const label = normalizeText(res.data.full_name) || normalizeText(res.data.email);
    if (label) names.set(String(res.data.id), label);
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

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await resolveFieldsMapContext(request, { write: true });
    const { companyId, supabase } = context;
    const objectId = normalizeUuid(params.id);
    if (!objectId) return NextResponse.json({ error: "Некорректный ID объекта" }, { status: 400 });

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

    const updateRes = await supabase
      .from("field_engineering_objects")
      .update({
        season_id: seasonId,
        field_id: fieldId,
        crop_structure_id: cropStructureId,
        object_type: objectType,
        name,
        description: normalizeText(body.description) || null,
        geometry: normalizedGeometry.geometry,
        geometry_type: normalizedGeometry.geometryType,
        properties: normalizeProperties(body.properties),
      })
      .eq("id", objectId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .select("*")
      .single();

    if (updateRes.error || !updateRes.data?.id) {
      return NextResponse.json({ error: updateRes.error?.message || "Объект не найден" }, { status: 404 });
    }

    const names = await buildProfileName(supabase, updateRes.data);
    return NextResponse.json({ engineering_object: mapEngineeringObjectRow(updateRes.data, names) });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await resolveFieldsMapContext(_request, { write: true });
    const { companyId, supabase } = context;
    const objectId = normalizeUuid(params.id);
    if (!objectId) return NextResponse.json({ error: "Некорректный ID объекта" }, { status: 400 });

    const updateRes = await supabase
      .from("field_engineering_objects")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq("id", objectId)
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (updateRes.error) return NextResponse.json({ error: updateRes.error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}
