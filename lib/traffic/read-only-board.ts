import type { FleetVehicle } from "@/lib/fleet/model";
import { getFleetVehicleBrand } from "@/lib/fleet/model";
import type { TrafficSnapshot } from "@/lib/traffic/model";
import { trafficStatusSince } from "@/lib/traffic/model";

export const TRAFFIC_BOARD_ROLES = [
  "weighman", "director", "agronomist", "fleet_manager", "company_admin", "global_admin",
] as const;
export const TRAFFIC_BOARD_GROUPS = [
  { key: "empty", label: "Пустые" },
  { key: "loaded", label: "В пути на весовую" },
  { key: "unloading", label: "На выгрузке" },
  { key: "repair", label: "На ремонте" },
  { key: "offline", label: "Не на линии" },
] as const;
export type TrafficBoardGroup = typeof TRAFFIC_BOARD_GROUPS[number]["key"];
export type TrafficBoardVehicle = {
  id: string;
  name: string;
  brand: string;
  plate: string | null;
  driver: string | null;
  group: TrafficBoardGroup;
  since: string | null;
  /** Omitted on the plain board. Null means unavailable, never a guessed zero. */
  shiftTrips?: number | null;
};
export type TrafficBoardSnapshot = {
  companyId: string;
  serverTime: string;
  readOnly: true;
  vehicles: TrafficBoardVehicle[];
};

/** The active PTC fleet is the whitelist, not the operator's filtered queue.
 * Do not expose mutation versions, account metadata or manager capabilities. */
export function buildTrafficBoard(
  companyId: string,
  snapshot: Pick<TrafficSnapshot, "vehicles" | "serverTime">,
  fleet: FleetVehicle[],
  driverTripCounts?: ReadonlyMap<string, number> | null,
): TrafficBoardSnapshot {
  const states = new Map(snapshot.vehicles.map(vehicle => [vehicle.vehicle_id, vehicle]));
  const uniqueFleet = new Map(fleet.map(vehicle => [vehicle.id, vehicle]));
  const vehicles: TrafficBoardVehicle[] = Array.from(uniqueFleet.values(), vehicle => {
    const state = states.get(vehicle.id);
    // Manager snapshots omit off-line states; the full fleet carries the current
    // driver identity even there. Name and ID come from the same scoped read.
    const driverId = vehicle.driverId !== undefined ? vehicle.driverId
      : state?.driver === vehicle.driver ? state?.driverId : null;
    // Repairs have their own version stream. A newer fleet repair must not be
    // hidden by a state snapshot that completed milliseconds earlier.
    const repair = state && (state.repairVersion ?? 0) > (vehicle.repairVersion ?? 0) ? state : vehicle;
    const assigned = state?.assigned ?? vehicle.assigned ?? false;
    const group: TrafficBoardGroup = repair.inRepair ? "repair"
      : !assigned ? "offline" : state?.state ?? vehicle.state ?? "empty";
    const candidateSince = trafficStatusSince({
      since: state?.since ?? vehicle.lastActivity ?? "",
      inRepair: repair.inRepair,
      repairChangedAt: repair.repairChangedAt,
    }, "manager");
    return {
      id: vehicle.id,
      name: vehicle.name,
      brand: getFleetVehicleBrand(vehicle),
      plate: vehicle.plate,
      driver: vehicle.driver,
      group,
      since: candidateSince && Number.isFinite(Date.parse(candidateSince)) ? candidateSince : null,
      ...(driverTripCounts !== undefined ? { shiftTrips: driverTripCounts && vehicle.driver && driverId
        ? driverTripCounts.get(driverId) ?? 0 : null } : {}),
    };
  });
  vehicles.sort((left, right) =>
    (left.since ? Date.parse(left.since) : Infinity) - (right.since ? Date.parse(right.since) : Infinity)
    || left.name.localeCompare(right.name, "ru") || left.id.localeCompare(right.id));
  return { companyId, serverTime: snapshot.serverTime, readOnly: true, vehicles };
}
