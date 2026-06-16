import type {
  FieldEngineeringGeometryType,
  FieldEngineeringObject,
  FieldEngineeringObjectType,
  GeoJsonGeometry,
  GeoJsonPosition,
} from "@/lib/types/fields-map";

export const FIELD_ENGINEERING_OBJECT_TYPES: FieldEngineeringObjectType[] = [
  "pond",
  "pump_station",
  "main_pipe",
  "layflat_hose",
  "hydrant",
  "drip_tape",
  "irrigation_zone",
  "mixing_tank",
  "fertigation_point",
  "well",
  "connection_point",
  "technical_boundary",
  "technical_zone",
  "flag",
  "other",
];

const POINT_TYPES = new Set<FieldEngineeringObjectType>([
  "hydrant",
  "pump_station",
  "mixing_tank",
  "fertigation_point",
  "well",
  "connection_point",
  "flag",
  "other",
]);

const LINE_TYPES = new Set<FieldEngineeringObjectType>([
  "main_pipe",
  "layflat_hose",
  "drip_tape",
  "technical_boundary",
  "other",
]);

const POLYGON_TYPES = new Set<FieldEngineeringObjectType>([
  "pond",
  "irrigation_zone",
  "technical_zone",
  "technical_boundary",
  "other",
]);

export function normalizeEngineeringObjectType(value: unknown): FieldEngineeringObjectType | null {
  const normalized = String(value || "").trim();
  return FIELD_ENGINEERING_OBJECT_TYPES.includes(normalized as FieldEngineeringObjectType)
    ? (normalized as FieldEngineeringObjectType)
    : null;
}

export function objectTypeSupportsGeometry(
  objectType: FieldEngineeringObjectType,
  geometryType: FieldEngineeringGeometryType
): boolean {
  if (geometryType === "Point") return POINT_TYPES.has(objectType);
  if (geometryType === "LineString") return LINE_TYPES.has(objectType);
  if (geometryType === "Polygon") return POLYGON_TYPES.has(objectType);
  return false;
}

function isFinitePosition(value: unknown): value is GeoJsonPosition {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  );
}

function isLine(value: unknown): value is GeoJsonPosition[] {
  return Array.isArray(value) && value.length >= 2 && value.every(isFinitePosition);
}

function isClosedRing(value: unknown): value is GeoJsonPosition[] {
  if (!Array.isArray(value) || value.length < 4 || !value.every(isFinitePosition)) return false;
  const first = value[0];
  const last = value[value.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

export function normalizeEngineeringGeometry(geometry: unknown): {
  geometry: GeoJsonGeometry;
  geometryType: FieldEngineeringGeometryType;
} | null {
  if (!geometry || typeof geometry !== "object") return null;
  const raw = geometry as Record<string, unknown>;
  const type = String(raw.type || "").trim();
  const coordinates = raw.coordinates;

  if (type === "Point" && isFinitePosition(coordinates)) {
    return {
      geometry: { type: "Point", coordinates: [Number(coordinates[0]), Number(coordinates[1])] },
      geometryType: "Point",
    };
  }

  if (type === "LineString" && isLine(coordinates)) {
    return {
      geometry: {
        type: "LineString",
        coordinates: coordinates.map((point) => [Number(point[0]), Number(point[1])] as GeoJsonPosition),
      },
      geometryType: "LineString",
    };
  }

  if (type === "Polygon" && Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(isClosedRing)) {
    return {
      geometry: {
        type: "Polygon",
        coordinates: coordinates.map((ring) =>
          ring.map((point) => [Number(point[0]), Number(point[1])] as GeoJsonPosition)
        ),
      },
      geometryType: "Polygon",
    };
  }

  return null;
}

export function mapEngineeringObjectRow(
  row: any,
  namesByProfileId: Map<string, string> = new Map()
): FieldEngineeringObject {
  const createdBy = row.created_by ? String(row.created_by) : null;
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    season_id: row.season_id ? String(row.season_id) : null,
    field_id: row.field_id ? String(row.field_id) : null,
    crop_structure_id: row.crop_structure_id ? String(row.crop_structure_id) : null,
    object_type: String(row.object_type || "other") as FieldEngineeringObjectType,
    name: String(row.name || ""),
    description: row.description == null ? null : String(row.description),
    geometry: row.geometry as GeoJsonGeometry,
    geometry_type: String(row.geometry_type || "Point") as FieldEngineeringGeometryType,
    properties: row.properties && typeof row.properties === "object" ? (row.properties as Record<string, unknown>) : {},
    is_active: Boolean(row.is_active),
    created_by: createdBy,
    created_by_name: createdBy ? namesByProfileId.get(createdBy) || null : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    deleted_at: row.deleted_at ? String(row.deleted_at) : null,
  };
}
