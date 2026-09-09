import { NextRequest, NextResponse } from "next/server";
import { validateParsedPolygonsForImport } from "@/lib/fields-map/import-validation";
import { fieldsMapErrorResponse, resolveFieldsMapContext } from "@/lib/fields-map/server";
import type { GeoJsonAreaGeometry } from "@/lib/types/fields-map";

const BOUNDARY_ACTIONS = new Set(["replace", "relink", "unlink", "restore"] as const);
type BoundaryAction = "replace" | "relink" | "unlink" | "restore";

function normalizeUuid(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(normalized)
    ? normalized
    : null;
}

function normalizeAction(value: unknown): BoundaryAction | null {
  const action = String(value || "").trim().toLowerCase();
  return BOUNDARY_ACTIONS.has(action as BoundaryAction) ? (action as BoundaryAction) : null;
}

function boundaryMutationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/FIELD_BOUNDARY_(?:CAS_FAILED|TARGET_OCCUPIED|RESTORE_ALREADY_USED)/u.test(message)) {
    return NextResponse.json(
      { error: "Контур уже изменён в другой сессии. Обновите карту и повторите действие." },
      { status: 409 }
    );
  }
  if (/FIELD_BOUNDARY_(?:FIELD_SCOPE_MISMATCH|SOURCE_NOT_FOUND|RESTORE_NOT_ALLOWED)/u.test(message)) {
    return NextResponse.json({ error: "Контур или поле не найдены в текущей компании." }, { status: 404 });
  }
  if (/FIELD_BOUNDARY_(?:ACTION_INVALID|GEOMETRY_REQUIRED|GEOMETRY_INVALID|EXPECTED_ID_REQUIRED)/u.test(message)) {
    return NextResponse.json({ error: "Некорректные параметры изменения контура." }, { status: 400 });
  }
  return fieldsMapErrorResponse(error);
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveFieldsMapContext(request, { mutation: true });
    const { actor, companyId, supabase } = context;
    const body = await request.json();
    const action = normalizeAction(body?.action);
    const fieldId = normalizeUuid(body?.field_id);
    const expectedGeometryId = normalizeUuid(body?.expected_geometry_id);
    const targetFieldId = normalizeUuid(body?.target_field_id);

    if (!action) {
      return NextResponse.json({ error: "Неизвестное действие с контуром." }, { status: 400 });
    }
    if (!fieldId) {
      return NextResponse.json({ error: "Некорректный field_id." }, { status: 400 });
    }
    if ((action === "relink" || action === "restore") && !targetFieldId) {
      return NextResponse.json({ error: "Выберите поле для привязки контура." }, { status: 400 });
    }
    if ((action === "relink" || action === "unlink" || action === "restore") && !expectedGeometryId) {
      return NextResponse.json({ error: "Версия контура не указана. Обновите карту." }, { status: 400 });
    }

    let geometry: GeoJsonAreaGeometry | null = null;
    let areaHa: number | null = null;
    if (action === "replace") {
      const validation = validateParsedPolygonsForImport([
        {
          id: expectedGeometryId || `manual-${fieldId}`,
          name: `Поле ${fieldId}`,
          geometry: body?.geometry,
          area_ha: null,
        },
      ]);
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.error },
          { status: validation.tooLarge ? 413 : 400 }
        );
      }
      geometry = validation.polygons[0].geometry;
      areaHa = validation.polygons[0].area_ha;
    }

    const mutation = await supabase.rpc("mutate_field_boundary_v1", {
      p_company_id: companyId,
      p_actor_id: actor.id,
      p_action: action,
      p_field_id: fieldId,
      p_expected_geometry_id: expectedGeometryId,
      p_target_field_id: targetFieldId,
      p_geometry_geojson: geometry,
      p_area_from_kml_ha: areaHa,
    });
    if (mutation.error) throw new Error(mutation.error.message);

    return NextResponse.json({ boundary: mutation.data });
  } catch (error) {
    return boundaryMutationError(error);
  }
}
