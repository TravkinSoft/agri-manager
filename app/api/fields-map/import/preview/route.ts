import { NextRequest, NextResponse } from "next/server";
import { buildFieldAliasIndex, resolveFieldByPolygonName } from "@/lib/fields-map/matching";
import { fieldsMapErrorResponse, resolveFieldsMapContext } from "@/lib/fields-map/server";
import type { GeoJsonGeometry, ParsedKmlPolygonInput } from "@/lib/types/fields-map";
import { getServiceClient } from "@/lib/supabase/service";

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function isUuidLike(value: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(String(value || "").trim());
}

function parseNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function isValidRing(ring: unknown): boolean {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  return ring.every((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])));
}

function isValidGeometry(geometry: unknown): geometry is GeoJsonGeometry {
  if (!geometry || typeof geometry !== "object") return false;
  const type = (geometry as any).type;
  const coordinates = (geometry as any).coordinates;
  if (type === "Polygon") {
    return Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every((ring) => isValidRing(ring));
  }
  if (type === "MultiPolygon") {
    return (
      Array.isArray(coordinates) &&
      coordinates.length > 0 &&
      coordinates.every((polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every((ring: unknown) => isValidRing(ring)))
    );
  }
  return false;
}

function normalizePolygons(raw: unknown): ParsedKmlPolygonInput[] {
  if (!Array.isArray(raw)) return [];
  const result: ParsedKmlPolygonInput[] = [];
  raw.forEach((item, index) => {
    const row = item as Record<string, unknown>;
    const id = normalizeText(row.id) || `poly-${index + 1}`;
    const name = normalizeText(row.name) || `Полигон ${index + 1}`;
    const geometry = row.geometry;
    if (!isValidGeometry(geometry)) return;
    const area = parseNumber(row.area_ha);
    result.push({
      id,
      name,
      geometry,
      area_ha: area == null ? null : Number(area.toFixed(4)),
    });
  });
  return result;
}

async function resolveSeasonIdForPreview(params: {
  requestedSeasonId: string | null;
  companyId: string;
  supabase: ReturnType<typeof getServiceClient>;
}): Promise<string | null> {
  const { requestedSeasonId, companyId, supabase } = params;
  if (isUuidLike(requestedSeasonId)) {
    const requested = String(requestedSeasonId).trim();
    const existing = await supabase
      .from("seasons")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", requested)
      .eq("archived", false)
      .maybeSingle();
    if (!existing.error && existing.data?.id) return requested;
  }

  const seasonsRes = await supabase
    .from("seasons")
    .select("id,year")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("year", { ascending: false });

  if (seasonsRes.error) {
    return null;
  }
  const seasons = seasonsRes.data || [];
  const season2026 = seasons.find((item: any) => Number(item.year || 0) === 2026);
  if (season2026?.id) return String(season2026.id);
  if (seasons.length > 0) return String(seasons[0].id);
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveFieldsMapContext(request, { write: true });
    const { companyId, supabase, actor } = context;
    const body = await request.json();

    const fileName = normalizeText(body.fileName) || "fields-map-import.kml";
    const kmlText = normalizeText(body.kmlText);
    const polygons = normalizePolygons(body.polygons);
    const seasonId = await resolveSeasonIdForPreview({
      requestedSeasonId: normalizeText(body.seasonId) || null,
      companyId,
      supabase,
    });

    if (!kmlText) {
      return NextResponse.json({ error: "KML content is required" }, { status: 400 });
    }
    if (!polygons.length) {
      return NextResponse.json({ error: "Не найдено валидных полигонов для импорта" }, { status: 400 });
    }

    const fieldsRes = await supabase
      .from("fields")
      .select("id,name,notes")
      .eq("company_id", companyId)
      .eq("archived", false);

    if (fieldsRes.error) {
      return NextResponse.json({ error: fieldsRes.error.message }, { status: 400 });
    }

    const aliasIndex = buildFieldAliasIndex((fieldsRes.data || []) as any[]);
    const matches = polygons.map((polygon) => {
      const resolved = resolveFieldByPolygonName(polygon.name, aliasIndex);
      return {
        polygon_id: polygon.id,
        polygon_name: polygon.name,
        area_ha: polygon.area_ha,
        geometry: polygon.geometry,
        match_status: resolved.status,
        field_id: resolved.field_id,
        field_display_name: resolved.field_display_name,
        candidates: resolved.candidates,
      };
    });

    const matchedCount = matches.filter((item) => item.match_status === "matched").length;
    const unmatchedCount = matches.length - matchedCount;
    const errorCount = matches.filter((item) => item.match_status !== "matched").length;

    const previewPayload = {
      season_id: seasonId,
      polygons: matches,
      generated_at: new Date().toISOString(),
    };

    const insertRes = await supabase
      .from("field_map_imports")
      .insert({
        company_id: companyId,
        source_file_name: fileName,
        source_kml_text: kmlText,
        status: "draft",
        total_polygons: matches.length,
        matched_polygons: matchedCount,
        unmatched_polygons: unmatchedCount,
        error_count: errorCount,
        preview_payload: previewPayload,
        imported_by: actor.id,
        is_active: false,
      })
      .select("id,created_at,status,total_polygons,matched_polygons,unmatched_polygons,error_count")
      .single();

    if (insertRes.error || !insertRes.data?.id) {
      return NextResponse.json({ error: insertRes.error?.message || "Не удалось создать draft импорта" }, { status: 400 });
    }

    return NextResponse.json({
      import_id: String(insertRes.data.id),
      season_id: seasonId,
      file_name: fileName,
      stats: {
        total_polygons: matches.length,
        matched_polygons: matchedCount,
        unmatched_polygons: unmatchedCount,
        error_count: errorCount,
      },
      matches,
    });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}
