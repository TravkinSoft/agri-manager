import { supabase } from "@/lib/supabase/client";

export interface LedgerRow {
  id: string;
  company_id: string;
  ticket_id: string | null;
  processing_id: string | null;
  product_id: string;
  warehouse_id: string;
  direction: "in" | "out";
  quantity: number;
  delta_qty_signed: number;
  reason_type: string;
  occurred_at: string;
  is_storno: boolean;
  storno_of_entry_id: string | null;
  notes: string | null;
  product_name?: string;
  warehouse_name?: string;
}

export async function getLedgerEntries(companyId: string): Promise<LedgerRow[]> {
  const { data, error } = await supabase
    .from("stock_ledger_entries")
    .select(`
      *,
      products:product_id(name),
      warehouses:warehouse_id(name)
    `)
    .eq("company_id", companyId)
    .order("occurred_at", { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => ({
    ...row,
    quantity: Number(row.quantity || 0),
    delta_qty_signed: Number(row.delta_qty_signed || 0),
    product_name: row.products?.name || "-",
    warehouse_name: row.warehouses?.name || "-",
  }));
}

