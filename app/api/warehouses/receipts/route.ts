import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { AGROCHEMICAL_WAREHOUSE_TYPES } from "@/lib/warehouse/warehouse-scope";
import { isAgrochemicalProductType, isAgrochemicalWarehouseType } from "@/lib/warehouse/warehouse-scope";
import { COUNTERPARTY_SELECT, normalizeCounterpartyRow } from "@/lib/counterparties/rows";

const READ_ROLES = ["global_admin", "company_admin", "warehouse", "warehouse_operator"] as const;
const WRITE_ROLES = ["global_admin", "warehouse", "warehouse_operator"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function contextForRequest(request: NextRequest, requestedCompanyId: string | null) {
  const actor = await getServerActorFromSession(request);
  const companyId = resolveCompanyForActor(actor, requestedCompanyId);
  const supabase = await getUserScopedClientFromRequest(request);
  return { actor, companyId, supabase };
}

export async function GET(request: NextRequest) {
  try {
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const { actor, companyId, supabase } = await contextForRequest(request, requestedCompanyId);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...READ_ROLES],
    });

    let allowedWarehouseIds: string[] | null = null;
    if (actor.role === "warehouse" || actor.role === "warehouse_operator") {
      const { data: allowed, error: warehouseError } = await supabase
        .from("warehouses")
        .select("id")
        .eq("company_id", companyId)
        .in("warehouse_type", [...AGROCHEMICAL_WAREHOUSE_TYPES])
        .eq("archived", false)
        .eq("is_archived", false);
      if (warehouseError) throw new Error(warehouseError.message);
      allowedWarehouseIds = (allowed || []).map((row: any) => String(row.id));
      if (allowedWarehouseIds.length === 0) return NextResponse.json({ receipts: [] });
    }

    let ticketQuery = supabase
      .from("tickets")
      .select("id,ticket_no,status,warehouse_to_id,source_id,supplier_id,supplier_document_no,notes,created_at,finalized_at,created_by")
      .eq("company_id", companyId)
      .eq("op_type", "supplier_receipt")
      .eq("receipt_mode", "direct")
      .order("created_at", { ascending: false })
      .limit(100);
    if (allowedWarehouseIds) ticketQuery = ticketQuery.in("warehouse_to_id", allowedWarehouseIds);
    const { data: tickets, error: ticketError } = await ticketQuery;
    if (ticketError) throw new Error(ticketError.message);

    const ticketIds = (tickets || []).map((row: any) => String(row.id));
    const { data: lines, error: lineError } = ticketIds.length
      ? await supabase
          .from("ticket_lines")
          .select("id,ticket_id,product_id,product_name_snapshot,product_type,quantity,uom,lot_id,quality_json,products:product_id(name,trade_name,type,product_type)")
          .in("ticket_id", ticketIds)
          .order("created_at", { ascending: true })
      : { data: [] as any[], error: null };
    if (lineError) throw new Error(lineError.message);

    const supplierIds = Array.from(new Set((tickets || [])
      .map((row: any) => String(row.supplier_id || ""))
      .filter(Boolean)));
    const { data: supplierRows, error: supplierError } = supplierIds.length
      ? await supabase.from("counterparties").select(COUNTERPARTY_SELECT).in("id", supplierIds)
      : { data: [] as any[], error: null };
    if (supplierError) throw new Error(supplierError.message);
    const suppliers = new Map(
      (supplierRows || []).map((row: any) => {
        const normalized = normalizeCounterpartyRow(row);
        return [normalized.id, normalized];
      }),
    );

    const linesByTicket = new Map<string, any[]>();
    for (const line of lines || []) {
      const key = String((line as any).ticket_id);
      linesByTicket.set(key, [...(linesByTicket.get(key) || []), line]);
    }

    return NextResponse.json({
      receipts: (tickets || []).map((ticket: any) => ({
        ...ticket,
        supplier: suppliers.get(String(ticket.supplier_id || ""))?.legal_name || ticket.source_id || null,
        supplier_counterparty: suppliers.get(String(ticket.supplier_id || "")) || null,
        lines: linesByTicket.get(String(ticket.id)) || [],
      })),
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load receipts" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, any>;
    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const { actor, companyId, supabase } = await contextForRequest(request, requestedCompanyId);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WRITE_ROLES],
    });

    const idempotencyKey = String(
      request.headers.get("Idempotency-Key") || body.idempotency_key || ""
    ).trim();
    if (!UUID_RE.test(idempotencyKey)) {
      return NextResponse.json({ error: "Idempotency-Key must be a UUID" }, { status: 400 });
    }

    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) {
      return NextResponse.json({ error: "Добавьте хотя бы одну строку прихода" }, { status: 400 });
    }
    const productIds = Array.from(new Set(lines.map((line: any) => String(line.product_id || "")).filter(Boolean)));
    const warehouseId = String(body.warehouse_id || "").trim();
    const [{ data: warehouse }, { data: products, error: productError }] = await Promise.all([
      supabase
        .from("warehouses")
        .select("id,warehouse_type")
        .eq("id", warehouseId)
        .eq("company_id", companyId)
        .eq("archived", false)
        .eq("is_archived", false)
        .maybeSingle(),
      productIds.length
        ? supabase
            .from("products")
            .select("id,type,product_type,category,company_id")
            .in("id", productIds)
            .or(`company_id.eq.${companyId},company_id.is.null`)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if (productError) throw new Error(productError.message);
    if (!warehouse?.id || !isAgrochemicalWarehouseType(warehouse.warehouse_type)) {
      return NextResponse.json(
        { error: "Обычный складской приход разрешён только на агрохимический склад" },
        { status: 403 }
      );
    }
    if (
      (products || []).length !== productIds.length ||
      (products || []).some((product: any) => !isAgrochemicalProductType(product.product_type || product.type || product.category))
    ) {
      return NextResponse.json(
        { error: "Обычный складской приход принимает только пестициды, удобрения и добавки" },
        { status: 403 }
      );
    }
    const supplierCompanyId = String(body.supplier_company_counterparty_id || "").trim() || null;
    const supplierGlobalId = String(body.supplier_global_counterparty_id || "").trim() || null;
    if (!supplierCompanyId && !supplierGlobalId) {
      return NextResponse.json({ error: "Выберите поставщика из справочника" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("create_warehouse_receipt_atomic_v4", {
      p_company_id: companyId,
      p_warehouse_id: warehouseId,
      p_supplier_company_counterparty_id: supplierCompanyId,
      p_supplier_global_counterparty_id: supplierGlobalId,
      p_document_no: body.document_no == null ? null : String(body.document_no),
      p_notes: body.notes == null ? null : String(body.notes),
      p_lines: lines,
      p_idempotency_key: idempotencyKey,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ receipt: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create receipt" },
      { status: 500 }
    );
  }
}
