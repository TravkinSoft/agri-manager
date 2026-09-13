import { str, type Row } from "./contracts";

/** Mirrors the canonical harvest business clock without importing a broad engine.
 * Only two projected paper_backfill scalars enter this runtime, never audit_json. */
export function businessTime(
  ticket: Row,
  tickets: Row[],
  visited = new Set<string>(),
): string | undefined {
  const valid = (value: string): string | undefined =>
    value && Number.isFinite(Date.parse(value)) ? value : undefined;
  if (
    ticket.paper_source === "paper_journal" &&
    valid(str(ticket, "paper_recorded_at"))
  )
    return str(ticket, "paper_recorded_at");
  const id = str(ticket, "id");
  if (visited.has(id)) return undefined;
  visited.add(id);
  if (ticket.correction_of_ticket_id) {
    const root = tickets.find((t) => t.id === ticket.correction_of_ticket_id);
    if (!root) return undefined;
    return businessTime(root, tickets, visited);
  }
  return (
    valid(str(ticket, "finalized_at")) ||
    valid(str(ticket, "weighing_2_at")) ||
    valid(str(ticket, "updated_at")) ||
    valid(str(ticket, "created_at"))
  );
}
