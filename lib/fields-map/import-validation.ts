import {
  FIELD_MAP_MAX_POLYGONS_PER_IMPORT,
  FIELD_MAP_MAX_POSITIONS_PER_IMPORT,
  FIELD_MAP_MAX_RINGS_PER_IMPORT,
  FIELD_MAP_MAX_SELF_INTERSECTION_COMPLEXITY,
  estimateRawAreaGeometryComplexity,
  validateAreaGeometry,
} from "@/lib/fields-map/geometry-validation";
import type { ParsedKmlPolygonInput } from "@/lib/types/fields-map";

export type FieldMapImportValidationResult =
  | { ok: true; polygons: ParsedKmlPolygonInput[]; positionCount: number }
  | { ok: false; error: string; tooLarge: boolean };

export function validateParsedPolygonsForImport(
  polygons: readonly ParsedKmlPolygonInput[]
): FieldMapImportValidationResult {
  if (polygons.length === 0) {
    return { ok: false, error: "В KML не найдено валидных полигонов для импорта.", tooLarge: false };
  }
  if (polygons.length > FIELD_MAP_MAX_POLYGONS_PER_IMPORT) {
    return {
      ok: false,
      error: `Превышен предел полигонов в одном импорте: ${FIELD_MAP_MAX_POLYGONS_PER_IMPORT}.`,
      tooLarge: true,
    };
  }

  const seenIds = new Set<string>();
  const validatedRows: ParsedKmlPolygonInput[] = [];
  let totalPositions = 0;
  let totalRings = 0;
  let totalSelfIntersectionComplexity = 0;

  for (let index = 0; index < polygons.length; index += 1) {
    const row = polygons[index];
    const id = String(row?.id || "").trim();
    const name = String(row?.name || "").trim() || `Полигон ${index + 1}`;
    if (!id) {
      return { ok: false, error: `${name}: отсутствует идентификатор полигона.`, tooLarge: false };
    }
    if (seenIds.has(id)) {
      return { ok: false, error: `${name}: идентификатор полигона ${id} повторяется.`, tooLarge: false };
    }
    seenIds.add(id);

    const complexity = estimateRawAreaGeometryComplexity(row?.geometry);
    totalPositions += complexity.positionCount;
    totalRings += complexity.ringCount;
    totalSelfIntersectionComplexity += complexity.selfIntersectionComplexity;
    if (
      totalPositions > FIELD_MAP_MAX_POSITIONS_PER_IMPORT ||
      totalRings > FIELD_MAP_MAX_RINGS_PER_IMPORT ||
      totalSelfIntersectionComplexity > FIELD_MAP_MAX_SELF_INTERSECTION_COMPLEXITY
    ) {
      return {
        ok: false,
        error: "Геометрия KML слишком сложна для безопасной проверки за один запрос.",
        tooLarge: true,
      };
    }

    const validated = validateAreaGeometry(row?.geometry, name);
    if (!validated.ok) {
      return { ok: false, error: validated.error, tooLarge: false };
    }
    validatedRows.push({
      id,
      name,
      geometry: validated.geometry,
      area_ha: validated.areaHa,
    });
  }

  return { ok: true, polygons: validatedRows, positionCount: totalPositions };
}
