export type HarvestAggregate = {
  netKg: number;
  trips: number;
  averageTripKg: number;
  averageMoisture: number | null;
  measuredMoistureTrips: number;
  firstTripAt: string | null;
  lastTripAt: string | null;
  ticketIds: string[];
};

export function aggregateHarvestTickets(rows: any[]): HarvestAggregate {
  const netKg = rows.reduce((sum, row) => sum + Number(row.net_weight_kg || 0), 0);
  const orderedTrips = rows
    .map((row) => ({
      id: String(row.id || ""),
      occurredAt: String(row.finalized_at || row.created_at || ""),
    }))
    .filter((row) => row.id && !Number.isNaN(new Date(row.occurredAt).getTime()))
    .sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
  const moistureRows = rows
    .map((row) => ({
      netKg: Number(row.net_weight_kg || 0),
      moisture: Number((Array.isArray(row.lines) ? row.lines[0] : null)?.moisture_percent),
    }))
    .filter((row) => Number.isFinite(row.moisture) && row.moisture > 0 && Number.isFinite(row.netKg) && row.netKg > 0);
  const measuredMassKg = moistureRows.reduce((sum, row) => sum + row.netKg, 0);
  return {
    netKg,
    trips: rows.length,
    averageTripKg: rows.length > 0 ? netKg / rows.length : 0,
    averageMoisture: measuredMassKg > 0
      ? moistureRows.reduce((sum, row) => sum + row.moisture * row.netKg, 0) / measuredMassKg
      : null,
    measuredMoistureTrips: moistureRows.length,
    firstTripAt: orderedTrips[0]?.occurredAt || null,
    lastTripAt: orderedTrips[orderedTrips.length - 1]?.occurredAt || null,
    ticketIds: orderedTrips.map((row) => row.id),
  };
}
