export interface FleetVehicle {
  id: string;
  name: string;
  brand?: string | null;
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

const BRAND_LABELS: Array<[RegExp, string]> = [
  [/(?:^|\s)(?:KAMAZ|КАМАЗ)(?:\s|$)/iu, "КамАЗ"],
  [/(?:^|\s)(?:ZIL|ЗИЛ)(?:\s|$)/iu, "ЗИЛ"],
  [/(?:^|\s)(?:GAZ|ГАЗ)(?:\s|$)/iu, "ГАЗ"],
  [/(?:^|\s)(?:MAZ|МАЗ)(?:\s|$)/iu, "МАЗ"],
  [/(?:^|\s)(?:NEFAZ|НЕФАЗ)(?:\s|$)/iu, "НЕФАЗ"],
  [/(?:^|\s)(?:UAZ|УАЗ)(?:\s|$)/iu, "УАЗ"],
  [/(?:^|\s)МТЗ(?:\s|$)/iu, "МТЗ"],
  [/(?:^|\s)HOWO(?:\s|$)/iu, "HOWO"],
  [/(?:^|\s)SHACMAN(?:\s|$)/iu, "SHACMAN"],
];

export function getFleetVehicleBrand(
  vehicle: Pick<FleetVehicle, "name" | "brand">,
): string {
  const source = `${vehicle.brand?.trim() || ""} ${vehicle.name.trim()}`.trim();
  for (const [pattern, label] of BRAND_LABELS) if (pattern.test(source)) return label;
  return vehicle.brand?.trim() || vehicle.name.trim().split(/\s+/)[0] || "Машина";
}

export function getFleetVehicleCardIdentity(
  vehicle: Pick<FleetVehicle, "name" | "brand" | "plate" | "driver">,
): FleetVehicleCardIdentity {
  const driver = vehicle.driver?.trim() || null;
  const brand = getFleetVehicleBrand(vehicle);
  const plate = vehicle.plate?.trim() || null;
  return {
    primary: driver ?? brand,
    secondary: driver ? [brand, plate].filter(Boolean).join(" · ") : plate,
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
    (!query || [vehicle.name, vehicle.brand, vehicle.plate, vehicle.driver].some(value =>
      value?.toLocaleLowerCase().replace(/\s+/g, "").includes(query))));
}
