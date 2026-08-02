import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import {
  buildMaterialSelectItems,
  type MaterialCatalogProduct,
  type MaterialCompanyLink,
  type MaterialProductGroup,
  type MaterialStockRow,
} from "@/lib/catalog/material-select";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "warehouse",
  "warehouse_operator",
  "specialist",
  "director",
] as const;

const GROUPS = new Set<MaterialProductGroup>(["pesticides", "additives", "fertilizers"]);
const TYPES_BY_GROUP: Record<MaterialProductGroup, string[]> = {
  pesticides: ["pesticide", "growth_regulator"],
  additives: ["additive", "adjuvant"],
  fertilizers: ["fertilizer"],
};

function parseGroup(value: unknown): MaterialProductGroup {
  const group = String(value || "").trim() as MaterialProductGroup;
  if (!GROUPS.has(group)) throw new SessionAuthError("Invalid material product group", 400);
  return group;
}

function parseLimit(value: unknown): number {
  const limit = Number(value || 20);
  return Number.isFinite(limit) ? Math.min(60, Math.max(1, Math.trunc(limit))) : 20;
}

function parseCursor(value: unknown): number {
  const cursor = Number(value || 0);
  return Number.isFinite(cursor) ? Math.max(0, Math.trunc(cursor)) : 0;
}

function escapedLike(value: string): string {
  return value.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, null);
    const group = parseGroup(request.nextUrl.searchParams.get("product_group"));
    const query = String(request.nextUrl.searchParams.get("q") || "").trim().slice(0, 120);
    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
    const cursor = parseCursor(request.nextUrl.searchParams.get("cursor"));
    const supabase = await getUserScopedClientFromRequest(request);

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...READ_ROLES],
    });

    const types = TYPES_BY_GROUP[group];
    let productQuery = supabase
      .from("products")
      .select("id,master_product_id,company_id,name,trade_name,normalized_name,name_ru,name_en,manufacturer,active_ingredient,type,product_type,category,subcategory,pesticide_category,fertilizer_type,unit,stock_unit,base_uom,default_unit,application_unit,default_rate_type,default_rate_unit,notes,archived,is_active")
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .eq("archived", false)
      .eq("is_active", true)
      .or(`product_type.in.(${types.join(",")}),type.in.(${types.join(",")}),category.in.(${types.join(",")})`);

    const normalizedQuery = escapedLike(query);
    if (normalizedQuery) {
      const pattern = `*${normalizedQuery}*`;
      productQuery = productQuery.or(
        [
          `name.ilike.${pattern}`,
          `trade_name.ilike.${pattern}`,
          `normalized_name.ilike.${pattern}`,
          `name_ru.ilike.${pattern}`,
          `name_en.ilike.${pattern}`,
          `manufacturer.ilike.${pattern}`,
          `active_ingredient.ilike.${pattern}`,
        ].join(",")
      );
    }

    const aliasQuery = normalizedQuery
      ? supabase
          .from("global_product_aliases")
          .select("product_id,alias")
          .ilike("alias", `%${normalizedQuery}%`)
          .limit(250)
      : Promise.resolve({ data: [], error: null } as any);

    const [productsResult, aliasesResult, linksResult, stockResult] = await Promise.all([
      productQuery.range(0, 1999),
      aliasQuery,
      supabase
        .from("company_product_links")
        .select("global_product_id,source,sources,first_used_at,last_used_at")
        .eq("company_id", companyId),
      supabase
        .from("v_stock_balance_canonical")
        .select("product_id,warehouse_id,quantity,uom")
        .eq("company_id", companyId)
        .gt("quantity", 0),
    ]);

    const baseError = productsResult.error || aliasesResult.error || linksResult.error || stockResult.error;
    if (baseError) throw new Error(baseError.message);

    const aliasRows = aliasesResult.data || [];
    const aliasProductIds = Array.from(new Set(aliasRows.map((row: any) => String(row.product_id || "")).filter(Boolean)));
    const aliasProductsResult = aliasProductIds.length
      ? await supabase
          .from("products")
          .select("id,master_product_id,company_id,name,trade_name,normalized_name,name_ru,name_en,manufacturer,active_ingredient,type,product_type,category,subcategory,pesticide_category,fertilizer_type,unit,stock_unit,base_uom,default_unit,application_unit,default_rate_type,default_rate_unit,notes,archived,is_active")
          .or(`company_id.is.null,company_id.eq.${companyId}`)
          .or(`id.in.(${aliasProductIds.join(",")}),master_product_id.in.(${aliasProductIds.join(",")})`)
          .eq("archived", false)
          .eq("is_active", true)
      : { data: [], error: null };
    if (aliasProductsResult.error) throw new Error(aliasProductsResult.error.message);

    const aliasesByProduct = new Map<string, string[]>();
    for (const row of aliasRows as any[]) {
      const productId = String(row.product_id || "");
      aliasesByProduct.set(productId, [...(aliasesByProduct.get(productId) || []), String(row.alias || "")]);
    }

    const productsById = new Map<string, MaterialCatalogProduct>();
    for (const row of [...(productsResult.data || []), ...(aliasProductsResult.data || [])] as any[]) {
      const product = {
        ...row,
        aliases: aliasesByProduct.get(String(row.id)) || [],
      } as MaterialCatalogProduct;
      productsById.set(String(product.id), product);
    }

    const result = buildMaterialSelectItems({
      products: Array.from(productsById.values()),
      stocks: (stockResult.data || []) as MaterialStockRow[],
      links: (linksResult.data || []) as MaterialCompanyLink[],
      group,
      query,
      globalOffset: cursor,
      globalLimit: limit,
    });

    return NextResponse.json({
      company_id: companyId,
      product_group: group,
      items: result.items,
      next_cursor: result.nextCursor,
      total_matches: result.totalMatches,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить каталог материалов" },
      { status: 500 }
    );
  }
}
