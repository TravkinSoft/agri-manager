import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregateTicketCargoLines, type TicketCargoLine } from "../lib/weighbridge/ticket-cargo-composition";

const paper = readFileSync("components/weighbridge/weighbridge-ticket-paper.tsx", "utf8");

const line = (overrides: Partial<TicketCargoLine>): TicketCargoLine => ({
  id: "line",
  product_id: "wheat-product",
  crop_id: "wheat-crop",
  product_name: "Пшеница",
  quantity: 0,
  uom: "kg",
  variety_id: "lamis",
  variety_name: "Ламис",
  reproduction_id: "r2",
  reproduction_name: "2 репродукция",
  ...overrides,
});

const exactTicket = aggregateTicketCargoLines([
  line({ id: "batch-a", quantity: 13_000 }),
  line({ id: "batch-b", quantity: 12_000 }),
  line({ id: "batch-c", quantity: 5_000 }),
]);
assert.equal(exactTicket.length, 1);
assert.equal(exactTicket[0]?.product_name, "Пшеница");
assert.equal(exactTicket[0]?.quantity, 30_000);

const distinctIdentity = aggregateTicketCargoLines([
  line({ id: "lamis", quantity: 10_000 }),
  line({ id: "other-variety", variety_id: "other", variety_name: "Айна", quantity: 8_000 }),
  line({ id: "other-reproduction", reproduction_id: "elite", reproduction_name: "Элита", quantity: 7_000 }),
]);
assert.equal(distinctIdentity.length, 3);

const nonCropProducts = aggregateTicketCargoLines([
  line({ id: "fertilizer-a", crop_id: null, product_id: "fertilizer-a", product_name: "NPK", variety_id: null, reproduction_id: null, quantity: 5 }),
  line({ id: "fertilizer-b", crop_id: null, product_id: "fertilizer-b", product_name: "Карбамид", variety_id: null, reproduction_id: null, quantity: 7 }),
]);
assert.equal(nonCropProducts.length, 2);

const differentUnits = aggregateTicketCargoLines([
  line({ id: "kg", quantity: 5, uom: "kg" }),
  line({ id: "litres", quantity: 5, uom: "l" }),
]);
assert.equal(differentUnits.length, 2);

assert.match(paper, /PaperSection title="СОСТАВ ГРУЗА"/);
assert.match(paper, /aggregateTicketCargoLines\(lines\)/);
assert.doesNotMatch(paper, /ТОВАРЫ В ДОКУМЕНТЕ/);

console.log("TZ315 ticket cargo composition PASS: 7/7");
