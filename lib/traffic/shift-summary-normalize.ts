import type { TrafficClosedShiftSummary } from "./shift-summary";

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeCount(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

/** Keeps a cached new PWA safe if the server is temporarily rolled back. */
export function normalizeTrafficClosedShiftSummary(value: unknown): TrafficClosedShiftSummary | null {
  if (!value || typeof value !== "object") return null;
  const summary = value as TrafficClosedShiftSummary & Record<string, unknown>;
  const totalTrips = nonNegativeCount(summary.totalTrips);
  return {
    ...summary,
    totalTrips,
    participatingVehicles: nonNegativeCount(summary.participatingVehicles),
    averageLoadIntervalMinutes: finiteOrNull(summary.averageLoadIntervalMinutes),
    loadIntervalSamples: nonNegativeCount(summary.loadIntervalSamples, Math.max(0, totalTrips - 1)),
    averageFieldToWeighbridgeMinutes: finiteOrNull(summary.averageFieldToWeighbridgeMinutes),
    fieldToWeighbridgeTrips: nonNegativeCount(summary.fieldToWeighbridgeTrips),
    averageUnloadingMinutes: finiteOrNull(summary.averageUnloadingMinutes),
    unloadingTrips: nonNegativeCount(summary.unloadingTrips),
    averageReturnToLoadMinutes: finiteOrNull(summary.averageReturnToLoadMinutes),
    returnToLoadTrips: nonNegativeCount(summary.returnToLoadTrips),
    averageVehicleCycleMinutes: finiteOrNull(summary.averageVehicleCycleMinutes),
    vehicleCycleSamples: nonNegativeCount(summary.vehicleCycleSamples),
    latestFleetRoundMinutes: finiteOrNull(summary.latestFleetRoundMinutes),
    latestDistinctVehicleLoadSpanMinutes: finiteOrNull(summary.latestDistinctVehicleLoadSpanMinutes),
    probableDowntimeCount: nonNegativeCount(summary.probableDowntimeCount),
    probableDowntimeMinutes: nonNegativeCount(summary.probableDowntimeMinutes),
    vehicles: Array.isArray(summary.vehicles) ? summary.vehicles : [],
  };
}
