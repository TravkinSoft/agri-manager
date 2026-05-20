import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError } from "@/lib/auth/server-session";
import { getWarehouseDeleteCheck } from "@/lib/server/warehouse-access";
import { WAREHOUSE_READ_ROLES, resolveWarehouseForActor } from "@/app/api/warehouses/_helpers";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const warehouseId = String(id || "").trim();
    if (!warehouseId) return NextResponse.json({ error: "Warehouse id is required" }, { status: 400 });

    const { actor, companyId, supabase, existing } = await resolveWarehouseForActor(request, warehouseId);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_READ_ROLES],
    });
    if (!existing?.id) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }

    const check = await getWarehouseDeleteCheck(supabase, companyId, warehouseId);

    return NextResponse.json({
      can_delete: check.canDelete,
      reasons: check.reasons,
      stats: {
        stock_balance_rows: check.stats.stockBalanceRows,
        stock_balance_qty: check.stats.stockBalanceQty,
        inventory_transactions: check.stats.inventoryTransactions,
        stock_ledger_entries: check.stats.stockLedgerEntries,
        tickets: check.stats.tickets,
        issue_requests: check.stats.issueRequests,
        field_material_consumptions: check.stats.fieldMaterialConsumptions,
        batch_inputs: check.stats.batchInputs,
        batch_outputs: check.stats.batchOutputs,
      },
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

