import { getFleetVehicleBrand } from "@/lib/fleet/model";

export type TrafficState = "empty" | "loaded" | "unloading";
export type TrafficRole = "harvester" | "weighman" | "receiver" | "manager";
export function operatorRole(
  profileRole: string,
): Exclude<TrafficRole, "manager"> | null {
  if (profileRole === "mechanic_operator") return "harvester";
  if (profileRole === "weighman") return "weighman";
  if (profileRole === "vegetable_brigadier") return "receiver";
  return null;
}
export const STATE_LABEL: Record<TrafficState, string> = {
  empty: "Пустая",
  loaded: "Загружена",
  unloading: "На выгрузке",
};
export const ROLE_LABEL: Record<TrafficRole, string> = {
  harvester: "Комбайнёр",
  weighman: "Весовщик",
  receiver: "Приёмка картофеля",
  manager: "Оборот машин",
};
export function nextState(
  role: TrafficRole,
  state: TrafficState,
  inRepair = false,
): TrafficState | null {
  if (role === "harvester" && state === "empty" && !inRepair) return "loaded";
  if (role === "weighman" && state === "loaded") return "unloading";
  if (role === "receiver" && state === "unloading") return "empty";
  return null;
}
export const ACTION_LABEL: Record<TrafficState, string> = {
  loaded: "Загружена — отправить",
  unloading: "Прибыла на выгрузку",
  empty: "Разгрузилась",
};
export interface TrafficVehicle {
  vehicle_id: string;
  name: string;
  brand?: string | null;
  plate: string | null;
  driver: string | null;
  state: TrafficState;
  version: number;
  since: string;
  cycle: number;
  assigned: boolean;
  inRepair?: boolean;
  repairVersion?: number;
  repairChangedAt?: string | null;
}
export interface TrafficLastVehicle {
  vehicleId: string;
  driver: string | null;
  brand: string;
  plate: string | null;
  markedAt: string;
  version: number;
}
export interface TrafficCombineShift {
  id: string;
  operatorName: string;
  openedAt: string;
  closedAt: string | null;
  hectaresShift: number | null;
  hectaresFieldTotal: number | null;
  status: "open" | "closed";
}
export interface TrafficCombineBreakdown {
  operatorUserId: string;
  operatorName: string;
  changedAt: string;
  version: number;
}
export interface TrafficOwnCombineStatus {
  operatorUserId: string;
  operatorName: string;
  isBroken: boolean;
  changedAt: string | null;
  version: number;
}
export interface TrafficAnalytics {
  windowLabel: string;
  windowStartedAt: string;
  completedLoads: number;
  lastLoadIntervalMinutes: number | null;
  averageLoadIntervalMinutes: number | null;
  averageFieldToWeighbridgeMinutes: number | null;
  averageUnloadingMinutes: number | null;
  averageReturnToLoadMinutes: number | null;
  averageVehicleCycleMinutes: number | null;
  latestFleetRoundMinutes: number | null;
  probableDowntimeCount: number;
  probableDowntimeMinutes: number;
  currentProbableDowntimeMinutes: number | null;
}
export interface TrafficSnapshot {
  companyId?: string;
  role: TrafficRole;
  personName: string;
  enabled: boolean;
  fieldName: string | null;
  fieldId: string | null;
  flowRevision?: string | null;
  serverTime: string;
  vehicles: TrafficVehicle[];
  lastVehicle?: TrafficLastVehicle | null;
  combineShift?: TrafficCombineShift | null;
  combineBreakdowns?: TrafficCombineBreakdown[];
  ownCombineStatus?: TrafficOwnCombineStatus | null;
  analytics?: TrafficAnalytics | null;
  events: Array<{
    id: string;
    vehicle_id: string;
    from_state: TrafficState;
    to_state: TrafficState;
    created_at: string;
    actor_name: string;
    field_id: string | null;
    field_name: string | null;
    vehicle_name: string;
    vehicle_plate: string | null;
    vehicle_brand?: string | null;
    vehicle_driver?: string | null;
  }>;
}

export function trafficEventSummary(event: TrafficSnapshot["events"][number]): string {
  const driver = event.vehicle_driver?.trim() || "Водитель не назначен";
  const brand = getFleetVehicleBrand({
    name: event.vehicle_name,
    brand: event.vehicle_brand || null,
  });
  const plate = event.vehicle_plate?.trim() || "Без номера";
  return [
    driver,
    brand,
    plate,
    `${STATE_LABEL[event.from_state]} → ${STATE_LABEL[event.to_state]}`,
  ].join(" · ");
}
export interface TrafficCommit {
  eventId: string;
  replayed: boolean;
  serverTime: string;
  refreshRequired: boolean;
  vehicle: Pick<TrafficVehicle, "vehicle_id" | "state" | "version" | "since" | "cycle" | "assigned"> | null;
}

// Apply only a server-confirmed current row, never the user's requested target.
export function applyTrafficCommit(
  snapshot: TrafficSnapshot,
  receipt: TrafficCommit,
): TrafficSnapshot {
  const row = receipt.vehicle;
  if (!row) return snapshot;
  const existing = snapshot.vehicles.find((vehicle) => vehicle.vehicle_id === row.vehicle_id);
  if (!existing || existing.version > row.version) return snapshot;
  return {
    ...snapshot,
    vehicles: visibleVehicles(snapshot.vehicles.map((vehicle) =>
      vehicle.vehicle_id === row.vehicle_id ? { ...vehicle, ...row } : vehicle), snapshot.role),
  };
}
export function visibleVehicles(
  vehicles: TrafficVehicle[],
  role: TrafficRole,
): TrafficVehicle[] {
  const rank = { empty: 0, loaded: 1, unloading: 2 };
  const returnedFromRepairAt = (vehicle: TrafficVehicle) => {
    if (vehicle.inRepair || vehicle.state !== "empty" || !vehicle.repairChangedAt) return 0;
    const repairAt = Date.parse(vehicle.repairChangedAt);
    const stateAt = Date.parse(vehicle.since);
    return Number.isFinite(repairAt) && repairAt > stateAt ? repairAt : 0;
  };
  return vehicles
    .filter((v) =>
      v.assigned &&
      (role === "manager" || !v.inRepair) &&
      (role !== "weighman" || v.state === "loaded") &&
      (role !== "receiver" || v.state === "unloading"))
    .sort(
      (a, b) => {
        const stateOrder = rank[a.state] - rank[b.state];
        const aReturnedAt = returnedFromRepairAt(a);
        const bReturnedAt = returnedFromRepairAt(b);
        return Number(!!a.inRepair) - Number(!!b.inRepair) ||
          stateOrder ||
          bReturnedAt - aReturnedAt ||
          a.since.localeCompare(b.since) ||
          a.vehicle_id.localeCompare(b.vehicle_id);
      },
    );
}
export function stateAge(since: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60000));
  return minutes < 1
    ? "только что"
    : minutes < 60
      ? `${minutes} мин`
      : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}
