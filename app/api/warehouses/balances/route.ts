import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { WAREHOUSE_READ_ROLES } from "@/app/api/warehouses/_helpers";
import { localizedName } from "@/lib/i18n/helpers";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import { buildCatalogIdentityKey, buildProductDisplayLabel } from "@/lib/catalog/catalog-identity";
import { normalizeStockUom } from "@/lib/warehouse/stock-unit-contract";
import { isAgrochemicalProductType, isAgrochemicalWarehouseType } from "@/lib/warehouse/warehouse-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Language = "ru" | "kz" | "en";

type BalanceAccumulator = {
  warehouse_id: string;
  warehouse_name: string;
  product_id: string;
  product_ids: Set<string>;
  product_name: string;
  identity_name: string;
  product_type: string;
  unit: string;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  last_updated: string;
};

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function parseLanguage(value: unknown): Language {
  return value === "kz" || value === "en" ? value : "ru";
}

function legacyUom(value: unknown): string {
  try {
    return `legacy/${normalizeStockUom(value).baseUom}`;
  } catch {
    return "legacy/unknown";
  }
}

function canonicalUom(row: any): string {
  return Number(row.unit_contract_version) === 2 ? String(row.uom || "") : legacyUom(row.uom);
}

function isOpenRequest(row: any): boolean {
  return ["new", "active", "preparing", "ready", "received_confirmed"].includes(String(row.status || "")) &&
    !["issued", "closed", "return_received", "cancelled"].includes(String(row.warehouse_request_status || ""));
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const language = parseLanguage(request.nextUrl.searchParams.get("language"));
    const supabase = await getUserScopedClientFromRequest(request);

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_READ_ROLES],
    });

    const [ledgerResult, catalogResult, requestResult] = await Promise.all([
      supabase.from("stock_ledger_entries").select(`
        id,
        company_id,
        warehouse_id,
        product_id,
        direction,
        quantity,
        delta_qty_signed,
        uom,
        unit_contract_version,
        occurred_at,
        created_at,
        warehouses:warehouse_id (id,name,name_ru,name_kz,name_en,warehouse_type)
      `)
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: true }),
      supabase
        .from("products")
        .select("id,master_product_id,name,trade_name,normalized_name,manufacturer,type,product_type,category,subcategory,pesticide_category,fertilizer_type,unit,stock_unit,base_uom,company_id,archived,is_active,created_at")
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .eq("archived", false),
      supabase
        .from("warehouse_issue_requests")
        .select("id,status,warehouse_request_status,source_warehouse_id,warehouse_issue_request_items(id,product_id,actual_product_id,prepared_quantity,issued_quantity,unit,prepared_unit,issued_unit)")
        .eq("company_id", companyId),
    ]);

    if (ledgerResult.error || catalogResult.error || requestResult.error) {
      return NextResponse.json(
        { error: ledgerResult.error?.message || catalogResult.error?.message || requestResult.error?.message },
        { status: 400 }
      );
    }

    const catalog = (catalogResult.data || []).filter((row: any) => row.is_active !== false);
    const productById = new Map(catalog.map((row: any) => [String(row.id), row] as const));
    const companyOverrideByMaster = new Map(
      catalog
        .filter((row: any) => String(row.company_id || "") === companyId && row.master_product_id)
        .map((row: any) => [String(row.master_product_id), row] as const)
    );
    const preferredByIdentity = new Map<string, any>();
    for (const product of catalog) {
      const key = buildCatalogIdentityKey(product as any);
      const current = preferredByIdentity.get(key);
      if (!current || (!current.company_id && product.company_id)) preferredByIdentity.set(key, product);
    }
    const preferredProduct = (productId: unknown) => {
      const raw = productById.get(String(productId || ""));
      if (!raw) return null;
      if (raw.company_id) return raw;
      const override = companyOverrideByMaster.get(String(raw.id));
      if (override) return override;
      return preferredByIdentity.get(buildCatalogIdentityKey(raw as any)) || raw;
    };

    const ledgerRows = (ledgerResult.data || []).filter((row: any) => {
      const product = preferredProduct(row.product_id);
      if (actor.role !== "warehouse" && actor.role !== "warehouse_operator") return true;
      const warehouse = relationOne(row.warehouses) as any;
      return isAgrochemicalWarehouseType(warehouse?.warehouse_type) &&
        isAgrochemicalProductType(product?.product_type || product?.type);
    });

    const balances = new Map<string, BalanceAccumulator>();
    for (const raw of ledgerRows) {
      const row = raw as any;
      const warehouse = relationOne(row.warehouses);
      const product = preferredProduct(row.product_id);
      if (!product || !isAgrochemicalProductType(product.product_type || product.type || product.category)) continue;
      const uom = canonicalUom(row);
      const identityKey = buildCatalogIdentityKey(product as any);
      const key = `${row.warehouse_id}|${identityKey}|${uom}`;
      const signedQuantity = Number.isFinite(Number(row.delta_qty_signed))
        ? Number(row.delta_qty_signed)
        : String(row.direction) === "in" ? Number(row.quantity || 0) : -Number(row.quantity || 0);
      const occurredAt = String(row.occurred_at || row.created_at || "");
      const existing = balances.get(key);

      if (existing) {
        existing.quantity += signedQuantity;
        existing.product_ids.add(String(row.product_id));
        if (occurredAt > existing.last_updated) existing.last_updated = occurredAt;
        continue;
      }

      balances.set(key, {
        warehouse_id: String(row.warehouse_id || ""),
        warehouse_name: localizedName(warehouse, language) || "N/A",
        product_id: String(product.id || row.product_id || ""),
        product_ids: new Set([String(row.product_id)]),
        product_name: buildProductDisplayLabel(product as any) || "N/A",
        identity_name: buildProductDisplayLabel(product as any) || "N/A",
        product_type: (product as any)?.product_type || (product as any)?.type || "N/A",
        unit: uom || "legacy/unknown",
        quantity: signedQuantity,
        reserved_quantity: 0,
        available_quantity: signedQuantity,
        last_updated: occurredAt,
      });
    }

    for (const requestRow of requestResult.data || []) {
      if (!isOpenRequest(requestRow)) continue;
      const warehouseId = String((requestRow as any).source_warehouse_id || "");
      if (!warehouseId) continue;
      for (const item of (requestRow as any).warehouse_issue_request_items || []) {
        const product = preferredProduct(item.actual_product_id || item.product_id);
        if (!product) continue;
        let uom = "";
        try {
          uom = normalizeStockUom(item.prepared_unit || item.issued_unit || item.unit).baseUom;
        } catch {
          continue;
        }
        const key = `${warehouseId}|${buildCatalogIdentityKey(product as any)}|${uom}`;
        const balance = balances.get(key);
        if (!balance) continue;
        const prepared = Number(item.prepared_quantity || 0);
        const issued = Number(item.issued_quantity || 0);
        balance.reserved_quantity += Math.max(prepared - issued, 0);
      }
    }

    const rows = Array.from(balances.values())
      .filter((row) => Math.abs(Number(row.quantity || 0)) > 0.000001)
      .map((row) => ({
        ...row,
        quantity: Number(Number(row.quantity || 0).toFixed(3)),
        reserved_quantity: Number(Number(row.reserved_quantity || 0).toFixed(3)),
        available_quantity: Number(Math.max(Number(row.quantity || 0) - Number(row.reserved_quantity || 0), 0).toFixed(3)),
        product_ids: Array.from(row.product_ids),
      }))
      .filter(
        (row) =>
          !hasQaDataMarker(
            `${row.warehouse_name} ${row.product_name} ${row.identity_name} ${row.product_type}`
          )
      )
      .sort(
        (a, b) =>
          String(a.warehouse_name).localeCompare(String(b.warehouse_name)) ||
          String(a.identity_name || a.product_name).localeCompare(String(b.identity_name || b.product_name))
      );

    return NextResponse.json({ companyId, balances: rows });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load warehouse balances" },
      { status: 500 }
    );
  }
}
