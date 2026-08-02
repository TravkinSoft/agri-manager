import {
  buildCatalogIdentityKey,
  buildProductDisplayLabel,
  normalizeCatalogName,
  stripManufacturerPrefixCandidate,
  type CatalogProductLike,
} from "@/lib/catalog/catalog-identity";

export type MaterialProductGroup = "pesticides" | "additives" | "fertilizers";
export type MaterialSourceType = "company" | "company_override" | "linked_global" | "global";

export type MaterialCatalogProduct = CatalogProductLike & {
  master_product_id?: string | null;
  active_ingredient?: string | null;
  archived?: boolean | null;
  is_active?: boolean | null;
  aliases?: string[];
};

export type MaterialStockRow = {
  product_id: string;
  warehouse_id?: string | null;
  quantity: number | string;
  uom?: string | null;
};

export type MaterialCompanyLink = {
  global_product_id: string;
  source?: string | null;
  sources?: string[] | null;
  first_used_at?: string | null;
  last_used_at?: string | null;
};

export type MaterialSelectItem = {
  product_id: string;
  canonical_product_id: string;
  master_product_id: string | null;
  trade_name: string;
  manufacturer: string | null;
  product_type: string;
  category: string | null;
  subcategory: string | null;
  unit: string | null;
  source_type: MaterialSourceType;
  is_company_linked: boolean;
  is_company_override: boolean;
  available_quantity: number;
  available_unit: string | null;
  available_quantities: Array<{ quantity: number; unit: string }>;
  has_stock: boolean;
  aliases: string[];
  match_reason: "exact" | "prefix" | "contains" | "initial";
  active_ingredient: string | null;
};

const TYPES_BY_GROUP: Record<MaterialProductGroup, Set<string>> = {
  pesticides: new Set(["pesticide", "growth_regulator"]),
  additives: new Set(["additive", "adjuvant"]),
  fertilizers: new Set(["fertilizer"]),
};

function productType(product: MaterialCatalogProduct): string {
  return String(product.product_type || product.type || product.category || "").trim().toLowerCase();
}

export function productMatchesMaterialGroup(
  product: MaterialCatalogProduct,
  group: MaterialProductGroup
): boolean {
  return TYPES_BY_GROUP[group].has(productType(product));
}

function canonicalProductId(product: MaterialCatalogProduct): string {
  if (product.company_id && product.master_product_id) return String(product.master_product_id);
  return String(product.id);
}

function identityKey(product: MaterialCatalogProduct): string {
  if (product.master_product_id) return `master:${product.master_product_id}`;
  if (!product.company_id) return `master:${product.id}`;
  return `catalog:${buildCatalogIdentityKey(product)}`;
}

function preferDisplayProduct(current: MaterialCatalogProduct, candidate: MaterialCatalogProduct) {
  const currentOverride = Boolean(current.company_id && current.master_product_id);
  const candidateOverride = Boolean(candidate.company_id && candidate.master_product_id);
  if (currentOverride !== candidateOverride) return candidateOverride ? candidate : current;
  if (Boolean(current.company_id) !== Boolean(candidate.company_id)) return candidate.company_id ? candidate : current;
  const completeness = (row: MaterialCatalogProduct) =>
    [row.trade_name, row.manufacturer, row.subcategory, row.active_ingredient, row.unit, row.base_uom].filter(Boolean).length;
  return completeness(candidate) > completeness(current) ? candidate : current;
}

function searchValues(product: MaterialCatalogProduct): string[] {
  const stripped = stripManufacturerPrefixCandidate(product);
  return [
    product.trade_name,
    product.name,
    product.normalized_name,
    stripped.proposedTradeName,
    buildProductDisplayLabel(product),
    product.manufacturer,
    product.active_ingredient,
    ...(product.aliases || []),
  ]
    .map((value) => normalizeCatalogName(value))
    .filter(Boolean);
}

function matchRank(product: MaterialCatalogProduct, query: string): 0 | 1 | 2 | 99 {
  const normalized = normalizeCatalogName(query);
  if (!normalized) return 0;
  const values = searchValues(product);
  if (values.some((value) => value === normalized)) return 0;
  if (values.some((value) => value.startsWith(normalized) || value.split(" ").some((word) => word.startsWith(normalized)))) return 1;
  if (values.some((value) => value.includes(normalized))) return 2;
  return 99;
}

function matchReason(rank: 0 | 1 | 2 | 99, query: string): MaterialSelectItem["match_reason"] {
  if (!normalizeCatalogName(query)) return "initial";
  if (rank === 0) return "exact";
  if (rank === 1) return "prefix";
  return "contains";
}

function rounded(value: number) {
  return Number(value.toFixed(3));
}

