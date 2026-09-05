export type TrafficState = "empty" | "loaded" | "unloading";
export type TrafficRole = "harvester" | "receiver" | "manager";
export function operatorRole(
  profileRole: string,
): Exclude<TrafficRole, "manager"> | null {
  if (profileRole === "mechanic_operator") return "harvester";
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
  receiver: "Приёмка картофеля",
  manager: "Оборот машин",
};
export function nextState(
  role: TrafficRole,
  state: TrafficState,
  inRepair = false,
): TrafficState | null {
  if (role === "harvester" && state === "empty" && !inRepair) return "loaded";
  if (role === "receiver" && state === "loaded") return "unloading";
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
  plate: string | null;
  driver: string | null;
  state: TrafficState;
  version: number;
  since: string;
  cycle: number;
  assigned: boolean;
  inRepair?: boolean;
  repairVersion?: number;
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
  }>;
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
  return vehicles
    .filter((v) => v.assigned && (role !== "receiver" || v.state !== "empty"))
    .sort(
      (a, b) =>
        Number(!!a.inRepair) - Number(!!b.inRepair) ||
        rank[a.state] - rank[b.state] ||
        a.since.localeCompare(b.since) ||
        a.vehicle_id.localeCompare(b.vehicle_id),
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
