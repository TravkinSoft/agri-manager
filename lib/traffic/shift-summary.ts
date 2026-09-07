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
  averageVehicleCycleMinutes: number | null;
  latestFleetRoundMinutes: number | null;
  probableDowntimeCount: number;
  probableDowntimeMinutes: number;
  vehicles: TrafficClosedShiftVehicleSummary[];
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
    averageVehicleCycleMinutes: analytics.averageVehicleCycleMinutes,
    latestFleetRoundMinutes: analytics.latestFleetRoundMinutes,
    probableDowntimeCount: analytics.probableDowntimeCount,
    probableDowntimeMinutes: analytics.probableDowntimeMinutes,
    vehicles,
  };
}
