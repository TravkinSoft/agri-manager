export type PtcReferenceVehicleRow = {
  ptc_enabled?: unknown;
  source_machine_id?: unknown;
  type?: unknown;
  fleet_type?: unknown;
  import_source?: unknown;
  inventory_number?: unknown;
  source_raw_name?: unknown;
  source_clean_name?: unknown;
  transport_model?:
    | { category?: unknown }
    | Array<{ category?: unknown }>
    | null;
};

export type PtcReferenceVehicleIdentity = PtcReferenceVehicleRow & {
  license_plate?: unknown;
  plate_number?: unknown;
};

const ELIGIBLE_KINDS = new Set([
  "truck",
  "grain_truck",
  "dump_truck",
  "tractor",
  "tractor_unit",
]);

const BLOCKED_KINDS = new Set([
  "light_vehicle",
  "trailer",
  "semi_trailer",
  "tractor_trailer",
  "special_vehicle",
  "crane",
  "mobile_crane",
  "truck_crane",
  "fuel_truck",
  "fuel_tanker",
  "fuel_bowser",
  "tanker",
]);

// These are provenance fields, not user-facing vehicle names. Require an
// explicit standalone QA/audit token so ordinary imported assets stay visible.
const EXPLICIT_AUDIT_TOKEN =
  /(^|[^\p{L}\p{N}])(audit|qa|test|e2e|smoke|тест)(?=$|[^\p{L}\p{N}])/iu;

const SPECIAL_PURPOSE_SOURCE =
  /(^|[^\p{L}\p{N}])(автокран|кран|crane|топливозаправ\p{L}*|бензовоз|fuel[\s_-]*(truck|tanker|bowser)|refuel\p{L}*)(?=$|[^\p{L}\p{N}])/iu;

const normalized = (value: unknown) =>
  String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru-RU");

function modelCategories(row: PtcReferenceVehicleRow) {
  const models = Array.isArray(row.transport_model)
    ? row.transport_model
    : row.transport_model
      ? [row.transport_model]
      : [];
  return models.map((model) => normalized(model?.category)).filter(Boolean);
}

function hasExplicitAuditProvenance(row: PtcReferenceVehicleRow) {
  return [
    row.import_source,
    row.inventory_number,
    row.source_raw_name,
    row.source_clean_name,
  ].some((value) => EXPLICIT_AUDIT_TOKEN.test(normalized(value)));
}

function hasSpecialPurposeProvenance(row: PtcReferenceVehicleRow) {
  return [row.source_raw_name, row.source_clean_name]
    .some((value) => SPECIAL_PURPOSE_SOURCE.test(normalized(value)));
}

/**
 * PTC operates only on cargo-capable rows from reference_vehicles.
 * Agricultural-machine rows never reach this helper; real tractors are
 * eligible only when their reference_vehicles type/category says tractor.
 */
export function isStructurallyPtcReferenceVehicle(row: PtcReferenceVehicleRow) {
  if (hasExplicitAuditProvenance(row) || hasSpecialPurposeProvenance(row)) return false;

  const kinds = [
    normalized(row.type),
    normalized(row.fleet_type),
    ...modelCategories(row),
  ].filter(Boolean);

  if (kinds.some((kind) => BLOCKED_KINDS.has(kind))) return false;
  return kinds.some((kind) => ELIGIBLE_KINDS.has(kind));
}

export function isPtcEligibleReferenceVehicle(row: PtcReferenceVehicleRow) {
  return row.ptc_enabled === true && isStructurallyPtcReferenceVehicle(row);
}

export function ptcVehicleDisplayPlate(row: PtcReferenceVehicleIdentity) {
  const licensePlate = String(row.license_plate ?? "").trim();
  if (licensePlate) return licensePlate;
  const legacyPlate = String(row.plate_number ?? "").trim();
  if (row.source_machine_id && /^PTC-TRACTOR-/iu.test(legacyPlate)) return null;
  return legacyPlate || null;
}
