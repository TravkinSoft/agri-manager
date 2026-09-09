import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  aggregateTicketCargoLines,
  shouldUseCanonicalJournalNet,
  type TicketCargoLine,
} from "../lib/weighbridge/ticket-cargo-composition";

const potatoLine = (id: string, quantity: number): TicketCargoLine => ({
  id,
  product_id: "potato",
  crop_id: "potato-crop",
  product_name: "Картофель",
  product_name_snapshot: "Картофель",
  variety_id: "gala",
  variety_name: "Гала",
  reproduction_id: "second",
  reproduction_name: "Вторая репродукция",
  quantity,
  uom: "kg",
});

const fifoLines = aggregateTicketCargoLines([
  potatoLine("batch-a", 1_580),
  potatoLine("batch-b", 6_720),
]);
assert.equal(fifoLines.length, 1);
assert.equal(Number(fifoLines[0]?.quantity), 8_300);
assert.equal(fifoLines[0]?.product_name_snapshot, "Картофель");

const nextFifoLines = aggregateTicketCargoLines([
  potatoLine("batch-b-tail", 3_220),
  potatoLine("batch-c", 5_300),
]);
assert.equal(nextFifoLines.length, 1);
assert.equal(Number(nextFifoLines[0]?.quantity), 8_520);

assert.equal(shouldUseCanonicalJournalNet({ net_weight_kg: 8_520, weigh_method: "preset_tare" }), true);
assert.equal(shouldUseCanonicalJournalNet({ net_weight_kg: 8_520, weigh_method: "double_weighing" }), true);
assert.equal(shouldUseCanonicalJournalNet({ net_weight_kg: 20, weigh_method: "manual_override_with_reason" }), false);
assert.equal(shouldUseCanonicalJournalNet({ net_weight_kg: null, weigh_method: "preset_tare" }), false);

const page = readFileSync(resolve(process.cwd(), "app/(dashboard)/weighbridge/page.tsx"), "utf8");
assert.match(page, /import \{ aggregateTicketCargoLines, shouldUseCanonicalJournalNet \} from "@\/lib\/weighbridge\/ticket-cargo-composition"/);
assert.match(page, /const productSummary[\s\S]{0,180}aggregateTicketCargoLines\(ticket\?\.lines \|\| \[\]\)/);

const quantityBlock = page.slice(page.indexOf("const ticketQuantitySummary"), page.indexOf("const ticketCardMeta"));
const canonicalNet = quantityBlock.indexOf("shouldUseCanonicalJournalNet(ticket)");
const fifoFallback = quantityBlock.indexOf("aggregateTicketCargoLines(ticket?.lines || [])");
assert.ok(canonicalNet >= 0 && canonicalNet < fifoFallback, "canonical ticket net must win over internal FIFO lines");
assert.match(quantityBlock, /formatQuantityWithUnit\(ticket\.net_weight_kg, "kg"\)/);
assert.doesNotMatch(quantityBlock, /correction_of_ticket_id/);
assert.match(page, /shouldUseCanonicalJournalNet\(t\) \? "Нетто" : "Количество"/);

console.log("P0 WEIGHBRIDGE JOURNAL SUMMARY: 15/15 PASS");
