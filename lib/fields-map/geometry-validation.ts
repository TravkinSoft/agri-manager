import type {
  GeoJsonAreaGeometry,
  GeoJsonLinearRing,
  GeoJsonPosition,
} from "@/lib/types/fields-map";

export const FIELD_MAP_MAX_POLYGONS_PER_IMPORT = 300;
export const FIELD_MAP_MAX_POSITIONS_PER_IMPORT = 100_000;
export const FIELD_MAP_MAX_POLYGONS_PER_GEOMETRY = 256;
export const FIELD_MAP_MAX_RINGS_PER_POLYGON = 128;
export const FIELD_MAP_MAX_POSITIONS_PER_RING = 1_000;
export const FIELD_MAP_MAX_RINGS_PER_IMPORT = 1_500;
export const FIELD_MAP_MAX_SELF_INTERSECTION_COMPLEXITY = 25_000_000;
export const FIELD_MAP_MAX_CONFLICT_SEGMENT_COMPLEXITY = 200_000_000;
export const FIELD_MAP_MAX_CONFLICT_CANDIDATE_PAIRS = 5_000;

type GeometryValidationSuccess = {
  ok: true;
  geometry: GeoJsonAreaGeometry;
  areaHa: number;
  positionCount: number;
};

type GeometryValidationFailure = {
  ok: false;
  error: string;
};

export type GeometryValidationResult = GeometryValidationSuccess | GeometryValidationFailure;

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const FLOAT_TOLERANCE_FACTOR = 32;

function samePosition(a: GeoJsonPosition, b: GeoJsonPosition): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function coordinateTolerance(...values: number[]): number {
  const scale = Math.max(1, ...values.map((value) => Math.abs(value)));
  return Number.EPSILON * FLOAT_TOLERANCE_FACTOR * scale;
}

function orientationSign(a: GeoJsonPosition, b: GeoJsonPosition, c: GeoJsonPosition): -1 | 0 | 1 {
  const left = (b[0] - a[0]) * (c[1] - a[1]);
  const right = (b[1] - a[1]) * (c[0] - a[0]);
  const determinant = left - right;
  const tolerance =
    Number.EPSILON *
    FLOAT_TOLERANCE_FACTOR *
    Math.max(Number.MIN_VALUE, Math.abs(left) + Math.abs(right));
  if (Math.abs(determinant) <= tolerance) return 0;
  return determinant > 0 ? 1 : -1;
}

function onSegment(a: GeoJsonPosition, b: GeoJsonPosition, point: GeoJsonPosition): boolean {
  if (orientationSign(a, b, point) !== 0) return false;
  const tolerance = coordinateTolerance(a[0], a[1], b[0], b[1], point[0], point[1]);
  return (
    point[0] >= Math.min(a[0], b[0]) - tolerance &&
    point[0] <= Math.max(a[0], b[0]) + tolerance &&
    point[1] >= Math.min(a[1], b[1]) - tolerance &&
    point[1] <= Math.max(a[1], b[1]) + tolerance
  );
}

function segmentsIntersect(
  a: GeoJsonPosition,
  b: GeoJsonPosition,
  c: GeoJsonPosition,
  d: GeoJsonPosition
): boolean {
  const o1 = orientationSign(a, b, c);
  const o2 = orientationSign(a, b, d);
  const o3 = orientationSign(c, d, a);
  const o4 = orientationSign(c, d, b);

  if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4) {
    return true;
  }

  return (
    (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b))
  );
}

function hasCollinearOverlapBeyondPoint(
  a: GeoJsonPosition,
  b: GeoJsonPosition,
  c: GeoJsonPosition,
  d: GeoJsonPosition
): boolean {
  if (
    orientationSign(a, b, c) !== 0 ||
    orientationSign(a, b, d) !== 0 ||
    orientationSign(c, d, a) !== 0 ||
    orientationSign(c, d, b) !== 0
  ) {
    return false;
  }
  const useLongitude = Math.abs(a[0] - b[0]) >= Math.abs(a[1] - b[1]);
  const first = useLongitude ? [a[0], b[0]] : [a[1], b[1]];
  const second = useLongitude ? [c[0], d[0]] : [c[1], d[1]];
  const overlap =
    Math.min(Math.max(...first), Math.max(...second)) -
    Math.max(Math.min(...first), Math.min(...second));
  return overlap > coordinateTolerance(...first, ...second);
}

