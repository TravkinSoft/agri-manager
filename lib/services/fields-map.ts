import { supabase } from "@/lib/supabase/client";
import type {
  FieldEngineeringObject,
  FieldEngineeringObjectType,
  FieldMapPreviewDiagnostics,
  FieldsMapBootstrapPayload,
  FieldMapImportSummary,
  FieldMapPreviewMatch,
  GeoJsonGeometry,
  ParsedKmlPolygonInput,
} from "@/lib/types/fields-map";

export class FieldsMapApiError extends Error {
  status: number;
  payload: any;
  constructor(message: string, status: number, payload: any) {
    super(message);
    this.name = "FieldsMapApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function buildAuthHeaders(mode: "json" | "none" = "none") {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error("Session expired");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${data.session.access_token}`,
  };
  if (mode === "json") headers["Content-Type"] = "application/json";
  return headers;
}

async function parseJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const debugMessage = String(payload?.debug?.error_message || payload?.technical || "").trim();
    const requestId = String(payload?.request_id || "").trim();
    const suffix = [debugMessage, requestId ? `request_id=${requestId}` : ""].filter(Boolean).join(" · ");
    throw new FieldsMapApiError(
      `${payload?.error || "Request failed"}${suffix ? ` (${suffix})` : ""}`,
      response.status,
      payload
    );
  }
  return payload;
}

export async function getFieldsMapBootstrap(seasonId?: string) {
  const query = new URLSearchParams();
  if (seasonId) query.set("seasonId", seasonId);
  const headers = await buildAuthHeaders();
  const response = await fetch(`/api/fields-map/bootstrap?${query.toString()}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  return parseJsonOrThrow(response) as Promise<FieldsMapBootstrapPayload>;
}

export async function previewFieldMapImport(payload: {
  fileName: string;
  kmlText: string;
  seasonId?: string | null;
  polygons: ParsedKmlPolygonInput[];
}) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/fields-map/import/preview", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(response) as Promise<{
    import_id: string;
    season_id: string | null;
    file_name: string;
    stats: {
      total_polygons: number;
      matched_polygons: number;
      unmatched_polygons: number;
      error_count: number;
    };
    matches: FieldMapPreviewMatch[];
    debug?: FieldMapPreviewDiagnostics;
  }>;
}

export async function confirmFieldMapImport(payload: {
  import_id: string;
  overrides: Array<{ polygon_id: string; field_id: string }>;
}) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/fields-map/import/confirm", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(response) as Promise<{
    import_id: string;
    status: string;
    saved_polygons: number;
    skipped_polygons: number;
    unresolved_polygons: string[];
  }>;
}

export async function listFieldMapImports() {
  const headers = await buildAuthHeaders();
  const response = await fetch("/api/fields-map/imports", {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = (await parseJsonOrThrow(response)) as { imports: FieldMapImportSummary[] };
  return payload.imports || [];
}

export async function updateFieldMapImportAction(importId: string, action: "activate" | "deactivate" | "delete") {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/fields-map/imports/${encodeURIComponent(importId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ action }),
  });
  return parseJsonOrThrow(response);
}

export async function deleteFieldMapImport(importId: string) {
  const headers = await buildAuthHeaders();
  const response = await fetch(`/api/fields-map/imports/${encodeURIComponent(importId)}`, {
    method: "DELETE",
    headers,
  });
  return parseJsonOrThrow(response);
}

export async function downloadFieldMapImportKml(importId: string) {
  const headers = await buildAuthHeaders();
  const response = await fetch(`/api/fields-map/imports/${encodeURIComponent(importId)}/download`, {
    method: "GET",
    headers,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || "Download failed");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const fileNameMatch = disposition.match(/filename="?([^";]+)"?/iu);
  const fileName = fileNameMatch?.[1] || "fields-map-import.kml";
  return { blob, fileName };
}

export type FieldEngineeringObjectInput = {
  season_id?: string | null;
  field_id?: string | null;
  crop_structure_id?: string | null;
  object_type: FieldEngineeringObjectType;
  name: string;
  description?: string | null;
  geometry: GeoJsonGeometry;
  properties?: Record<string, unknown>;
};

export async function createFieldEngineeringObject(input: FieldEngineeringObjectInput) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/fields-map/engineering-objects", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const payload = (await parseJsonOrThrow(response)) as { engineering_object: FieldEngineeringObject };
  return payload.engineering_object;
}

export async function updateFieldEngineeringObject(objectId: string, input: FieldEngineeringObjectInput) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/fields-map/engineering-objects/${encodeURIComponent(objectId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(input),
  });
  const payload = (await parseJsonOrThrow(response)) as { engineering_object: FieldEngineeringObject };
  return payload.engineering_object;
}

export async function deleteFieldEngineeringObject(objectId: string) {
  const headers = await buildAuthHeaders();
  const response = await fetch(`/api/fields-map/engineering-objects/${encodeURIComponent(objectId)}`, {
    method: "DELETE",
    headers,
  });
  return parseJsonOrThrow(response);
}
