import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError } from "@/lib/auth/server-session";
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

    const limitRaw = Number(request.nextUrl.searchParams.get("limit") || 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 10), 500) : 100;
    const warnings: string[] = [];

    const [txRes, ticketsRes, transformationsRes] = await Promise.all([
      supabase
        .from("inventory_transactions")
        .select(`
          *,
          warehouses:warehouse_id (name, name_ru, name_kz, name_en),
          source_warehouse:source_warehouse_id (name, name_ru, name_kz, name_en),
          destination_warehouse:destination_warehouse_id (name, name_ru, name_kz, name_en),
          products:product_id (name, name_ru, name_kz, name_en, type, unit),
          profiles:responsible_user_id (email)
        `)
        .eq("company_id", companyId)
        .or(`warehouse_id.eq.${warehouseId},source_warehouse_id.eq.${warehouseId},destination_warehouse_id.eq.${warehouseId}`)
        .order("operation_datetime", { ascending: false, nullsFirst: false })
        .order("date", { ascending: false })
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

    if (txRes.error) warnings.push(`inventory_transactions: ${txRes.error.message}`);
    if (ticketsRes.error) warnings.push(`tickets: ${ticketsRes.error.message}`);
    if (transformationsRes.error) warnings.push(`batch_transformations: ${transformationsRes.error.message}`);

    const txRows = (txRes.data || []).map((row: any) => ({
      ...row,
      source_warehouse_name: row.source_warehouse?.name || row.warehouses?.name || "N/A",
      destination_warehouse_name: row.destination_warehouse?.name || row.warehouses?.name || "N/A",
      warehouse_name: row.warehouses?.name || "N/A",
      product_name: row.products?.name || "N/A",
      product_type: row.products?.type || "N/A",
      product_unit: row.products?.unit || "kg",
      created_by_email: row.profiles?.email || "N/A",
    }));

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

