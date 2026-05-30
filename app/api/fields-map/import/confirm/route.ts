import { NextRequest, NextResponse } from "next/server";
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
  field_id: string;
};

function normalizeOverrides(raw: unknown): OverrideRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item as Record<string, unknown>;
      const polygonId = normalizeText(row.polygon_id);
      const fieldId = normalizeText(row.field_id);
      if (!polygonId || !isUuidLike(fieldId)) return null;
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
        candidates: Array.isArray(row.candidates) ? row.candidates : [],
      } as FieldMapPreviewMatch;
    })
    .filter((row): row is FieldMapPreviewMatch => Boolean(row));
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveFieldsMapContext(request, { write: true });
    const { companyId, supabase, actor } = context;
    const body = await request.json();
    const importId = normalizeText(body.import_id);
    if (!isUuidLike(importId)) {
      return NextResponse.json({ error: "Некорректный import_id" }, { status: 400 });
    }

    const overrides = normalizeOverrides(body.overrides);
    const overrideMap = new Map(overrides.map((item) => [item.polygon_id, item.field_id]));

    const importRes = await supabase
      .from("field_map_imports")
      .select("id,status,source_file_name,preview_payload")
      .eq("id", importId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (importRes.error || !importRes.data?.id) {
      return NextResponse.json({ error: importRes.error?.message || "Импорт не найден" }, { status: 404 });
    }

    const previewRows = getPreviewRows(importRes.data.preview_payload);
    if (!previewRows.length) {
      return NextResponse.json({ error: "В import draft нет данных полигонов" }, { status: 400 });
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

    let saved = 0;
    let skipped = 0;
    const unresolved: string[] = [];
    const finalizedRows = [];

    for (const row of previewRows) {
      const overrideFieldId = overrideMap.get(row.polygon_id);
      const resolvedFieldId = isUuidLike(overrideFieldId) ? overrideFieldId : row.field_id;
      if (!resolvedFieldId || !validFieldIds.has(resolvedFieldId)) {
        skipped += 1;
        unresolved.push(row.polygon_name);
        finalizedRows.push({
          ...row,
          final_field_id: null,
          final_status: "skipped",
          final_reason: "field_not_resolved",
        });
        continue;
      }

      const deactivateRes = await supabase
        .from("field_geometries")
        .update({ is_active: false })
        .eq("company_id", companyId)
        .eq("field_id", resolvedFieldId)
        .eq("is_active", true);

      if (deactivateRes.error) {
        skipped += 1;
        unresolved.push(row.polygon_name);
        finalizedRows.push({
          ...row,
          final_field_id: resolvedFieldId,
          final_status: "skipped",
          final_reason: deactivateRes.error.message,
        });
        continue;
      }

      const insertRes = await supabase.from("field_geometries").insert({
        company_id: companyId,
        field_id: resolvedFieldId,
        import_id: importId,
        source_file_name: importRes.data.source_file_name,
        geometry_geojson: row.geometry,
        area_from_kml_ha: row.area_ha == null ? null : Number(row.area_ha),
        imported_at: nowIso,
        imported_by: actor.id,
        is_active: true,
      });

      if (insertRes.error) {
        skipped += 1;
        unresolved.push(row.polygon_name);
        finalizedRows.push({
          ...row,
          final_field_id: resolvedFieldId,
          final_status: "skipped",
          final_reason: insertRes.error.message,
        });
        continue;
      }

      saved += 1;
      finalizedRows.push({
        ...row,
        final_field_id: resolvedFieldId,
        final_status: "saved",
        final_reason: null,
      });
    }

    const totalPolygons = previewRows.length;
    const matchedPolygons = saved;
    const unmatchedPolygons = totalPolygons - saved;
    const finalStatus = saved > 0 ? "imported" : "failed";

    const nextPayload = {
      ...(importRes.data.preview_payload || {}),
      polygons: finalizedRows,
      confirmed_at: nowIso,
      unresolved_polygons: unresolved,
    };

    if (saved > 0) {
      await supabase
        .from("field_map_imports")
        .update({ is_active: false })
        .eq("company_id", companyId)
        .neq("id", importId);
    }

    const updateRes = await supabase
      .from("field_map_imports")
      .update({
        status: finalStatus,
        total_polygons: totalPolygons,
        matched_polygons: matchedPolygons,
        unmatched_polygons: unmatchedPolygons,
        error_count: skipped,
        preview_payload: nextPayload,
        imported_at: nowIso,
        imported_by: actor.id,
        is_active: saved > 0,
      })
      .eq("id", importId)
      .eq("company_id", companyId);

    if (updateRes.error) {
      return NextResponse.json({ error: updateRes.error.message }, { status: 400 });
    }

    return NextResponse.json({
      import_id: importId,
      status: finalStatus,
      saved_polygons: saved,
      skipped_polygons: skipped,
      unresolved_polygons: unresolved,
    });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}
