import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";
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
import { calculateStockMath } from "@/lib/warehouse/stock-math";
import {
  isHarvestLedgerRow,
  loadHarvestLedgerOriginRefs,
} from "@/lib/warehouse/harvest-ledger-origin";

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
  batch_class: string;
  unit: string;
  quantity: number;
  harvest_represented_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  last_updated: string;
  reservations: Array<{
    request_id: string;
    request_number: string;
    operation_id: string | null;
    operation: string | null;
    field: string | null;
    quantity: number;
    status: string;
  }>;
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
  const canonical = String(row.warehouse_request_status || "");
  if (canonical) return ["pending", "collecting", "ready_for_pickup"].includes(canonical);
  return ["new", "active", "preparing", "ready"].includes(String(row.status || ""));
}

const LEDGER_SELECT = `
  id,
  company_id,
  warehouse_id,
  product_id,
  direction,
  quantity,
  delta_qty_signed,
  uom,
  batch_class,
  inventory_batch_id,
  batch_id,
  batch_id_text,
  ticket_id,
  occurred_at,
  created_at,
  warehouses:warehouse_id (id,name,name_ru,name_kz,name_en,warehouse_type)
`;

const PRODUCT_SELECT = "id,master_product_id,name,trade_name,normalized_name,manufacturer,type,product_type,category,subcategory,pesticide_category,fertilizer_type,unit,stock_unit,base_uom,company_id,archived,is_active,created_at";

