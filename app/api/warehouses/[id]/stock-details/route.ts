import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError } from "@/lib/auth/server-session";
import { WAREHOUSE_READ_ROLES, resolveWarehouseForActor } from "@/app/api/warehouses/_helpers";
import { buildCatalogIdentityKey, buildProductDisplayLabel } from "@/lib/catalog/catalog-identity";
import { normalizeStockUom } from "@/lib/warehouse/stock-unit-contract";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signedQuantity(row: any): number {
  const delta = Number(row.delta_qty_signed);
  if (Number.isFinite(delta)) return delta;
  const quantity = Number(row.quantity || 0);
  return row.direction === "in" ? quantity : -quantity;
}

function isOpenRequest(row: any): boolean {
  return ["new", "active", "preparing", "ready", "received_confirmed"].includes(String(row.status || "")) &&
    !["issued", "closed", "return_received", "cancelled"].includes(String(row.warehouse_request_status || ""));
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
    if (!UUID_RE.test(productId) || !requestedUnit) {
      return NextResponse.json({ error: "Материал и единица обязательны" }, { status: 400 });
    }

    const { actor, companyId, supabase, existing } = await resolveWarehouseForActor(request, warehouseId);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_READ_ROLES],
    });
    if (!existing?.id) return NextResponse.json({ error: "Склад не найден" }, { status: 404 });

    const { data: catalogRows, error: catalogError } = await supabase
      .from("products")
      .select("id,master_product_id,name,trade_name,normalized_name,manufacturer,type,product_type,category,subcategory,pesticide_category,fertilizer_type,unit,base_uom,company_id,archived,is_active")
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .eq("archived", false);
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
        .select("id,product_id,direction,quantity,delta_qty_signed,uom,batch_id,batch_id_text,batch_class,reason_type,reason_ref_id,ticket_id,occurred_at,created_at,notes")
        .eq("company_id", companyId)
        .eq("warehouse_id", warehouseId)
        .in("product_id", productIds)
        .order("occurred_at", { ascending: true }),
      supabase
        .from("warehouse_issue_requests")
        .select("id,status,warehouse_request_status,source_warehouse_id,warehouse_issue_request_items(product_id,actual_product_id,prepared_quantity,issued_quantity,unit,prepared_unit,issued_unit)")
        .eq("company_id", companyId)
        .eq("source_warehouse_id", warehouseId),
    ]);
    if (ledgerResult.error || requestResult.error) {
      throw new Error(ledgerResult.error?.message || requestResult.error?.message);
    }

    const ledger = (ledgerResult.data || []).filter((row: any) => {
      try {
        return normalizeStockUom(row.uom).baseUom === unit;
      } catch {
        return false;
      }
    });
    const quantity = ledger.reduce((sum: number, row: any) => sum + signedQuantity(row), 0);
    let reserved = 0;
    for (const row of requestResult.data || []) {
      if (!isOpenRequest(row)) continue;
      for (const item of (row as any).warehouse_issue_request_items || []) {
        if (!productIds.includes(String(item.actual_product_id || item.product_id || ""))) continue;
        try {
          if (normalizeStockUom(item.prepared_unit || item.issued_unit || item.unit).baseUom !== unit) continue;
        } catch {
          continue;
        }
        reserved += Math.max(Number(item.prepared_quantity || 0) - Number(item.issued_quantity || 0), 0);
      }
    }

    const byBatch = new Map<string, { batchId: string | null; quantity: number; firstAt: string }>();
    for (const row of ledger) {
      const batchId = String(row.batch_id_text || row.batch_id || "").trim() || null;
      const key = batchId || "__unassigned__";
      const current = byBatch.get(key) || {
        batchId,
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
    const { data: tickets, error: ticketError } = ticketIds.length
      ? await supabase
          .from("tickets")
          .select("id,ticket_no,supplier_id,created_at,finalized_at")
          .in("id", ticketIds)
      : { data: [] as any[], error: null };
    if (ticketError) throw new Error(ticketError.message);
    const { data: lines, error: lineError } = ticketIds.length
      ? await supabase
          .from("ticket_lines")
          .select("ticket_id,product_id,lot_id,quality_json")
          .in("ticket_id", ticketIds)
          .in("product_id", productIds)
      : { data: [] as any[], error: null };
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
      .filter(([key, row]) => key !== "__unassigned__" && row.quantity > 0.000001)
      .map(([key, row]) => ({ key, ...row }))
      .sort((a, b) => a.firstAt.localeCompare(b.firstAt));
    let unassigned = byBatch.get("__unassigned__")?.quantity || 0;
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
        return {
          key: row.key,
          batch_id: row.batchId,
          batch_label: String(batch?.supplier_lot || batch?.lot_number || batch?.batch_code || row.batchId),
          quantity: Number(row.quantity.toFixed(3)),
          manufactured_at: quality.manufactured_at ? String(quality.manufactured_at) : null,
          expires_at: quality.expires_at ? String(quality.expires_at) : null,
          supplier: supplierById.get(String(batch?.supplier_id || ticket?.supplier_id || "")) || null,
          receipt_no: ticket?.ticket_no || null,
          received_at: ticket?.finalized_at || ticket?.created_at || row.firstAt || null,
        };
      });
    if (unassigned > 0.000001) {
      lots.push({
        key: "__unassigned__",
        batch_id: null,
        batch_label: "Партия не указана",
        quantity: Number(unassigned.toFixed(3)),
        manufactured_at: null,
        expires_at: null,
        supplier: null,
        receipt_no: null,
        received_at: byBatch.get("__unassigned__")?.firstAt || null,
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

    return NextResponse.json({
      details: {
        warehouse_id: warehouseId,
        product_id: productId,
        product_name: buildProductDisplayLabel(selected as any),
        unit,
        quantity: Number(quantity.toFixed(3)),
        reserved_quantity: Number(reserved.toFixed(3)),
        available_quantity: Number(Math.max(quantity - reserved, 0).toFixed(3)),
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
