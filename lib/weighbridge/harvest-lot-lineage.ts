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

export type HarvestLotTicketSource = "link" | "inventory_batch" | "parent_link" | "parent_batch" | "transformation_input";

export type HarvestLotTransformationInputLink = {
  output_batch_id?: unknown;
  input_batch_id?: unknown;
  input_weight_kg?: unknown;
};

export type HarvestLotTicketCandidate = {
  ticketId: string;
  source: HarvestLotTicketSource;
  enteredProcessingKg?: number | null;
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
  batches: HarvestLotInventoryBatchLineage[],
  transformationInputs: HarvestLotTransformationInputLink[] = []
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
  const transformationInputsByOutputBatchId = new Map<string, Array<{ batchId: string; weightKg: number | null }>>();
  for (const edge of transformationInputs) {
    const outputBatchId = valueId(edge.output_batch_id);
    const inputBatchId = valueId(edge.input_batch_id);
    if (!outputBatchId || !inputBatchId) continue;
    const rawWeight = Number(edge.input_weight_kg);
    const weightKg = Number.isFinite(rawWeight) && rawWeight >= 0 ? rawWeight : null;
    transformationInputsByOutputBatchId.set(outputBatchId, [
      ...(transformationInputsByOutputBatchId.get(outputBatchId) || []),
      { batchId: inputBatchId, weightKg },
    ]);
  }

  return memberLinks.flatMap((link) => {
    const harvestLotId = valueId(link.harvest_lot_id);
    const inventoryBatchId = valueId(link.inventory_batch_id);
    if (!harvestLotId || !inventoryBatchId) return [];

    const rawCandidates: Array<[HarvestLotTicketSource, unknown, number | null, string]> = [];
    const queue: Array<{ batchId: string; enteredProcessingKg: number | null; contributionKey: string; hop: "root" | "parent" | "transformation" }> = [
      { batchId: inventoryBatchId, enteredProcessingKg: null, contributionKey: "direct", hop: "root" },
    ];
    const visitedBatchWeights = new Set<string>();
    while (queue.length) {
      const current = queue.shift() as { batchId: string; enteredProcessingKg: number | null; contributionKey: string; hop: "root" | "parent" | "transformation" };
      const visitKey = `${current.batchId}|${current.enteredProcessingKg ?? "direct"}|${current.contributionKey}`;
      if (visitedBatchWeights.has(visitKey)) continue;
      visitedBatchWeights.add(visitKey);
      const currentLink = linksByBatchId.get(current.batchId);
      const currentBatch = batchesById.get(current.batchId);
      const linkSource: HarvestLotTicketSource = current.hop === "root"
        ? "link"
        : current.hop === "parent" ? "parent_link" : "transformation_input";
      const batchSource: HarvestLotTicketSource = current.hop === "root"
        ? "inventory_batch"
        : current.hop === "parent" ? "parent_batch" : "transformation_input";
      rawCandidates.push(
        [linkSource, currentLink?.source_ticket_id, current.enteredProcessingKg, current.contributionKey],
        [batchSource, currentBatch?.source_ticket_id, current.enteredProcessingKg, current.contributionKey]
      );
      const transformationInputsForBatch = transformationInputsByOutputBatchId.get(current.batchId) || [];
      const parentBatchId = valueId(currentBatch?.parent_batch_id);
      // Processing outputs keep a single parent_batch_id for compatibility, but
      // batch_transformation_inputs is the complete, weighted provenance. Walking
      // both paths counts that parent once as the whole output and again as its
      // actual input contribution.
      if (!transformationInputsForBatch.length && parentBatchId) {
        queue.push({
          batchId: parentBatchId,
          enteredProcessingKg: current.enteredProcessingKg,
          contributionKey: current.contributionKey,
          hop: "parent",
        });
      }
      for (const [inputIndex, input] of Array.from(
        transformationInputsForBatch.entries()
      )) {
        queue.push({
          batchId: input.batchId,
          enteredProcessingKg: input.weightKg,
          contributionKey: `${current.batchId}->${input.batchId}:${inputIndex}`,
          hop: "transformation",
        });
      }
    }
    const candidateBranchesByTicketId = new Map<string, Map<string, HarvestLotTicketCandidate>>();
    rawCandidates.forEach(([source, value, enteredProcessingKg, contributionKey]) => {
      const ticketId = valueId(value);
      if (!ticketId) return;
      const branches = candidateBranchesByTicketId.get(ticketId) || new Map<string, HarvestLotTicketCandidate>();
      const existing = branches.get(contributionKey);
      const existingWeight = Number(existing?.enteredProcessingKg);
      const incomingWeight = Number(enteredProcessingKg);
      if (!existing || (Number.isFinite(incomingWeight) && (!Number.isFinite(existingWeight) || incomingWeight > existingWeight))) {
        branches.set(contributionKey, { ticketId, source, enteredProcessingKg });
      }
      candidateBranchesByTicketId.set(ticketId, branches);
    });
    const candidates = Array.from(candidateBranchesByTicketId.entries()).map(([ticketId, branches]) => {
      const branchCandidates = Array.from(branches.values());
      const weighted = branchCandidates.filter((candidate) => candidate.enteredProcessingKg != null);
      if (!weighted.length) return branchCandidates[0];
      return {
        ticketId,
        source: weighted.some((candidate) => candidate.source === "transformation_input")
          ? "transformation_input" as const
          : weighted[0].source,
        enteredProcessingKg: weighted.reduce((sum, candidate) => sum + Number(candidate.enteredProcessingKg || 0), 0),
      };
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

export function resolveEffectiveHarvestTicketCandidatesByBatch(
  lineage: HarvestLotTicketLineage[],
  tickets: HarvestLotTicketRecord[]
): Map<string, HarvestLotTicketCandidate[]> {
  const ticketsById = new Map(tickets.flatMap((ticket) => {
    const ticketId = valueId(ticket.id);
    return ticketId ? [[ticketId, ticket] as const] : [];
  }));
  return new Map(lineage.map((row) => [
    row.inventoryBatchId,
    row.candidates.filter((candidate) => (
      isEffectiveFinalizedHarvestTicket(ticketsById.get(candidate.ticketId))
    )),
  ]));
}

export function resolveHarvestTicketContributionsForBatches(
  effectiveCandidatesByBatch: Map<string, HarvestLotTicketCandidate[]>,
  batchIds: Iterable<string>
): Map<string, number | null> {
  const contributions = new Map<string, number | null>();
  for (const batchId of Array.from(batchIds)) {
    for (const candidate of effectiveCandidatesByBatch.get(batchId) || []) {
      const weight = candidate.enteredProcessingKg;
      const current = contributions.get(candidate.ticketId);
      if (weight == null) {
        if (!contributions.has(candidate.ticketId)) contributions.set(candidate.ticketId, null);
        continue;
      }
      if (current == null || weight > current) contributions.set(candidate.ticketId, weight);
    }
  }
  return contributions;
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
