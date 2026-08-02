import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getServerActorFromSession, SessionAuthError } from "@/lib/auth/server-session";
import {
  dedupeCanonicalPesticides,
  normalizePesticideSearchText,
  pesticideCategoryKey,
  pesticideCategoryLabel,
  searchAndRankPesticides,
  stablePesticideSort,
  type PesticideCatalogProduct,
  type PesticideSearchRelations,
} from "@/lib/platform/pesticide-catalog-search";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const PRODUCT_TYPES = ["pesticide", "additive", "adjuvant", "growth_regulator"];

const PRODUCT_SELECT = [
  "id",
  "master_product_id",
  "name",
  "name_ru",
  "name_en",
  "trade_name",
  "normalized_name",
  "manufacturer",
  "manufacturer_id",
  "formulation",
  "formulation_id",
  "active_ingredient",
  "pesticide_category",
  "category",
  "subcategory",
  "category_id",
  "mode_of_action_type",
  "mode_of_action_type_id",
  "registration_status_kz",
  "stock_unit",
  "default_rate_type",
  "default_rate_unit",
  "product_type",
  "type",
  "is_active",
  "archived",
].join(",");

type ProductRow = PesticideCatalogProduct & Record<string, any>;
type ReferenceRow = Record<string, any>;
type ComponentLink = {
  product_id: string;
  component_id: string;
  role_in_product?: string | null;
  sort_order?: number | null;
};

type SupabasePage<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

