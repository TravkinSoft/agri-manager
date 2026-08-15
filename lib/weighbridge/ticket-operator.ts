import type { WeighbridgeTicket } from "@/lib/types/weighbridge";

export const UNRECORDED_OPERATOR = "Оператор не зафиксирован";

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

  return [{ label: "Весовщик", value: UNRECORDED_OPERATOR }];
}
