import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const company = "company";
const ticket = { id: "t1", company_id: company, op_type: "harvest_incoming", field_id: "f92", crop_structure_allocation_id: "plot", warehouse_to_id: "w1", net_weight_kg: 200000, status: "finalized", is_finalized: true, is_voided: false, replacement_ticket_id: null };
const tables: Record<string, any[]> = {
  harvest_lots: [{ id: "lot-a", company_id: company, status: "active", crop_id: "crop", season_id: "season" }],
  harvest_lot_batches: [{ company_id: company, harvest_lot_id: "lot-a", inventory_batch_id: "b1", source_ticket_id: "t1" }],
  v_harvest_lot_stock_v2: [{ company_id: company, harvest_lot_id: "lot-a", warehouse_id: "w1", current_weight_kg: 100000 }],
  inventory_batches: [
    { id: "b1", company_id: company, source_ticket_id: "t1", warehouse_id: "w1", parent_batch_id: null },
    { id: "b2", company_id: company, source_ticket_id: "t2", warehouse_id: "w2", parent_batch_id: null },
    { id: "child", company_id: company, source_ticket_id: null, warehouse_id: "w2", parent_batch_id: "b1" },
    { id: "grandchild", company_id: company, source_ticket_id: null, warehouse_id: "w3", parent_batch_id: "child" },
  ],
  tickets: [ticket, { ...ticket, id: "t2", warehouse_to_id: "w2", net_weight_kg: 141010 },
    { ...ticket, id: "foreign", company_id: "foreign", net_weight_kg: 99999999 },
    { ...ticket, id: "void", is_voided: true, net_weight_kg: 99999999 },
    { ...ticket, id: "replaced", replacement_ticket_id: "t1", net_weight_kg: 99999999 }],
  crop_structure: [{ id: "plot", company_id: company, field_id: "f92", area: 92 }],
  fields: [{ id: "f92", company_id: company, name: "виноград" }],
  crops: [{ id: "crop", name: "Картофель" }], seasons: [{ id: "season", company_id: company, year: 2026 }],
  warehouses: [{ id: "w1", company_id: company, name: "Склад" }],
  stock_ledger_entries: [
    { id: "soil1", company_id: company, inventory_batch_id: "b1", reason_type: "weighbridge_impurities", delta_qty_signed: -50000 },
    { id: "soil2", company_id: company, inventory_batch_id: "b2", reason_type: "weighbridge_impurities", delta_qty_signed: -42380 },
    { id: "later-soil", company_id: company, inventory_batch_id: "grandchild", reason_type: "weighbridge_impurities", delta_qty_signed: -1000 },
  ],
  ptc_combine_field_segments: [{ id: "seg", company_id: company, crop_structure_id: "plot", shift_id: "shift", hectares_segment: 5.87, closed_at: "2026-09-21T20:00:00Z" }],
  ptc_combine_shifts: [{ id: "shift", company_id: company, closed_at: "2026-09-21T20:00:00Z" }],
};
let reads = 0;
const db = { from(table: string) {
  let rows = tables[table] || []; let scoped = false;
  const query: any = {
    select() { return query; },
    eq(key: string, value: any) { if (key === "company_id") { assert.equal(value, company); scoped = true; } rows = rows.filter(row => row[key] === value); return query; },
    is(key: string, value: any) { rows = rows.filter(row => value === null ? row[key] == null : row[key] === value); return query; },
    in(key: string, values: any[]) { rows = rows.filter(row => values.includes(row[key])); return query; },
    ilike(key: string, pattern: string) { rows = rows.filter(row => String(row[key]).toLowerCase().includes(pattern.replaceAll("%", "").toLowerCase())); return query; },
    order() { return query; }, limit(n: number) { rows = rows.slice(0, n); return query; },
    range(start: number, end: number) { rows = rows.slice(start, end + 1); return query; },
    then(resolve: any, reject: any) {
      assert(scoped || ["crops", "varieties", "seed_reproductions"].includes(table), `${table} read must be tenant scoped`);
      reads++; return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  }; return query;
} };
const localRequire = createRequire(import.meta.url);
const source = readFileSync("app/api/weighbridge/harvest-batches/route.ts", "utf8") + "\nexports.loadOriginsForTest = loadAggregateHarvestLots;";
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: any = {};
vm.runInNewContext(compiled, { exports, process, console, setTimeout, require(name: string) {
  if (["next/server", "@/app/api/weighbridge/_auth", "@/lib/supabase/service"].includes(name)) return {};
  return localRequire(name.startsWith("@/") ? path.resolve(name.slice(2)) : name);
} });
async function main() {
  const load = () => exports.loadOriginsForTest(db, db, company, "w1", "lot-a", true);
  const result = await load(); const field = result[0].fieldSummaries[0];
  assert.equal(field.netWeightKg, 200000);
  assert.equal(field.cleanWeightKg, 149000, "soil on two-hop transfer without source_ticket_id follows its origin");
  assert.equal(field.areaHa, 92); assert.equal(field.harvestedAreaHa, 5.87);
  assert.equal(field.yieldCleanWeightKg, 247630, "includes same plot's other lot in another warehouse; excludes foreign/void/replaced");
  assert.equal(field.yieldTPerHa, 247.63 / 5.87);
  tables.ptc_combine_field_segments.push({ id: "today", company_id: company, crop_structure_id: "plot", shift_id: "open", hectares_segment: null, closed_at: null });
  tables.ptc_combine_shifts.push({ id: "open", company_id: company, closed_at: null });
  const waiting = (await load())[0].fieldSummaries[0];
  assert.equal(waiting.yieldTPerHa, null); assert.equal(waiting.yieldStatus, "awaiting_shift");
  assert(reads > 0); console.log(`PASS actual origins loader: tenant scope, complete cohort, two-hop transfer, open shift (${reads} fixture reads, no writes)`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