async function fetchAllRows<T>(
  pageFactory: (from: number, to: number) => PromiseLike<SupabasePage<T>>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await pageFactory(from, from + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function decodeCursor(value: string | null): number {
  if (!value) return 0;
  try {
    const parsed = Number.parseInt(Buffer.from(value, "base64url").toString("utf8"), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function byId(rows: ReferenceRow[]): Map<string, ReferenceRow> {
  return new Map(rows.map((row) => [String(row.id), row]));
}

function parseCsv(value: string | null): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function addRelation(
  target: Map<string, PesticideSearchRelations>,
  productId: string,
  key: keyof PesticideSearchRelations,
  value: string | null | undefined,
) {
  const prepared = String(value || "").trim();
  if (!prepared) return;
  const current = target.get(productId) || {};
  const values = new Set([...(current[key] || []), prepared]);
  target.set(productId, { ...current, [key]: Array.from(values) });
}

function apiError(error: unknown) {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Не удалось загрузить каталог" },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    if (actor.role !== "global_admin") {
      throw new SessionAuthError("Доступ только для глобального администратора", 403);
    }

    const supabase = getServiceClient();
    const params = request.nextUrl.searchParams;
    const query = normalizePesticideSearchText(params.get("q"));
    const category = pesticideCategoryKey(params.get("category"));
    const hasCategoryFilter = Boolean(params.get("category") && params.get("category") !== "all");
    const productType = String(params.get("product_type") || "all").trim();
    const status = String(params.get("status") || "active").trim();
    const manufacturerId = String(params.get("manufacturer_id") || "").trim();
    const formulationId = String(params.get("formulation_id") || "").trim();
    const modeOfActionId = String(params.get("mode_of_action_type_id") || "").trim();
    const activeIngredientIds = parseCsv(params.get("active_ingredient_ids"));
    const sort = String(params.get("sort") || "name_asc").trim();
    const limit = parseLimit(params.get("limit"));
    const offset = decodeCursor(params.get("cursor"));

    const [productRows, categoriesResult, manufacturersResult, formulationsResult, modesResult] = await Promise.all([
      fetchAllRows<ProductRow>((from, to) => supabase
        .from("products")
        .select(PRODUCT_SELECT)
        .is("company_id", null)
        .eq("archived", false)
        .in("product_type", PRODUCT_TYPES)
        .range(from, to) as unknown as PromiseLike<SupabasePage<ProductRow>>),
      supabase
        .from("pesticide_categories")
        .select("id,slug,name_ru,is_active,archived")
        .eq("archived", false),
      supabase
        .from("agrochem_manufacturers")
        .select("id,name")
        .eq("archived", false),
      supabase
        .from("agrochem_formulations")
        .select("id,code,name_ru")
        .eq("archived", false),
      supabase
        .from("agrochem_mode_of_actions")
        .select("id,slug,name_ru")
        .eq("archived", false),
    ]);

    const firstError = [categoriesResult, manufacturersResult, formulationsResult, modesResult]
      .map((result) => result.error)
      .find(Boolean);
    if (firstError) throw new Error(firstError.message);

    const categoryById = byId(categoriesResult.data || []);
    const manufacturerById = byId(manufacturersResult.data || []);
    const formulationById = byId(formulationsResult.data || []);
    const modeById = byId(modesResult.data || []);

    const canonicalRows = dedupeCanonicalPesticides(productRows).map((product) => {
      const categoryReference = product.category_id ? categoryById.get(String(product.category_id)) : null;
      const rawCategory = categoryReference?.slug || product.pesticide_category || product.category || product.subcategory;
      const categoryKey = pesticideCategoryKey(rawCategory);
      return {
        ...product,
        manufacturer: product.manufacturer || manufacturerById.get(String(product.manufacturer_id || ""))?.name || null,
        formulation:
          product.formulation
          || formulationById.get(String(product.formulation_id || ""))?.name_ru
          || formulationById.get(String(product.formulation_id || ""))?.code
          || null,
        mode_of_action_type:
          product.mode_of_action_type
          || modeById.get(String(product.mode_of_action_type_id || ""))?.name_ru
          || null,
        _category_key: categoryKey,
        _category_label: pesticideCategoryLabel(categoryKey, categoryReference?.name_ru || rawCategory),
      };
    });

    const activeRows = canonicalRows.filter((product) => product.is_active !== false);
    const categoryCountMap = new Map<string, { key: string; label: string; count: number }>();
    for (const product of activeRows) {
      const key = String(product._category_key);
      const current = categoryCountMap.get(key) || {
        key,
        label: String(product._category_label),
        count: 0,
      };
      current.count += 1;
      categoryCountMap.set(key, current);
    }
    const categoryCounts = Array.from(categoryCountMap.values()).sort(
      (left, right) => right.count - left.count || left.label.localeCompare(right.label, "ru"),
    );

    let filtered = canonicalRows.filter((product) => {
      if (status === "active" && product.is_active === false) return false;
      if (status === "inactive" && product.is_active !== false) return false;
      if (productType !== "all" && String(product.product_type || product.type) !== productType) return false;
      if (hasCategoryFilter && product._category_key !== category) return false;
      if (manufacturerId && manufacturerId !== "all" && product.manufacturer_id !== manufacturerId) return false;
      if (formulationId && formulationId !== "all" && product.formulation_id !== formulationId) return false;
      if (modeOfActionId && modeOfActionId !== "all" && product.mode_of_action_type_id !== modeOfActionId) return false;
      return true;
    });

    const relationsByProductId = new Map<string, PesticideSearchRelations>();
    let componentLinks: ComponentLink[] = [];
    let componentsById = new Map<string, ReferenceRow>();
    const needsSearchRelations = Boolean(query || activeIngredientIds.length);

    if (needsSearchRelations) {
      const [aliases, links, components, registrations] = await Promise.all([
        fetchAllRows<ReferenceRow>((from, to) => supabase
          .from("global_product_aliases")
          .select("product_id,alias")
          .range(from, to) as unknown as PromiseLike<SupabasePage<ReferenceRow>>),
        fetchAllRows<ComponentLink>((from, to) => supabase
          .from("glbd_product_components")
          .select("product_id,component_id,role_in_product,sort_order")
          .in("review_status", ["approved", "needs_owner_review"])
          .range(from, to) as unknown as PromiseLike<SupabasePage<ComponentLink>>),
        fetchAllRows<ReferenceRow>((from, to) => supabase
          .from("glbd_components")
          .select("id,legacy_active_ingredient_id,name_ru,name_en,canonical_name,is_active,archived_at")
          .eq("is_active", true)
          .is("archived_at", null)
          .range(from, to) as unknown as PromiseLike<SupabasePage<ReferenceRow>>),
        fetchAllRows<ReferenceRow>((from, to) => supabase
          .from("glbd_product_registrations")
          .select("product_id,registration_number")
          .range(from, to) as unknown as PromiseLike<SupabasePage<ReferenceRow>>),
      ]);

      componentLinks = links;
      componentsById = byId(components);
      for (const alias of aliases) {
        addRelation(relationsByProductId, String(alias.product_id), "aliases", alias.alias);
      }
      for (const link of componentLinks) {
        const component = componentsById.get(String(link.component_id));
        if (!component) continue;
        addRelation(
          relationsByProductId,
          String(link.product_id),
          "activeIngredients",
          component.name_ru || component.name_en || component.canonical_name,
        );
      }
      for (const registration of registrations) {
        addRelation(
          relationsByProductId,
          String(registration.product_id),
          "registrationNumbers",
          registration.registration_number,
        );
      }
    }

    if (activeIngredientIds.length) {
      const requested = new Set(activeIngredientIds);
      const productIds = new Set(
        componentLinks
          .filter((link) => {
            const component = componentsById.get(String(link.component_id));
            return requested.has(String(link.component_id))
              || requested.has(String(component?.legacy_active_ingredient_id || ""));
          })
          .map((link) => String(link.product_id)),
      );
      filtered = filtered.filter((product) => productIds.has(product.id));
    }

    let ranked = query
      ? searchAndRankPesticides(filtered, query, relationsByProductId)
      : stablePesticideSort(filtered).map((product) => ({ product, score: 0 }));
    if (!query && sort === "name_desc") ranked = [...ranked].reverse();
    if (!query && sort === "manufacturer_asc") {
      ranked = [...ranked].sort((left, right) => {
        const manufacturerOrder = normalizePesticideSearchText(left.product.manufacturer)
          .localeCompare(normalizePesticideSearchText(right.product.manufacturer), "ru");
        if (manufacturerOrder) return manufacturerOrder;
        return normalizePesticideSearchText(left.product.trade_name || left.product.name)
          .localeCompare(normalizePesticideSearchText(right.product.trade_name || right.product.name), "ru")
          || left.product.id.localeCompare(right.product.id);
      });
    }
    const total = ranked.length;
    const page = ranked.slice(offset, offset + limit).map((entry) => entry.product);

    if (!needsSearchRelations && page.length) {
      const productIds = page.map((product) => product.id);
      const linksResult = await supabase
        .from("glbd_product_components")
        .select("product_id,component_id,role_in_product,sort_order")
        .in("product_id", productIds)
        .in("review_status", ["approved", "needs_owner_review"]);
      if (linksResult.error) throw new Error(linksResult.error.message);
      componentLinks = (linksResult.data || []) as ComponentLink[];
      const componentIds = Array.from(new Set(componentLinks.map((link) => link.component_id)));
      if (componentIds.length) {
        const componentsResult = await supabase
          .from("glbd_components")
          .select("id,legacy_active_ingredient_id,name_ru,name_en,canonical_name,is_active,archived_at")
          .in("id", componentIds)
          .eq("is_active", true)
          .is("archived_at", null);
        if (componentsResult.error) throw new Error(componentsResult.error.message);
        componentsById = byId(componentsResult.data || []);
      }
    }

    const linksByProductId = new Map<string, ComponentLink[]>();
    for (const link of componentLinks) {
      const links = linksByProductId.get(link.product_id) || [];
      links.push(link);
      linksByProductId.set(link.product_id, links);
    }

    const items = page.map((product) => {
      const activeIngredientComponents = (linksByProductId.get(product.id) || [])
        .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
        .map((link) => {
          const component = componentsById.get(String(link.component_id));
          if (!component) return null;
          return {
            id: component.id,
            displayName: component.name_ru || component.name_en || component.canonical_name || "Компонент",
            role: link.role_in_product || null,
          };
        })
        .filter(Boolean);

      const activeIngredientsSummary = activeIngredientComponents
        .map((component: any) => component.displayName)
        .join(", ") || product.active_ingredient || null;

      return {
        id: product.id,
        canonical_id: product.master_product_id || product.id,
        trade_name: product.trade_name || product.name,
        manufacturer: product.manufacturer,
        pesticide_category: product._category_label,
        category_id: product.category_id,
        active_ingredients: activeIngredientsSummary,
        active_ingredient_components: activeIngredientComponents,
        formulation: product.formulation,
        registration_status: product.registration_status_kz,
        mode_of_action_type: product.mode_of_action_type,
        stock_unit: product.stock_unit,
        default_rate_type: product.default_rate_type,
        default_rate_unit: product.default_rate_unit,
        product_type: product.product_type || product.type,
        is_active: product.is_active !== false,
        status: "общий каталог",
      };
    });

    const nextOffset = offset + items.length;
    return NextResponse.json(
      {
        items,
        total,
        category_counts: {
          all: activeRows.length,
          categories: categoryCounts,
        },
        next_cursor: nextOffset < total ? encodeCursor(nextOffset) : null,
        query,
        request_id: requestId,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
