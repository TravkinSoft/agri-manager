import type { SupabaseClient } from "@supabase/supabase-js";

export type WarehouseDeleteCheckResult = {
  canDelete: boolean;
  reasons: string[];
  stats: {
    stockBalanceRows: number;
    stockBalanceQty: number;
    inventoryTransactions: number;
    stockLedgerEntries: number;
    tickets: number;
    issueRequests: number;
    fieldMaterialConsumptions: number;
    batchInputs: number;
    batchOutputs: number;
  };
};

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function countByQuery(queryPromise: PromiseLike<{ count: number | null; error: any }>): Promise<number> {
  const { count, error } = await queryPromise;
  if (error) {
    return 0;
  }
  return toInt(count);
}

export async function getWarehouseDeleteCheck(
  supabase: SupabaseClient,
  companyId: string,
  warehouseId: string
): Promise<WarehouseDeleteCheckResult> {
  const [stockBalanceRes, stockBalanceQtyRes] = await Promise.all([
    supabase
      .from("v_stock_balance_canonical")
      .select("warehouse_id, quantity", { count: "exact", head: false })
      .eq("company_id", companyId)
      .eq("warehouse_id", warehouseId)
      .neq("quantity", 0),
    supabase
      .from("v_stock_balance_canonical")
      .select("quantity")
      .eq("company_id", companyId)
      .eq("warehouse_id", warehouseId),
  ]);

  const inventoryTransactions = await countByQuery(
    supabase
      .from("inventory_transactions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .or(`warehouse_id.eq.${warehouseId},source_warehouse_id.eq.${warehouseId},destination_warehouse_id.eq.${warehouseId}`)
  );

  const stockLedgerEntries = await countByQuery(
    supabase
      .from("stock_ledger_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("warehouse_id", warehouseId)
  );

  const tickets = await countByQuery(
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .or(`warehouse_from_id.eq.${warehouseId},warehouse_to_id.eq.${warehouseId}`)
  );

  const issueRequests = await countByQuery(
    supabase
      .from("warehouse_issue_requests")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .or(`source_warehouse_id.eq.${warehouseId},destination_warehouse_id.eq.${warehouseId}`)
  );

  const fieldMaterialConsumptions = await countByQuery(
    supabase
      .from("field_material_consumptions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("warehouse_id", warehouseId)
  );

  const batchInputs = await countByQuery(
    supabase
      .from("batch_transformation_inputs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("warehouse_from_id", warehouseId)
  );

  const batchOutputs = await countByQuery(
    supabase
      .from("batch_transformation_outputs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("warehouse_to_id", warehouseId)
  );

  const stockBalanceRows = toInt(stockBalanceRes.count);
  const stockBalanceQty = (stockBalanceQtyRes.data || []).reduce((sum: number, row: any) => sum + toInt(row.quantity), 0);

  const reasons: string[] = [];
  if (stockBalanceRows > 0 || Math.abs(stockBalanceQty) > 0.000001) {
    reasons.push("Warehouse has stock balance");
  }
  if (inventoryTransactions > 0) reasons.push("Warehouse has inventory transactions history");
  if (stockLedgerEntries > 0) reasons.push("Warehouse has ledger history");
  if (tickets > 0) reasons.push("Warehouse has weighbridge ticket links");
  if (issueRequests > 0) reasons.push("Warehouse has issue request links");
  if (fieldMaterialConsumptions > 0) reasons.push("Warehouse has field material consumption links");
  if (batchInputs > 0 || batchOutputs > 0) reasons.push("Warehouse has batch processing links");

  return {
    canDelete: reasons.length === 0,
    reasons,
    stats: {
      stockBalanceRows,
      stockBalanceQty,
      inventoryTransactions,
      stockLedgerEntries,
      tickets,
      issueRequests,
      fieldMaterialConsumptions,
      batchInputs,
      batchOutputs,
    },
  };
}
