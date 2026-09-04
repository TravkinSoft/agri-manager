import { nextState, visibleVehicles, type TrafficCommit, type TrafficSnapshot, type TrafficState, type TrafficVehicle } from "./model";

export function isTrafficAcknowledgement(value: unknown): value is TrafficCommit {
  if (!value || typeof value !== "object") return false;
  const receipt = value as TrafficCommit;
  return typeof receipt.eventId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.eventId) &&
    typeof receipt.replayed === "boolean" && typeof receipt.refreshRequired === "boolean" &&
    typeof receipt.serverTime === "string" && Number.isFinite(Date.parse(receipt.serverTime));
}

export interface TrafficCommand {
  vehicle: TrafficVehicle;
  target: TrafficState;
  key: string;
}

export interface PendingTrafficCommand extends TrafficCommand {
  phase: "sending" | "uncertain" | "reconciling";
  since: string;
  error?: string;
}

/** Display-only intent. Never change the canonical row, version, cycle or history. */
export function optimisticTrafficVehicles(snapshot: TrafficSnapshot, pending: PendingTrafficCommand[]): TrafficVehicle[] {
  return visibleVehicles(snapshot.vehicles.map(vehicle => {
    const command = pending.find(item => item.vehicle.vehicle_id === vehicle.vehicle_id);
    if (!command || command.phase === "uncertain" || vehicle.version !== command.vehicle.version ||
      vehicle.state !== command.vehicle.state || nextState(snapshot.role, vehicle.state) !== command.target) return vehicle;
    return { ...vehicle, state: command.target, since: command.since };
  }), snapshot.role);
}

/** A newer canonical snapshot resolves an uncertain response, never a client guess. */
export function trafficCommandObserved(snapshot: TrafficSnapshot, command: TrafficCommand): boolean {
  const vehicle = snapshot.vehicles.find(item => item.vehicle_id === command.vehicle.vehicle_id);
  return !vehicle || vehicle.version > command.vehicle.version;
}
