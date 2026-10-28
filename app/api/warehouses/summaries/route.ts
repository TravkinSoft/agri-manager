import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";
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
import { buildWarehouseMassBreakdown } from "@/lib/warehouse/warehouse-summary-math";
import { countColdWarehousePositions } from "@/lib/warehouse/harvest-batch-selection";
import { compareWarehouseDisplayOrder } from "@/lib/warehouse/warehouse-order";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUERY_CHUNK_SIZE = 300;
const BALANCE_PAGE_SIZE = 1000;

async function loadWarehouseBalanceRows(
  db: Awaited<ReturnType<typeof getUserScopedClientFromRequest>>,
  companyId: string,
  warehouseIds: string[],
) {
  const rows: any[] = [];
  for (let from = 0; ; from += BALANCE_PAGE_SIZE) {
    const result = await db
      .from("v_stock_balance_identity")
      .select("warehouse_id,product_id,variety_id,reproduction_id,quantity,uom,batch_class,batch_id,last_movement_at")
      .eq("company_id", companyId)
      .in("warehouse_id", warehouseIds)
      .order("warehouse_id", { ascending: true })
      .order("product_id", { ascending: true })
      .order("variety_id", { ascending: true, nullsFirst: true })
      .order("reproduction_id", { ascending: true, nullsFirst: true })
      .order("batch_id", { ascending: true, nullsFirst: true })
      .order("batch_class", { ascending: true })
      .order("uom", { ascending: true })
      .range(from, from + BALANCE_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const page = result.data || [];
    rows.push(...page);
    if (page.length < BALANCE_PAGE_SIZE) return rows;
  }
}

async function loadRowsInChunks<T>(
  values: string[],
  read: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: any }>,
) {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += QUERY_CHUNK_SIZE) {
    chunks.push(values.slice(index, index + QUERY_CHUNK_SIZE));
  }
  const pages = await Promise.all(chunks.map(async (chunk) => {
    const result = await read(chunk);
    if (result.error) throw result.error;
    return result.data || [];
  }));
  return pages.flat();
}

