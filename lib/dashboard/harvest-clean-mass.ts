import type { WeighbridgeTicket } from "@/lib/types/weighbridge";

/** Read projection from the receipt's soil ledger, not its remaining stock. */
export function harvestCleanKg(ticket: WeighbridgeTicket): number {
  const value = Number(ticket.harvest_clean_weight_kg ?? ticket.accepted_weight_kg ?? ticket.net_weight_kg ?? 0);
  return Number.isFinite(value) ? value : 0;
}
