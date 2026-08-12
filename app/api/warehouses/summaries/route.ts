import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import {
  WAREHOUSE_READ_ROLES,
  normalizeWarehouseRow,
  warehouseVisibleToRole,
} from "@/app/api/warehouses/_helpers";
import { rowHasQaDataMarker } from "@/lib/utils/qa-data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
    const supabase = await getUserScopedClientFromRequest(request);

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_READ_ROLES],
    });

    let warehouseQuery = supabase.from("warehouses").select("*").eq("company_id", companyId).order("name");
    if (!includeArchived) warehouseQuery = warehouseQuery.eq("archived", false).eq("is_archived", false);

    const [warehousesResult, balancesResult, ledgerResult, harvestProductsResult, harvestLotsResult] = await Promise.all([
      warehouseQuery,
      supabase
        .from("v_stock_balance_canonical")
        .select("warehouse_id,product_id,quantity")
        .eq("company_id", companyId),
      supabase
        .from("stock_ledger_entries")
        .select("warehouse_id,occurred_at,created_at")
        .eq("company_id", companyId)
        .order("occurred_at", { ascending: false })
        .limit(5000),
      supabase
        .from("inventory_batches")
        .select("product_id")
        .eq("company_id", companyId)
        .eq("origin_type", "harvest"),
      supabase
        .from("v_harvest_lot_stock_v1")
        .select("harvest_lot_id,warehouse_id,current_weight_kg")
        .eq("company_id", companyId),
    ]);

    const error = warehousesResult.error || balancesResult.error || ledgerResult.error || harvestProductsResult.error || harvestLotsResult.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const harvestProductIds = new Set(
      (harvestProductsResult.data || []).map((row: any) => String(row.product_id || "")).filter(Boolean)
    );
    const materialPositions = new Map<string, Set<string>>();
    for (const row of balancesResult.data || []) {
      const warehouseId = String((row as any).warehouse_id || "");
      const productId = String((row as any).product_id || "");
      if (!warehouseId || !productId || harvestProductIds.has(productId) || Math.abs(Number((row as any).quantity || 0)) < 0.0005) continue;
      const positions = materialPositions.get(warehouseId) || new Set<string>();
      positions.add(productId);
      materialPositions.set(warehouseId, positions);
    }

    const harvestPositions = new Map<string, Set<string>>();
    for (const row of harvestLotsResult.data || []) {
      const warehouseId = String((row as any).warehouse_id || "");
      const lotId = String((row as any).harvest_lot_id || "");
      if (!warehouseId || !lotId || Number((row as any).current_weight_kg || 0) <= 0) continue;
      const positions = harvestPositions.get(warehouseId) || new Set<string>();
      positions.add(lotId);
      harvestPositions.set(warehouseId, positions);
    }

    const lastMovementByWarehouse = new Map<string, string>();
    for (const row of ledgerResult.data || []) {
      const warehouseId = String((row as any).warehouse_id || "");
      if (!warehouseId || lastMovementByWarehouse.has(warehouseId)) continue;
      const timestamp = String((row as any).occurred_at || (row as any).created_at || "");
      if (timestamp) lastMovementByWarehouse.set(warehouseId, timestamp);
    }

    const summaries = (warehousesResult.data || [])
      .map(normalizeWarehouseRow)
      .filter((row) => warehouseVisibleToRole(row, actor.role))
      .filter((row) => !rowHasQaDataMarker(row as unknown as Record<string, unknown>, ["name", "description", "warehouse_type"]))
      .map((warehouse) => ({
        warehouse,
        position_count:
          (materialPositions.get(String(warehouse.id))?.size || 0) +
          (harvestPositions.get(String(warehouse.id))?.size || 0),
        last_movement_at: lastMovementByWarehouse.get(String(warehouse.id)) || null,
      }));

    return NextResponse.json({ summaries });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load warehouse summaries" },
      { status: 500 }
    );
  }
}
