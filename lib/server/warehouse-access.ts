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

export type WarehouseUsageCheckResult = {
  isUsed: boolean;
  reasons: string[];
  stats: Record<string, number>;
};

export type WarehouseArchiveCheckResult = {
  canArchive: boolean;
  reasons: string[];
  stats: {
    stockBalanceRows: number;
    stockBalanceQty: number;
    batchStockRows: number;
    openTickets: number;
    activeHarvests: number;
    activeTransformations: number;
    activeProcessingDocuments: number;
    activeProcessingNodes: number;
    draftInventoryTransactions: number;
    activeInventoryDocuments: number;
    activeIssueRequests: number;
    outstandingIssueAllocations: number;
  };
};

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function countByQuery(queryPromise: PromiseLike<{ count: number | null; error: any }>): Promise<number> {
  const { count, error } = await queryPromise;
  if (error) {
    throw new Error(`Warehouse dependency check failed: ${error.message || "unknown database error"}`);
  }
  return toInt(count);
}

async function getStockBalance(
  supabase: SupabaseClient,
  companyId: string,
  warehouseId: string
): Promise<{ rows: number; quantity: number }> {
  const [rowsResult, quantityResult] = await Promise.all([
    supabase
      .from("v_stock_balance_canonical")
      .select("warehouse_id, quantity", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("warehouse_id", warehouseId)
      .neq("quantity", 0),
    supabase
      .from("v_stock_balance_canonical")
      .select("quantity")
      .eq("company_id", companyId)
      .eq("warehouse_id", warehouseId),
  ]);

  if (rowsResult.error || quantityResult.error) {
    throw new Error(
      `Warehouse balance check failed: ${rowsResult.error?.message || quantityResult.error?.message || "unknown database error"}`
    );
  }

  return {
    rows: toInt(rowsResult.count),
    quantity: (quantityResult.data || []).reduce(
      (sum: number, row: any) => sum + Number(row.quantity || 0),
      0
    ),
  };
}

export async function getWarehouseDeleteCheck(
  supabase: SupabaseClient,
  companyId: string,
  warehouseId: string
): Promise<WarehouseDeleteCheckResult> {
  const balance = await getStockBalance(supabase, companyId, warehouseId);

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
      .eq("source_warehouse_id", warehouseId)
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

  const stockBalanceRows = balance.rows;
  const stockBalanceQty = balance.quantity;

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

export async function getWarehouseUsageCheck(
  supabase: SupabaseClient,
  companyId: string,
  warehouseId: string
): Promise<WarehouseUsageCheckResult> {
  const balance = await getStockBalance(supabase, companyId, warehouseId);
  const counts = await Promise.all([
    countByQuery(supabase.from("tickets").select("id", { count: "exact", head: true }).eq("company_id", companyId).or(`warehouse_from_id.eq.${warehouseId},warehouse_to_id.eq.${warehouseId}`)),
    countByQuery(supabase.from("ticket_lines").select("id", { count: "exact", head: true }).eq("company_id", companyId).or(`warehouse_from_id.eq.${warehouseId},warehouse_to_id.eq.${warehouseId}`)),
    countByQuery(supabase.from("inventory_batches").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("warehouse_id", warehouseId)),
    countByQuery(supabase.from("stock_ledger_entries").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("warehouse_id", warehouseId)),
    countByQuery(supabase.from("inventory_transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId).or(`warehouse_id.eq.${warehouseId},source_warehouse_id.eq.${warehouseId},destination_warehouse_id.eq.${warehouseId}`)),
    countByQuery(supabase.from("batch_transformation_inputs").select("id", { count: "exact", head: true }).eq("company_id", companyId).or(`warehouse_from_id.eq.${warehouseId},node_warehouse_id.eq.${warehouseId}`)),
    countByQuery(supabase.from("batch_transformation_outputs").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("warehouse_to_id", warehouseId)),
    countByQuery(supabase.from("batch_transformations").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("node_warehouse_id", warehouseId)),
    countByQuery(supabase.from("processing_documents").select("id", { count: "exact", head: true }).eq("company_id", companyId).or(`source_warehouse_id.eq.${warehouseId},destination_warehouse_id.eq.${warehouseId}`)),
    countByQuery(supabase.from("processing_nodes").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("linked_warehouse_id", warehouseId)),
    countByQuery(supabase.from("warehouse_inventory_documents").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("warehouse_id", warehouseId)),
    countByQuery(supabase.from("warehouse_issue_requests").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("source_warehouse_id", warehouseId)),
    countByQuery(supabase.from("warehouse_issue_request_item_allocations").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("warehouse_id", warehouseId)),
    countByQuery(supabase.from("warehouse_transfer_documents").select("id", { count: "exact", head: true }).eq("company_id", companyId).or(`source_warehouse_id.eq.${warehouseId},destination_warehouse_id.eq.${warehouseId}`)),
    countByQuery(supabase.from("weighbridge_active_harvests").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("warehouse_id", warehouseId)),
    countByQuery(supabase.from("field_material_consumptions").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("warehouse_id", warehouseId)),
  ]);

  const keys = [
    "tickets", "ticketLines", "inventoryBatches", "stockLedgerEntries",
    "inventoryTransactions", "batchInputs", "batchOutputs", "batchTransformations",
    "processingDocuments", "processingNodes", "inventoryDocuments", "issueRequests",
    "issueRequestAllocations", "transferDocuments", "activeHarvests", "fieldMaterialConsumptions",
  ] as const;
  const stats: Record<string, number> = {
    stockBalanceRows: balance.rows,
    stockBalanceQty: balance.quantity,
  };
  keys.forEach((key, index) => {
    stats[key] = counts[index];
  });

  const reasons: string[] = [];
  if (balance.rows > 0 || Math.abs(balance.quantity) > 0.000001) reasons.push("Есть ненулевой остаток");
  if (stats.tickets > 0 || stats.ticketLines > 0) reasons.push("Есть связанные талоны");
  if (stats.inventoryBatches > 0) reasons.push("Есть связанные партии");
  if (stats.stockLedgerEntries > 0 || stats.inventoryTransactions > 0) reasons.push("Есть складские проводки или движения");
  if (stats.batchInputs > 0 || stats.batchOutputs > 0 || stats.batchTransformations > 0 || stats.processingDocuments > 0 || stats.processingNodes > 0) {
    reasons.push("Есть связанные операции обработки");
  }
  if (stats.inventoryDocuments > 0 || stats.issueRequests > 0 || stats.issueRequestAllocations > 0 || stats.transferDocuments > 0 || stats.activeHarvests > 0 || stats.fieldMaterialConsumptions > 0) {
    reasons.push("Есть другая операционная история");
  }

  return { isUsed: reasons.length > 0, reasons, stats };
}

export async function getWarehouseArchiveCheck(
  supabase: SupabaseClient,
  companyId: string,
  warehouseId: string
): Promise<WarehouseArchiveCheckResult> {
  const balance = await getStockBalance(supabase, companyId, warehouseId);
  const [openTicketResult, batchStockResult] = await Promise.all([
    supabase
      .from("tickets")
      .select("id,warehouse_from_id,warehouse_to_id")
      .eq("company_id", companyId)
      .in("status", ["draft", "active", "ready_to_close"]),
    supabase
      .from("inventory_batches")
      .select("id,current_weight_kg,current_quantity,mass_kg")
      .eq("company_id", companyId)
      .eq("warehouse_id", warehouseId),
  ]);
  if (openTicketResult.error || batchStockResult.error) {
    throw new Error(
      `Warehouse dependency check failed: ${openTicketResult.error?.message || batchStockResult.error?.message || "unknown database error"}`
    );
  }

  const openTicketRows = openTicketResult.data || [];
  const openTicketIds = openTicketRows.map((row: any) => String(row.id));
  const directOpenTicketIds = new Set(
    openTicketRows
      .filter(
        (row: any) =>
          String(row.warehouse_from_id || "") === warehouseId ||
          String(row.warehouse_to_id || "") === warehouseId
      )
      .map((row: any) => String(row.id))
  );
  if (openTicketIds.length > 0) {
    const lineResult = await supabase
      .from("ticket_lines")
      .select("ticket_id")
      .eq("company_id", companyId)
      .in("ticket_id", openTicketIds)
      .or(`warehouse_from_id.eq.${warehouseId},warehouse_to_id.eq.${warehouseId}`);
    if (lineResult.error) {
      throw new Error(`Warehouse dependency check failed: ${lineResult.error.message}`);
    }
    for (const row of lineResult.data || []) directOpenTicketIds.add(String((row as any).ticket_id));
  }
  const openTickets = directOpenTicketIds.size;
  const batchStockRows = (batchStockResult.data || []).filter((row: any) =>
    [row.current_weight_kg, row.current_quantity, row.mass_kg].some(
      (value) => Math.abs(Number(value || 0)) > 0.000001
    )
  ).length;

  const [
    activeHarvests,
    activeTransformations,
    activeProcessingDocuments,
    activeProcessingNodes,
    draftInventoryTransactions,
    activeInventoryDocuments,
    activeIssueRequests,
    allocationResult,
  ] = await Promise.all([
    countByQuery(supabase.from("weighbridge_active_harvests").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("warehouse_id", warehouseId).eq("status", "active")),
    countByQuery(supabase.from("batch_transformations").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("node_warehouse_id", warehouseId).or("status.eq.draft,processing_state.in.(in_processing,processing_pending_outputs)")),
    countByQuery(supabase.from("processing_documents").select("id", { count: "exact", head: true }).eq("company_id", companyId).or(`source_warehouse_id.eq.${warehouseId},destination_warehouse_id.eq.${warehouseId}`).eq("status", "draft")),
    countByQuery(supabase.from("processing_nodes").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("linked_warehouse_id", warehouseId).eq("is_active", true).eq("archived", false)),
    countByQuery(supabase.from("inventory_transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId).or(`warehouse_id.eq.${warehouseId},source_warehouse_id.eq.${warehouseId},destination_warehouse_id.eq.${warehouseId}`).eq("status", "draft")),
    countByQuery(supabase.from("warehouse_inventory_documents").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("warehouse_id", warehouseId).in("status", ["in_progress", "awaiting_approval", "rejected"])),
    countByQuery(supabase.from("warehouse_issue_requests").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("source_warehouse_id", warehouseId).in("status", ["new", "active", "preparing", "ready", "partially_issued", "issued_by_warehouse", "issued"])),
    supabase.from("warehouse_issue_request_item_allocations").select("prepared_quantity,issued_quantity").eq("company_id", companyId).eq("warehouse_id", warehouseId),
  ]);

  if (allocationResult.error) {
    throw new Error(`Warehouse dependency check failed: ${allocationResult.error.message}`);
  }
  const outstandingIssueAllocations = (allocationResult.data || []).filter(
    (row: any) => Number(row.prepared_quantity || 0) - Number(row.issued_quantity || 0) > 0.000001
  ).length;

  const stats = {
    stockBalanceRows: balance.rows,
    stockBalanceQty: balance.quantity,
    batchStockRows,
    openTickets,
    activeHarvests,
    activeTransformations,
    activeProcessingDocuments,
    activeProcessingNodes,
    draftInventoryTransactions,
    activeInventoryDocuments,
    activeIssueRequests,
    outstandingIssueAllocations,
  };
  const reasons: string[] = [];
  if (balance.rows > 0 || Math.abs(balance.quantity) > 0.000001 || batchStockRows > 0) {
    reasons.push(`Ненулевой остаток: ${balance.quantity} кг${batchStockRows > 0 ? `; партий с остатком: ${batchStockRows}` : ""}`);
  }
  if (openTickets > 0) reasons.push(`Открытые талоны: ${openTickets}`);
  if (activeHarvests > 0) reasons.push(`Активная приёмка: ${activeHarvests}`);
  if (activeTransformations + activeProcessingDocuments + activeProcessingNodes > 0) {
    reasons.push(`Незавершённая обработка: ${activeTransformations + activeProcessingDocuments + activeProcessingNodes}`);
  }
  if (draftInventoryTransactions + activeInventoryDocuments + activeIssueRequests + outstandingIssueAllocations > 0) {
    reasons.push(`Незавершённое перемещение или складская операция: ${draftInventoryTransactions + activeInventoryDocuments + activeIssueRequests + outstandingIssueAllocations}`);
  }

  return { canArchive: reasons.length === 0, reasons, stats };
}