async function loadLedgerRows(
  supabase: Awaited<ReturnType<typeof getUserScopedClientFromRequest>>,
  companyId: string,
  warehouseId: string | null
) {
  const buildQuery = (select: string) => {
    let query = supabase
      .from("stock_ledger_entries")
      .select(select)
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: true });
    if (warehouseId) query = query.eq("warehouse_id", warehouseId);
    return query;
  };

  const withUnitContract = await buildQuery(`${LEDGER_SELECT},unit_contract_version`);

  if (!withUnitContract.error || !String(withUnitContract.error.message || "").includes("unit_contract_version")) {
    return withUnitContract;
  }

  return buildQuery(LEDGER_SELECT);
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const warehouseId = String(request.nextUrl.searchParams.get("warehouseId") || "").trim() || null;
    const language = parseLanguage(request.nextUrl.searchParams.get("language"));
    const supabase = await getUserScopedClientFromRequest(request);

    await assertActorAccess({
      // Resolve the trusted actor profile server-side; stock reads keep the caller JWT/RLS.
      supabase: actor.isImpersonating ? getServiceClient() : supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_READ_ROLES],
    });

    let requestQuery = supabase
      .from("warehouse_issue_requests")
      .select("id,request_number,status,warehouse_request_status,source_warehouse_id,operation_id,field_id,operations:operation_id(operation_type),fields:field_id(name),warehouse_issue_request_items(id,product_id,actual_product_id,prepared_quantity,issued_quantity,unit,prepared_unit,issued_unit)")
      .eq("company_id", companyId);
    if (warehouseId) requestQuery = requestQuery.eq("source_warehouse_id", warehouseId);

    const [ledgerResult, requestResult] = await Promise.all([
      loadLedgerRows(supabase, companyId, warehouseId),
      requestQuery,
    ]);

    if (ledgerResult.error || requestResult.error) {
      return NextResponse.json(
        { error: ledgerResult.error?.message || requestResult.error?.message },
        { status: 400 }
      );
    }

    const ledgerRows = ledgerResult.data || [];
    const requestRows = requestResult.data || [];
    const harvestOriginRefs = await loadHarvestLedgerOriginRefs(
      supabase,
      companyId,
      ledgerRows as any[]
    );
    const referencedProductIds = new Set<string>();
    for (const row of ledgerRows as any[]) {
      if (row.product_id) referencedProductIds.add(String(row.product_id));
    }
    for (const requestRow of requestRows as any[]) {
      for (const item of requestRow.warehouse_issue_request_items || []) {
        if (item.product_id) referencedProductIds.add(String(item.product_id));
        if (item.actual_product_id) referencedProductIds.add(String(item.actual_product_id));
      }
    }

    let catalogRows: any[] = [];
    if (!warehouseId || referencedProductIds.size > 0) {
      let catalogQuery = supabase
        .from("products")
        .select(PRODUCT_SELECT)
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .eq("archived", false);

      if (warehouseId) {
        const ids = Array.from(referencedProductIds).join(",");
        catalogQuery = catalogQuery.or(
          `company_id.eq.${companyId},id.in.(${ids}),master_product_id.in.(${ids})`
        );
      }

      const catalogResult = await catalogQuery;
      if (catalogResult.error) {
        return NextResponse.json({ error: catalogResult.error.message }, { status: 400 });
      }
      catalogRows = catalogResult.data || [];
    }

    const catalog = catalogRows.filter((row: any) => row.is_active !== false);
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

    const balances = new Map<string, BalanceAccumulator>();
    for (const raw of ledgerRows) {
      const row = raw as any;
      const warehouse = relationOne(row.warehouses);
      const product = preferredProduct(row.product_id);
      if (!product) continue;
      const uom = canonicalUom(row);
      const batchClass = String(row.batch_class || "commodity").trim().toLowerCase() || "commodity";
      const identityKey = buildCatalogIdentityKey(product as any);
      const key = `${row.warehouse_id}|${identityKey}|${uom}|${batchClass}`;
      const signedQuantity = Number.isFinite(Number(row.delta_qty_signed))
        ? Number(row.delta_qty_signed)
        : String(row.direction) === "in" ? Number(row.quantity || 0) : -Number(row.quantity || 0);
      const harvestQuantity = isHarvestLedgerRow(row, harvestOriginRefs) ? signedQuantity : 0;
      const occurredAt = String(row.occurred_at || row.created_at || "");
      const existing = balances.get(key);

      if (existing) {
        existing.quantity += signedQuantity;
        existing.harvest_represented_quantity += harvestQuantity;
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
        batch_class: batchClass,
        unit: uom || "legacy/unknown",
        quantity: signedQuantity,
        harvest_represented_quantity: harvestQuantity,
        reserved_quantity: 0,
        available_quantity: signedQuantity,
        last_updated: occurredAt,
        reservations: [],
      });
    }

    for (const requestRow of requestRows) {
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
        const baseKey = `${warehouseId}|${buildCatalogIdentityKey(product as any)}|${uom}`;
        const balance = balances.get(`${baseKey}|commodity`)
          || Array.from(balances.entries()).find(([key]) => key.startsWith(`${baseKey}|`))?.[1];
        if (!balance) continue;
        const prepared = Number(item.prepared_quantity || 0);
        const issued = Number(item.issued_quantity || 0);
        const reservation = Math.max(prepared - issued, 0);
        balance.reserved_quantity += reservation;
        if (reservation > 0.000001) {
          const operation = relationOne((requestRow as any).operations) as any;
          const field = relationOne((requestRow as any).fields) as any;
          balance.reservations.push({
            request_id: String((requestRow as any).id),
            request_number: String((requestRow as any).request_number || (requestRow as any).id),
            operation_id: (requestRow as any).operation_id
              ? String((requestRow as any).operation_id)
              : null,
            operation: operation?.operation_type || null,
            field: field?.name || null,
            quantity: Number(reservation.toFixed(3)),
            status: String(
              (requestRow as any).warehouse_request_status ||
                (requestRow as any).status ||
                "pending"
            ),
          });
        }
      }
    }

    const rows = Array.from(balances.values())
      .filter((row) => Math.abs(Number(row.quantity || 0)) > 0.000001)
      .map((row) => {
        const stock = calculateStockMath(row.quantity, row.reserved_quantity);
        return {
          ...row,
          quantity: Number(stock.onHand.toFixed(3)),
          harvest_represented_quantity: Number(row.harvest_represented_quantity.toFixed(3)),
          material_quantity: Number(
            (stock.onHand - row.harvest_represented_quantity).toFixed(3)
          ),
          reserved_quantity: Number(stock.reserved.toFixed(3)),
          available_quantity: Number(stock.available.toFixed(3)),
          deficit_quantity: Number(stock.deficit.toFixed(3)),
          stock_status: stock.deficit > 0.000001 ? "deficit" : "available",
          product_ids: Array.from(row.product_ids),
        };
      })
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
