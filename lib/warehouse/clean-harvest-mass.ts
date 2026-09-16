type Ticket = { id: string; accepted_weight_kg?: number | null; net_weight_kg?: number | null };
export type ImpurityEntry = {
  id: string; inventory_batch_id?: string | null; batch_id_text?: string | null;
  batch_id?: string | null; delta_qty_signed: number | string | null; reason_type: string | null;
};

// Follow the original harvest receipt across warehouses. Only impurity ledger
// entries affect clean harvest; sales, transfers and stock balances do not.
// Sum reversals with their originals before deciding whether provenance is unclear.
export function cleanHarvestMassByTicket(
  tickets: Ticket[],
  sourcesByBatch: Map<string, Array<{ ticketId: string }>>,
  entries: ImpurityEntry[],
): Map<string, number | null> {
  const result = new Map(tickets.map(ticket => [ticket.id, Number(ticket.accepted_weight_kg ?? ticket.net_weight_kg)] as const));
  const deltas = new Map<string, number>();
  for (const entry of Array.from(new Map(entries.map(row => [row.id, row])).values())) {
    if (!String(entry.reason_type || "").toLowerCase().includes("impurit")) continue;
    const batchId = entry.inventory_batch_id || entry.batch_id_text || entry.batch_id || "";
    deltas.set(batchId, (deltas.get(batchId) || 0) + Number(entry.delta_qty_signed || 0));
  }
  const unknown = new Set<string>();
  for (const [batchId, delta] of Array.from(deltas)) {
    if (Math.abs(delta) < 0.0005) continue;
    const sources = Array.from(new Set((sourcesByBatch.get(batchId) || []).map(row => row.ticketId))).filter(id => result.has(id));
    if (sources.length !== 1 || !Number.isFinite(delta)) {
      sources.forEach(id => unknown.add(id));
      continue;
    }
    result.set(sources[0], result.get(sources[0])! + delta);
  }
  return new Map(Array.from(result).map(([id, mass]) => [id,
    unknown.has(id) || !Number.isFinite(mass) || mass < -0.001 ? null : Math.max(0, Number(mass.toFixed(3))),
  ]));
}
