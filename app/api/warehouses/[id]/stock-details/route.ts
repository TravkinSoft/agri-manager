import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";
import { SessionAuthError } from "@/lib/auth/server-session";
import { WAREHOUSE_READ_ROLES, resolveWarehouseForActor } from "@/app/api/warehouses/_helpers";
import { buildCatalogIdentityKey, buildProductDisplayLabel } from "@/lib/catalog/catalog-identity";
import { normalizeStockUom } from "@/lib/warehouse/stock-unit-contract";
import { calculateStockMath, signedLedgerQuantity } from "@/lib/warehouse/stock-math";
import { loadWarehouseStockCatalog } from "@/lib/warehouse/load-stock-catalog";
import {
  isHarvestLedgerRow,
  loadHarvestLedgerOriginRefs,
  resolveLedgerBatchId,
} from "@/lib/warehouse/harvest-ledger-origin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STOCK_BATCH_CLASSES = new Set([
  "commodity",
  "seed",
  "material",
  "feed",
  "waste",
  "processing",
  "rejected",
]);

function signedQuantity(row: any): number {
  return signedLedgerQuantity(row);
}

function isOpenRequest(row: any): boolean {
  const canonical = String(row.warehouse_request_status || "");
  if (canonical) return ["pending", "collecting", "ready_for_pickup"].includes(canonical);
  return ["new", "active", "preparing", "ready"].includes(String(row.status || ""));
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const warehouseId = String(id || "").trim();
    const productId = String(request.nextUrl.searchParams.get("productId") || "").trim();
    const requestedUnit = String(request.nextUrl.searchParams.get("unit") || "").trim();
    const requestedBatchClass = String(
      request.nextUrl.searchParams.get("batchClass") || ""
    ).trim().toLowerCase();
    const stockOrigin = String(
      request.nextUrl.searchParams.get("stockOrigin") || "all"
    ).trim().toLowerCase();
    const excludeRequestId = String(
      request.nextUrl.searchParams.get("excludeRequestId") || ""
    ).trim();
    if (!UUID_RE.test(productId) || !requestedUnit) {
      return NextResponse.json({ error: "Материал и единица обязательны" }, { status: 400 });
    }
    if (requestedBatchClass && !STOCK_BATCH_CLASSES.has(requestedBatchClass)) {
      return NextResponse.json({ error: "Неизвестный класс партии" }, { status: 400 });
    }
    if (!new Set(["all", "material"]).has(stockOrigin)) {
      return NextResponse.json({ error: "Неизвестное происхождение остатка" }, { status: 400 });
    }

    const { actor, companyId, supabase, existing } = await resolveWarehouseForActor(request, warehouseId);
    await assertActorAccess({
      // Resolve the trusted actor profile server-side; stock reads keep the caller JWT/RLS.
      supabase: actor.isImpersonating ? getServiceClient() : supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_READ_ROLES],
    });
    if (!existing?.id) return NextResponse.json({ error: "Склад не найден" }, { status: 404 });

    const { data: catalogRows, error: catalogError } = await loadWarehouseStockCatalog(
      supabase,
      "id,master_product_id,name,trade_name,normalized_name,manufacturer,type,product_type,category,subcategory,pesticide_category,fertilizer_type,unit,base_uom,company_id,archived,is_active",
      companyId
    );
    if (catalogError) throw new Error(catalogError.message);
    const selected = (catalogRows || []).find((row: any) => String(row.id) === productId);
    if (!selected) return NextResponse.json({ error: "Материал не найден" }, { status: 404 });
    const identityKey = buildCatalogIdentityKey(selected as any);
    const identityProducts = (catalogRows || []).filter(
      (row: any) => row.is_active !== false && buildCatalogIdentityKey(row as any) === identityKey
    );
    const productIds = identityProducts.map((row: any) => String(row.id));
    const unit = normalizeStockUom(requestedUnit).baseUom;

    const [ledgerResult, requestResult] = await Promise.all([
      supabase
        .from("stock_ledger_entries")
        .select("id,product_id,direction,quantity,delta_qty_signed,uom,batch_id,batch_id_text,batch_class,inventory_batch_id,reason_type,reason_ref_id,ticket_id,occurred_at,created_at,notes")
        .eq("company_id", companyId)
        .eq("warehouse_id", warehouseId)
        .in("product_id", productIds)
        .order("occurred_at", { ascending: true }),
      supabase
        .from("warehouse_issue_requests")
        .select("id,request_number,status,warehouse_request_status,source_warehouse_id,operation_id,field_id,operations:operation_id(operation_type),fields:field_id(name),warehouse_issue_request_items(product_id,actual_product_id,prepared_quantity,issued_quantity,unit,prepared_unit,issued_unit,warehouse_issue_request_item_allocations(batch_id_text,batch_class,prepared_quantity,issued_quantity))")
        .eq("company_id", companyId)
        .eq("source_warehouse_id", warehouseId),
    ]);
    if (ledgerResult.error || requestResult.error) {
      throw new Error(ledgerResult.error?.message || requestResult.error?.message);
    }

    const harvestOriginRefs = await loadHarvestLedgerOriginRefs(
      supabase,
      companyId,
      (ledgerResult.data || []) as any[]
    );
    const ledger = (ledgerResult.data || []).filter((row: any) => {
      try {
        return normalizeStockUom(row.uom).baseUom === unit &&
          (!requestedBatchClass ||
            String(row.batch_class || "commodity").toLowerCase() === requestedBatchClass) &&
          (stockOrigin !== "material" || !isHarvestLedgerRow(row, harvestOriginRefs));
      } catch {
        return false;
      }
    });
    const quantity = ledger.reduce((sum: number, row: any) => sum + signedQuantity(row), 0);
    let reserved = 0;
    const reservedByBatch = new Map<string, number>();
    const reservations: Array<Record<string, unknown>> = [];
    for (const row of requestResult.data || []) {
      if (!isOpenRequest(row)) continue;
      if (excludeRequestId && String((row as any).id) === excludeRequestId) continue;
      for (const item of (row as any).warehouse_issue_request_items || []) {
        if (!productIds.includes(String(item.actual_product_id || item.product_id || ""))) continue;
        try {
          if (normalizeStockUom(item.prepared_unit || item.issued_unit || item.unit).baseUom !== unit) continue;
        } catch {
          continue;
        }
        const itemReservation = Math.max(
          Number(item.prepared_quantity || 0) - Number(item.issued_quantity || 0),
          0
        );
        const allocations = Array.isArray(item.warehouse_issue_request_item_allocations)
          ? item.warehouse_issue_request_item_allocations
          : [];
        const relevantAllocations = allocations.filter((allocation: any) =>
          (!requestedBatchClass ||
            String(allocation.batch_class || "commodity").toLowerCase() === requestedBatchClass) &&
          (stockOrigin !== "material" || !isHarvestLedgerRow(allocation, harvestOriginRefs))
        );
        const reservation = requestedBatchClass
          ? allocations.length > 0
            ? relevantAllocations.reduce(
                (sum: number, allocation: any) =>
                  sum + Math.max(
                    Number(allocation.prepared_quantity || 0) -
                      Number(allocation.issued_quantity || 0),
                    0
                  ),
                0
              )
            : requestedBatchClass === "commodity"
              ? itemReservation
              : 0
          : itemReservation;
        reserved += reservation;
        if (relevantAllocations.length > 0) {
          for (const allocation of relevantAllocations) {
            const allocationReserved = Math.max(
              Number(allocation.prepared_quantity || 0) -
                Number(allocation.issued_quantity || 0),
              0
            );
            const batchKey =
              `${String(allocation.batch_class || "commodity")}:${
                String(allocation.batch_id_text || "").trim() || "__unassigned__"
              }`;
            reservedByBatch.set(
              batchKey,
              (reservedByBatch.get(batchKey) || 0) + allocationReserved
            );
          }
        } else if (reservation > 0.000001) {
          reservedByBatch.set(
            `${requestedBatchClass || "commodity"}:__unassigned__`,
            (reservedByBatch.get(`${requestedBatchClass || "commodity"}:__unassigned__`) || 0) + reservation
          );
        }
        if (reservation > 0.000001) {
          const operation = Array.isArray((row as any).operations)
            ? (row as any).operations[0]
            : (row as any).operations;
          const field = Array.isArray((row as any).fields)
            ? (row as any).fields[0]
            : (row as any).fields;
          reservations.push({
            request_id: String((row as any).id),
            request_number: String((row as any).request_number || (row as any).id),
            operation_id: (row as any).operation_id || null,
            operation: operation?.operation_type || null,
            field: field?.name || null,
            quantity: Number(reservation.toFixed(3)),
            status: String((row as any).warehouse_request_status || (row as any).status || "pending"),
            batch_id_text:
              relevantAllocations.length === 1
                ? String(relevantAllocations[0]?.batch_id_text || "").trim() || null
                : null,
          });
        }
      }
    }

    const byBatch = new Map<
      string,
      {
        batchId: string | null;
        batchClass: string;
        quantity: number;
        firstAt: string;
      }
    >();
    for (const row of ledger) {
      const batchId = resolveLedgerBatchId(row);
      const batchClass = String(row.batch_class || "commodity");
      const key = `${batchClass}:${batchId || "__unassigned__"}`;
      const current = byBatch.get(key) || {
        batchId,
        batchClass,
        quantity: 0,
        firstAt: String(row.occurred_at || row.created_at || ""),
      };
      current.quantity += signedQuantity(row);
      byBatch.set(key, current);
    }

    const uuidBatchIds = Array.from(byBatch.values())
      .map((row) => row.batchId)
      .filter((value): value is string => Boolean(value && UUID_RE.test(value)));
    const { data: batches, error: batchError } = uuidBatchIds.length
      ? await supabase
          .from("inventory_batches")
          .select("id,product_id,source_ticket_id,batch_code,supplier_lot,lot_number,supplier_id,created_at")
          .in("id", uuidBatchIds)
      : { data: [] as any[], error: null };
    if (batchError) throw new Error(batchError.message);
    const ticketIds = Array.from(new Set((batches || []).map((row: any) => String(row.source_ticket_id || "")).filter(Boolean)));
    const [ticketResult, lineResult] = await Promise.all([
      ticketIds.length
        ? supabase
            .from("tickets")
            .select("id,ticket_no,supplier_id,created_at,finalized_at")
            .in("id", ticketIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      ticketIds.length
        ? supabase
            .from("ticket_lines")
            .select("ticket_id,product_id,lot_id,quality_json")
            .in("ticket_id", ticketIds)
            .in("product_id", productIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    const { data: tickets, error: ticketError } = ticketResult;
    const { data: lines, error: lineError } = lineResult;
    if (ticketError) throw new Error(ticketError.message);
    if (lineError) throw new Error(lineError.message);
    const supplierIds = Array.from(new Set([
      ...(batches || []).map((row: any) => String(row.supplier_id || "")),
      ...(tickets || []).map((row: any) => String(row.supplier_id || "")),
    ].filter(Boolean)));
    const { data: suppliers, error: supplierError } = supplierIds.length
      ? await supabase.from("counterparties").select("id,name").in("id", supplierIds)
      : { data: [] as any[], error: null };
    if (supplierError) throw new Error(supplierError.message);

    const batchById = new Map((batches || []).map((row: any) => [String(row.id), row] as const));
    const ticketById = new Map((tickets || []).map((row: any) => [String(row.id), row] as const));
    const supplierById = new Map((suppliers || []).map((row: any) => [String(row.id), String(row.name || "")] as const));
    const lineByTicket = new Map((lines || []).map((row: any) => [String(row.ticket_id), row] as const));
    const knownLots = Array.from(byBatch.entries())
      .filter(([, row]) => row.batchId && row.quantity > 0.000001)
      .map(([key, row]) => ({ key, ...row }))
      .sort((a, b) => a.firstAt.localeCompare(b.firstAt));
    const unassignedRows = Array.from(byBatch.entries())
      .filter(([, row]) => !row.batchId)
      .map(([key, row]) => ({ key, ...row }));
    let unassigned = unassignedRows.reduce(
      (sum, row) => sum + row.quantity,
      0
    );
    if (unassigned < -0.000001) {
      let remainingOut = -unassigned;
      for (const lot of knownLots) {
        const take = Math.min(lot.quantity, remainingOut);
        lot.quantity -= take;
        remainingOut -= take;
        if (remainingOut <= 0.000001) break;
      }
      unassigned = -remainingOut;
    }

    const lots = knownLots
      .filter((row) => row.quantity > 0.000001)
      .map((row) => {
        const batch = batchById.get(String(row.batchId || ""));
        const ticket = batch ? ticketById.get(String(batch.source_ticket_id || "")) : null;
        const line = ticket ? lineByTicket.get(String(ticket.id)) : null;
        const quality = (line?.quality_json || {}) as Record<string, unknown>;
        const lotReserved = reservedByBatch.get(row.key) || 0;
        return {
          key: row.key,
          batch_id: row.batchId,
          batch_class: row.batchClass,
          batch_label: String(batch?.supplier_lot || batch?.lot_number || batch?.batch_code || row.batchId),
          quantity: Number(row.quantity.toFixed(3)),
          reserved_quantity: Number(lotReserved.toFixed(3)),
          available_quantity: Number(
            Math.max(row.quantity - lotReserved, 0).toFixed(3)
          ),
          manufactured_at: quality.manufactured_at ? String(quality.manufactured_at) : null,
          expires_at: quality.expires_at ? String(quality.expires_at) : null,
          supplier: supplierById.get(String(batch?.supplier_id || ticket?.supplier_id || "")) || null,
          receipt_no: ticket?.ticket_no || null,
          received_at: ticket?.finalized_at || ticket?.created_at || row.firstAt || null,
        };
      });
    if (unassigned > 0.000001) {
      const unassignedClass = unassignedRows[0]?.batchClass || "commodity";
      const unassignedKey = `${unassignedClass}:__unassigned__`;
      const unassignedReserved = reservedByBatch.get(unassignedKey) || 0;
      lots.push({
        key: unassignedKey,
        batch_id: null,
        batch_class: unassignedClass,
        batch_label: "Партия не указана",
        quantity: Number(unassigned.toFixed(3)),
        reserved_quantity: Number(unassignedReserved.toFixed(3)),
        available_quantity: Number(
          Math.max(unassigned - unassignedReserved, 0).toFixed(3)
        ),
        manufactured_at: null,
        expires_at: null,
        supplier: null,
        receipt_no: null,
        received_at: unassignedRows[0]?.firstAt || null,
      });
    }
    lots.sort((a, b) => {
      const expiryA = a.expires_at || "9999-12-31";
      const expiryB = b.expires_at || "9999-12-31";
      return expiryA.localeCompare(expiryB) || String(a.received_at || "").localeCompare(String(b.received_at || ""));
    });

    const movements = [...ledger]
      .sort((a: any, b: any) => String(b.occurred_at || b.created_at).localeCompare(String(a.occurred_at || a.created_at)))
      .slice(0, 20)
      .map((row: any) => ({
        id: String(row.id),
        warehouse_id: warehouseId,
        product_id: String(row.product_id),
        product_name: buildProductDisplayLabel(selected as any),
        quantity: Math.abs(signedQuantity(row)),
        quantity_delta: signedQuantity(row),
        product_unit: unit,
        movement_type: String(row.reason_type || "").includes("transfer") ? "transfer" : row.direction === "in" ? "receipt" : "issue",
        reason_type: row.reason_type,
        reason_ref_id: row.reason_ref_id,
        operation_datetime: row.occurred_at || row.created_at,
        created_at: row.created_at,
        notes: row.notes,
        status: "confirmed",
        transaction_type: row.direction,
        date: String(row.occurred_at || row.created_at || "").slice(0, 10),
        user_id: "",
        updated_at: row.created_at,
      }));

    const stock = calculateStockMath(quantity, reserved);
    return NextResponse.json({
      details: {
        warehouse_id: warehouseId,
        product_id: productId,
        product_name: buildProductDisplayLabel(selected as any),
        batch_class: requestedBatchClass || null,
        stock_origin: stockOrigin,
        unit,
        quantity: Number(stock.onHand.toFixed(3)),
        reserved_quantity: Number(stock.reserved.toFixed(3)),
        available_quantity: Number(stock.available.toFixed(3)),
        deficit_quantity: Number(stock.deficit.toFixed(3)),
        stock_status: stock.deficit > 0.000001 ? "deficit" : "available",
        reservations,
        lots,
        movements,
      },
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить детали остатка" },
      { status: 500 }
    );
  }
}
