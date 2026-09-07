import { getFleetVehicleBrand } from "@/lib/fleet/model";
import { calculateTrafficAnalytics, type TrafficAnalyticsEvent } from "@/lib/traffic/analytics";

export interface ClosedTrafficShiftRow {
  id: string;
  operatorUserId: string;
  operatorName: string;
  fieldId: string | null;
  openedAt: string;
  closedAt: string;
  hectaresShift: number | null;
  hectaresFieldTotal: number | null;
}

export interface TrafficShiftVehicleIdentity {
  id: string;
  name: string;
  brand: string | null;
  plate: string | null;
}

export interface TrafficShiftEvent extends TrafficAnalyticsEvent {
  actor_user_id: string | null;
}

export interface TrafficClosedShiftVehicleSummary {
  vehicleId: string;
  brand: string;
  plate: string | null;
  trips: number;
}

export interface TrafficClosedShiftSummary {
  shiftId: string;
  operatorName: string;
  fieldName: string | null;
  openedAt: string;
  closedAt: string;
  durationMinutes: number;
  hectaresShift: number | null;
  hectaresFieldTotal: number | null;
  totalTrips: number;
  participatingVehicles: number;
  averageLoadIntervalMinutes: number | null;
  loadIntervalSamples: number;
  averageFieldToWeighbridgeMinutes: number | null;
  fieldToWeighbridgeTrips: number;
  averageUnloadingMinutes: number | null;
  unloadingTrips: number;
  averageReturnToLoadMinutes: number | null;
  returnToLoadTrips: number;
  averageVehicleCycleMinutes: number | null;
  vehicleCycleSamples: number;
  /** Legacy count-based estimate retained for already-installed PWA clients. */
  latestFleetRoundMinutes: number | null;
  /** Span between the last load of every vehicle that participated in the shift. */
  latestDistinctVehicleLoadSpanMinutes: number | null;
  probableDowntimeCount: number;
  probableDowntimeMinutes: number;
  vehicles: TrafficClosedShiftVehicleSummary[];
}

type ShiftTimingSampleCounts = {
  fieldToWeighbridgeTrips: number;
  unloadingTrips: number;
  returnToLoadTrips: number;
  vehicleCycleSamples: number;
};

function countShiftTimingSamples(events: TrafficShiftEvent[]): ShiftTimingSampleCounts {
  const byTrip = new Map<string, Partial<Record<"loaded" | "unloading" | "empty", string>>>();
  const byVehicle = new Map<string, TrafficShiftEvent[]>();
  for (const event of events) {
    const tripKey = `${event.vehicle_id}:${event.cycle}`;
    const trip = byTrip.get(tripKey) ?? {};
    trip[event.to_state] = event.created_at;
    byTrip.set(tripKey, trip);
    const vehicleEvents = byVehicle.get(event.vehicle_id) ?? [];
    vehicleEvents.push(event);
    byVehicle.set(event.vehicle_id, vehicleEvents);
  }

  let fieldToWeighbridgeTrips = 0;
  let unloadingTrips = 0;
  for (const trip of Array.from(byTrip.values())) {
    if (trip.loaded && trip.unloading) fieldToWeighbridgeTrips += 1;
    if (trip.unloading && trip.empty) unloadingTrips += 1;
  }

  let returnToLoadTrips = 0;
  let vehicleCycleSamples = 0;
  for (const vehicleEvents of Array.from(byVehicle.values())) {
    const ordered = [...vehicleEvents].sort((left, right) =>
      Date.parse(left.created_at) - Date.parse(right.created_at));
    const loads = ordered.filter((event) => event.to_state === "loaded");
    vehicleCycleSamples += Math.max(0, loads.length - 1);
    for (let index = 0; index < ordered.length; index++) {
      const event = ordered[index];
      if (event.to_state !== "empty") continue;
      if (ordered.slice(index + 1).some((candidate) =>
        candidate.to_state === "loaded" && candidate.cycle === event.cycle + 1)) {
        returnToLoadTrips += 1;
      }
    }
  }

  return { fieldToWeighbridgeTrips, unloadingTrips, returnToLoadTrips, vehicleCycleSamples };
}

/**
 * Measures the shortest suffix ending at the last load in which every vehicle
 * that participated in the shift appears at least once. Repeated loads by one
 * vehicle therefore cannot masquerade as a complete fleet round.
 */
