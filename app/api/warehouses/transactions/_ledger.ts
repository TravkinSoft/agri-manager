type MovementType = "receipt" | "issue" | "transfer" | "writeoff" | "adjustment";
type TransactionDirection = "in" | "out";

function toNumberSafe(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeMovementType(movementType: unknown, direction: unknown): MovementType {
  if (
    movementType === "receipt" ||
    movementType === "issue" ||
    movementType === "transfer" ||
    movementType === "writeoff" ||
    movementType === "adjustment"
  ) {
    return movementType;
  }
  return direction === "in" ? "receipt" : "issue";
}

function normalizeDirection(direction: unknown): TransactionDirection {
  return direction === "in" ? "in" : "out";
}

function reasonTypeForMovement(movementType: MovementType): string {
  if (movementType === "receipt") return "warehouse_receipt";
  if (movementType === "issue") return "warehouse_issue";
  if (movementType === "transfer") return "warehouse_transfer";
  if (movementType === "writeoff") return "warehouse_writeoff";
  return "warehouse_adjustment";
}

function buildLedgerRows(transaction: any) {
  if (String(transaction?.status || "confirmed") !== "confirmed") return [];

  const quantity = Math.abs(toNumberSafe(transaction.base_quantity));
  const uom = String(transaction.base_uom || "").trim();
  const batchClass = String(transaction.batch_class || "").trim();
  if (!transaction?.id || !transaction?.company_id || !transaction?.product_id || quantity <= 0) return [];
  if (transaction.unit_contract_version !== 2 || !uom || !batchClass) {
    throw new Error("Inventory transaction has no canonical unit and batch contract");
  }

  const movementType = normalizeMovementType(transaction.movement_type, transaction.transaction_type);
  const direction = normalizeDirection(transaction.transaction_type);
  const occurredAt =
    transaction.operation_datetime || transaction.confirmed_at || transaction.created_at || new Date().toISOString();
  const base = {
    company_id: transaction.company_id,
    product_id: transaction.product_id,
    quantity,
    uom,
    batch_class: batchClass,
    mass_kg: transaction.mass_kg ?? null,
    density_kg_per_l: transaction.density_kg_per_l ?? null,
    density_unit: transaction.density_unit ?? null,
    density_source: transaction.density_source ?? null,
    density_verification_status: transaction.density_verification_status ?? null,
    density_verified_at: transaction.density_verified_at ?? null,
    unit_source: `inventory_transaction:${transaction.id}`,
    unit_contract_version: 2,
    reason_type: reasonTypeForMovement(movementType),
    reason_ref_id: transaction.id,
    occurred_at: occurredAt,
    created_by: transaction.responsible_user_id || null,
    notes: transaction.notes || null,
  };

  const sourceWarehouseId = transaction.source_warehouse_id || transaction.warehouse_id || null;
  const destinationWarehouseId = transaction.destination_warehouse_id || transaction.warehouse_id || null;

  if (movementType === "transfer") {
    return [
      {
        ...base,
        warehouse_id: sourceWarehouseId,
        direction: "out",
        delta_qty_signed: -quantity,
      },
      {
        ...base,
        warehouse_id: destinationWarehouseId,
        direction: "in",
        delta_qty_signed: quantity,
      },
    ].filter((row) => row.warehouse_id);
  }

  if (movementType === "receipt" || (movementType === "adjustment" && direction === "in")) {
    return [
      {
        ...base,
        warehouse_id: destinationWarehouseId,
        direction: "in",
        delta_qty_signed: quantity,
      },
    ].filter((row) => row.warehouse_id);
  }

  return [
    {
      ...base,
      warehouse_id: sourceWarehouseId,
      direction: "out",
      delta_qty_signed: -quantity,
    },
  ].filter((row) => row.warehouse_id);
}

async function insertLedgerRowsFallback(supabase: any, transaction: any) {
  const rows = buildLedgerRows(transaction);
  if (rows.length === 0) return;

  const { data: existing, error: existingError } = await supabase
    .from("stock_ledger_entries")
    .select("id")
    .eq("company_id", transaction.company_id)
    .eq("reason_ref_id", transaction.id)
    .limit(1);

  if (existingError) throw new Error(existingError.message);
  if ((existing || []).length > 0) return;

  const { error } = await supabase.from("stock_ledger_entries").insert(rows);
  if (error) throw new Error(error.message);
}

export async function postInventoryTransactionToLedger(supabase: any, transaction: any) {
  if (String(transaction?.status || "confirmed") !== "confirmed") return;

  const { error } = await supabase.rpc("post_inventory_transaction_to_ledger", {
    p_transaction_id: transaction.id,
  });

  if (!error) return;

  const message = String(error.message || "").toLowerCase();
  const missingRpc =
    message.includes("post_inventory_transaction_to_ledger") ||
    message.includes("could not find the function") ||
    message.includes("schema cache");

  if (!missingRpc) {
    throw new Error(error.message);
  }

  await insertLedgerRowsFallback(supabase, transaction);
}
