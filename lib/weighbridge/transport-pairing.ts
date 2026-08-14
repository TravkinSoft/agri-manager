export const OPEN_TRANSPORT_TICKET_STATUSES = ["draft", "active", "ready_to_close"] as const;

export type TransportPairTicketRow = {
  id: string;
  ticket_no?: string | null;
  vehicle_id?: string | null;
  driver_id?: string | null;
  status: string;
  season_id?: string | null;
  finalized_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  is_voided?: boolean | null;
  replacement_ticket_id?: string | null;
};

export type RecentTransportPair = {
  vehicleId: string;
  driverId: string;
  lastUsedAt: string;
  usageCount: number;
  usedInOperationalDay: boolean;
  usedInCurrentSeason: boolean;
};

export type OpenTransportAssignment = {
  ticketId: string;
  ticketNo: string;
  vehicleId: string | null;
  driverId: string | null;
};

export type WeighbridgeTransportPickerData = {
  seasonId: string | null;
  operationalDayStartHour: number;
  recentPairs: RecentTransportPair[];
  latestDriverByVehicle: Record<string, string>;
  latestVehicleByDriver: Record<string, string>;
  openAssignments: OpenTransportAssignment[];
  fetchedAt: string;
};

export function normalizeTransportSearchText(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/\u0451/g, "\u0435")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function operationalDayStartUtc(
  now: Date,
  startHour: number,
  utcOffsetMinutes = 300
): Date {
  const safeStartHour = Math.min(23, Math.max(0, Math.trunc(startHour)));
  const shifted = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  let localStartMs = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    safeStartHour
  );
  if (shifted.getUTCHours() < safeStartHour) localStartMs -= 86_400_000;
  return new Date(localStartMs - utcOffsetMinutes * 60_000);
}

function ticketMoment(row: TransportPairTicketRow): string {
  return String(row.finalized_at || row.updated_at || row.created_at || "");
}

export function buildWeighbridgeTransportPickerData(params: {
  finalizedTickets: TransportPairTicketRow[];
  openTickets: TransportPairTicketRow[];
  seasonId: string | null;
  operationalDayStartHour: number;
  now?: Date;
  pairLimit?: number;
}): WeighbridgeTransportPickerData {
  const now = params.now || new Date();
  const operationalStart = operationalDayStartUtc(now, params.operationalDayStartHour);
  const validFinalized = params.finalizedTickets
    .filter((row) =>
      row.status === "finalized" &&
      !row.is_voided &&
      !row.replacement_ticket_id &&
      row.vehicle_id &&
      row.driver_id &&
      ticketMoment(row)
    )
    .sort((a, b) => Date.parse(ticketMoment(b)) - Date.parse(ticketMoment(a)));

  const latestDriverByVehicle: Record<string, string> = {};
  const latestVehicleByDriver: Record<string, string> = {};
  const grouped = new Map<string, RecentTransportPair>();

  validFinalized.forEach((row) => {
    const vehicleId = String(row.vehicle_id);
    const driverId = String(row.driver_id);
    const usedAt = ticketMoment(row);
    if (!latestDriverByVehicle[vehicleId]) latestDriverByVehicle[vehicleId] = driverId;
    if (!latestVehicleByDriver[driverId]) latestVehicleByDriver[driverId] = vehicleId;

    const key = `${vehicleId}:${driverId}`;
    const current = grouped.get(key);
    const usedInOperationalDay = Date.parse(usedAt) >= operationalStart.getTime();
    const usedInCurrentSeason = Boolean(params.seasonId && row.season_id === params.seasonId);
    if (!current) {
      grouped.set(key, {
        vehicleId,
        driverId,
        lastUsedAt: usedAt,
        usageCount: 1,
        usedInOperationalDay,
        usedInCurrentSeason,
      });
      return;
    }
    current.usageCount += 1;
    current.usedInOperationalDay ||= usedInOperationalDay;
    current.usedInCurrentSeason ||= usedInCurrentSeason;
  });

  const recentPairs = Array.from(grouped.values())
    .sort((a, b) => {
      const dayPriority = Number(b.usedInOperationalDay) - Number(a.usedInOperationalDay);
      if (dayPriority !== 0) return dayPriority;
      const seasonPriority = Number(b.usedInCurrentSeason) - Number(a.usedInCurrentSeason);
      if (seasonPriority !== 0) return seasonPriority;
      const timePriority = Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt);
      if (timePriority !== 0) return timePriority;
      return b.usageCount - a.usageCount;
    })
    .slice(0, Math.max(1, params.pairLimit ?? 4));

  const openAssignments = params.openTickets
    .filter((row) => OPEN_TRANSPORT_TICKET_STATUSES.includes(row.status as (typeof OPEN_TRANSPORT_TICKET_STATUSES)[number]))
    .map((row) => ({
      ticketId: String(row.id),
      ticketNo: String(row.ticket_no || ""),
      vehicleId: row.vehicle_id ? String(row.vehicle_id) : null,
      driverId: row.driver_id ? String(row.driver_id) : null,
    }));

  return {
    seasonId: params.seasonId,
    operationalDayStartHour: params.operationalDayStartHour,
    recentPairs,
    latestDriverByVehicle,
    latestVehicleByDriver,
    openAssignments,
    fetchedAt: now.toISOString(),
  };
}
