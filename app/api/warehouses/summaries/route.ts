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
import { buildWarehouseMassBreakdown } from "@/lib/warehouse/warehouse-summary-math";
import { isHarvestLedgerRow, loadHarvestLedgerOriginRefs } from "@/lib/warehouse/harvest-ledger-origin";
import { countColdWarehousePositions } from "@/lib/warehouse/harvest-batch-selection";
import { normalizeStockUom } from "@/lib/warehouse/stock-unit-contract";

export const dynamic = "force-dynamic";

const LEDGER_PAGE_SIZE = 1000;
const LEDGER_SELECT = "id,warehouse_id,product_id,direction,quantity,delta_qty_signed,uom,batch_class,inventory_batch_id,batch_id,batch_id_text,ticket_id,occurred_at,created_at,unit_contract_version";

async function loadWarehouseLedgerRows(
  supabase: Awaited<ReturnType<typeof getUserScopedClientFromRequest>>,
  companyId: string,
  warehouseIds: string[],
) {
  const rows: any[] = [];
  for (let from = 0; ; from += LEDGER_PAGE_SIZE) {
    const result = await supabase
      .from("stock_ledger_entries")
      .select(LEDGER_SELECT)
      .eq("company_id", companyId)
      .in("warehouse_id", warehouseIds)
      .order("id", { ascending: true })
      .range(from, from + LEDGER_PAGE_SIZE - 1);
    if (result.error) return { data: [] as any[], error: result.error };
    const page = (result.data || []) as any[];
    rows.push(...page);
    if (page.length < LEDGER_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
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
      supabase,
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
      .filter((row) => !rowHasQaDataMarker(row as unknown as Record<string, unknown>, ["name", "description", "warehouse_type"]));
    const warehouseIds = visibleWarehouses.map((warehouse) => String(warehouse.id));
    if (!warehouseIds.length) return NextResponse.json({ summaries: [] });

    if (processingCardsScope) {
      const harvestLotsResult = await supabase
        .from("v_harvest_lot_stock_v1")
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

    const [balancesResult, harvestLotsResult, ledgerResult] = await Promise.all([
      supabase
        .from("v_stock_balance_identity")
        .select("warehouse_id,product_id,quantity,uom,batch_class")
        .eq("company_id", companyId)
        .in("warehouse_id", warehouseIds),
      supabase
        .from("v_harvest_lot_stock_v1")
        .select("harvest_lot_id,warehouse_id,current_weight_kg")
        .eq("company_id", companyId)
        .in("warehouse_id", warehouseIds)
        .gt("current_weight_kg", 0.0001),
      loadWarehouseLedgerRows(supabase, companyId, warehouseIds),
    ]);

    const error = balancesResult.error
      || harvestLotsResult.error
      || ledgerResult.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const ledgerRows = (ledgerResult.data || []) as any[];
    const harvestOriginRefs = await loadHarvestLedgerOriginRefs(supabase, companyId, ledgerRows);

    const materialBalances = new Map<string, {
      warehouse_id: string;
      product_id: string;
      batch_class: string;
      uom: string;
      quantity: number;
      harvest_represented_quantity: number;
    }>();
    for (const row of ledgerRows) {
      const warehouseId = String((row as any).warehouse_id || "");
      const productId = String((row as any).product_id || "");
      const batchClass = String((row as any).batch_class || "commodity").trim().toLowerCase() || "commodity";
      let uom = String((row as any).uom || "").trim().toLowerCase();
      if (Number((row as any).unit_contract_version) !== 2) {
        try {
          uom = `legacy/${normalizeStockUom((row as any).uom).baseUom}`;
        } catch {
          uom = "legacy/unknown";
        }
      }
      if (!warehouseId || !productId) continue;
      const deltaValue = (row as any).delta_qty_signed;
      const signedQuantity = deltaValue != null && Number.isFinite(Number(deltaValue))
        ? Number(deltaValue)
        : String((row as any).direction || "").toLowerCase() === "in"
          ? Number((row as any).quantity || 0)
          : -Number((row as any).quantity || 0);
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
      if (isHarvestLedgerRow(row, harvestOriginRefs)) current.harvest_represented_quantity += signedQuantity;
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
    for (const row of ledgerRows) {
      const warehouseId = String((row as any).warehouse_id || "");
      const timestamp = String((row as any).occurred_at || (row as any).created_at || "");
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
