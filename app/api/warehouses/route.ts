import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { WAREHOUSE_ENTITY_WRITE_ROLES, WAREHOUSE_READ_ROLES, normalizeWarehouseRow, toNullableText, warehouseVisibleToRole } from "@/app/api/warehouses/_helpers";
import { rowHasQaDataMarker } from "@/lib/utils/qa-data";

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const includeArchived = String(request.nextUrl.searchParams.get("includeArchived") || "false").toLowerCase() === "true";

    const supabase = await getUserScopedClientFromRequest(request);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_READ_ROLES],
    });

    let query = supabase
      .from("warehouses")
      .select("*")
      .eq("company_id", companyId)
      .order("name");

    if (!includeArchived) {
      query = query.eq("archived", false).eq("is_archived", false);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      warehouses: (data || [])
        .map(normalizeWarehouseRow)
        .filter((row) => warehouseVisibleToRole(row, actor.role))
        .filter((row) => !rowHasQaDataMarker(row as unknown as Record<string, unknown>, ["name", "description", "warehouse_type"])),
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

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const body = await request.json().catch(() => ({}));
    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);

    const supabase = await getUserScopedClientFromRequest(request);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_ENTITY_WRITE_ROLES],
    });

    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "Warehouse name is required" }, { status: 400 });
    }

    const warehouseType = toNullableText(body.warehouse_type || body.warehouseType) || "universal";
    const capacityValue =
      body.capacity_value == null || body.capacity_value === ""
        ? null
        : Number(body.capacity_value);
    const capacityUnit = toNullableText(body.capacity_unit || body.capacityUnit);
    const responsibleUserId = toNullableText(body.responsible_user_id || body.responsibleUserId);
    const location = toNullableText(body.location);
    const description = toNullableText(body.description);
    const isArchived = body.is_archived === true;

    if (capacityValue != null && (!Number.isFinite(capacityValue) || capacityValue < 0)) {
      return NextResponse.json({ error: "capacity_value must be a positive number" }, { status: 400 });
    }

    const payload: Record<string, unknown> = {
      company_id: companyId,
      name,
      warehouse_type: warehouseType,
      capacity_value: capacityValue,
      capacity_unit: capacityUnit,
      storage_capacity_kg:
        capacityUnit === "kg" && capacityValue != null ? capacityValue : null,
      responsible_user_id: responsibleUserId,
      location,
      description,
      archived: isArchived,
      is_archived: isArchived,
      user_id: actor.authUserId,
      created_by_user_id: actor.authUserId,
      updated_by_user_id: actor.authUserId,
      archived_at: isArchived ? new Date().toISOString() : null,
      archived_by_user_id: isArchived ? actor.id : null,
    };

    const { data, error } = await supabase.from("warehouses").insert(payload).select("*").single();
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Failed to create warehouse" },
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