function latestDistinctFleetRoundMinutes(loads: TrafficShiftEvent[]): number | null {
  const ordered = [...loads].sort((left, right) =>
    Date.parse(left.created_at) - Date.parse(right.created_at));
  const participating = new Set(ordered.map((event) => event.vehicle_id));
  if (participating.size < 2) return null;
  const seen = new Set<string>();
  for (let index = ordered.length - 1; index >= 0; index--) {
    seen.add(ordered[index].vehicle_id);
    if (seen.size !== participating.size) continue;
    const minutes = (Date.parse(ordered[ordered.length - 1].created_at) -
      Date.parse(ordered[index].created_at)) / 60_000;
    return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : null;
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Builds a read-only fact sheet from committed PTC events inside one closed shift. */
export function buildTrafficClosedShiftSummary(
  shift: ClosedTrafficShiftRow,
  rawEvents: TrafficShiftEvent[],
  vehicleIdentities: TrafficShiftVehicleIdentity[],
  fieldName: string | null,
): TrafficClosedShiftSummary {
  const openedAt = Date.parse(shift.openedAt);
  const closedAt = Date.parse(shift.closedAt);
  if (!Number.isFinite(openedAt) || !Number.isFinite(closedAt) || closedAt < openedAt)
    throw new Error("Invalid closed PTC shift window");

  // Keep the aggregation correct even if a caller accidentally passes a wider event set.
  const windowEvents = rawEvents.filter((event) => {
    const createdAt = Date.parse(event.created_at);
    return Number.isFinite(createdAt) && createdAt >= openedAt && createdAt <= closedAt;
  });
  const operatorTrips = new Set(windowEvents
    .filter((event) => event.to_state === "loaded" && event.actor_user_id === shift.operatorUserId)
    .map((event) => `${event.vehicle_id}:${event.cycle}`));
  // Weighman and receiver events are performed by other users, so retain them
  // only when their vehicle+cycle belongs to this combine operator's load.
  const events = windowEvents.filter((event) =>
    operatorTrips.has(`${event.vehicle_id}:${event.cycle}`));
  const loads = events.filter((event) => event.to_state === "loaded");
  const tripCounts = new Map<string, number>();
  for (const event of loads)
    tripCounts.set(event.vehicle_id, (tripCounts.get(event.vehicle_id) ?? 0) + 1);

  const identityById = new Map(vehicleIdentities.map((vehicle) => [vehicle.id, vehicle]));
  const vehicles = Array.from(tripCounts.entries())
    .map(([vehicleId, trips]) => {
      const identity = identityById.get(vehicleId);
      return {
        vehicleId,
        brand: identity
          ? getFleetVehicleBrand({ name: identity.name, brand: identity.brand })
          : "Машина",
        plate: identity?.plate?.trim() || null,
        trips,
      };
    })
    .sort((left, right) =>
      right.trips - left.trips ||
      left.brand.localeCompare(right.brand, "ru") ||
      (left.plate ?? "").localeCompare(right.plate ?? "", "ru") ||
      left.vehicleId.localeCompare(right.vehicleId));

  const participatingVehicles = vehicles.length;
  const timingSamples = countShiftTimingSamples(events);
  const analytics = calculateTrafficAnalytics(
    events,
    shift.closedAt,
    {
      id: shift.id,
      operatorName: shift.operatorName,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      hectaresShift: finiteNumber(shift.hectaresShift),
      hectaresFieldTotal: finiteNumber(shift.hectaresFieldTotal),
      status: "closed",
    },
    participatingVehicles,
  );

  return {
    shiftId: shift.id,
    operatorName: shift.operatorName.trim() || "Комбайнёр",
    fieldName: fieldName?.trim() || null,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
    durationMinutes: Math.max(0, Math.round((closedAt - openedAt) / 60_000)),
    hectaresShift: finiteNumber(shift.hectaresShift),
    hectaresFieldTotal: finiteNumber(shift.hectaresFieldTotal),
    totalTrips: loads.length,
    participatingVehicles,
    averageLoadIntervalMinutes: analytics.averageLoadIntervalMinutes,
    loadIntervalSamples: Math.max(0, loads.length - 1),
    averageFieldToWeighbridgeMinutes: analytics.averageFieldToWeighbridgeMinutes,
    fieldToWeighbridgeTrips: timingSamples.fieldToWeighbridgeTrips,
    averageUnloadingMinutes: analytics.averageUnloadingMinutes,
    unloadingTrips: timingSamples.unloadingTrips,
    averageReturnToLoadMinutes: analytics.averageReturnToLoadMinutes,
    returnToLoadTrips: timingSamples.returnToLoadTrips,
    averageVehicleCycleMinutes: analytics.averageVehicleCycleMinutes,
    vehicleCycleSamples: timingSamples.vehicleCycleSamples,
    // Do not change the meaning of this existing field: an already-installed
    // PWA can keep using it while a release is rolling forward or back.
    latestFleetRoundMinutes: analytics.latestFleetRoundMinutes,
    latestDistinctVehicleLoadSpanMinutes: latestDistinctFleetRoundMinutes(loads),
    probableDowntimeCount: analytics.probableDowntimeCount,
    probableDowntimeMinutes: analytics.probableDowntimeMinutes,
    vehicles,
  };
}
