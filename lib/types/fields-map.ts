export type GeoJsonPosition = [number, number];
export type GeoJsonLinearRing = GeoJsonPosition[];

export type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: GeoJsonLinearRing[];
};

export type GeoJsonMultiPolygon = {
  type: "MultiPolygon";
  coordinates: GeoJsonLinearRing[][];
};

export type GeoJsonGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

export type MapMatchStatus = "matched" | "ambiguous" | "not_found";
export type FieldMapImportStatus = "draft" | "imported" | "archived" | "failed";

export interface ParsedKmlPolygonInput {
  id: string;
  name: string;
  geometry: GeoJsonGeometry;
  area_ha: number | null;
}

export interface FieldMapPreviewMatch {
  polygon_id: string;
  polygon_name: string;
  area_ha: number | null;
  geometry: GeoJsonGeometry;
  match_status: MapMatchStatus;
  field_id: string | null;
  field_display_name: string | null;
  candidates: Array<{
    field_id: string;
    field_display_name: string;
    technical_key: string | null;
  }>;
}

export interface FieldMapImportSummary {
  id: string;
  company_id: string;
  source_file_name: string;
  status: FieldMapImportStatus;
  total_polygons: number;
  matched_polygons: number;
  unmatched_polygons: number;
  error_count: number;
  imported_at: string | null;
  imported_by: string | null;
  imported_by_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FieldMapFieldCard {
  field_id: string;
  field_name: string;
  field_display_name: string;
  field_area_ha: number;
  geometry_id: string | null;
  geometry_area_ha: number | null;
  geometry: GeoJsonGeometry | null;
  crop_plan: {
    crop_id: string | null;
    crop_name: string | null;
    variety_name: string | null;
    reproduction_name: string | null;
    planned_area_ha: number;
  } | null;
  recent_operations: Array<{
    id: string;
    operation_type: string | null;
    date: string | null;
    status: string | null;
  }>;
}

export interface FieldsMapBootstrapPayload {
  company: { id: string; name: string };
  seasons: Array<{ id: string; year: number; name: string | null }>;
  selected_season_id: string | null;
  fields: FieldMapFieldCard[];
}
