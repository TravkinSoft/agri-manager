import type { WeighbridgeTicket } from "@/lib/types/weighbridge";

export type TicketCargoLine = NonNullable<WeighbridgeTicket["lines"]>[number];
type TicketJournalWeight = Partial<Pick<WeighbridgeTicket, "net_weight_kg" | "weigh_method">>;

const clean = (value: unknown) => String(value ?? "").trim();
const normalized = (value: unknown) => clean(value).toLocaleLowerCase("ru-RU");

const identityPart = (id: unknown, name: unknown) => clean(id) || normalized(name) || "none";

export function shouldUseCanonicalJournalNet(ticket: TicketJournalWeight | null | undefined): boolean {
  return ticket?.net_weight_kg != null
    && normalized(ticket.weigh_method) !== "manual_override_with_reason";
}

export function aggregateTicketCargoLines(lines: TicketCargoLine[]): TicketCargoLine[] {
  const grouped = new Map<string, TicketCargoLine>();

  for (const line of lines) {
    const cropIdentity = clean(line.crop_id)
      ? `crop:${clean(line.crop_id)}`
      : clean(line.product_id)
        ? `product:${clean(line.product_id)}`
        : `name:${normalized(line.product_name || line.product_name_snapshot)}`;
    const key = [
      cropIdentity,
      `variety:${identityPart(line.variety_id, line.variety_name || line.variety_name_snapshot)}`,
      `reproduction:${identityPart(line.reproduction_id, line.reproduction_name || line.reproduction_name_snapshot)}`,
      `uom:${normalized(line.uom) || "kg"}`,
    ].join("|");
    const current = grouped.get(key);

    if (!current) {
      grouped.set(key, { ...line, quantity: Number(line.quantity || 0) });
      continue;
    }

    grouped.set(key, {
      ...current,
      quantity: Number(current.quantity || 0) + Number(line.quantity || 0),
    });
  }

  return Array.from(grouped.values());
}
