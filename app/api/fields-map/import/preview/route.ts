import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  FIELD_MAP_MAX_CONFLICT_CANDIDATE_PAIRS,
  FIELD_MAP_MAX_CONFLICT_SEGMENT_COMPLEXITY,
  estimateAreaGeometryConflictComplexity,
  findAreaGeometryConflicts,
} from "@/lib/fields-map/geometry-validation";
import { validateParsedPolygonsForImport } from "@/lib/fields-map/import-validation";
import { parseKmlToGeoJson } from "@/lib/fields-map/kml-server";
import { buildFieldAliasIndex, resolveFieldByPolygonName } from "@/lib/fields-map/matching";
import { fieldsMapErrorResponse, resolveFieldsMapContext } from "@/lib/fields-map/server";
import type { FieldMapPreviewDiagnostics } from "@/lib/types/fields-map";
import { getServiceClient } from "@/lib/supabase/service";

const DEFAULT_MAX_KML_BYTES = 5 * 1024 * 1024;
const configuredMaxBytes = Number(process.env.FIELD_MAP_PREVIEW_MAX_KML_BYTES);
const MAX_KML_BYTES =
  Number.isFinite(configuredMaxBytes) && configuredMaxBytes > 0
    ? Math.min(configuredMaxBytes, 20 * 1024 * 1024)
    : DEFAULT_MAX_KML_BYTES;

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeFileName(value: unknown): string {
  const basename = normalizeText(value).split(/[\\/]/u).pop() || "fields-map-import.kml";
  return basename.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 255);
}

