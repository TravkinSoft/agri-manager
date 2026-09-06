export interface FleetVehicle {
  id: string;
  name: string;
  plate: string | null;
  driver: string | null;
  inRepair?: boolean;
  repairVersion?: number;
  assigned?: boolean;
  state?: "empty" | "loaded" | "unloading";
  lastActivity?: string | null;
}

export interface FleetSnapshot {
  companyId: string;
  vehicles: FleetVehicle[];
}

export interface FleetRepairReceipt {
  companyId: string;
  vehicleId: string;
  inRepair: boolean;
  version: number;
  changedAt: string | null;
  notificationEventKey?: string | null;
}

export interface FleetVehicleCardIdentity {
  primary: string;
  secondary: string | null;
  hasDriver: boolean;
}

export function getFleetVehicleCardIdentity(
  vehicle: Pick<FleetVehicle, "name" | "plate" | "driver">,
): FleetVehicleCardIdentity {
  const driver = vehicle.driver?.trim() || null;
  const name = vehicle.name.trim() || "Машина";
  const plate = vehicle.plate?.trim() || null;
  return {
    primary: driver ?? plate ?? name,
    secondary: driver ? [name, plate].filter(Boolean).join(" · ") : plate ? name : null,
    hasDriver: !!driver,
  };
}

export function isFleetRepairReceipt(value: unknown): value is FleetRepairReceipt {
  if (!value || typeof value !== "object") return false;
  const result = value as FleetRepairReceipt;
  return typeof result.companyId === "string" && typeof result.vehicleId === "string" &&
    typeof result.inRepair === "boolean" && Number.isSafeInteger(result.version) && result.version >= 0 &&
    (result.changedAt === null || typeof result.changedAt === "string");
}

export function applyFleetRepair(snapshot: FleetSnapshot, receipt: FleetRepairReceipt): FleetSnapshot {
  if (snapshot.companyId !== receipt.companyId) return snapshot;
  return { ...snapshot, vehicles: snapshot.vehicles.map(vehicle =>
    vehicle.id === receipt.vehicleId && (vehicle.repairVersion ?? 0) <= receipt.version
      ? { ...vehicle, inRepair: receipt.inRepair, repairVersion: receipt.version } : vehicle) };
}

export function filterFleet(vehicles: FleetVehicle[], search: string, unassigned: boolean) {
  const query = search.trim().toLocaleLowerCase().replace(/\s+/g, "");
  return vehicles.filter(vehicle => (!unassigned || !vehicle.driver) &&
    (!query || [vehicle.name, vehicle.plate, vehicle.driver].some(value =>
      value?.toLocaleLowerCase().replace(/\s+/g, "").includes(query))));
}
