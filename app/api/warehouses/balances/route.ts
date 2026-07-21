import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { WAREHOUSE_READ_ROLES } from "@/app/api/warehouses/_helpers";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import { normalizeStockUom } from "@/lib/warehouse/stock-unit-contract";
import { isAgrochemicalProductType, isAgrochemicalWarehouseType } from "@/lib/warehouse/warehouse-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Language = "ru" | "kz" | "en";

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

function batchClassLabel(value: unknown): string | null {
  const batchClass = String(value || "commodity");
  if (batchClass === "seed") return "Семенной фонд";
  if (batchClass === "material") return "Материал";
  if (batchClass === "feed") return "Кормовой";
  if (batchClass === "waste") return "Отход";
  if (batchClass === "processing") return "Переработка";
  if (batchClass === "rejected") return "Брак";
  return null;
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

    const { data, error } = await supabase
      .from("stock_ledger_entries")
      .select(`
        id,
        company_id,
        warehouse_id,
        product_id,
        variety_id,
        reproduction_id,
        batch_id,
        batch_id_text,
        batch_class,
        direction,
        quantity,
        uom,
        unit_contract_version,
        occurred_at,
        created_at,
        warehouses:warehouse_id (id,name,name_ru,name_kz,name_en,warehouse_type),
        products:product_id (id,name,trade_name,normalized_name,type,product_type,unit,base_uom)
      `)
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const ledgerRows = (data || []).filter((row: any) => {
      if (actor.role !== "warehouse" && actor.role !== "warehouse_operator") return true;
      const warehouse = relationOne(row.warehouses) as any;
      const product = relationOne(row.products) as any;
      return isAgrochemicalWarehouseType(warehouse?.warehouse_type) &&
        isAgrochemicalProductType(product?.product_type || product?.type);
    });
    const varietyIds = Array.from(
      new Set(ledgerRows.map((row: any) => String(row.variety_id || "").trim()).filter(Boolean))
    );
    const reproductionIds = Array.from(
      new Set(ledgerRows.map((row: any) => String(row.reproduction_id || "").trim()).filter(Boolean))
    );
    const [varietyResult, reproductionResult] = await Promise.all([
      varietyIds.length
        ? supabase.from("varieties").select("id,name,name_ru,name_kz,name_en").in("id", varietyIds)
        : Promise.resolve({ data: [], error: null }),
      reproductionIds.length
        ? supabase
            .from("seed_reproductions")
            .select("id,name,name_ru,name_kz,name_en,code")
            .in("id", reproductionIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (varietyResult.error || reproductionResult.error) {
      return NextResponse.json(
        {
          error:
            varietyResult.error?.message ||
            reproductionResult.error?.message ||
            "Failed to load warehouse stock identity",
        },
        { status: 400 }
      );
    }

    const varietyById = new Map(
      (varietyResult.data || []).map((row: any) => [String(row.id), row] as const)
    );
    const reproductionById = new Map(
      (reproductionResult.data || []).map((row: any) => [String(row.id), row] as const)
    );

    const balances = new Map<string, Record<string, any>>();
    for (const raw of ledgerRows) {
      const row = raw as any;
      const warehouse = relationOne(row.warehouses);
      const product = relationOne(row.products);
      const variety = varietyById.get(String(row.variety_id || "")) || null;
      const reproduction = reproductionById.get(String(row.reproduction_id || "")) || null;
      const batchId = String(row.batch_id_text || row.batch_id || "").trim() || null;
      const batchClass = String(row.batch_class || "legacy/unknown");
      const uom = Number(row.unit_contract_version) === 2 ? String(row.uom || "") : legacyUom(row.uom);
      const key = [
        row.warehouse_id,
        row.product_id,
        row.variety_id || "",
        row.reproduction_id || "",
        batchId || "",
        batchClass,
        uom,
      ].join("|");
      const productName = brandName(product) || "N/A";
      const varietyName = row.variety_id ? brandName(variety) || "-" : "-";
      const reproductionName = row.reproduction_id
        ? localizedName(reproduction, language, ["name", "code"]) || "-"
        : "-";
      const classLabel = batchClassLabel(batchClass);
      const identityCore = `${productName} / ${varietyName} / ${reproductionName}`;
      const signedQuantity = String(row.direction) === "in" ? Number(row.quantity || 0) : -Number(row.quantity || 0);
      const occurredAt = String(row.occurred_at || row.created_at || "");
      const existing = balances.get(key);

      if (existing) {
        existing.quantity += signedQuantity;
        if (occurredAt > existing.last_updated) existing.last_updated = occurredAt;
        continue;
      }

      balances.set(key, {
        warehouse_id: String(row.warehouse_id || ""),
        warehouse_name: localizedName(warehouse, language) || "N/A",
        product_id: String(row.product_id || ""),
        product_name: productName,
        variety_id: row.variety_id ? String(row.variety_id) : null,
        variety_name: varietyName,
        reproduction_id: row.reproduction_id ? String(row.reproduction_id) : null,
        reproduction_name: reproductionName,
        batch_id: batchId,
        batch_class: batchClass,
        identity_name: classLabel ? `${identityCore} / ${classLabel}` : identityCore,
        product_type: (product as any)?.product_type || (product as any)?.type || "N/A",
        unit: uom || "legacy/unknown",
        quantity: signedQuantity,
        last_updated: occurredAt,
      });
    }

    const rows = Array.from(balances.values())
      .filter((row) => Math.abs(Number(row.quantity || 0)) > 0.000001)
      .filter(
        (row) =>
          !hasQaDataMarker(
            `${row.warehouse_name} ${row.product_name} ${row.variety_name} ${row.reproduction_name} ${row.identity_name} ${row.product_type}`
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
