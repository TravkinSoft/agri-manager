/** Only the v3 read RPC may use this narrow, read-only schema fallback. */
export function isMissingContourReadSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof message !== "string") return false;

  if (code === "PGRST202" || code === "42883") {
    return /\bget_field_map_contours_v3\b/u.test(message);
  }
  if (code === "42703") {
    return /\b(?:contour_id|contour_version|source_polygon_id|source_polygon_name|source_import_id|source_geometry_geojson|display_name|deleted_at)\b/u.test(message);
  }
  // Permission, session, network and unrelated database failures must stay visible.
  return false;
}
