import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError } from "@/lib/auth/server-session";
import { getWarehouseArchiveCheck, getWarehouseDeleteCheck, getWarehouseUsageCheck } from "@/lib/server/warehouse-access";
import { WAREHOUSE_ENTITY_WRITE_ROLES, WAREHOUSE_READ_ROLES, isActiveResponsibleUserInCompany, normalizeWarehouseRow, resolveWarehouseForActor, toNullableText } from "@/app/api/warehouses/_helpers";
import { normalizeStoragePlaceType, parseStoragePlaceType } from "@/lib/warehouse/warehouse-scope";
import { getServiceClient } from "@/lib/supabase/service";

const WAREHOUSE_TYPES = new Set([
  "agrochemical",
  "grain",
  "vegetable",
  "seed",
  "fertilizer",
  "pesticide",
  "universal",
  "potato_storage",
  "fuel",
  "temporary",
]);
const CAPACITY_UNITS = new Set(["kg", "t", "m3", "l"]);

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const warehouseId = String(id || "").trim();
    if (!warehouseId) return NextResponse.json({ error: "Warehouse id is required" }, { status: 400 });

    const { actor, companyId, supabase, existing } = await resolveWarehouseForActor(request, warehouseId);
    const accessSupabase = getServiceClient();
    await assertActorAccess({
      supabase: accessSupabase,
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

    const { actor, companyId, existing } = await resolveWarehouseForActor(request, warehouseId);
    const writeSupabase = getServiceClient();
    await assertActorAccess({
      supabase: writeSupabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_ENTITY_WRITE_ROLES],
    });
    if (!existing?.id) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const payload: Record<string, unknown> = {
      updated_by_user_id: actor.authUserId,
    };
    const existingPlaceType = normalizeStoragePlaceType(existing.place_type);
    const hasPlaceType = body.place_type !== undefined || body.placeType !== undefined;
    const requestedPlaceType = hasPlaceType
      ? parseStoragePlaceType(body.place_type ?? body.placeType)
      : existingPlaceType;
    if (!requestedPlaceType) {
      return NextResponse.json({ error: "Неизвестный тип объекта" }, { status: 400 });
    }
    const existingWarehouseType = toNullableText(existing.warehouse_type) || "universal";
    const hasWarehouseType = body.warehouse_type !== undefined || body.warehouseType !== undefined;
    const requestedWarehouseType = requestedPlaceType === "WAREHOUSE"
      ? hasWarehouseType
        ? toNullableText(body.warehouse_type ?? body.warehouseType) || "universal"
        : existingPlaceType === "WAREHOUSE"
          ? existingWarehouseType
          : "universal"
      : requestedPlaceType === existingPlaceType
        ? existingWarehouseType
        : "universal";
    if (requestedPlaceType === "WAREHOUSE" && !WAREHOUSE_TYPES.has(requestedWarehouseType)) {
      return NextResponse.json({ error: "Неизвестный тип склада" }, { status: 400 });
    }

    const effectiveTypeChanged =
      requestedPlaceType !== existingPlaceType ||
      (requestedPlaceType === "WAREHOUSE" &&
        existingPlaceType === "WAREHOUSE" &&
        requestedWarehouseType !== existingWarehouseType);
    if (effectiveTypeChanged) {
      const usage = await getWarehouseUsageCheck(writeSupabase, companyId, warehouseId);
      if (usage.isUsed) {
        return NextResponse.json(
          {
            error: "Тип используемого объекта изменить нельзя. Архивируйте его и создайте новый объект.",
            reasons: usage.reasons,
            stats: usage.stats,
          },
          { status: 409 }
        );
      }
      if (requestedPlaceType !== existingPlaceType) payload.place_type = requestedPlaceType;
    }

    if (body.name !== undefined) {
      const name = String(body.name || "").trim();
      if (!name) return NextResponse.json({ error: "Warehouse name is required" }, { status: 400 });
      payload.name = name;
    }
    if (requestedWarehouseType !== existingWarehouseType) {
      payload.warehouse_type = requestedWarehouseType;
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
      const capacityUnit = toNullableText(body.capacity_unit ?? body.capacityUnit);
      if (capacityUnit && !CAPACITY_UNITS.has(capacityUnit)) {
        return NextResponse.json({ error: "Неизвестная единица вместимости" }, { status: 400 });
      }
      payload.capacity_unit = capacityUnit;
    }
    if (body.capacity_value !== undefined || body.capacityValue !== undefined || body.capacity_unit !== undefined || body.capacityUnit !== undefined) {
      const nextCapacityValue = payload.capacity_value !== undefined ? payload.capacity_value : existing.capacity_value;
      const nextCapacityUnit = payload.capacity_unit !== undefined ? payload.capacity_unit : existing.capacity_unit;
      payload.storage_capacity_kg = nextCapacityUnit === "kg" ? nextCapacityValue ?? null : null;
    }
    if (body.responsible_user_id !== undefined || body.responsibleUserId !== undefined) {
      const responsibleUserId = toNullableText(body.responsible_user_id || body.responsibleUserId);
      if (responsibleUserId && !(await isActiveResponsibleUserInCompany(writeSupabase, companyId, responsibleUserId))) {
        return NextResponse.json({ error: "Ответственный пользователь недоступен в выбранной компании" }, { status: 400 });
      }
      payload.responsible_user_id = responsibleUserId;
    }
    if (body.location !== undefined) payload.location = toNullableText(body.location);
    if (body.description !== undefined) payload.description = toNullableText(body.description);
    if (body.is_archived !== undefined) {
      const isArchived = Boolean(body.is_archived);
      const wasArchived = existing.is_archived === true || existing.archived === true;
      if (isArchived && !wasArchived) {
        const archiveCheck = await getWarehouseArchiveCheck(writeSupabase, companyId, warehouseId);
        if (!archiveCheck.canArchive) {
          return NextResponse.json(
            {
              error: `Объект нельзя архивировать: ${archiveCheck.reasons.join("; ")}`,
              reasons: archiveCheck.reasons,
              stats: archiveCheck.stats,
            },
            { status: 409 }
          );
        }
      }
      payload.is_archived = isArchived;
      payload.archived = isArchived;
      payload.archived_at = isArchived ? new Date().toISOString() : null;
      payload.archived_by_user_id = isArchived ? actor.id : null;
    }

    const { data, error } = await writeSupabase
      .from("warehouses")
      .update(payload)
      .eq("id", warehouseId)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Failed to update warehouse" },
        { status: error?.code === "23514" ? 409 : 400 }
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

    const { actor, companyId, existing } = await resolveWarehouseForActor(request, warehouseId);
    const writeSupabase = getServiceClient();
    await assertActorAccess({
      supabase: writeSupabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_ENTITY_WRITE_ROLES],
    });
    if (!existing?.id) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }
    const mode = String(request.nextUrl.searchParams.get("mode") || "archive").toLowerCase();

    if (mode === "hard") {
      const [deleteCheck, usageCheck] = await Promise.all([
        getWarehouseDeleteCheck(writeSupabase, companyId, warehouseId),
        getWarehouseUsageCheck(writeSupabase, companyId, warehouseId),
      ]);
      if (!deleteCheck.canDelete || usageCheck.isUsed) {
        const reasons = Array.from(new Set([...deleteCheck.reasons, ...usageCheck.reasons]));
        return NextResponse.json(
          {
            error: "Warehouse cannot be hard deleted because it has stock or history",
            reasons,
            stats: {
              delete: deleteCheck.stats,
              usage: usageCheck.stats,
            },
          },
          { status: 409 }
        );
      }
      const { error: deleteError } = await writeSupabase
        .from("warehouses")
        .delete()
        .eq("id", warehouseId)
        .eq("company_id", companyId);
      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 400 });
      }
      return NextResponse.json({ deleted: true, mode: "hard" });
    }

    const alreadyArchived = existing.is_archived === true || existing.archived === true;
    if (!alreadyArchived) {
      const archiveCheck = await getWarehouseArchiveCheck(writeSupabase, companyId, warehouseId);
      if (!archiveCheck.canArchive) {
        return NextResponse.json(
          {
            error: `Объект нельзя архивировать: ${archiveCheck.reasons.join("; ")}`,
            reasons: archiveCheck.reasons,
            stats: archiveCheck.stats,
          },
          { status: 409 }
        );
      }
    }

    const { data, error } = await writeSupabase
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
      return NextResponse.json(
        { error: error?.message || "Failed to archive warehouse" },
        { status: error?.code === "23514" ? 409 : 400 }
      );
    }

    return NextResponse.json({
      deleted: false,
      mode: "archive",
      warehouse: normalizeWarehouseRow(data),
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
