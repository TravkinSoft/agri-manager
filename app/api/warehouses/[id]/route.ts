import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError } from "@/lib/auth/server-session";
import { getWarehouseDeleteCheck } from "@/lib/server/warehouse-access";
import { WAREHOUSE_READ_ROLES, WAREHOUSE_WRITE_ROLES, normalizeWarehouseRow, resolveWarehouseForActor, toNullableText } from "@/app/api/warehouses/_helpers";

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

    const deleteCheck = await getWarehouseDeleteCheck(supabase, companyId, warehouseId);

    return NextResponse.json({
      warehouse: normalizeWarehouseRow(existing),
      delete_check: {
        can_delete: deleteCheck.canDelete,
        reasons: deleteCheck.reasons,
        stats: {
          stock_balance_rows: deleteCheck.stats.stockBalanceRows,
          stock_balance_qty: deleteCheck.stats.stockBalanceQty,
          inventory_transactions: deleteCheck.stats.inventoryTransactions,
          stock_ledger_entries: deleteCheck.stats.stockLedgerEntries,
          tickets: deleteCheck.stats.tickets,
          issue_requests: deleteCheck.stats.issueRequests,
          field_material_consumptions: deleteCheck.stats.fieldMaterialConsumptions,
          batch_inputs: deleteCheck.stats.batchInputs,
          batch_outputs: deleteCheck.stats.batchOutputs,
        },
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

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const warehouseId = String(id || "").trim();
    if (!warehouseId) return NextResponse.json({ error: "Warehouse id is required" }, { status: 400 });

    const { actor, companyId, supabase, existing } = await resolveWarehouseForActor(request, warehouseId);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_WRITE_ROLES],
    });
    if (!existing?.id) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const payload: Record<string, unknown> = {
      updated_by_user_id: actor.authUserId,
    };

    if (body.name !== undefined) {
      const name = String(body.name || "").trim();
      if (!name) return NextResponse.json({ error: "Warehouse name is required" }, { status: 400 });
      payload.name = name;
    }
    if (body.warehouse_type !== undefined || body.warehouseType !== undefined) {
      payload.warehouse_type = toNullableText(body.warehouse_type || body.warehouseType) || "universal";
    }
    if (body.capacity_value !== undefined || body.capacityValue !== undefined) {
      const raw = body.capacity_value ?? body.capacityValue;
      if (raw === null || raw === "") {
        payload.capacity_value = null;
      } else {
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0) {
          return NextResponse.json({ error: "capacity_value must be a positive number" }, { status: 400 });
        }
        payload.capacity_value = num;
      }
    }
    if (body.capacity_unit !== undefined || body.capacityUnit !== undefined) {
      payload.capacity_unit = toNullableText(body.capacity_unit || body.capacityUnit);
    }
    if (payload.capacity_unit === "kg") {
      payload.storage_capacity_kg = payload.capacity_value ?? existing.capacity_value ?? null;
    }
    if (body.responsible_user_id !== undefined || body.responsibleUserId !== undefined) {
      payload.responsible_user_id = toNullableText(body.responsible_user_id || body.responsibleUserId);
    }
    if (body.location !== undefined) payload.location = toNullableText(body.location);
    if (body.description !== undefined) payload.description = toNullableText(body.description);
    if (body.is_archived !== undefined) {
      const isArchived = Boolean(body.is_archived);
      payload.is_archived = isArchived;
      payload.archived = isArchived;
      payload.archived_at = isArchived ? new Date().toISOString() : null;
      payload.archived_by_user_id = isArchived ? actor.id : null;
    }

    const { data, error } = await supabase
      .from("warehouses")
      .update(payload)
      .eq("id", warehouseId)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Failed to update warehouse" },
        { status: 400 }
      );
    }

    return NextResponse.json({ warehouse: normalizeWarehouseRow(data) });
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

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const warehouseId = String(id || "").trim();
    if (!warehouseId) return NextResponse.json({ error: "Warehouse id is required" }, { status: 400 });

    const { actor, companyId, supabase, existing } = await resolveWarehouseForActor(request, warehouseId);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_WRITE_ROLES],
    });
    if (!existing?.id) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }

    const mode = String(request.nextUrl.searchParams.get("mode") || "archive").toLowerCase();
    const deleteCheck = await getWarehouseDeleteCheck(supabase, companyId, warehouseId);

    if (mode === "hard") {
      if (!deleteCheck.canDelete) {
        return NextResponse.json(
          {
            error: "Warehouse cannot be hard deleted because it has stock or history",
            reasons: deleteCheck.reasons,
            stats: deleteCheck.stats,
          },
          { status: 409 }
        );
      }
      const { error: deleteError } = await supabase
        .from("warehouses")
        .delete()
        .eq("id", warehouseId)
        .eq("company_id", companyId);
      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 400 });
      }
      return NextResponse.json({ deleted: true, mode: "hard" });
    }

    const { data, error } = await supabase
      .from("warehouses")
      .update({
        is_archived: true,
        archived: true,
        archived_at: new Date().toISOString(),
        archived_by_user_id: actor.id,
        updated_by_user_id: actor.authUserId,
      })
      .eq("id", warehouseId)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Failed to archive warehouse" }, { status: 400 });
    }

    return NextResponse.json({
      deleted: false,
      mode: "archive",
      warehouse: normalizeWarehouseRow(data),
      delete_check: {
        can_delete: deleteCheck.canDelete,
        reasons: deleteCheck.reasons,
        stats: deleteCheck.stats,
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