async function loadHarvestBalanceBatchIds(
  db: ReturnType<typeof getServiceClient>,
  companyId: string,
  balanceRows: any[],
) {
  const candidateBatchIds = Array.from(new Set(
    balanceRows
      .map((row) => String(row.batch_id || "").trim())
      .filter((batchId) => UUID_RE.test(batchId)),
  ));
  if (!candidateBatchIds.length) return new Set<string>();

  // The compact balance view already reduced tens of thousands of ledger rows
  // to physical batch identities. Resolve only those identities back to the
  // harvest lineage, instead of downloading the complete ledger on every
  // warehouse-page refresh.
  const [inventoryRows, directLinks] = await Promise.all([
    loadRowsInChunks<any>(candidateBatchIds, (chunk) => db
      .from("inventory_batches")
      .select("id,source_ticket_id")
      .eq("company_id", companyId)
      .in("id", chunk)),
    loadRowsInChunks<any>(candidateBatchIds, (chunk) => db
      .from("harvest_lot_batches")
      .select("inventory_batch_id,source_ticket_id")
      .eq("company_id", companyId)
      .in("inventory_batch_id", chunk)),
  ]);
  const sourceTicketIds = Array.from(new Set(
    inventoryRows.map((row) => String(row.source_ticket_id || "").trim()).filter(Boolean),
  ));
  const ticketLinks = sourceTicketIds.length
    ? await loadRowsInChunks<any>(sourceTicketIds, (chunk) => db
        .from("harvest_lot_batches")
        .select("inventory_batch_id,source_ticket_id")
        .eq("company_id", companyId)
        .in("source_ticket_id", chunk))
    : [];
  const harvestTicketIds = new Set(
    [...directLinks, ...ticketLinks]
      .map((row) => String(row.source_ticket_id || "").trim())
      .filter(Boolean),
  );
  const harvestBatchIds = new Set(
    [...directLinks, ...ticketLinks]
      .map((row) => String(row.inventory_batch_id || "").trim())
      .filter(Boolean),
  );
  inventoryRows.forEach((row) => {
    if (harvestTicketIds.has(String(row.source_ticket_id || "").trim())) {
      harvestBatchIds.add(String(row.id));
    }
  });
  return harvestBatchIds;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
    const processingCardsScope = request.nextUrl.searchParams.get("scope") === "processing_cards";
    const supabase = await getUserScopedClientFromRequest(request);

    await assertActorAccess({
      // Resolve the trusted actor profile server-side; stock reads keep the caller JWT/RLS.
      supabase: actor.isImpersonating ? getServiceClient() : supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_READ_ROLES],
    });

    let warehouseQuery = supabase.from("warehouses").select("*").eq("company_id", companyId).order("name");
    if (!includeArchived) warehouseQuery = warehouseQuery.eq("archived", false).eq("is_archived", false);
    if (processingCardsScope) warehouseQuery = warehouseQuery.in("place_type", ["YARD", "DRYER", "CLEANER"]);

    const warehousesResult = await warehouseQuery;
    if (warehousesResult.error) return NextResponse.json({ error: warehousesResult.error.message }, { status: 400 });
    const visibleWarehouses = (warehousesResult.data || [])
      .map(normalizeWarehouseRow)
      .filter((row) => warehouseVisibleToRole(row, actor.role))
      .filter((row) => !rowHasQaDataMarker(row as unknown as Record<string, unknown>, ["name", "description", "warehouse_type"]))
      .sort(compareWarehouseDisplayOrder);
    const warehouseIds = visibleWarehouses.map((warehouse) => String(warehouse.id));
    if (!warehouseIds.length) return NextResponse.json({ summaries: [] });
    // The actor and company scope are already verified. Restrict this privileged
    // reader to the aggregate stock view and keep every query company-scoped;
    // otherwise security-invoker RLS expansion can hit the statement timeout.
    const harvestStockSupabase = getServiceClient();

    if (processingCardsScope) {
      const harvestLotsResult = await harvestStockSupabase
        .from("v_harvest_lot_stock_v2")
        .select("harvest_lot_id,warehouse_id,current_weight_kg")
        .eq("company_id", companyId)
        .in("warehouse_id", warehouseIds)
        .gt("current_weight_kg", 0.0001);
      if (harvestLotsResult.error) {
        return NextResponse.json({ error: harvestLotsResult.error.message }, { status: 400 });
      }

      const harvestPositions = new Map<string, Set<string>>();
      const harvestWeightByWarehouse = new Map<string, number>();
      for (const row of harvestLotsResult.data || []) {
        const warehouseId = String((row as any).warehouse_id || "");
        const lotId = String((row as any).harvest_lot_id || "");
        if (!warehouseId || !lotId || Number((row as any).current_weight_kg || 0) <= 0) continue;
        const positions = harvestPositions.get(warehouseId) || new Set<string>();
        positions.add(lotId);
        harvestPositions.set(warehouseId, positions);
        harvestWeightByWarehouse.set(
          warehouseId,
          (harvestWeightByWarehouse.get(warehouseId) || 0) + Number((row as any).current_weight_kg || 0),
        );
      }

      return NextResponse.json({
        summaries: visibleWarehouses.map((warehouse) => ({
          warehouse,
          position_count: harvestPositions.get(String(warehouse.id))?.size || 0,
          harvest_lot_count: harvestPositions.get(String(warehouse.id))?.size || 0,
          harvest_weight_kg: harvestWeightByWarehouse.get(String(warehouse.id)) || 0,
          last_movement_at: null,
        })),
      });
    }

    const [balancesResult, harvestLotsResult] = await Promise.all([
      loadWarehouseBalanceRows(supabase, companyId, warehouseIds)
        .then((data) => ({ data, error: null }))
        .catch((error) => ({ data: [] as any[], error })),
      harvestStockSupabase
        .from("v_harvest_lot_stock_v2")
        .select("harvest_lot_id,warehouse_id,current_weight_kg")
        .eq("company_id", companyId)
        .in("warehouse_id", warehouseIds)
        .gt("current_weight_kg", 0.0001),
    ]);

    const error = balancesResult.error
      || harvestLotsResult.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const balanceRows = (balancesResult.data || []) as any[];
    const harvestBalanceBatchIds = await loadHarvestBalanceBatchIds(
      harvestStockSupabase,
      companyId,
      balanceRows,
    );

    const materialBalances = new Map<string, {
      warehouse_id: string;
      product_id: string;
      batch_class: string;
      uom: string;
      quantity: number;
      harvest_represented_quantity: number;
    }>();
    for (const row of balanceRows) {
      const warehouseId = String((row as any).warehouse_id || "");
      const productId = String((row as any).product_id || "");
      const batchClass = String((row as any).batch_class || "commodity").trim().toLowerCase() || "commodity";
      const uom = String((row as any).uom || "").trim().toLowerCase();
      if (!warehouseId || !productId) continue;
      const signedQuantity = Number((row as any).quantity || 0);
      const key = `${warehouseId}|${productId}|${batchClass}|${uom}`;
      const current = materialBalances.get(key) || {
        warehouse_id: warehouseId,
        product_id: productId,
        batch_class: batchClass,
        uom,
        quantity: 0,
        harvest_represented_quantity: 0,
      };
      current.quantity += signedQuantity;
      if (harvestBalanceBatchIds.has(String((row as any).batch_id || "").trim())) {
        current.harvest_represented_quantity += signedQuantity;
      }
      materialBalances.set(key, current);
    }
    const materialBalanceRows = Array.from(materialBalances.values()).map((row) => ({
      ...row,
      material_quantity: row.quantity - row.harvest_represented_quantity,
    }));

    const harvestPositions = new Map<string, Set<string>>();
    const harvestWeightByWarehouse = new Map<string, number>();
    for (const row of harvestLotsResult.data || []) {
      const warehouseId = String((row as any).warehouse_id || "");
      const lotId = String((row as any).harvest_lot_id || "");
      if (!warehouseId || !lotId || Number((row as any).current_weight_kg || 0) <= 0) continue;
      const positions = harvestPositions.get(warehouseId) || new Set<string>();
      positions.add(lotId);
      harvestPositions.set(warehouseId, positions);
      harvestWeightByWarehouse.set(
        warehouseId,
        (harvestWeightByWarehouse.get(warehouseId) || 0) + Number((row as any).current_weight_kg || 0)
      );
    }

    const lastMovementByWarehouse = new Map<string, string>();
    for (const row of balanceRows) {
      const warehouseId = String((row as any).warehouse_id || "");
      const timestamp = String((row as any).last_movement_at || "");
      if (warehouseId && timestamp && timestamp > (lastMovementByWarehouse.get(warehouseId) || "")) {
        lastMovementByWarehouse.set(warehouseId, timestamp);
      }
    }

    const massByWarehouse = buildWarehouseMassBreakdown(
      (balancesResult.data || []) as any[],
      harvestWeightByWarehouse
    );

    const summaries = visibleWarehouses.map((warehouse) => {
      const mass = massByWarehouse.get(String(warehouse.id));
      return {
        warehouse,
        position_count: countColdWarehousePositions(
          Array.from(harvestPositions.get(String(warehouse.id)) || []),
          materialBalanceRows.filter((row) => row.warehouse_id === String(warehouse.id)),
        ),
        harvest_lot_count: harvestPositions.get(String(warehouse.id))?.size || 0,
        harvest_weight_kg: harvestWeightByWarehouse.get(String(warehouse.id)) || 0,
        total_weight_kg: mass?.totalWeightKg || 0,
        seed_weight_kg: mass?.seedWeightKg || 0,
        other_material_weight_kg: mass?.otherMaterialWeightKg || 0,
        last_movement_at: lastMovementByWarehouse.get(String(warehouse.id)) || null,
      };
    });

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
