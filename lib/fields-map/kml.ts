import type { GeoJsonAreaGeometry, GeoJsonLinearRing, GeoJsonPosition, ParsedKmlPolygonInput } from "@/lib/types/fields-map";

type ParseResult = {
  features: ParsedKmlPolygonInput[];
  errors: string[];
};

function parseCoordinateSequence(raw: string): GeoJsonPosition[] {
  return String(raw || "")
    .trim()
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const [lonRaw, latRaw] = token.split(",");
      const lon = Number(lonRaw);
      const lat = Number(latRaw);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return [lon, lat] as GeoJsonPosition;
    })
    .filter((position): position is GeoJsonPosition => Array.isArray(position));
}

function ensureClosedRing(points: GeoJsonPosition[]): GeoJsonPosition[] {
  if (points.length < 3) return [];
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}

function parsePolygonElement(node: Element): GeoJsonLinearRing[] | null {
  const outerNode = node.querySelector("outerBoundaryIs > LinearRing > coordinates");
  if (!outerNode?.textContent) return null;
  const outerRing = ensureClosedRing(parseCoordinateSequence(outerNode.textContent));
  if (outerRing.length < 4) return null;

  const holes = Array.from(node.querySelectorAll("innerBoundaryIs > LinearRing > coordinates"))
    .map((item) => ensureClosedRing(parseCoordinateSequence(item.textContent || "")))
    .filter((ring) => ring.length >= 4);

  return [outerRing, ...holes];
}

function ringAreaSqMeters(ring: GeoJsonLinearRing): number {
  if (ring.length < 4) return 0;
  const latRef = (ring.reduce((sum, point) => sum + point[1], 0) / ring.length) * (Math.PI / 180);
  const earthRadius = 6378137;
  const projected = ring.map(([lon, lat]) => {
    const x = (lon * Math.PI / 180) * earthRadius * Math.cos(latRef);
    const y = (lat * Math.PI / 180) * earthRadius;
    return [x, y] as [number, number];
  });

  let sum = 0;
  for (let i = 0; i < projected.length - 1; i += 1) {
    const [x1, y1] = projected[i];
    const [x2, y2] = projected[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

function polygonAreaHa(rings: GeoJsonLinearRing[]): number {
  if (!rings.length) return 0;
  const outer = ringAreaSqMeters(rings[0]);
  const holes = rings.slice(1).reduce((sum, ring) => sum + ringAreaSqMeters(ring), 0);
  const squareMeters = Math.max(0, outer - holes);
  return squareMeters / 10000;
}

function geometryAreaHa(geometry: GeoJsonAreaGeometry): number {
  if (geometry.type === "Polygon") {
    return polygonAreaHa(geometry.coordinates);
  }
  return geometry.coordinates.reduce((sum, polygon) => sum + polygonAreaHa(polygon), 0);
}

function cleanPolygonName(value: string | null | undefined, fallback: string): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function parseKmlToGeoJson(kmlText: string): ParseResult {
  const result: ParseResult = { features: [], errors: [] };
  const raw = String(kmlText || "").trim();
  if (!raw) {
    result.errors.push("Файл KML пустой.");
    return result;
  }

  let xml: Document;
  try {
    xml = new DOMParser().parseFromString(raw, "application/xml");
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : "Не удалось разобрать KML.");
    return result;
  }

  const parserError = xml.querySelector("parsererror");
  if (parserError) {
    result.errors.push("Невалидный XML в KML-файле.");
    return result;
  }

  const placemarks = Array.from(xml.getElementsByTagName("Placemark"));
  if (!placemarks.length) {
    result.errors.push("В KML не найдено ни одного Placemark.");
    return result;
  }

  let sequence = 1;
  placemarks.forEach((placemark, placeIndex) => {
    const placeName = cleanPolygonName(
      placemark.getElementsByTagName("name")[0]?.textContent,
      `Поле ${placeIndex + 1}`
    );
    const polygons = Array.from(placemark.getElementsByTagName("Polygon"))
      .map((polygonNode) => parsePolygonElement(polygonNode))
      .filter((item): item is GeoJsonLinearRing[] => Array.isArray(item) && item.length > 0);

    if (!polygons.length) {
      return;
    }

    const geometry: GeoJsonAreaGeometry =
      polygons.length === 1
        ? { type: "Polygon", coordinates: polygons[0] }
        : { type: "MultiPolygon", coordinates: polygons };

    const area = geometryAreaHa(geometry);
    result.features.push({
      id: `poly-${sequence}`,
      name: placeName,
      geometry,
      area_ha: Number.isFinite(area) ? Number(area.toFixed(4)) : null,
    });
    sequence += 1;
  });

  if (!result.features.length) {
    result.errors.push("В KML не найдено валидных полигонов.");
  }

  return result;
}
