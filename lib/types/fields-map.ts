export type GeoJsonPosition = [number, number];
export type GeoJsonLinearRing = GeoJsonPosition[];

export type GeoJsonPoint = {
  type: "Point";
  coordinates: GeoJsonPosition;
};

export type GeoJsonLineString = {
  type: "LineString";
  coordinates: GeoJsonPosition[];
};

export type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: GeoJsonLinearRing[];
};

export type GeoJsonMultiPolygon = {
  type: "MultiPolygon";
  coordinates: GeoJsonLinearRing[][];
};

export type GeoJsonGeometry = GeoJsonPoint | GeoJsonLineString | GeoJsonPolygon | GeoJsonMultiPolygon;
export type GeoJsonAreaGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

export type MapMatchStatus = "matched" | "ambiguous" | "not_found";
export type MapMatchStage = "auto_matched" | "manual_required" | "unmatched";
export type FieldMapImportStatus = "draft" | "imported" | "archived" | "failed";

export interface ParsedKmlPolygonInput {
  id: string;
  name: string;
  geometry: GeoJsonAreaGeometry;
  area_ha: number | null;
}

export interface FieldMapPreviewMatch {
  polygon_id: string;
  polygon_name: string;
  area_ha: number | null;
  geometry: GeoJsonAreaGeometry;
  match_status: MapMatchStatus;
  match_stage: MapMatchStage;
  confidence_score: number;
  matched_by: string | null;
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
  crop_structure: Array<{
    id: string;
    crop_id: string | null;
    crop_name: string | null;
    variety_name: string | null;
    reproduction_name: string | null;
    area_ha: number;
  }>;
  recent_operations: Array<{
    id: string;
    operation_type: string | null;
    operation_subtype: string | null;
    operation_template: string | null;
    crop_structure_id: string | null;
    date: string | null;
    status: string | null;
  }>;
  material_summary: Array<{
    id: string;
    crop_structure_id: string | null;
    product_name: string | null;
    material_category: string | null;
    operation_type: string | null;
    quantity_kg: number;
    area_ha: number | null;
    consumed_at: string | null;
  }>;
  harvest_summary: Array<{
    id: string;
    ticket_no: string | null;
    product_name: string | null;
    quantity: number | null;
    unit: string | null;
    net_weight_kg: number | null;
    finalized_at: string | null;
    status: string | null;
  }>;
  work_status: "not_started" | "in_progress" | "completed" | "problem" | "no_data";
}

export type FieldEngineeringObjectType =
  | "pond"
  | "pump_station"
  | "main_pipe"
  | "layflat_hose"
  | "hydrant"
  | "drip_tape"
  | "irrigation_zone"
  | "mixing_tank"
  | "fertigation_point"
  | "well"
  | "connection_point"
  | "technical_boundary"
  | "technical_zone"
  | "flag"
  | "other";

export type FieldEngineeringGeometryType = "Point" | "LineString" | "Polygon";

export interface FieldEngineeringObject {
  id: string;
  company_id: string;
  season_id: string | null;
  field_id: string | null;
  crop_structure_id: string | null;
  object_type: FieldEngineeringObjectType;
  name: string;
  description: string | null;
  geometry: GeoJsonGeometry;
  geometry_type: FieldEngineeringGeometryType;
  properties: Record<string, unknown>;
  is_active: boolean;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface FieldsMapBootstrapPayload {
  company: { id: string; name: string };
  seasons: Array<{ id: string; year: number; name: string | null }>;
  selected_season_id: string | null;
  fields: FieldMapFieldCard[];
  engineering_objects: FieldEngineeringObject[];
}

export interface FieldMapPreviewDiagnostics {
  request_id: string;
  preview_status: "success" | "error";
  company_id: string;
  season_id: string | null;
  file_name: string;
  file_size_bytes: number;
  polygons_received: number;
  polygons_valid: number;
  matched_count: number;
  ambiguous_count: number;
  unmatched_count: number;
  error_stage: string | null;
  error_message: string | null;
}
