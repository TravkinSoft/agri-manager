import type { GeoJsonAreaGeometry, GeoJsonLinearRing, GeoJsonPosition } from "@/lib/types/fields-map";

export function contourRings(geometry: GeoJsonAreaGeometry) {
  const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return parts.flatMap((rings, part) => rings.map((ring, index) => ({
    part, ring: index, coordinates: ring,
    label: `Часть ${part + 1} · ${index === 0 ? "внешняя граница" : `отверстие ${index}`}`,
  })));
}

/** Change one ring only. Preserve type, every other part/hole and input object. */
export function replaceContourRing(
  geometry: GeoJsonAreaGeometry | null, part: number, ring: number, positions: GeoJsonPosition[]
): GeoJsonAreaGeometry | null {
  if (positions.length < 3 || positions.length > 999 || positions.some(([lng, lat]) =>
    !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90)) return null;
  const closed: GeoJsonLinearRing = [...positions.map(([lng, lat]) => [lng, lat] as GeoJsonPosition), [...positions[0]]];
  if (!geometry) return part === 0 && ring === 0 ? { type: "Polygon", coordinates: [closed] } : null;
  const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  if (!parts[part]?.[ring]) return null;
  const next = parts.map((rings, p) => rings.map((coordinates, r) => p === part && r === ring
    ? closed : coordinates.map(([lng, lat]) => [lng, lat] as GeoJsonPosition)));
  return geometry.type === "Polygon" ? { type: "Polygon", coordinates: next[0] } : { type: "MultiPolygon", coordinates: next };
}