export function buildMaterialSelectItems(input: {
  products: MaterialCatalogProduct[];
  stocks: MaterialStockRow[];
  links: MaterialCompanyLink[];
  group: MaterialProductGroup;
  query?: string;
  globalOffset?: number;
  globalLimit?: number;
  initialStockLimit?: number;
  initialLinkedLimit?: number;
}): { items: MaterialSelectItem[]; nextCursor: string | null; totalMatches: number } {
  const query = String(input.query || "").trim();
  const products = input.products.filter(
    (product) => product.is_active !== false && !product.archived && productMatchesMaterialGroup(product, input.group)
  );
  const productById = new Map(products.map((product) => [String(product.id), product] as const));
  const grouped = new Map<string, { preferred: MaterialCatalogProduct; members: MaterialCatalogProduct[] }>();

  for (const product of products) {
    const key = identityKey(product);
    const current = grouped.get(key);
    if (!current) grouped.set(key, { preferred: product, members: [product] });
    else {
      current.preferred = preferDisplayProduct(current.preferred, product);
      current.members.push(product);
    }
  }

  const linkByGlobalId = new Map(input.links.map((link) => [String(link.global_product_id), link] as const));
  const stockByIdentity = new Map<string, Map<string, number>>();
  for (const stock of input.stocks) {
    const product = productById.get(String(stock.product_id));
    if (!product) continue;
    const unit = String(stock.uom || product.base_uom || product.stock_unit || product.unit || "").trim().toLowerCase();
    if (!unit) continue;
    const quantity = Number(stock.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const key = identityKey(product);
    const units = stockByIdentity.get(key) || new Map<string, number>();
    units.set(unit, (units.get(unit) || 0) + quantity);
    stockByIdentity.set(key, units);
  }

  const ranked = Array.from(grouped.entries())
    .map(([key, group]) => {
      const rank = Math.min(...group.members.map((member) => matchRank(member, query))) as 0 | 1 | 2 | 99;
      if (rank === 99) return null;
      const canonicalId = canonicalProductId(group.preferred);
      const link = linkByGlobalId.get(canonicalId);
      const units = Array.from((stockByIdentity.get(key) || new Map()).entries())
        .map(([unit, quantity]) => ({ unit, quantity: rounded(quantity) }))
        .sort((left, right) => left.unit.localeCompare(right.unit));
      const hasStock = units.some((entry) => entry.quantity > 0);
      const isOverride = Boolean(group.preferred.company_id && group.preferred.master_product_id);
      const isCompany = Boolean(group.preferred.company_id && !group.preferred.master_product_id);
      const sourceType: MaterialSourceType = isOverride
        ? "company_override"
        : isCompany
          ? "company"
          : link
            ? "linked_global"
            : "global";
      const stripped = stripManufacturerPrefixCandidate(group.preferred);
      const aliases = Array.from(new Set(group.members.flatMap((item) => item.aliases || []).filter(Boolean)));
      const primary = units.length === 1 ? units[0] : null;
      const item: MaterialSelectItem = {
        product_id: String(group.preferred.id),
        canonical_product_id: canonicalId,
        master_product_id: group.preferred.master_product_id ? String(group.preferred.master_product_id) : null,
        trade_name: stripped.proposedTradeName || String(group.preferred.trade_name || group.preferred.name || "-"),
        manufacturer: group.preferred.manufacturer ? String(group.preferred.manufacturer) : null,
        product_type: productType(group.preferred),
        category: group.preferred.category ? String(group.preferred.category) : null,
        subcategory: group.preferred.subcategory ? String(group.preferred.subcategory) : null,
        unit: String(group.preferred.base_uom || group.preferred.stock_unit || group.preferred.unit || "").trim() || null,
        source_type: sourceType,
        is_company_linked: Boolean(link),
        is_company_override: isOverride,
        available_quantity: primary?.quantity || 0,
        available_unit: primary?.unit || null,
        available_quantities: units,
        has_stock: hasStock,
        aliases,
        match_reason: matchReason(rank, query),
        active_ingredient: group.preferred.active_ingredient ? String(group.preferred.active_ingredient) : null,
      };
      return {
        item,
        rank,
        tier: hasStock ? 0 : link || isCompany || isOverride ? 1 : 2,
      };
    })
    .filter(Boolean) as Array<{ item: MaterialSelectItem; rank: number; tier: number }>;

  ranked.sort((left, right) =>
    left.tier - right.tier ||
    left.rank - right.rank ||
    left.item.trade_name.localeCompare(right.item.trade_name, "ru") ||
    left.item.product_id.localeCompare(right.item.product_id)
  );

  const globalOffset = Math.max(0, Number(input.globalOffset || 0));
  const globalLimit = Math.min(60, Math.max(1, Number(input.globalLimit || 20)));
  if (query) {
    const page = ranked.slice(globalOffset, globalOffset + globalLimit).map((entry) => entry.item);
    return {
      items: page,
      nextCursor: globalOffset + globalLimit < ranked.length ? String(globalOffset + globalLimit) : null,
      totalMatches: ranked.length,
    };
  }

  const stock = ranked.filter((entry) => entry.tier === 0).slice(0, input.initialStockLimit || 20);
  const linked = ranked.filter((entry) => entry.tier === 1).slice(0, input.initialLinkedLimit || 20);
  const global = ranked.filter((entry) => entry.tier === 2);
  const globalPage = global.slice(globalOffset, globalOffset + globalLimit);
  return {
    items: [...stock, ...linked, ...globalPage].map((entry) => entry.item),
    nextCursor: globalOffset + globalLimit < global.length ? String(globalOffset + globalLimit) : null,
    totalMatches: ranked.length,
  };
}
