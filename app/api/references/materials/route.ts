import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_ROLES = ["global_admin", "company_admin", "agronomist", "warehouse", "warehouse_operator", "specialist", "director"] as const;

function canonicalProductId(row: any): string {
  return String(row.company_id && row.master_product_id ? row.master_product_id : row.id);
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, null);
    const supabase = await getUserScopedClientFromRequest(request);
    await assertActorAccess({ supabase, actorUserId: actor.id, companyId, allowedRoles: [...READ_ROLES] });

    const [companyProductsResult, linksResult, stockResult] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .eq("archived", false)
        .eq("is_active", true),
      supabase
        .from("company_product_links")
        .select("global_product_id,source,sources,first_used_at,last_used_at")
        .eq("company_id", companyId),
      supabase
        .from("v_stock_balance_canonical")
        .select("product_id,quantity,uom")
        .eq("company_id", companyId)
        .gt("quantity", 0),
    ]);
    const baseError = companyProductsResult.error || linksResult.error || stockResult.error;
    if (baseError) throw new Error(baseError.message);

    const companyProducts = companyProductsResult.data || [];
    const links = linksResult.data || [];
    const linkedGlobalIds = Array.from(new Set(links.map((row: any) => String(row.global_product_id || "")).filter(Boolean)));
    const globalProductsResult = linkedGlobalIds.length
      ? await supabase
          .from("products")
          .select("*")
          .in("id", linkedGlobalIds)
          .is("company_id", null)
          .eq("archived", false)
          .eq("is_active", true)
      : { data: [], error: null };
    if (globalProductsResult.error) throw new Error(globalProductsResult.error.message);

    const linkByGlobalId = new Map(links.map((link: any) => [String(link.global_product_id), link]));
    const companyByCanonicalId = new Map(companyProducts.map((product: any) => [canonicalProductId(product), product]));
    const stockByCanonicalUnit = new Map<string, number>();
    for (const stock of stockResult.data || []) {
      const productId = String((stock as any).product_id || "");
      const companyProduct = companyProducts.find((product: any) => String(product.id) === productId);
      const canonicalId = companyProduct ? canonicalProductId(companyProduct) : productId;
      const unit = String((stock as any).uom || "");
      const key = `${canonicalId}|${unit}`;
      stockByCanonicalUnit.set(key, (stockByCanonicalUnit.get(key) || 0) + Number((stock as any).quantity || 0));
    }

    const rowsByCanonicalId = new Map<string, any>();
    for (const globalProduct of globalProductsResult.data || []) {
      const canonicalId = String((globalProduct as any).id);
      rowsByCanonicalId.set(canonicalId, companyByCanonicalId.get(canonicalId) || globalProduct);
    }
    for (const companyProduct of companyProducts) {
      rowsByCanonicalId.set(canonicalProductId(companyProduct), companyProduct);
    }

    const rows = Array.from(rowsByCanonicalId.entries()).map(([canonicalId, product]) => {
      const link: any = linkByGlobalId.get(canonicalId);
      const sources = new Set<string>([...(link?.sources || []), link?.source].filter(Boolean));
      const stock = Array.from(stockByCanonicalUnit.entries())
        .filter(([key]) => key.startsWith(`${canonicalId}|`))
        .map(([key, quantity]) => ({ unit: key.slice(canonicalId.length + 1), quantity }));
      const statuses: string[] = [];
      if (stock.some((item) => item.quantity > 0)) statuses.push("На складе");
      if (sources.has("operation")) statuses.push("Использовался");
      if (sources.has("manual_catalog_add")) statuses.push("Добавлен из ГЛБД");
      return {
        ...product,
        canonical_product_id: canonicalId,
        source_scope: product.company_id ? (product.master_product_id ? "company_override" : "company") : "linked_global",
        reference_statuses: statuses,
        available_quantities: stock,
      };
    });

    rows.sort((left, right) => String(left.trade_name || left.name || "").localeCompare(String(right.trade_name || right.name || ""), "ru"));
    return NextResponse.json({ company_id: companyId, rows });
  } catch (error) {
    if (error instanceof SessionAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить материалы компании" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, null);
    const supabase = await getUserScopedClientFromRequest(request);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: ["global_admin", "company_admin"],
    });
    const body = await request.json().catch(() => ({}));
    const globalProductId = String(body?.global_product_id || "").trim();
    if (!globalProductId) throw new SessionAuthError("global_product_id is required", 400);
    const { data, error } = await supabase.rpc("link_company_global_product_v1", {
      p_company_id: companyId,
      p_global_product_id: globalProductId,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ link_id: data });
  } catch (error) {
    if (error instanceof SessionAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось добавить продукт из ГЛБД" },
      { status: 500 }
    );
  }
}
