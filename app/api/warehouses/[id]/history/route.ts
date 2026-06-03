import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError } from "@/lib/auth/server-session";
import { WAREHOUSE_READ_ROLES, resolveWarehouseForActor } from "@/app/api/warehouses/_helpers";

function normalizeLedgerMovementType(reasonType: unknown, direction: unknown) {
  const reason = String(reasonType || "").trim().toLowerCase();
  if (reason.includes("adjust")) return "adjustment";
  if (reason.includes("writeoff") || reason.includes("disposal") || reason.includes("waste")) return "writeoff";
  if (reason.includes("transfer")) return direction === "in" ? "receipt" : "issue";
  if (reason.includes("receipt") || reason.includes("incoming") || reason.includes("harvest")) return "receipt";
  if (reason.includes("issue") || reason.includes("outbound") || reason.includes("shipment")) return "issue";
  return direction === "in" ? "receipt" : "issue";
}

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

    const limitRaw = Number(request.nextUrl.searchParams.get("limit") || 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 10), 500) : 100;
    const warnings: string[] = [];

    const [txRes, ticketsRes, transformationsRes] = await Promise.all([
      supabase
        .from("stock_ledger_entries")
        .select(`
          *,
          warehouses:warehouse_id (name, name_ru, name_kz, name_en),
          products:product_id (name, name_ru, name_kz, name_en, type, product_type, unit, base_uom),
          profiles:created_by (email),
          tickets:ticket_id (ticket_no)
        `)
        .eq("company_id", companyId)
        .eq("warehouse_id", warehouseId)
        .order("occurred_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("tickets")
        .select("id,ticket_no,op_type,status,created_at,updated_at,finalized_at,voided_at,warehouse_from_id,warehouse_to_id")
        .eq("company_id", companyId)
        .or(`warehouse_from_id.eq.${warehouseId},warehouse_to_id.eq.${warehouseId}`)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("batch_transformations")
        .select("id,transformation_type,status,created_at,updated_at,notes")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    if (txRes.error) warnings.push(`stock_ledger_entries: ${txRes.error.message}`);
    if (ticketsRes.error) warnings.push(`tickets: ${ticketsRes.error.message}`);
    if (transformationsRes.error) warnings.push(`batch_transformations: ${transformationsRes.error.message}`);

    const txRows = (txRes.data || []).map((row: any) => {
      const direction = row.direction === "in" ? "in" : "out";
      const quantityDelta = Number.isFinite(Number(row.delta_qty_signed))
        ? Number(row.delta_qty_signed)
        : direction === "in"
          ? Math.abs(Number(row.quantity || 0))
          : -Math.abs(Number(row.quantity || 0));
      const occurredAt = row.occurred_at || row.created_at || null;
      const warehouseName = row.warehouses?.name || "N/A";
      return {
        id: String(row.id),
        warehouse_id: String(row.warehouse_id || ""),
        source_warehouse_id: direction === "out" ? String(row.warehouse_id || "") : null,
        destination_warehouse_id: direction === "in" ? String(row.warehouse_id || "") : null,
        product_id: String(row.product_id || ""),
        quantity: Math.abs(Number(row.quantity || quantityDelta || 0)),
        quantity_delta: quantityDelta,
        transaction_type: direction,
        movement_type: normalizeLedgerMovementType(row.reason_type, direction),
        status: "confirmed",
        operation_datetime: occurredAt,
        date: occurredAt ? String(occurredAt).slice(0, 10) : null,
        notes: row.notes || row.reason_type || null,
        responsible_user_id: row.created_by || null,
        confirmed_at: occurredAt,
        cancelled_at: null,
        created_at: row.created_at || occurredAt,
        updated_at: row.created_at || occurredAt,
        user_id: row.created_by || "",
        company_id: row.company_id || companyId,
        source_warehouse_name: direction === "out" ? warehouseName : "-",
        destination_warehouse_name: direction === "in" ? warehouseName : "-",
        warehouse_name: warehouseName,
        product_name: row.products?.name || "N/A",
        product_type: row.products?.product_type || row.products?.type || "N/A",
        product_unit: row.uom || row.products?.base_uom || row.products?.unit || "kg",
        created_by_email: row.profiles?.email || "N/A",
        source_system: "stock_ledger_entries",
        source_id: row.id || null,
        ledger_entry_id: row.id || null,
        movement_source: row.reason_type || null,
        reason_type: row.reason_type || null,
        reason_ref_id: row.reason_ref_id || null,
        ticket_id: row.ticket_id || null,
        processing_id: row.processing_id || null,
        document_ref: row.tickets?.ticket_no || row.reason_ref_id || row.ticket_id || row.processing_id || null,
        is_storno: row.is_storno === true,
      };
    });

    return NextResponse.json({
      warehouse: existing,
      history: {
        transactions: txRows,
        tickets: ticketsRes.data || [],
        transformations: transformationsRes.data || [],
        events: [
          {
            event_type: "warehouse_created",
            occurred_at: existing.created_at || null,
            actor_user_id: existing.created_by_user_id || existing.user_id || null,
            details: "Warehouse created",
          },
          {
            event_type: "warehouse_updated",
            occurred_at: existing.updated_at || null,
            actor_user_id: existing.updated_by_user_id || null,
            details: "Warehouse updated",
          },
          {
            event_type: "warehouse_archived",
            occurred_at: existing.archived_at || null,
            actor_user_id: existing.archived_by_user_id || null,
            details: existing.is_archived || existing.archived ? "Warehouse archived" : null,
          },
        ],
      },
      warnings,
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
