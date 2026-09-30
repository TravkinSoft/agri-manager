export type FieldHarvestTicketRow = {
  id: string;
  company_id: string;
  season_id: string | null;
  field_id: string | null;
  crop_structure_allocation_id: string | null;
  op_type: string;
  status: string;
  is_finalized: boolean;
  is_voided: boolean;
  replacement_ticket_id?: string | null;
  accepted_weight_kg?: number | null;
  net_weight_kg?: number | null;
  finalized_at?: string | null;
};

export type FieldHarvestLedgerRow = {
  ticket_id: string | null;
  company_id?: string | null;
  direction?: string | null;
  delta_qty_signed?: number | null;
  reason_type?: string | null;
  is_storno?: boolean | null;
};

export type FieldHarvestStructureRow = {
  id: string;
  company_id?: string | null;
  season_id?: string | null;
  field_id?: string | null;
  land_use_type?: string | null;
  area?: number | null;
};

export type FieldHarvestReconciliationStatus =
  | "empty"
  | "reconciled"
  | "ticket_only"
  | "mismatch"
  | "unavailable";

export type FieldHarvestAllocationProjection = {
  allocationId: string;
  areaHa: number;
  acceptedMassKg: number;
  finalizedTicketCount: number;
  yieldTPerHa: number | null;
};

export type FieldHarvestProjection = {
  companyId: string;
  seasonId: string;
  fieldId: string;
  acceptedMassKg: number;
  finalizedTicketCount: number;
  latestFinalizedAt: string | null;
  yieldAreaHa: number;
  yieldTPerHa: number | null;
  yieldBasis: "season_structure_area" | "field_area" | "unavailable";
  ledgerMassKg: number;
  ledgerTicketCount: number;
  reconciliationStatus: FieldHarvestReconciliationStatus;
  unassignedAcceptedMassKg: number;
  byAllocation: FieldHarvestAllocationProjection[];
  fetchedAt: string;
  source: "effective_finalized_harvest_tickets+stock_ledger_entries";
};

const LEDGER_TOLERANCE_KG = 0.01;

function finiteNonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function isEffectiveFieldHarvestTicket(
  ticket: FieldHarvestTicketRow,
  scope: { companyId: string; seasonId: string; fieldId: string }
): boolean {
  return (
    ticket.company_id === scope.companyId &&
    ticket.season_id === scope.seasonId &&
    ticket.field_id === scope.fieldId &&
    ticket.op_type === "harvest_incoming" &&
    ticket.status === "finalized" &&
    ticket.is_finalized === true &&
    ticket.is_voided === false &&
    !ticket.replacement_ticket_id
  );
}

export function acceptedTicketMassKg(ticket: FieldHarvestTicketRow): number {
  return finiteNonNegative(ticket.accepted_weight_kg ?? ticket.net_weight_kg);
}

function isHarvestIncomingLedgerEntry(
  entry: FieldHarvestLedgerRow,
  companyId: string,
  effectiveTicketIds: Set<string>
): boolean {
  const reason = String(entry.reason_type || "").trim().toLowerCase();
  return (
    Boolean(entry.ticket_id && effectiveTicketIds.has(entry.ticket_id)) &&
    (!entry.company_id || entry.company_id === companyId) &&
    String(entry.direction || "").toLowerCase() === "in" &&
    entry.is_storno !== true &&
    reason.startsWith("harvest_incoming") &&
    finiteNonNegative(entry.delta_qty_signed) > 0
  );
}

