export type PesticideCatalogProduct = {
  id: string;
  master_product_id?: string | null;
  name?: string | null;
  name_ru?: string | null;
  name_en?: string | null;
  trade_name?: string | null;
  normalized_name?: string | null;
  manufacturer?: string | null;
  active_ingredient?: string | null;
  registration_status_kz?: string | null;
  pesticide_category?: string | null;
  category?: string | null;
  subcategory?: string | null;
  category_id?: string | null;
  manufacturer_id?: string | null;
  formulation?: string | null;
  formulation_id?: string | null;
  mode_of_action_type?: string | null;
  mode_of_action_type_id?: string | null;
  stock_unit?: string | null;
  default_rate_type?: string | null;
  default_rate_unit?: string | null;
  product_type?: string | null;
  type?: string | null;
  is_active?: boolean | null;
};

export type PesticideSearchRelations = {
  aliases?: string[];
  activeIngredients?: string[];
  registrationNumbers?: string[];
};

export type PesticideSearchMatch<T extends PesticideCatalogProduct> = {
  product: T;
  score: number;
};

const DASHES_RE = /[\u2010-\u2015\u2212]/g;
const OUTER_QUOTES_RE = /^(?:["'«»“”„`]+)|(?:["'«»“”„`]+)$/g;

export function normalizePesticideSearchText(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(DASHES_RE, "-")
    .trim()
    .replace(OUTER_QUOTES_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizePesticideQuery(value: unknown): string[] {
  return normalizePesticideSearchText(value).split(" ").filter(Boolean);
}

function normalizedValues(values: Array<unknown>): string[] {
  return values.map(normalizePesticideSearchText).filter(Boolean);
}

function containsWholeWord(value: string, query: string): boolean {
  if (!value || !query) return false;
  const words = value.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  return words.includes(query);
}

export function rankPesticideProduct<T extends PesticideCatalogProduct>(
  product: T,
  query: string,
  relations: PesticideSearchRelations = {},
): number | null {
  const normalizedQuery = normalizePesticideSearchText(query);
  if (!normalizedQuery) return 0;

  const tokens = tokenizePesticideQuery(normalizedQuery);
  const tradeNames = normalizedValues([
    product.trade_name,
    product.name,
    product.name_ru,
    product.name_en,
    product.normalized_name,
  ]);
  const aliases = normalizedValues(relations.aliases || []);
  const manufacturers = normalizedValues([product.manufacturer]);
  const activeIngredients = normalizedValues([
    product.active_ingredient,
    ...(relations.activeIngredients || []),
  ]);
  const registrations = normalizedValues([
    product.registration_status_kz,
    ...(relations.registrationNumbers || []),
  ]);
  const searchable = [...tradeNames, ...aliases, ...manufacturers, ...activeIngredients, ...registrations];

  // Every query token must match at least one approved field. Tokens may match
  // different fields, e.g. manufacturer + trade name.
  if (!tokens.every((token) => searchable.some((value) => value.includes(token)))) return null;

  if (tradeNames.includes(normalizedQuery)) return 1000;
  if (aliases.includes(normalizedQuery)) return 900;
  if (tradeNames.some((value) => value.startsWith(normalizedQuery))) return 800;
  if (aliases.some((value) => value.startsWith(normalizedQuery))) return 700;
  if ([...tradeNames, ...aliases].some((value) => containsWholeWord(value, normalizedQuery))) return 600;

  const manufacturerAndTrade =
    tokens.some((token) => manufacturers.some((value) => value.includes(token)))
    && tokens.some((token) => tradeNames.some((value) => value.includes(token)));
  if (manufacturerAndTrade) return 550;
  if (activeIngredients.some((value) => value.includes(normalizedQuery))) return 500;

  const exactTokenMatches = tokens.filter((token) =>
    searchable.some((value) => containsWholeWord(value, token)),
  ).length;
  return 100 + exactTokenMatches;
}

export function searchAndRankPesticides<T extends PesticideCatalogProduct>(
  products: T[],
  query: string,
  relationsByProductId: Map<string, PesticideSearchRelations>,
): PesticideSearchMatch<T>[] {
  const normalizedQuery = normalizePesticideSearchText(query);
  return products
    .map((product) => ({
      product,
      score: rankPesticideProduct(product, normalizedQuery, relationsByProductId.get(product.id) || {}),
    }))
    .filter((entry): entry is PesticideSearchMatch<T> => entry.score !== null)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      const leftName = normalizePesticideSearchText(left.product.trade_name || left.product.name);
      const rightName = normalizePesticideSearchText(right.product.trade_name || right.product.name);
      return leftName.localeCompare(rightName, "ru") || left.product.id.localeCompare(right.product.id);
    });
}

export function dedupeCanonicalPesticides<T extends PesticideCatalogProduct>(products: T[]): T[] {
  const canonical = new Map<string, T>();
  for (const product of products) {
    const key = String(product.master_product_id || product.id);
    const current = canonical.get(key);
    if (!current || (current.is_active === false && product.is_active !== false)) canonical.set(key, product);
  }
  return Array.from(canonical.values());
}

const CATEGORY_LABELS: Record<string, string> = {
  herbicide: "Гербициды",
  fungicide: "Фунгициды",
  insecticide: "Инсектициды",
  additive: "Добавки",
  adjuvant: "Адъюванты",
  surfactant: "ПАВ",
  growth_regulator: "Регуляторы роста",
  crop_protection: "Защита растений",
  biological: "Биопрепараты",
  desiccant: "Десиканты",
  seed_treatment: "Протравители",
  water_conditioner: "Кондиционеры воды",
  ph_regulator: "Регуляторы pH",
  anti_foam: "Пеногасители",
  uncategorized: "Без категории",
};

const CATEGORY_ALIASES: Record<string, string> = {
  гербицид: "herbicide",
  гербициды: "herbicide",
  фунгицид: "fungicide",
  фунгициды: "fungicide",
  инсектицид: "insecticide",
  инсектициды: "insecticide",
  адъювант: "adjuvant",
  адъюванты: "adjuvant",
  протравитель: "seed_treatment",
  "протравители семян": "seed_treatment",
  десикант: "desiccant",
  десиканты: "desiccant",
  "регуляторы роста растений": "growth_regulator",
};

export function pesticideCategoryKey(value: unknown): string {
  const normalized = normalizePesticideSearchText(value).replace(/\s+/g, "_");
  if (!normalized) return "uncategorized";
  return CATEGORY_ALIASES[normalizePesticideSearchText(value)] || normalized;
}

export function pesticideCategoryLabel(key: string, fallback?: string | null): string {
  return CATEGORY_LABELS[key] || String(fallback || key).trim() || "Без категории";
}

export function stablePesticideSort<T extends PesticideCatalogProduct>(products: T[]): T[] {
  return [...products].sort((left, right) => {
    const leftName = normalizePesticideSearchText(left.trade_name || left.name);
    const rightName = normalizePesticideSearchText(right.trade_name || right.name);
    return leftName.localeCompare(rightName, "ru") || left.id.localeCompare(right.id);
  });
}
