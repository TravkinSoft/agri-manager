export type HarvestLotBatchLineageLink = {
  harvest_lot_id?: unknown;
  inventory_batch_id?: unknown;
  source_ticket_id?: unknown;
};

export type HarvestLotInventoryBatchLineage = {
  id?: unknown;
  parent_batch_id?: unknown;
  source_ticket_id?: unknown;
};

export type HarvestLotTicketSource = "link" | "inventory_batch" | "parent_link" | "parent_batch";

export type HarvestLotTicketCandidate = {
  ticketId: string;
  source: HarvestLotTicketSource;
};

export type HarvestLotTicketLineage = {
  harvestLotId: string;
  inventoryBatchId: string;
  ticketId: string | null;
  source: HarvestLotTicketSource | null;
  candidates: HarvestLotTicketCandidate[];
};

export type HarvestLotTicketRecord = {
  id?: unknown;
  op_type?: unknown;
  status?: unknown;
  is_finalized?: unknown;
  is_voided?: unknown;
  replacement_ticket_id?: unknown;
};

const valueId = (value: unknown): string | null => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

/**
 * Keep the first hop aligned with v_harvest_lot_stock_v1, then continue the
 * same link-before-batch precedence through older transfer ancestors.
 */
export function resolveHarvestLotTicketLineage(
  memberLinks: HarvestLotBatchLineageLink[],
  allLinks: HarvestLotBatchLineageLink[],
  batches: HarvestLotInventoryBatchLineage[]
): HarvestLotTicketLineage[] {
  const linksByBatchId = new Map(
    allLinks.flatMap((link) => {
      const batchId = valueId(link.inventory_batch_id);
      return batchId ? [[batchId, link] as const] : [];
    })
  );
  const batchesById = new Map(
    batches.flatMap((batch) => {
      const batchId = valueId(batch.id);
      return batchId ? [[batchId, batch] as const] : [];
    })
  );

  return memberLinks.flatMap((link) => {
    const harvestLotId = valueId(link.harvest_lot_id);
    const inventoryBatchId = valueId(link.inventory_batch_id);
    if (!harvestLotId || !inventoryBatchId) return [];

    const batch = batchesById.get(inventoryBatchId);
    const rawCandidates: Array<[HarvestLotTicketSource, unknown]> = [
      ["link", link.source_ticket_id],
      ["inventory_batch", batch?.source_ticket_id],
    ];
    const visitedBatchIds = new Set([inventoryBatchId]);
    let ancestorBatchId = valueId(batch?.parent_batch_id);
    while (ancestorBatchId && !visitedBatchIds.has(ancestorBatchId)) {
      visitedBatchIds.add(ancestorBatchId);
      const ancestorLink = linksByBatchId.get(ancestorBatchId);
      const ancestorBatch = batchesById.get(ancestorBatchId);
      rawCandidates.push(
        ["parent_link", ancestorLink?.source_ticket_id],
        ["parent_batch", ancestorBatch?.source_ticket_id]
      );
      ancestorBatchId = valueId(ancestorBatch?.parent_batch_id);
    }
    const seenTicketIds = new Set<string>();
    const candidates = rawCandidates.flatMap(([source, value]) => {
      const ticketId = valueId(value);
      if (!ticketId || seenTicketIds.has(ticketId)) return [];
      seenTicketIds.add(ticketId);
      return [{ ticketId, source }];
    });
    const resolved = candidates[0] || null;

    return [{
      harvestLotId,
      inventoryBatchId,
      ticketId: resolved?.ticketId || null,
      source: resolved?.source || null,
      candidates,
    }];
  });
}

export function lineageTicketIds(lineage: HarvestLotTicketLineage[]): string[] {
  return Array.from(new Set(lineage.flatMap((row) => row.candidates.map((candidate) => candidate.ticketId))));
}

export function isEffectiveFinalizedHarvestTicket(ticket: HarvestLotTicketRecord | null | undefined): boolean {
  return Boolean(
    valueId(ticket?.id)
    && String(ticket?.op_type || "") === "harvest_incoming"
    && String(ticket?.status || "") === "finalized"
    && ticket?.is_finalized === true
    && ticket?.is_voided !== true
    && !valueId(ticket?.replacement_ticket_id)
  );
}

export function resolveHarvestTicketIdsByBatch(
  lineage: HarvestLotTicketLineage[],
  tickets: HarvestLotTicketRecord[]
): {
  displayByBatchId: Map<string, string>;
  effectiveByBatchId: Map<string, string>;
} {
  const ticketsById = new Map(tickets.flatMap((ticket) => {
    const ticketId = valueId(ticket.id);
    return ticketId ? [[ticketId, ticket] as const] : [];
  }));
  const displayByBatchId = new Map<string, string>();
  const effectiveByBatchId = new Map<string, string>();

  for (const row of lineage) {
    const harvestCandidates = row.candidates.filter((candidate) => (
      String(ticketsById.get(candidate.ticketId)?.op_type || "") === "harvest_incoming"
    ));
    const effectiveCandidate = harvestCandidates.find((candidate) => (
      isEffectiveFinalizedHarvestTicket(ticketsById.get(candidate.ticketId))
    ));
    const displayCandidate = effectiveCandidate || harvestCandidates[0];
    if (displayCandidate) displayByBatchId.set(row.inventoryBatchId, displayCandidate.ticketId);
    if (effectiveCandidate) effectiveByBatchId.set(row.inventoryBatchId, effectiveCandidate.ticketId);
  }

  return { displayByBatchId, effectiveByBatchId };
}

export function hasCompleteHarvestTicketLineage(
  lineage: HarvestLotTicketLineage[],
  effectiveByBatchId: Map<string, string>,
  inventoryBatchIds?: Iterable<string>
): boolean {
  const targetBatchIds = new Set(
    inventoryBatchIds
      ? Array.from(inventoryBatchIds, (value) => String(value || "").trim()).filter(Boolean)
      : lineage.map((row) => row.inventoryBatchId)
  );
  if (!targetBatchIds.size) return false;
  const lineageBatchIds = new Set(
    lineage
      .map((row) => row.inventoryBatchId)
      .filter((batchId) => targetBatchIds.has(batchId))
  );
  return lineageBatchIds.size === targetBatchIds.size
    && Array.from(targetBatchIds).every((batchId) => effectiveByBatchId.has(batchId));
}

export function lotByTicketIdFromLineage(
  lineage: HarvestLotTicketLineage[],
  allowedTicketIds?: Iterable<string>
): { lotByTicketId: Map<string, string>; conflictingTicketIds: Set<string> } {
  const allowed = allowedTicketIds ? new Set(Array.from(allowedTicketIds, String)) : null;
  const lotByTicketId = new Map<string, string>();
  const conflictingTicketIds = new Set<string>();

  for (const row of lineage) {
    const candidate = row.candidates.find(({ ticketId }) => !allowed || allowed.has(ticketId));
    if (!candidate || conflictingTicketIds.has(candidate.ticketId)) continue;
    const existingLotId = lotByTicketId.get(candidate.ticketId);
    if (existingLotId && existingLotId !== row.harvestLotId) {
      lotByTicketId.delete(candidate.ticketId);
      conflictingTicketIds.add(candidate.ticketId);
      continue;
    }
    lotByTicketId.set(candidate.ticketId, row.harvestLotId);
  }

  return { lotByTicketId, conflictingTicketIds };
}