function ringBounds(ring: GeoJsonLinearRing): Bounds {
  return ring.reduce<Bounds>(
    (bounds, [x, y]) => ({
      minX: Math.min(bounds.minX, x),
      minY: Math.min(bounds.minY, y),
      maxX: Math.max(bounds.maxX, x),
      maxY: Math.max(bounds.maxY, y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
  );
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  const tolerance = coordinateTolerance(
    a.minX,
    a.minY,
    a.maxX,
    a.maxY,
    b.minX,
    b.minY,
    b.maxX,
    b.maxY
  );
  return !(
    a.maxX < b.minX - tolerance ||
    b.maxX < a.minX - tolerance ||
    a.maxY < b.minY - tolerance ||
    b.maxY < a.minY - tolerance
  );
}

function ringSelfIntersects(ring: GeoJsonLinearRing): boolean {
  const segmentCount = ring.length - 1;
  for (let first = 0; first < segmentCount; first += 1) {
    for (let second = first + 1; second < segmentCount; second += 1) {
      const adjacent = Math.abs(first - second) <= 1 || (first === 0 && second === segmentCount - 1);
      if (adjacent) continue;
      if (segmentsIntersect(ring[first], ring[first + 1], ring[second], ring[second + 1])) {
        return true;
      }
    }
  }
  return false;
}

function ringsIntersect(
  a: GeoJsonLinearRing,
  b: GeoJsonLinearRing,
  allowSharedEndpoints = false
): boolean {
  if (!boundsOverlap(ringBounds(a), ringBounds(b))) return false;
  for (let first = 0; first < a.length - 1; first += 1) {
    for (let second = 0; second < b.length - 1; second += 1) {
      if (!segmentsIntersect(a[first], a[first + 1], b[second], b[second + 1])) continue;
      const sharedEndpoint =
        samePosition(a[first], b[second]) ||
        samePosition(a[first], b[second + 1]) ||
        samePosition(a[first + 1], b[second]) ||
        samePosition(a[first + 1], b[second + 1]);
      if (
        !allowSharedEndpoints ||
        !sharedEndpoint ||
        hasCollinearOverlapBeyondPoint(
          a[first],
          a[first + 1],
          b[second],
          b[second + 1]
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function pointInRing(point: GeoJsonPosition, ring: GeoJsonLinearRing): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 2; current < ring.length - 1; previous = current, current += 1) {
    const a = ring[current];
    const b = ring[previous];
    if (onSegment(a, b, point)) return true;
    const crosses =
      (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointOnRing(point: GeoJsonPosition, ring: GeoJsonLinearRing): boolean {
  for (let index = 0; index < ring.length - 1; index += 1) {
    if (onSegment(ring[index], ring[index + 1], point)) return true;
  }
  return false;
}

function ringHasPointStrictlyInside(
  candidate: GeoJsonLinearRing,
  container: GeoJsonLinearRing
): boolean {
  return candidate
    .slice(0, -1)
    .some((point) => !pointOnRing(point, container) && pointInRing(point, container));
}

function pointInPolygonInterior(
  point: GeoJsonPosition,
  polygon: GeoJsonLinearRing[]
): boolean {
  const [outer, ...holes] = polygon;
  if (!outer || pointOnRing(point, outer) || !pointInRing(point, outer)) return false;
  return !holes.some((hole) => pointOnRing(point, hole) || pointInRing(point, hole));
}

function ringHasPointInPolygonInterior(
  candidate: GeoJsonLinearRing,
  polygon: GeoJsonLinearRing[]
): boolean {
  return candidate.slice(0, -1).some((point) => pointInPolygonInterior(point, polygon));
}

function validateRing(raw: unknown, label: string): GeoJsonLinearRing | GeometryValidationFailure {
  if (!Array.isArray(raw) || raw.length < 4) {
    return { ok: false, error: `${label}: контур должен содержать минимум четыре координаты.` };
  }
  if (raw.length > FIELD_MAP_MAX_POSITIONS_PER_RING) {
    return {
      ok: false,
      error: `${label}: превышен предел ${FIELD_MAP_MAX_POSITIONS_PER_RING} координат в одном контуре.`,
    };
  }

  const ring: GeoJsonLinearRing = [];
  for (let index = 0; index < raw.length; index += 1) {
    const point = raw[index];
    if (!Array.isArray(point) || point.length < 2) {
      return { ok: false, error: `${label}: координата ${index + 1} имеет неверный формат.` };
    }
    const lon = point[0];
    const lat = point[1];
    if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      return { ok: false, error: `${label}: координата ${index + 1} должна содержать конечные числа.` };
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      return { ok: false, error: `${label}: координата ${index + 1} выходит за диапазон WGS84.` };
    }
    ring.push([lon, lat]);
  }

  if (!samePosition(ring[0], ring[ring.length - 1])) {
    return { ok: false, error: `${label}: контур не замкнут.` };
  }

  for (let index = 1; index < ring.length; index += 1) {
    if (samePosition(ring[index - 1], ring[index])) {
      return { ok: false, error: `${label}: найдены подряд идущие одинаковые координаты.` };
    }
  }

  const uniqueVertices = new Set(ring.slice(0, -1).map(([lon, lat]) => `${lon}:${lat}`));
  if (uniqueVertices.size < 3) {
    return { ok: false, error: `${label}: контур должен содержать минимум три разные вершины.` };
  }
  if (ringSelfIntersects(ring)) {
    return { ok: false, error: `${label}: контур пересекает сам себя.` };
  }

  return ring;
}

function validatePolygon(raw: unknown, label: string): GeoJsonLinearRing[] | GeometryValidationFailure {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: `${label}: отсутствует внешний контур.` };
  }
  if (raw.length > FIELD_MAP_MAX_RINGS_PER_POLYGON) {
    return {
      ok: false,
      error: `${label}: превышен предел ${FIELD_MAP_MAX_RINGS_PER_POLYGON} контуров.`,
    };
  }

  const rings: GeoJsonLinearRing[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const validated = validateRing(raw[index], `${label}, контур ${index + 1}`);
    if (!Array.isArray(validated)) return validated;
    rings.push(validated);
  }

  const outer = rings[0];
  for (let index = 1; index < rings.length; index += 1) {
    const hole = rings[index];
    if (ringsIntersect(outer, hole) || !pointInRing(hole[0], outer)) {
      return { ok: false, error: `${label}: внутренний контур ${index} выходит за границу поля.` };
    }
    for (let other = index + 1; other < rings.length; other += 1) {
      if (
        ringsIntersect(hole, rings[other], true) ||
        ringHasPointStrictlyInside(hole, rings[other]) ||
        ringHasPointStrictlyInside(rings[other], hole)
      ) {
        return { ok: false, error: `${label}: внутренние контуры ${index} и ${other} пересекаются.` };
      }
    }
  }

  return rings;
}

function ringAreaSqMeters(ring: GeoJsonLinearRing): number {
  const latitudeReference =
    (ring.reduce((sum, point) => sum + point[1], 0) / ring.length) * (Math.PI / 180);
  const earthRadius = 6_378_137;
  const projected = ring.map(([lon, lat]) => [
    (lon * Math.PI / 180) * earthRadius * Math.cos(latitudeReference),
    (lat * Math.PI / 180) * earthRadius,
  ] as const);

  let sum = 0;
  for (let index = 0; index < projected.length - 1; index += 1) {
    const [x1, y1] = projected[index];
    const [x2, y2] = projected[index + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

function polygonAreaHa(rings: GeoJsonLinearRing[]): number {
  const outerArea = ringAreaSqMeters(rings[0]);
  const holesArea = rings.slice(1).reduce((sum, ring) => sum + ringAreaSqMeters(ring), 0);
  return Math.max(0, outerArea - holesArea) / 10_000;
}

function polygonsOverlap(first: GeoJsonLinearRing[], second: GeoJsonLinearRing[]): boolean {
  if (!boundsOverlap(ringBounds(first[0]), ringBounds(second[0]))) return false;
  for (const firstRing of first) {
    for (const secondRing of second) {
      if (ringsIntersect(firstRing, secondRing, true)) return true;
    }
  }
  return (
    ringHasPointInPolygonInterior(first[0], second) ||
    ringHasPointInPolygonInterior(second[0], first)
  );
}

export function validateAreaGeometry(raw: unknown, label = "Геометрия"): GeometryValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: `${label}: геометрия отсутствует.` };
  }

  const candidate = raw as { type?: unknown; coordinates?: unknown };
  const rawPolygons =
    candidate.type === "Polygon"
      ? [candidate.coordinates]
      : candidate.type === "MultiPolygon"
        ? candidate.coordinates
        : null;

  if (!Array.isArray(rawPolygons) || rawPolygons.length === 0) {
    return { ok: false, error: `${label}: поддерживаются только Polygon и MultiPolygon.` };
  }
  if (rawPolygons.length > FIELD_MAP_MAX_POLYGONS_PER_GEOMETRY) {
    return {
      ok: false,
      error: `${label}: превышен предел ${FIELD_MAP_MAX_POLYGONS_PER_GEOMETRY} частей одного поля.`,
    };
  }

  const polygons: GeoJsonLinearRing[][] = [];
  let positionCount = 0;
  for (let index = 0; index < rawPolygons.length; index += 1) {
    const polygon = validatePolygon(rawPolygons[index], `${label}, часть ${index + 1}`);
    if (!Array.isArray(polygon)) return polygon;
    positionCount += polygon.reduce((sum, ring) => sum + ring.length, 0);
    if (positionCount > FIELD_MAP_MAX_POSITIONS_PER_IMPORT) {
      return {
        ok: false,
        error: `${label}: превышен предел ${FIELD_MAP_MAX_POSITIONS_PER_IMPORT} координат.`,
      };
    }
    polygons.push(polygon);
  }

  for (let first = 0; first < polygons.length; first += 1) {
    for (let second = first + 1; second < polygons.length; second += 1) {
      if (polygonsOverlap(polygons[first], polygons[second])) {
        return { ok: false, error: `${label}: части ${first + 1} и ${second + 1} пересекаются.` };
      }
    }
  }

  const areaHa = polygons.reduce((sum, polygon) => sum + polygonAreaHa(polygon), 0);
  if (!Number.isFinite(areaHa) || areaHa <= 0.000001) {
    return { ok: false, error: `${label}: площадь должна быть больше нуля.` };
  }

  const geometry: GeoJsonAreaGeometry =
    candidate.type === "Polygon"
      ? { type: "Polygon", coordinates: polygons[0] }
      : { type: "MultiPolygon", coordinates: polygons };

  return {
    ok: true,
    geometry,
    areaHa: Number(areaHa.toFixed(4)),
    positionCount,
  };
}

export type AreaGeometryConflict = {
  firstId: string;
  secondId: string;
  kind: "interior_overlap";
};

type AreaGeometryFeature = {
  id: string;
  geometry: GeoJsonAreaGeometry;
};

function geometryPolygons(geometry: GeoJsonAreaGeometry): GeoJsonLinearRing[][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

export function estimateRawAreaGeometryComplexity(raw: unknown): {
  positionCount: number;
  ringCount: number;
  selfIntersectionComplexity: number;
} {
  const candidate = raw as { type?: unknown; coordinates?: unknown } | null;
  const rawPolygons = candidate?.type === "Polygon"
    ? [candidate.coordinates]
    : candidate?.type === "MultiPolygon"
      ? candidate.coordinates
      : [];
  let positionCount = 0;
  let ringCount = 0;
  let selfIntersectionComplexity = 0;
  if (!Array.isArray(rawPolygons)) {
    return { positionCount, ringCount, selfIntersectionComplexity };
  }
  for (const rawPolygon of rawPolygons) {
    if (!Array.isArray(rawPolygon)) continue;
    for (const rawRing of rawPolygon) {
      if (!Array.isArray(rawRing)) continue;
      const positions = rawRing.length;
      positionCount += positions;
      ringCount += 1;
      const segments = Math.max(0, positions - 1);
      selfIntersectionComplexity += segments * segments;
    }
  }
  return { positionCount, ringCount, selfIntersectionComplexity };
}

export function countAreaGeometryPositions(geometry: GeoJsonAreaGeometry): number {
  return geometryPolygons(geometry).reduce(
    (total, polygon) => total + polygon.reduce((sum, ring) => sum + ring.length, 0),
    0
  );
}

function mergeBounds(bounds: Bounds[]): Bounds | null {
  if (!bounds.length) return null;
  return bounds.reduce((combined, current) => ({
    minX: Math.min(combined.minX, current.minX),
    minY: Math.min(combined.minY, current.minY),
    maxX: Math.max(combined.maxX, current.maxX),
    maxY: Math.max(combined.maxY, current.maxY),
  }));
}

/** Cheap, deterministic budget estimate performed before pairwise conflict work. */
export function estimateAreaGeometryConflictComplexity(
  features: readonly AreaGeometryFeature[]
): { candidatePairs: number; segmentComplexity: number } {
  const prepared = features.map((feature) => {
    const polygons = geometryPolygons(feature.geometry);
    return {
      bounds: mergeBounds(polygons.map((polygon) => ringBounds(polygon[0]))),
      segments: polygons.reduce(
        (total, polygon) => total + polygon.reduce(
          (ringTotal, ring) => ringTotal + Math.max(0, ring.length - 1),
          0
        ),
        0
      ),
    };
  });
  let candidatePairs = 0;
  let segmentComplexity = 0;
  for (let first = 0; first < prepared.length; first += 1) {
    for (let second = first + 1; second < prepared.length; second += 1) {
      const left = prepared[first];
      const right = prepared[second];
      if (!left.bounds || !right.bounds || !boundsHaveInteriorOverlap(left.bounds, right.bounds)) continue;
      candidatePairs += 1;
      segmentComplexity += left.segments * right.segments;
    }
  }
  return { candidatePairs, segmentComplexity };
}

function boundsHaveInteriorOverlap(first: Bounds, second: Bounds): boolean {
  const tolerance = coordinateTolerance(
    first.minX,
    first.minY,
    first.maxX,
    first.maxY,
    second.minX,
    second.minY,
    second.maxX,
    second.maxY
  );
  return (
    Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX) > tolerance &&
    Math.min(first.maxY, second.maxY) - Math.max(first.minY, second.minY) > tolerance
  );
}

function segmentsProperlyIntersect(
  a: GeoJsonPosition,
  b: GeoJsonPosition,
  c: GeoJsonPosition,
  d: GeoJsonPosition
): boolean {
  const o1 = orientationSign(a, b, c);
  const o2 = orientationSign(a, b, d);
  const o3 = orientationSign(c, d, a);
  const o4 = orientationSign(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

function ringsProperlyIntersect(first: GeoJsonLinearRing, second: GeoJsonLinearRing): boolean {
  if (!boundsHaveInteriorOverlap(ringBounds(first), ringBounds(second))) return false;
  for (let firstIndex = 0; firstIndex < first.length - 1; firstIndex += 1) {
    for (let secondIndex = 0; secondIndex < second.length - 1; secondIndex += 1) {
      if (
        segmentsProperlyIntersect(
          first[firstIndex],
          first[firstIndex + 1],
          second[secondIndex],
          second[secondIndex + 1]
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function ringsShareTheSameBoundary(first: GeoJsonLinearRing, second: GeoJsonLinearRing): boolean {
  const firstOpen = first.slice(0, -1);
  const secondOpen = second.slice(0, -1);
  if (firstOpen.length < 3 || secondOpen.length < 3) return false;
  return (
    firstOpen.every((point) => pointOnRing(point, second)) &&
    secondOpen.every((point) => pointOnRing(point, first))
  );
}

function polygonInteriorsOverlap(
  first: GeoJsonLinearRing[],
  second: GeoJsonLinearRing[]
): boolean {
  const firstOuter = first[0];
  const secondOuter = second[0];
  if (!firstOuter || !secondOuter) return false;
  if (!boundsHaveInteriorOverlap(ringBounds(firstOuter), ringBounds(secondOuter))) return false;

  if (ringsProperlyIntersect(firstOuter, secondOuter)) return true;
  if (ringHasPointInPolygonInterior(firstOuter, second)) return true;
  if (ringHasPointInPolygonInterior(secondOuter, first)) return true;
  return ringsShareTheSameBoundary(firstOuter, secondOuter);
}

/**
 * Finds positive-area conflicts between separate source features. Shared
 * endpoints and borders are deliberately ignored, so adjacent fields are not
 * demoted merely because their cadastral boundaries touch.
 */
export function findAreaGeometryConflicts(
  features: readonly AreaGeometryFeature[]
): AreaGeometryConflict[] {
  const prepared = features.map((feature) => ({
    id: String(feature.id),
    polygons: geometryPolygons(feature.geometry),
  }));
  const conflicts: AreaGeometryConflict[] = [];

  for (let firstIndex = 0; firstIndex < prepared.length; firstIndex += 1) {
    const first = prepared[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < prepared.length; secondIndex += 1) {
      const second = prepared[secondIndex];
      const overlaps = first.polygons.some((firstPolygon) =>
        second.polygons.some((secondPolygon) => polygonInteriorsOverlap(firstPolygon, secondPolygon))
      );
      if (overlaps) {
        conflicts.push({
          firstId: first.id,
          secondId: second.id,
          kind: "interior_overlap",
        });
      }
    }
  }

  return conflicts;
}
