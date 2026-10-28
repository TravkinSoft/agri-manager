export type WarehouseFieldOrigin = {
  fieldId: string | null; fieldName: string; netWeightKg: number;
  tripCount: number; areaHa: number | null; yieldTPerHa: number | null;
  cleanWeightKg: number | null;
  harvestedAreaHa: number | null;
  yieldCleanWeightKg: number | null;
  yieldStatus: "confirmed" | "awaiting_shift" | "missing_area" | "area_exceeds_plan" | "uncertain_mass";
};
export type WarehouseHarvestArea = {
  harvestedAreaHa: number | null; areaPending: boolean; combineShiftOpen: boolean;
};
type OriginTicket = {
  id: string; field_id: string | null; crop_structure_allocation_id?: string | null;
  accepted_weight_kg?: number | null; net_weight_kg?: number | null;
  op_type: string; status: string; is_finalized: boolean; is_voided: boolean;
  replacement_ticket_id?: string | null;
};
type OriginArea = { id: string; field_id: string; area: number | null };

// One source ticket and one plot area count once, even after splitting stock.
// Missing plot provenance must never silently substitute the whole field area.
export function buildWarehouseFieldOrigins(tickets: OriginTicket[], areas: OriginArea[], names: Map<string, string>, yieldTickets: OriginTicket[] = tickets, cleanMassByTicket?: Map<string, number | null>, confirmedAreas?: Map<string, WarehouseHarvestArea>): WarehouseFieldOrigin[] {
  const areaById = new Map(areas.map(row => [row.id, row]));
  const yieldMassByPlot = new Map<string, number>();
  const unknownPlots = new Set<string>();
  for (const ticket of Array.from(new Map(yieldTickets.map(row => [row.id, row])).values())) {
    if (ticket.op_type !== "harvest_incoming" || ticket.status !== "finalized" || !ticket.is_finalized || ticket.is_voided || ticket.replacement_ticket_id) continue;
    const plot = areaById.get(ticket.crop_structure_allocation_id || "");
    // A receipt is not evidence that impurities have been accounted for.
    const mass = cleanMassByTicket?.get(ticket.id);
    if (plot && plot.field_id === ticket.field_id) {
      if (mass == null || !Number.isFinite(mass)) unknownPlots.add(plot.id);
      else yieldMassByPlot.set(plot.id, (yieldMassByPlot.get(plot.id) || 0) + mass);
    }
  }
  const groups = new Map<string, { row: WarehouseFieldOrigin; plots: Set<string>; missingArea: boolean }>();
  for (const ticket of Array.from(new Map(tickets.map(row => [row.id, row])).values())) {
    if (ticket.op_type !== "harvest_incoming" || ticket.status !== "finalized" || !ticket.is_finalized || ticket.is_voided || ticket.replacement_ticket_id) continue;
    const mass = Number(ticket.accepted_weight_kg ?? ticket.net_weight_kg);
    if (!Number.isFinite(mass) || mass <= 0) continue;
    const key = ticket.field_id || "unknown";
    const group = groups.get(key) || { row: { fieldId: ticket.field_id, fieldName: names.get(key) || "Поле не уточнено", netWeightKg: 0, cleanWeightKg: 0, tripCount: 0, areaHa: null, harvestedAreaHa: null, yieldCleanWeightKg: null, yieldStatus: "missing_area" as const, yieldTPerHa: null }, plots: new Set<string>(), missingArea: false };
    group.row.netWeightKg += mass; group.row.tripCount++;
    const cleanMass = cleanMassByTicket?.get(ticket.id);
    group.row.cleanWeightKg = group.row.cleanWeightKg == null || cleanMass == null || !Number.isFinite(cleanMass)
      ? null : group.row.cleanWeightKg + cleanMass;
    const plot = areaById.get(ticket.crop_structure_allocation_id || "");
    if (plot && plot.field_id === ticket.field_id && Number(plot.area) > 0) group.plots.add(plot.id);
    else group.missingArea = true;
    groups.set(key, group);
  }
  return Array.from(groups.values()).map(({ row, plots, missingArea }) => {
    const plotIds = Array.from(plots);
    const area = plotIds.reduce((sum, id) => sum + Number(areaById.get(id)?.area || 0), 0);
    const yieldMass = plotIds.reduce((sum, id) => sum + (yieldMassByPlot.get(id) || 0), 0);
    const harvested = plotIds.reduce((sum, id) => sum + (confirmedAreas?.get(id)?.harvestedAreaHa || 0), 0);
    const pending = plotIds.some(id => confirmedAreas?.get(id)?.areaPending || confirmedAreas?.get(id)?.combineShiftOpen);
    const missing = missingArea || !plotIds.length || plotIds.some(id => {
      const ha = confirmedAreas?.get(id)?.harvestedAreaHa;
      return ha == null || !Number.isFinite(ha) || ha <= 0;
    });
    const exceedsPlan = plotIds.some(id => Number(confirmedAreas?.get(id)?.harvestedAreaHa || 0) > Number(areaById.get(id)?.area || 0) + 0.001);
    const unknownMass = plotIds.some(id => unknownPlots.has(id) || !yieldMassByPlot.has(id));
    const yieldStatus: WarehouseFieldOrigin["yieldStatus"] = pending ? "awaiting_shift" : missing ? "missing_area"
      : exceedsPlan ? "area_exceeds_plan" : unknownMass ? "uncertain_mass" : "confirmed";
    return {
      ...row,
      cleanWeightKg: row.cleanWeightKg == null ? null : Number(row.cleanWeightKg.toFixed(3)),
      areaHa: !missingArea && area > 0 ? area : null,
      harvestedAreaHa: !missing && !exceedsPlan ? Number(harvested.toFixed(4)) : null,
      yieldCleanWeightKg: !unknownMass && !missingArea ? Number(yieldMass.toFixed(3)) : null,
      yieldStatus,
      yieldTPerHa: yieldStatus === "confirmed" ? yieldMass / 1000 / harvested : null,
    };
  }).sort((a, b) => a.fieldName.localeCompare(b.fieldName, "ru", { numeric: true }));
}