function isUuidLike(value: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(String(value || "").trim());
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
  const requestId = randomUUID();
  const diagnostics: FieldMapPreviewDiagnostics = {
    request_id: requestId,
    preview_status: "error",
    company_id: "",
    season_id: null,
    file_name: "",
    file_size_bytes: 0,
    polygons_received: 0,
    polygons_valid: 0,
    matched_count: 0,
    ambiguous_count: 0,
    unmatched_count: 0,
    error_stage: "request_init",
    error_message: null,
  };

  const previewError = (status: number, message: string, details?: string[]) =>
    NextResponse.json(
      {
        error: message,
        details: details?.slice(0, 20),
        request_id: requestId,
        debug: {
          ...diagnostics,
          preview_status: "error",
          error_message: message,
        },
      },
      { status }
    );

  try {
    const context = await resolveFieldsMapContext(request, { mutation: true });
    const { companyId, supabase, actor } = context;
    diagnostics.company_id = companyId;
    diagnostics.error_stage = "payload_parse";

    const body = await request.json();
    const fileName = normalizeFileName(body?.fileName);
    const kmlText = typeof body?.kmlText === "string" ? body.kmlText.trim() : "";

    diagnostics.file_name = fileName;
    diagnostics.file_size_bytes = Buffer.byteLength(kmlText, "utf8");

    if (!fileName || !/\.kml$/iu.test(fileName)) {
      diagnostics.error_stage = "payload_validation";
      return previewError(400, "Разрешены только файлы KML.");
    }
    if (!kmlText) {
      diagnostics.error_stage = "payload_validation";
      return previewError(400, "KML content is required");
    }
    if (diagnostics.file_size_bytes > MAX_KML_BYTES) {
      diagnostics.error_stage = "payload_limit";
      return previewError(413, `KML file is too large. Limit: ${MAX_KML_BYTES} bytes.`);
    }
    diagnostics.error_stage = "server_kml_parse";
    const parsedKml = parseKmlToGeoJson(kmlText);
    if (parsedKml.errors.length > 0) {
      return previewError(400, "KML не прошёл серверную проверку.", parsedKml.errors);
    }

    const validation = validateParsedPolygonsForImport(parsedKml.features);
    if (!validation.ok) {
      diagnostics.error_stage = validation.tooLarge ? "payload_limit" : "geometry_validation";
      return previewError(validation.tooLarge ? 413 : 400, validation.error);
    }
    const polygons = validation.polygons;
    diagnostics.polygons_received = parsedKml.features.length;
    diagnostics.polygons_valid = polygons.length;

    diagnostics.error_stage = "season_resolution";
    const seasonId = await resolveSeasonIdForPreview({
      requestedSeasonId: normalizeText(body.seasonId) || null,
      companyId,
      supabase,
    });
    diagnostics.season_id = seasonId;

    diagnostics.error_stage = "fields_lookup";
    const snapshotRes = await supabase.rpc("get_field_map_snapshot_v1", {
      p_company_id: companyId,
    });
    if (snapshotRes.error) {
      return previewError(400, snapshotRes.error.message);
    }
    const snapshotPayload = (snapshotRes.data || {}) as {
      fields?: Array<{ id: string; name: string; area: number | null; notes: string | null }>;
      revision?: Record<string, unknown>;
    };
    const snapshotFields = Array.isArray(snapshotPayload.fields) ? snapshotPayload.fields : [];
    if (!snapshotPayload.revision || typeof snapshotPayload.revision !== "object") {
      return previewError(409, "Не удалось зафиксировать ревизию карты для безопасного preview.");
    }

    diagnostics.error_stage = "matching";
    const aliasIndex = buildFieldAliasIndex(snapshotFields as any[]);
    const conflictComplexity = estimateAreaGeometryConflictComplexity(polygons);
    if (
      conflictComplexity.candidatePairs > FIELD_MAP_MAX_CONFLICT_CANDIDATE_PAIRS ||
      conflictComplexity.segmentComplexity > FIELD_MAP_MAX_CONFLICT_SEGMENT_COMPLEXITY
    ) {
      diagnostics.error_stage = "geometry_complexity";
      return previewError(413, "KML содержит слишком много потенциально пересекающихся контуров для одного запроса.");
    }
    const conflicts = findAreaGeometryConflicts(polygons);
    const conflictsByPolygonId = new Map<string, Set<string>>();
    conflicts.forEach((conflict) => {
      if (!conflictsByPolygonId.has(conflict.firstId)) {
        conflictsByPolygonId.set(conflict.firstId, new Set<string>());
      }
      if (!conflictsByPolygonId.has(conflict.secondId)) {
        conflictsByPolygonId.set(conflict.secondId, new Set<string>());
      }
      conflictsByPolygonId.get(conflict.firstId)?.add(conflict.secondId);
      conflictsByPolygonId.get(conflict.secondId)?.add(conflict.firstId);
    });
    const matches = polygons.map((polygon) => {
      const conflictPolygonIds = Array.from(conflictsByPolygonId.get(polygon.id) || []).sort();
      const resolved = resolveFieldByPolygonName(polygon.name, aliasIndex, {
        area_ha: polygon.area_ha,
        conflict_polygon_ids: conflictPolygonIds,
      });
      return {
        polygon_id: polygon.id,
        polygon_name: polygon.name,
        area_ha: polygon.area_ha,
        geometry: polygon.geometry,
        match_status: resolved.status,
        match_stage: resolved.stage,
        confidence_score: resolved.confidence_score,
        matched_by: resolved.matched_by,
        field_id: resolved.field_id,
        field_display_name: resolved.field_display_name,
        suggested_field_id: resolved.suggested_field_id,
        reason_codes: resolved.reason_codes,
        conflict_polygon_ids: conflictPolygonIds,
        candidates: resolved.candidates,
      };
    });

    const matchedCount = matches.filter((item) => item.match_status === "matched").length;
    const ambiguousCount = matches.filter((item) => item.match_status === "ambiguous").length;
    const unmatchedCount = matches.length - matchedCount;
    const errorCount = matches.filter((item) => item.match_status !== "matched").length;

    diagnostics.matched_count = matchedCount;
    diagnostics.ambiguous_count = ambiguousCount;
    diagnostics.unmatched_count = unmatchedCount;

    const successDebug: FieldMapPreviewDiagnostics = {
      ...diagnostics,
      preview_status: "success",
      error_stage: null,
      error_message: null,
    };

    const previewPayload = {
      season_id: seasonId,
      polygons: matches,
      map_revision: snapshotPayload.revision,
      generated_at: new Date().toISOString(),
      debug: successDebug,
    };

    diagnostics.error_stage = "draft_insert";
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
      const message = insertRes.error?.message || "Failed to create field map import draft";
      if (/field_map_imports|schema cache|could not find the table/i.test(message)) {
        throw new Error(message);
      }
      return previewError(400, message);
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
      debug: successDebug,
    });
  } catch (error) {
    diagnostics.error_stage = diagnostics.error_stage || "unexpected";
    diagnostics.error_message = error instanceof Error ? error.message : "Unknown error";
    console.error("[fields-map.preview] failed", {
      request_id: requestId,
      stage: diagnostics.error_stage,
      company_id: diagnostics.company_id,
      error: diagnostics.error_message,
    });
    return fieldsMapErrorResponse(error);
  }
}
