import { createClient } from "@supabase/supabase-js";
import { cleanHarvestMassByTicket } from "../../lib/warehouse/clean-harvest-mass";
import { buildWarehouseFieldOrigins } from "../../lib/warehouse/field-origins";
import { resolveHarvestLotTicketLineage, resolveEffectiveHarvestTicketCandidatesByBatch } from "../../lib/weighbridge/harvest-lot-lineage";

async function main() {
  const company = process.argv[2];
  if (!/^[0-9a-f-]{36}$/i.test(company || "")) throw new Error("Provide company UUID");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  async function all(table: string, select: string, filter: (query: any) => any = q => q): Promise<any[]> {
    const rows: any[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await filter(db.from(table).select(select).eq("company_id", company)).order("id").range(start, start + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }
  const [lots, links, batches, tickets, ledger, areas, fields] = await Promise.all([
    all("harvest_lots", "id,lot_code", q => q.eq("status", "active")),
    all("harvest_lot_batches", "id,harvest_lot_id,inventory_batch_id,source_ticket_id"),
    all("inventory_batches", "id,parent_batch_id,source_ticket_id,warehouse_id"),
    all("tickets", "id,field_id,crop_structure_allocation_id,accepted_weight_kg,net_weight_kg,warehouse_to_id,op_type,status,is_finalized,is_voided,replacement_ticket_id", q => q.eq("op_type", "harvest_incoming")),
    all("stock_ledger_entries", "id,inventory_batch_id,batch_id_text,batch_id,reason_type,delta_qty_signed", q => q.ilike("reason_type", "%impurit%")),
    all("crop_structure", "id,field_id,area"), all("fields", "id,name"),
  ]);
  const sources = resolveEffectiveHarvestTicketCandidatesByBatch(resolveHarvestLotTicketLineage(
    batches.map(row => ({ harvest_lot_id: "all", inventory_batch_id: row.id })), links, batches), tickets);
  const clean = cleanHarvestMassByTicket(tickets, sources, ledger);
  const names = new Map<string, string>(fields.map(row => [row.id, row.name]));
  const result = lots.map(lot => {
    const sourceIds = new Set(links.filter(row => row.harvest_lot_id === lot.id).flatMap(row => (sources.get(row.inventory_batch_id) || []).map(t => t.ticketId)));
    const rows = tickets.filter(row => sourceIds.has(row.id));
    return { lot: lot.id, fields: buildWarehouseFieldOrigins(rows, areas, names, rows, clean) };
  }).filter(row => row.fields.length);
  console.log(JSON.stringify({ readOnly: true, lotCount: result.length, result }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
