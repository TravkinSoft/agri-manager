import { NextRequest } from "next/server";
import { summaryAccess, summaryChunks, summaryRows } from "@/lib/dashboard/summary-server";
import { failed, noStore } from "@/lib/traffic/server";
import { isPotatoLabel } from "@/lib/dashboard/harvest-summary";
import type { SummaryStock } from "@/lib/dashboard/operational-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const name = (row: any) => String(row?.name_ru || row?.name || row?.code || "").trim();
export async function GET(request: NextRequest) {
  try {
    const { companyId, db } = await summaryAccess(request);
    // Fully paginated ledger-backed balance; do not add receipt totals to this balance.
    const stocks = await summaryRows(() => db.from("v_harvest_lot_stock_v2")
      .select("harvest_lot_id,warehouse_id,current_weight_kg,batch_class,physical_state")
      .eq("company_id", companyId).order("harvest_lot_id").order("warehouse_id").order("batch_class").order("physical_state"));
    const lots = await summaryChunks(stocks.map(row => row.harvest_lot_id), ids => db.from("harvest_lots")
      .select("id,season_id,crop_id,variety_id,reproduction_id").eq("company_id", companyId).in("id", ids).order("id"));
    const [crops, varieties, reproductions, seasons, warehouses] = await Promise.all([
      summaryChunks(lots.map(row => row.crop_id), ids => db.from("crops").select("id,name,name_ru").in("id", ids).order("id")),
      summaryChunks(lots.map(row => row.variety_id), ids => db.from("varieties").select("id,name,name_ru").in("id", ids).order("id")),
      summaryChunks(lots.map(row => row.reproduction_id), ids => db.from("seed_reproductions").select("id,name,name_ru,code").in("id", ids).order("id")),
      summaryChunks(lots.map(row => row.season_id), ids => db.from("seasons").select("id,year").eq("company_id", companyId).in("id", ids).order("id")),
      summaryChunks(stocks.map(row => row.warehouse_id), ids => db.from("warehouses").select("id,name").eq("company_id", companyId).in("id", ids).order("id")),
    ]);
    const index = (rows: any[]) => new Map(rows.map(row => [row.id, row]));
    const lotById = index(lots), cropById = index(crops), varietyById = index(varieties), repById = index(reproductions), seasonById = index(seasons), warehouseById = index(warehouses);
    const groups = new Map<string, SummaryStock["warehouses"][number]>();
    for (const row of stocks) {
      if (row.batch_class === "waste") continue;
      const lot = lotById.get(row.harvest_lot_id);
      if (!lot || !cropById.has(lot.crop_id)) throw new Error("Не удалось определить культуру складского остатка");
      if (!isPotatoLabel(name(cropById.get(lot.crop_id)))) continue;
      const kg = Number(row.current_weight_kg);
      if (!Number.isFinite(kg)) throw new Error("Некорректный складской остаток");
      if (!kg) continue;
      if (!row.warehouse_id || !warehouseById.has(row.warehouse_id)) throw new Error("Склад остатка не определён");
      const group: SummaryStock["warehouses"][number] = groups.get(row.warehouse_id) || { id: row.warehouse_id, name: name(warehouseById.get(row.warehouse_id)), totalKg: 0, lastReceiptAt: null, parties: [] };
      let party = group.parties.find(item => item.id === lot.id);
      if (!party) {
        party = { id: lot.id, label: [name(varietyById.get(lot.variety_id)) || "Сорт не указан", name(repById.get(lot.reproduction_id)) || "Репродукция не указана"].join(" · "), season: String(seasonById.get(lot.season_id)?.year || "Сезон не указан"), kg: 0 };
        group.parties.push(party);
      }
      party.kg += kg;
      group.totalKg += kg;
      groups.set(group.id, group);
    }
    // Bounded concurrency; exact last receipt per displayed warehouse, not an arbitrary last-N ticket window.
    const result = Array.from(groups.values());
    for (let offset = 0; offset < result.length; offset += 4) {
      await Promise.all(result.slice(offset, offset + 4).map(async warehouse => {
        const receipt = await db.from("tickets").select("finalized_at").eq("company_id", companyId)
          .eq("warehouse_to_id", warehouse.id).eq("op_type", "harvest_incoming").eq("status", "finalized")
          .eq("is_finalized", true).eq("is_voided", false).is("replacement_ticket_id", null)
          .order("finalized_at", { ascending: false, nullsFirst: false }).order("id").limit(1).maybeSingle();
        if (receipt.error) throw receipt.error;
        warehouse.lastReceiptAt = receipt.data?.finalized_at || null;
        warehouse.parties = warehouse.parties.filter(party => party.kg !== 0).sort((a, b) => b.kg - a.kg || a.id.localeCompare(b.id));
      }));
    }
    result.sort((a, b) => Date.parse(b.lastReceiptAt || "1970-01-01") - Date.parse(a.lastReceiptAt || "1970-01-01") || a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id));
    return noStore({ companyId, readOnly: true, serverTime: new Date().toISOString(), totalKg: result.reduce((sum, row) => sum + row.totalKg, 0), warehouses: result } satisfies SummaryStock);
  } catch (error) { return failed(error); }
}
