import { NextRequest, NextResponse } from "next/server";
import { validateParsedPolygonsForImport } from "@/lib/fields-map/import-validation";
import { fieldsMapErrorResponse, resolveFieldsMapContext } from "@/lib/fields-map/server";
import type { FieldMapPreviewMatch } from "@/lib/types/fields-map";

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function isUuidLike(value: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(String(value || "").trim());
}

function toNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

type OverrideRow = {
  polygon_id: string;
  field_id: string | null;
};

function normalizeOverrides(raw: unknown): OverrideRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item as Record<string, unknown>;
      const polygonId = normalizeText(row.polygon_id);
      const fieldId = row.field_id === null ? null : normalizeText(row.field_id);
      if (!polygonId || (fieldId !== null && !isUuidLike(fieldId))) return null;
      return { polygon_id: polygonId, field_id: fieldId };
    })
    .filter((item): item is OverrideRow => Boolean(item));
}

function getPreviewRows(payload: unknown): FieldMapPreviewMatch[] {
  const polygons = (payload as any)?.polygons;
  if (!Array.isArray(polygons)) return [];
  return polygons
    .map((item) => {
      const row = item as Record<string, any>;
      if (!row || typeof row !== "object") return null;
      const polygonId = normalizeText(row.polygon_id || row.id);
      if (!polygonId) return null;
      const polygonName = normalizeText(row.polygon_name || row.name) || polygonId;
      const geometry = row.geometry;
      if (!geometry || typeof geometry !== "object") return null;
      return {
        polygon_id: polygonId,
        polygon_name: polygonName,
        area_ha: toNumber(row.area_ha),
        geometry,
        match_status: row.match_status || "not_found",
        match_stage:
          row.match_stage === "auto_matched"
            ? "auto_matched"
            : row.match_stage === "manual_required"
              ? "manual_required"
              : "unmatched",
        confidence_score: Number.isFinite(Number(row.confidence_score)) ? Number(row.confidence_score) : 0,
        matched_by: normalizeText(row.matched_by) || null,
        field_id: isUuidLike(row.field_id) ? String(row.field_id) : null,
        field_display_name: normalizeText(row.field_display_name) || null,
        suggested_field_id: isUuidLike(row.suggested_field_id) ? String(row.suggested_field_id) : null,
        reason_codes: Array.isArray(row.reason_codes)
          ? row.reason_codes.map((value: unknown) => normalizeText(value)).filter(Boolean).slice(0, 12)
          : [],
        conflict_polygon_ids: Array.isArray(row.conflict_polygon_ids)
          ? row.conflict_polygon_ids.map((value: unknown) => normalizeText(value)).filter(Boolean).slice(0, 50)
          : [],
        candidates: Array.isArray(row.candidates) ? row.candidates : [],
      } as FieldMapPreviewMatch;
    })
    .filter((row): row is FieldMapPreviewMatch => Boolean(row));
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveFieldsMapContext(request, { mutation: true });
    const { companyId, supabase, actor } = context;
    const body = await request.json();
    const importId = normalizeText(body.import_id);
    if (!isUuidLike(importId)) {
      return NextResponse.json({ error: "Некорректный import_id" }, { status: 400 });
    }

    const overrides = normalizeOverrides(body.overrides);
    if (Array.isArray(body.overrides) && overrides.length !== body.overrides.length) {
      return NextResponse.json({ error: "Некорректный формат ручных привязок" }, { status: 400 });
    }
    const duplicateOverrideIds = overrides
      .map((item) => item.polygon_id)
      .filter((polygonId, index, all) => all.indexOf(polygonId) !== index);
    if (duplicateOverrideIds.length > 0) {
      return NextResponse.json(
        { error: `Ручная привязка полигона ${duplicateOverrideIds[0]} указана повторно` },
        { status: 400 }
      );
    }
    const overrideMap = new Map(overrides.map((item) => [item.polygon_id, item.field_id]));

    const importRes = await supabase
      .from("field_map_imports")
      .select("id,status,source_file_name,preview_payload")
      .eq("id", importId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (importRes.error) {
      throw new Error(importRes.error.message);
    }
    if (!importRes.data?.id) {
      return NextResponse.json({ error: "Импорт не найден" }, { status: 404 });
    }
    if (String(importRes.data.status || "") !== "draft") {
      return NextResponse.json(
        { error: "Подтвердить можно только импорт в статусе draft" },
        { status: 409 }
      );
    }
    const expectedRevision = (importRes.data.preview_payload as any)?.map_revision;
    if (!expectedRevision || typeof expectedRevision !== "object" || Array.isArray(expectedRevision)) {
      return NextResponse.json(
        { error: "Import draft не содержит ревизию карты. Выполните preview заново." },
        { status: 409 }
      );
    }

    let previewRows = getPreviewRows(importRes.data.preview_payload);
    if (!previewRows.length) {
      return NextResponse.json({ error: "В import draft нет данных полигонов" }, { status: 400 });
    }
    const geometryValidation = validateParsedPolygonsForImport(
      previewRows.map((row) => ({
        id: row.polygon_id,
        name: row.polygon_name,
        geometry: row.geometry,
        area_ha: row.area_ha,
      }))
    );
    if (!geometryValidation.ok) {
      return NextResponse.json(
        { error: geometryValidation.error },
        { status: geometryValidation.tooLarge ? 413 : 400 }
      );
    }
    const validatedGeometryById = new Map(
      geometryValidation.polygons.map((row) => [row.id, row] as const)
    );
    previewRows = previewRows.map((row) => {
      const validated = validatedGeometryById.get(row.polygon_id);
      return validated
        ? { ...row, geometry: validated.geometry, area_ha: validated.area_ha }
        : row;
    });
    const previewPolygonIds = new Set(previewRows.map((row) => row.polygon_id));
    const unknownOverride = overrides.find((override) => !previewPolygonIds.has(override.polygon_id));
    if (unknownOverride) {
      return NextResponse.json(
        { error: `Полигон ${unknownOverride.polygon_id} отсутствует в import draft` },
        { status: 400 }
      );
    }
    const pendingDecision = previewRows.find(
      (row) => row.match_status !== "matched" && !overrideMap.has(row.polygon_id)
    );
    if (pendingDecision) {
      return NextResponse.json(
        { error: `Для контура ${pendingDecision.polygon_name} не принято явное решение: выберите поле или пропустите контур.` },
        { status: 409 }
      );
    }

    const fieldsRes = await supabase
      .from("fields")
      .select("id")
      .eq("company_id", companyId)
      .eq("archived", false);

    if (fieldsRes.error) {
      return NextResponse.json({ error: fieldsRes.error.message }, { status: 400 });
    }

    const validFieldIds = new Set((fieldsRes.data || []).map((row: any) => String(row.id)));
    const nowIso = new Date().toISOString();
    const unresolved: string[] = [];
    const finalizedRows: Array<FieldMapPreviewMatch & {
      final_field_id: string | null;
      final_status: "saved" | "skipped";
      final_reason: string | null;
    }> = [];
    const resolvedRows: Array<{
      polygon_id: string;
      field_id: string;
      geometry_geojson: FieldMapPreviewMatch["geometry"];
      area_from_kml_ha: number | null;
    }> = [];

    for (const row of previewRows) {
      const hasOverride = overrideMap.has(row.polygon_id);
      const overrideFieldId = overrideMap.get(row.polygon_id);
      const resolvedFieldId = hasOverride
        ? isUuidLike(overrideFieldId) ? overrideFieldId : null
        : row.field_id;
      if (!resolvedFieldId) {
        if (!hasOverride || overrideFieldId !== null) {
          return NextResponse.json(
            { error: `Привязка контура ${row.polygon_name} устарела. Выполните preview заново.` },
            { status: 409 }
          );
        }
        unresolved.push(row.polygon_name);
        finalizedRows.push({
          ...row,
          final_field_id: null,
          final_status: "skipped",
          final_reason: "field_not_resolved",
        });
        continue;
      }
      if (!validFieldIds.has(resolvedFieldId)) {
        return NextResponse.json(
          { error: `Выбранное поле для контура ${row.polygon_name} больше недоступно. Обновите preview.` },
          { status: 409 }
        );
      }
      resolvedRows.push({
        polygon_id: row.polygon_id,
        field_id: resolvedFieldId,
        geometry_geojson: row.geometry,
        area_from_kml_ha: row.area_ha == null ? null : Number(row.area_ha),
      });
      finalizedRows.push({
        ...row,
        final_field_id: resolvedFieldId,
        final_status: "saved",
        final_reason: null,
      });
    }

    const totalPolygons = previewRows.length;
    const matchedPolygons = resolvedRows.length;
    const unmatchedPolygons = totalPolygons - matchedPolygons;
    if (matchedPolygons === 0) {
      return NextResponse.json(
        { error: "Нет подтверждённых привязок. Разрешите хотя бы один контур перед импортом." },
        { status: 400 }
      );
    }

    const fieldToPolygon = new Map<string, string>();
    for (const row of resolvedRows) {
      const existingPolygonId = fieldToPolygon.get(row.field_id);
      if (existingPolygonId) {
        return NextResponse.json(
          {
            error: `Поле ${row.field_id} выбрано для двух контуров (${existingPolygonId} и ${row.polygon_id}). Объедините контуры или оставьте один без привязки.`,
          },
          { status: 409 }
        );
      }
      fieldToPolygon.set(row.field_id, row.polygon_id);
    }

    const nextPayload = {
      ...(importRes.data.preview_payload || {}),
      polygons: finalizedRows,
      confirmed_at: nowIso,
      unresolved_polygons: unresolved,
    };

    const confirmRes = await supabase.rpc("confirm_field_map_import_v2", {
      p_company_id: companyId,
      p_import_id: importId,
      p_actor_id: actor.id,
      p_rows: resolvedRows,
      p_preview_payload: nextPayload,
      p_total_polygons: totalPolygons,
      p_unmatched_polygons: unmatchedPolygons,
      p_error_count: unresolved.length,
      p_expected_revision: expectedRevision,
    });
    if (confirmRes.error) throw new Error(confirmRes.error.message);

    return NextResponse.json({
      import_id: importId,
      status: "imported",
      saved_polygons: matchedPolygons,
      skipped_polygons: unmatchedPolygons,
      unresolved_polygons: unresolved,
    });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}