export function buildFieldHarvestProjection(input: {
  companyId: string;
  seasonId: string;
  fieldId: string;
  fieldAreaHa: number;
  tickets: FieldHarvestTicketRow[];
  ledgerEntries: FieldHarvestLedgerRow[];
  structureRows: FieldHarvestStructureRow[];
  ledgerAvailable?: boolean;
  fetchedAt?: string;
}): FieldHarvestProjection {
  const scope = {
    companyId: input.companyId,
    seasonId: input.seasonId,
    fieldId: input.fieldId,
  };
  const tickets = input.tickets.filter((ticket) => isEffectiveFieldHarvestTicket(ticket, scope));
  const effectiveTicketIds = new Set(tickets.map((ticket) => ticket.id));
  const acceptedMassByTicket = new Map(
    tickets.map((ticket) => [ticket.id, acceptedTicketMassKg(ticket)])
  );
  const acceptedMassKg = round(
    Array.from(acceptedMassByTicket.values()).reduce((sum, massKg) => sum + massKg, 0),
    3
  );

  const scopedStructureRows = input.structureRows.filter((row) =>
    (!row.company_id || row.company_id === input.companyId) &&
    (!row.season_id || row.season_id === input.seasonId) &&
    (!row.field_id || row.field_id === input.fieldId) &&
    row.land_use_type !== "fallow"
  );
  const allocationAreaById = new Map(
    scopedStructureRows.map((row) => [String(row.id), finiteNonNegative(row.area)])
  );
  const seasonStructureAreaHa = round(
    Array.from(allocationAreaById.values()).reduce((sum, areaHa) => sum + areaHa, 0),
    4
  );
  const fieldAreaHa = round(finiteNonNegative(input.fieldAreaHa), 4);
  const yieldAreaHa = seasonStructureAreaHa > 0 ? seasonStructureAreaHa : fieldAreaHa;
  const yieldBasis = seasonStructureAreaHa > 0
    ? "season_structure_area" as const
    : fieldAreaHa > 0
      ? "field_area" as const
      : "unavailable" as const;
  const yieldTPerHa = acceptedMassKg > 0 && yieldAreaHa > 0
    ? round(acceptedMassKg / 1000 / yieldAreaHa, 3)
    : null;

  const allocationTicketTotals = new Map<string, { acceptedMassKg: number; ticketIds: Set<string> }>();
  let unassignedAcceptedMassKg = 0;
  for (const ticket of tickets) {
    const allocationId = String(ticket.crop_structure_allocation_id || "");
    const ticketMassKg = acceptedMassByTicket.get(ticket.id) || 0;
    if (!allocationId || !allocationAreaById.has(allocationId)) {
      unassignedAcceptedMassKg += ticketMassKg;
      continue;
    }
    const current = allocationTicketTotals.get(allocationId) || {
      acceptedMassKg: 0,
      ticketIds: new Set<string>(),
    };
    current.acceptedMassKg += ticketMassKg;
    current.ticketIds.add(ticket.id);
    allocationTicketTotals.set(allocationId, current);
  }

  const byAllocation = scopedStructureRows.map((row) => {
    const allocationId = String(row.id);
    const areaHa = allocationAreaById.get(allocationId) || 0;
    const totals = allocationTicketTotals.get(allocationId);
    const allocationMassKg = round(totals?.acceptedMassKg || 0, 3);
    return {
      allocationId,
      areaHa,
      acceptedMassKg: allocationMassKg,
      finalizedTicketCount: totals?.ticketIds.size || 0,
      yieldTPerHa: allocationMassKg > 0 && areaHa > 0
        ? round(allocationMassKg / 1000 / areaHa, 3)
        : null,
    };
  });

  const ledgerRows = input.ledgerEntries.filter((entry) =>
    isHarvestIncomingLedgerEntry(entry, input.companyId, effectiveTicketIds)
  );
  const ledgerMassByTicket = new Map<string, number>();
  for (const entry of ledgerRows) {
    const ticketId = String(entry.ticket_id);
    ledgerMassByTicket.set(
      ticketId,
      (ledgerMassByTicket.get(ticketId) || 0) + finiteNonNegative(entry.delta_qty_signed)
    );
  }
  const ledgerMassKg = round(
    Array.from(ledgerMassByTicket.values()).reduce((sum, massKg) => sum + massKg, 0),
    3
  );
  const ledgerAvailable = input.ledgerAvailable !== false;
  let reconciliationStatus: FieldHarvestReconciliationStatus;
  if (!ledgerAvailable) {
    reconciliationStatus = "unavailable";
  } else if (tickets.length === 0) {
    reconciliationStatus = "empty";
  } else if (ledgerMassByTicket.size === 0) {
    reconciliationStatus = "ticket_only";
  } else if (
    ledgerMassByTicket.size === tickets.length &&
    Math.abs(ledgerMassKg - acceptedMassKg) <= LEDGER_TOLERANCE_KG
  ) {
    reconciliationStatus = "reconciled";
  } else {
    reconciliationStatus = "mismatch";
  }

  const latestFinalizedAt = tickets
    .map((ticket) => String(ticket.finalized_at || ""))
    .filter((value) => value && Number.isFinite(new Date(value).getTime()))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null;

  return {
    companyId: input.companyId,
    seasonId: input.seasonId,
    fieldId: input.fieldId,
    acceptedMassKg,
    finalizedTicketCount: tickets.length,
    latestFinalizedAt,
    yieldAreaHa,
    yieldTPerHa,
    yieldBasis,
    ledgerMassKg,
    ledgerTicketCount: ledgerMassByTicket.size,
    reconciliationStatus,
    unassignedAcceptedMassKg: round(unassignedAcceptedMassKg, 3),
    byAllocation,
    fetchedAt: input.fetchedAt || new Date().toISOString(),
    source: "effective_finalized_harvest_tickets+stock_ledger_entries",
  };
}
