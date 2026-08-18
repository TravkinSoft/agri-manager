import type { WeighbridgeTicket } from "@/lib/types/weighbridge";

export const UNRECORDED_OPERATOR = "Оператор не зафиксирован";
export const LOADING_OPERATOR = "Имя оператора загружается";

export type TicketOperatorFact = {
  label: "Весовщик" | "Открыл" | "Завершил";
  value: string;
};

const clean = (value: unknown) => String(value || "").trim();

export function ticketOperatorFacts(ticket: WeighbridgeTicket): TicketOperatorFact[] {
  const openedBy = clean(ticket.opened_by_person_name);
  const finalizedBy = clean(ticket.finalized_by_person_name);

  if (openedBy && finalizedBy && openedBy === finalizedBy) {
    return [{ label: "Весовщик", value: openedBy }];
  }

  if (openedBy || finalizedBy) {
    const facts: TicketOperatorFact[] = [];
    if (openedBy) facts.push({ label: "Открыл", value: openedBy });
    if (finalizedBy) facts.push({ label: "Завершил", value: finalizedBy });
    return facts;
  }

  if (
    clean(ticket.created_by_person_id) ||
    clean(ticket.finalized_by_person_id) ||
    ticket.operator_attribution_source === "ticket_person" ||
    ticket.operator_attribution_source === "shift_unambiguous"
  ) {
    return [{ label: "Весовщик", value: LOADING_OPERATOR }];
  }

  return [{ label: "Весовщик", value: UNRECORDED_OPERATOR }];
}
