export type WeighbridgePersonnelRole = "driver" | "mechanic_operator";

export type WeighbridgeVehicleKind = {
  type?: string | null;
  fleetType?: string | null;
  fleet_type?: string | null;
};

const DRIVER_VEHICLE_TYPES = new Set([
  "truck",
  "grain_truck",
  "dump_truck",
  "tractor_unit",
]);

export function personnelRoleForVehicle(
  vehicle: WeighbridgeVehicleKind | null | undefined
): WeighbridgePersonnelRole | null {
  if (!vehicle) return null;

  const type = String(vehicle.type || "").trim().toLowerCase();
  const fleetType = String(vehicle.fleetType || vehicle.fleet_type || "")
    .trim()
    .toLowerCase();

  if (type === "tractor" || fleetType === "tractor") {
    return "mechanic_operator";
  }
  if (DRIVER_VEHICLE_TYPES.has(type) || DRIVER_VEHICLE_TYPES.has(fleetType)) {
    return "driver";
  }
  return null;
}

export function isWeighbridgePersonnelRole(value: unknown): value is WeighbridgePersonnelRole {
  return value === "driver" || value === "mechanic_operator";
}

export function personnelRoleMatchesVehicle(
  role: unknown,
  _vehicle: WeighbridgeVehicleKind | null | undefined
) {
  return isWeighbridgePersonnelRole(role);
}

export function personnelRoleLabel(role: WeighbridgePersonnelRole) {
  return role === "driver" ? "Водители" : "Механизаторы";
}
