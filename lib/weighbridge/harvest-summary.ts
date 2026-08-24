export type HarvestAggregate = {
  netKg: number;
  trips: number;
  averageTripKg: number;
  averageMoisture: number | null;
  measuredMoistureTrips: number;
};

export function aggregateHarvestTickets(rows: any[]): HarvestAggregate {
  const netKg = rows.reduce((sum, row) => sum + Number(row.net_weight_kg || 0), 0);
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
  };
}
