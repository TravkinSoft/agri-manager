import type {
  TrafficClosedShiftHistoryItem,
  TrafficClosedShiftHistoryPage,
  TrafficClosedShiftSummary,
} from "./shift-summary";

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

function historyItem(value: unknown): TrafficClosedShiftHistoryItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<TrafficClosedShiftHistoryItem>;
  const openedAt = typeof item.openedAt === "string" ? Date.parse(item.openedAt) : Number.NaN;
  const closedAt = typeof item.closedAt === "string" ? Date.parse(item.closedAt) : Number.NaN;
  if (
    typeof item.shiftId !== "string" || !item.shiftId ||
    typeof item.operatorName !== "string" ||
    typeof item.openedAt !== "string" || !Number.isFinite(openedAt) ||
    typeof item.closedAt !== "string" || !Number.isFinite(closedAt) || closedAt < openedAt
  ) return null;
  return {
    shiftId: item.shiftId,
    operatorName: item.operatorName.trim() || "Комбайнёр",
    fieldName: typeof item.fieldName === "string" && item.fieldName.trim()
      ? item.fieldName.trim()
      : null,
    openedAt: item.openedAt,
    closedAt: item.closedAt,
    durationMinutes: Math.round((closedAt - openedAt) / 60_000),
    hectaresShift: finiteOrNull(item.hectaresShift),
    hectaresFieldTotal: finiteOrNull(item.hectaresFieldTotal),
  };
}

export function normalizeTrafficClosedShiftHistoryPage(
  value: unknown,
): TrafficClosedShiftHistoryPage {
  if (!value || typeof value !== "object") return { items: [], nextCursor: null };
  const page = value as Partial<TrafficClosedShiftHistoryPage>;
  return {
    items: Array.isArray(page.items)
      ? page.items.map(historyItem).filter((item): item is TrafficClosedShiftHistoryItem => Boolean(item))
      : [],
    nextCursor: typeof page.nextCursor === "string" && page.nextCursor
      ? page.nextCursor
      : null,
  };
}
