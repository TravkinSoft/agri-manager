import type { TrafficAnalytics, TrafficCombineShift, TrafficState } from "./model";

export interface TrafficAnalyticsEvent {
  vehicle_id: string;
  from_state: TrafficState;
  to_state: TrafficState;
  cycle: number;
  created_at: string;
}

const MINUTE = 60_000;
const IDLE_THRESHOLD_MINUTES = 15;

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function minutesBetween(from: string, to: string): number | null {
  const duration = (Date.parse(to) - Date.parse(from)) / MINUTE;
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

/** Read-only operational estimates derived only from committed PTC events. */
export function calculateTrafficAnalytics(
  events: TrafficAnalyticsEvent[],
  serverTime: string,
  shift: TrafficCombineShift | null,
  activeVehicleCount = 0,
): TrafficAnalytics {
  const now = Date.parse(serverTime);
  const fallbackStartedAt = new Date(now - 12 * 60 * MINUTE).toISOString();
  const windowStartedAt = shift?.openedAt ?? fallbackStartedAt;
  const windowEndedAt = shift?.closedAt ?? serverTime;
  const start = Date.parse(windowStartedAt);
  const end = Date.parse(windowEndedAt);
  const ordered = events
    .filter((event) => {
      const at = Date.parse(event.created_at);
      return Number.isFinite(at) && at >= start && at <= end;
    })
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  const loads = ordered.filter((event) => event.to_state === "loaded");
  const loadIntervals = loads.slice(1).flatMap((event, index) => {
    const value = minutesBetween(loads[index].created_at, event.created_at);
    return value === null ? [] : [value];
  });
  const byTrip = new Map<string, Partial<Record<"loaded" | "unloading" | "empty", string>>>();
  for (const event of ordered) {
    const key = `${event.vehicle_id}:${event.cycle}`;
    const trip = byTrip.get(key) ?? {};
    if (event.to_state === "loaded" || event.to_state === "unloading" || event.to_state === "empty")
      trip[event.to_state] = event.created_at;
    byTrip.set(key, trip);
  }
  const fieldToWeighbridge: number[] = [];
  const unloading: number[] = [];
  for (const trip of Array.from(byTrip.values())) {
    if (trip.loaded && trip.unloading) {
      const value = minutesBetween(trip.loaded, trip.unloading);
      if (value !== null) fieldToWeighbridge.push(value);
    }
    if (trip.unloading && trip.empty) {
      const value = minutesBetween(trip.unloading, trip.empty);
      if (value !== null) unloading.push(value);
    }
  }
  const returnToLoad: number[] = [];
  const vehicleCycles: number[] = [];
  const byVehicle = new Map<string, TrafficAnalyticsEvent[]>();
  for (const event of ordered) {
    const vehicleEvents = byVehicle.get(event.vehicle_id) ?? [];
    vehicleEvents.push(event);
    byVehicle.set(event.vehicle_id, vehicleEvents);
  }
  for (const vehicleEvents of Array.from(byVehicle.values())) {
    const vehicleLoads = vehicleEvents.filter((event) => event.to_state === "loaded");
    for (let index = 1; index < vehicleLoads.length; index++) {
      const value = minutesBetween(vehicleLoads[index - 1].created_at, vehicleLoads[index].created_at);
      if (value !== null) vehicleCycles.push(value);
    }
    for (let index = 0; index < vehicleEvents.length; index++) {
      const event = vehicleEvents[index];
      if (event.to_state !== "empty") continue;
      const nextLoad = vehicleEvents.slice(index + 1).find((candidate) =>
        candidate.to_state === "loaded" && candidate.cycle === event.cycle + 1);
      if (!nextLoad) continue;
      const value = minutesBetween(event.created_at, nextLoad.created_at);
      if (value !== null) returnToLoad.push(value);
    }
  }
  const closedDowntimes = loadIntervals.filter((value) => value > IDLE_THRESHOLD_MINUTES);
  const currentGapStart = loads.length
    ? loads[loads.length - 1].created_at
    : shift?.status === "open"
      ? shift.openedAt
      : null;
  const currentGap = currentGapStart && shift?.status === "open"
    ? minutesBetween(currentGapStart, serverTime)
    : null;
  const currentWholeGapMinutes = currentGap === null ? null : Math.floor(currentGap);
  const currentProbableDowntimeMinutes = currentWholeGapMinutes !== null && currentWholeGapMinutes > IDLE_THRESHOLD_MINUTES
    ? currentWholeGapMinutes - IDLE_THRESHOLD_MINUTES
    : null;
  return {
    windowLabel: shift
      ? shift.status === "open" ? "Текущая смена" : "Последняя смена"
      : "Последние 12 часов",
    windowStartedAt,
    completedLoads: loads.length,
    lastLoadIntervalMinutes: loadIntervals.length ? Math.round(loadIntervals[loadIntervals.length - 1]) : null,
    averageLoadIntervalMinutes: average(loadIntervals),
    averageFieldToWeighbridgeMinutes: average(fieldToWeighbridge),
    averageUnloadingMinutes: average(unloading),
    averageReturnToLoadMinutes: average(returnToLoad),
    averageVehicleCycleMinutes: average(vehicleCycles),
    latestFleetRoundMinutes: activeVehicleCount > 0 && loads.length > activeVehicleCount
      ? (() => {
          const value = minutesBetween(
            loads[loads.length - activeVehicleCount - 1].created_at,
            loads[loads.length - 1].created_at,
          );
          return value === null ? null : Math.round(value);
        })()
      : null,
    probableDowntimeCount: closedDowntimes.length + Number(currentProbableDowntimeMinutes !== null),
    probableDowntimeMinutes: Math.round(
      closedDowntimes.reduce((sum, value) => sum + value - IDLE_THRESHOLD_MINUTES, 0) +
      (currentProbableDowntimeMinutes ?? 0),
    ),
    currentProbableDowntimeMinutes,
  };
}
