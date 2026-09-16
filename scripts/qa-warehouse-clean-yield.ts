import assert from "node:assert/strict";
import { cleanHarvestMassByTicket } from "../lib/warehouse/clean-harvest-mass";
import { buildWarehouseFieldOrigins } from "../lib/warehouse/field-origins";

const t = { id: "soraya", field_id: "49-2", crop_structure_allocation_id: "soraya-elite", net_weight_kg: 636470, op_type: "harvest_incoming", status: "finalized", is_finalized: true, is_voided: false };
const t2 = { ...t, id: "gala", field_id: "28", crop_structure_allocation_id: "gala-2", net_weight_kg: 100000 };
const areas = [{ id: "soraya-elite", field_id: "49-2", area: 10 }, { id: "gala-2", field_id: "28", area: 20 }];
const names = new Map([["49-2", "49-2"], ["28", "28"]]);
const sources = new Map([["b1", [{ ticketId: t.id }]], ["transferred", [{ ticketId: t.id }]], ["b2", [{ ticketId: t2.id }]]]);
const rows = [
  { id: "soil", inventory_batch_id: "b1", reason_type: "weighbridge_impurities", delta_qty_signed: -207660 },
  { id: "sale", inventory_batch_id: "b1", reason_type: "shipment_outbound", delta_qty_signed: -100000 },
  { id: "transfer", inventory_batch_id: "b1", reason_type: "transfer_out", delta_qty_signed: -80000 },
  { id: "shared-member", inventory_batch_id: "b2", reason_type: "weighbridge_impurities_shared_member", delta_qty_signed: -7000 },
  { id: "shared-pool", inventory_batch_id: "pool", reason_type: "weighbridge_impurities_shared", delta_qty_signed: -7000 },
];
let masses = cleanHarvestMassByTicket([t, t2], sources, [...rows, rows[0]]);
assert.equal(masses.get(t.id), 428810, "Soraya: impurities counted once; sales and transfers excluded");
assert.equal(masses.get(t2.id), 93000, "shared member deduction not duplicated by pool entry");
let fields = buildWarehouseFieldOrigins([t, t, t2], areas, names, [t, t2], masses);
assert.equal(fields.find(row => row.fieldId === "49-2")?.cleanWeightKg, 428810);
assert.equal(fields.find(row => row.fieldId === "49-2")?.yieldTPerHa, 42.881);
assert.equal(fields.find(row => row.fieldId === "28")?.yieldTPerHa, 4.65);
const reversal = { ...rows[0], id: "undo-soil", reason_type: "storno_weighbridge_impurities", delta_qty_signed: 207660 };
assert.equal(cleanHarvestMassByTicket([t], sources, [...rows, reversal]).get(t.id), 636470, "voided impurity restores clean yield");
assert.equal(cleanHarvestMassByTicket([t], sources, [...rows, { ...rows[0], id: "later-soil", inventory_batch_id: "transferred", delta_qty_signed: -1000 }]).get(t.id), 427810, "impurities after transfer still reduce original harvest");
assert.equal(cleanHarvestMassByTicket([t], sources, [{ ...rows[0], inventory_batch_id: null, batch_id_text: "b1" }]).get(t.id), 428810, "legacy text batch id supported");
assert.equal(cleanHarvestMassByTicket([t], sources, [{ ...rows[0], inventory_batch_id: null, batch_id: "b1" }]).get(t.id), 428810);
const ambiguous = new Map(sources).set("mixed", [{ ticketId: t.id }, { ticketId: t2.id }]);
const mixedRow = { ...rows[0], id: "mixed-soil", inventory_batch_id: "mixed", delta_qty_signed: -100 };
masses = cleanHarvestMassByTicket([t, t2], ambiguous, [mixedRow]);
fields = buildWarehouseFieldOrigins([t, t2], areas, names, [t, t2], masses);
assert.ok(fields.every(row => row.cleanWeightKg === null && row.yieldTPerHa === null), "unallocated mixed impurities cannot show false yield");
assert.equal(cleanHarvestMassByTicket([t, t2], ambiguous, [mixedRow, { ...mixedRow, id: "undo-mixed", delta_qty_signed: 100 }]).get(t.id), 636470, "reversed ambiguity no longer blocks yield");
assert.equal(cleanHarvestMassByTicket([t], sources, [{ ...rows[0], delta_qty_signed: -700000 }]).get(t.id), null, "inconsistent negative clean mass is not silently clamped");
assert.equal(buildWarehouseFieldOrigins([t], [], names, [t], cleanHarvestMassByTicket([t], sources, rows))[0].yieldTPerHa, null, "no invented area");
assert.equal(buildWarehouseFieldOrigins([{ ...t, is_voided: true }], areas, names).length, 0);
console.log("PASS warehouse clean harvest: Soraya 428810 kg / 42.881 t/ha, shared impurities, reversals, transfers, sales, missing provenance and duplicates");
