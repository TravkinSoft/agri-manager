import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProductDisplayLabel,
  matchCatalogSearch,
  normalizeCatalogName,
  stripManufacturerPrefixCandidate,
  type CatalogProductLike,
} from "@/lib/catalog/catalog-identity";
import { buildProductPassport } from "@/lib/products/product-passport";
import type {
  KnowledgeIntakeMatchInput,
  KnowledgeMatchType,
  KnowledgeMatcherTimings,
  KnowledgeMatcherResult,
  KnowledgeProductMatch,
  KnowledgeRecommendation,
} from "@/lib/knowledge/types";

const PRODUCT_SELECT = [
  "id",
  "company_id",
  "name",
  "trade_name",
  "normalized_name",
  "manufacturer",
  "product_type",
  "type",
  "category",
  "subcategory",
  "pesticide_category",
  "fertilizer_type",
  "unit",
  "stock_unit",
  "base_uom",
  "default_unit",
  "application_unit",
  "default_rate_type",
  "default_rate_unit",
  "physical_state",
  "metadata_review_required",
  "metadata_confidence",
  "metadata_source_url",
  "notes",
  "is_active",
  "archived",
].join(",");

const PRODUCT_CANDIDATE_LIMIT = 250;
const PRODUCT_CANDIDATE_CACHE_TTL_MS = 5 * 60 * 1000;

type ProductRow = CatalogProductLike & {
  physical_state?: string | null;
  metadata_review_required?: boolean | string | null;
  metadata_confidence?: string | null;
  metadata_source_url?: string | null;
  is_active?: boolean | null;
  archived?: boolean | null;
};

type AliasGroup = {
  id: string;
  aliases: string[];
};

type CandidateMatch = {
  product: ProductRow;
  match_type: KnowledgeMatchType;
  confidence: number;
  reason: string;
};

type IndexedProduct = {
  product: ProductRow;
  names: string[];
  normalizedNames: Set<string>;
  aliasGroup: string | null;
  searchNorm: string;
};

type CandidateCacheEntry = {
  expiresAt: number;
  indexes: IndexedProduct[];
  dbFetchMs: number;
};

const candidateCache = new Map<string, CandidateCacheEntry>();

const ALIAS_GROUPS: AliasGroup[] = [
  {
    id: "phomazin",
    aliases: [
      "phomazin",
      "fomazin",
      "swissgrow phomazin",
      "sg phomazin",
      "\u0424\u043e\u043c\u0430\u0437\u0438\u043d",
      "\u0421\u0432\u0438\u0441\u0441\u0433\u0440\u043e\u0443 \u0424\u043e\u043c\u0430\u0437\u0438\u043d",
    ],
  },
  {
    id: "curamin-foliar",
    aliases: [
      "curamin",
      "curamin foliar",
      "\u041a\u0443\u0440\u0430\u043c\u0438\u043d",
      "\u041a\u0443\u0440\u0430\u043c\u0438\u043d \u0424\u043e\u043b\u0438\u0430\u0440",
    ],
  },
  {
    id: "celest-top",
    aliases: [
      "celest top",
      "celes top",
      "celest top ks",
      "celest top sc",
      "celest top fs",
      "\u0421\u0435\u043b\u0435\u0441\u0442 \u0422\u043e\u043f",
      "\u0421\u0435\u043b\u0435\u0441\u0442 \u0422\u043e\u043f \u041a\u0421",
      "\u0421\u0435\u043b\u0435\u0441\u0442 \u0422\u043e\u043f, \u041a\u0421",
      "\u0421\u0435\u043b\u0435\u0441\u0442\u043e\u043f",
    ],
  },
  {
    id: "technofit-ph",
    aliases: [
      "technofit",
      "technofit ph",
      "techno fit ph",
      "\u0422\u0435\u0445\u043d\u043e\u0444\u0438\u0442",
      "\u0422\u0435\u0445\u043d\u043e\u0444\u0438\u0442 PH",
      "\u0422\u0435\u043a\u043d\u043e\u0444\u0438\u0442",
      "\u0422\u0435\u043a\u043d\u043e\u0444\u0438\u0442 PH",
    ],
  },
  {
    id: "tilt",
    aliases: ["tilt", "\u0422\u0438\u043b\u0442", "\u0422\u0438\u043b\u044c\u0442"],
  },
];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableText(value: unknown): string | null {
  const next = text(value);
  return next ? next : null;
}

function normalized(value: unknown): string {
  return normalizeCatalogName(text(value));
}

function nowMs() {
  return Date.now();
}

function elapsedMs(start: number) {
  return Math.max(0, nowMs() - start);
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const next = text(value);
    if (!next) continue;
    const key = normalized(next);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(next);
  }
  return result;
}

function aliasGroupById(groupId: string | null): AliasGroup | null {
  return ALIAS_GROUPS.find((group) => group.id === groupId) || null;
}

function sanitizePostgrestSearchTerm(value: string): string {
  return text(value)
    .replace(/[,%()*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productName(product: ProductRow): string {
  return text(product.trade_name || product.name || product.normalized_name);
}

function productTexts(product: ProductRow): string[] {
  const displayName = buildProductDisplayLabel(product);
  const stripped = stripManufacturerPrefixCandidate(product);
  return [
    product.name,
    product.trade_name,
    product.normalized_name,
    displayName,
    stripped.originalName,
    stripped.proposedTradeName,
  ]
    .map(text)
    .filter(Boolean);
}

function aliasGroupFor(value: unknown): string | null {
  const valueNorm = normalized(value);
  if (!valueNorm) return null;
  for (const group of ALIAS_GROUPS) {
    if (group.aliases.some((alias) => normalized(alias) === valueNorm)) return group.id;
  }
  return null;
}

function productAliasGroup(product: ProductRow): string | null {
  for (const value of productTexts(product)) {
    const group = aliasGroupFor(value);
    if (group) return group;
  }
  return null;
}

function buildSearchNorm(product: ProductRow, names: string[], aliasGroup: string | null): string {
  const group = aliasGroupById(aliasGroup);
  return [
    ...names,
    product.manufacturer,
    product.product_type,
    product.type,
    product.category,
    product.subcategory,
    product.pesticide_category,
    product.fertilizer_type,
    product.notes,
    ...(group?.aliases || []),
  ]
    .map(normalized)
    .filter(Boolean)
    .join(" ");
}

function indexProduct(product: ProductRow): IndexedProduct {
  const names = productTexts(product);
  const aliasGroup = productAliasGroup(product);
  return {
    product,
    names,
    normalizedNames: new Set(names.map(normalized).filter(Boolean)),
    aliasGroup,
    searchNorm: buildSearchNorm(product, names, aliasGroup),
  };
}

function stripShortManufacturerPrefix(value: string): { stripped: string; matched: boolean } {
  const next = text(value);
  const match = next.match(/^(sg|swissgrow)\s+(.+)$/i);
  if (!match?.[2]) return { stripped: next, matched: false };
  return { stripped: text(match[2]), matched: true };
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j < previous.length; j += 1) previous[j] = current[j];
  }
  return previous[right.length];
}

function similarity(left: string, right: string): number {
  const a = normalized(left);
  const b = normalized(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLength = Math.max(a.length, b.length);
  if (!maxLength) return 0;
  return 1 - levenshtein(a, b) / maxLength;
}

function pickBestMatch(product: ProductRow, input: KnowledgeIntakeMatchInput): CandidateMatch | null {
  const inputValue = text(input.inputValue);
  const inputNorm = normalized(inputValue);
  if (!inputNorm) return null;
  const names = productTexts(product);
  const exact = names.some((value) => normalized(value) === inputNorm);
  if (exact) {
    return { product, match_type: "exact", confidence: 0.95, reason: "normalized trade/name exact match" };
  }

  const inputGroup = aliasGroupFor(inputValue);
  const productGroup = productAliasGroup(product);
  if (inputGroup && productGroup && inputGroup === productGroup) {
    return { product, match_type: "alias", confidence: 0.9, reason: `known identity alias group: ${inputGroup}` };
  }

  const stripped = stripManufacturerPrefixCandidate(inputValue);
  const shortPrefix = stripShortManufacturerPrefix(inputValue);
  const strippedInput = stripped.isCandidate ? stripped.proposedTradeName : shortPrefix.stripped;
  const strippedGroup = aliasGroupFor(strippedInput);
  const prefixMatched = stripped.isCandidate || shortPrefix.matched;
  if (prefixMatched && strippedInput) {
    const strippedNorm = normalized(strippedInput);
    const strippedExact = names.some((value) => normalized(value) === strippedNorm);
    if (strippedExact || (strippedGroup && productGroup && strippedGroup === productGroup) || matchCatalogSearch(product, strippedInput)) {
      return {
        product,
        match_type: "manufacturer_prefix",
        confidence: 0.85,
        reason: "manufacturer/brand prefix stripped before matching",
      };
    }
  }

  if (matchCatalogSearch(product, inputValue)) {
    return { product, match_type: "transliteration", confidence: 0.75, reason: "catalog search/alias text matched" };
  }

  let bestSimilarity = 0;
  for (const value of names) bestSimilarity = Math.max(bestSimilarity, similarity(inputValue, value));
  if (bestSimilarity >= 0.68) {
    return {
      product,
      match_type: "fuzzy",
      confidence: Math.max(0.5, Math.min(0.7, Number(bestSimilarity.toFixed(2)))),
      reason: `normalized fuzzy similarity ${bestSimilarity.toFixed(2)}`,
    };
  }

  return null;
}

function toKnowledgeMatch(candidate: CandidateMatch): KnowledgeProductMatch {
  const passport = buildProductPassport(candidate.product);
  return {
    product_id: candidate.product.id,
    display_name: passport.displayName || buildProductDisplayLabel(candidate.product) || productName(candidate.product),
    trade_name: passport.tradeName || productName(candidate.product),
    manufacturer: passport.manufacturer.name || nullableText(candidate.product.manufacturer),
    product_type: passport.classification.productType || nullableText(candidate.product.product_type || candidate.product.type),
    subcategory:
      passport.classification.subcategory ||
      nullableText(candidate.product.subcategory || candidate.product.pesticide_category || candidate.product.fertilizer_type),
    stock_unit: passport.units.stockUnit === "unknown" ? null : passport.units.stockUnit,
    default_rate_type: passport.units.defaultRateType || null,
    default_rate_unit: passport.units.defaultRateUnit,
    metadata_review_required: passport.review.metadataReviewRequired,
    match_type: candidate.match_type,
    confidence: candidate.confidence,
    reason: candidate.reason,
  };
}

function isTruthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const next = text(value).toLowerCase();
  return next === "true" || next === "1" || next === "yes" || next === "\u0434\u0430";
}

function isKnownText(value: unknown): boolean {
  const next = text(value).toLowerCase();
  return Boolean(next && !["unknown", "\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e", "\u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u043e", "-"].includes(next));
}

function hasKnownManufacturer(product: ProductRow): boolean {
  return isKnownText(product.manufacturer);
}

function hasKnownStockUnit(product: ProductRow): boolean {
  return [product.stock_unit, product.unit, product.base_uom, product.default_unit, product.application_unit].some(isKnownText);
}

function hasSpecificRateType(product: ProductRow): boolean {
  const rateType = text(product.default_rate_type);
  return Boolean(rateType && rateType !== "manual");
}

function candidateSortScores(candidate: CandidateMatch, input: KnowledgeIntakeMatchInput): number[] {
  const inputGroup = aliasGroupFor(input.inputValue);
  const candidateGroup = productAliasGroup(candidate.product);
  const isKnownIdentityGroup = Boolean(inputGroup && candidateGroup && inputGroup === candidateGroup);
  const isExactOrAlias = ["exact", "alias", "manufacturer_prefix"].includes(candidate.match_type);
  return [
    isKnownIdentityGroup || isExactOrAlias ? 1 : 0,
    candidate.match_type === "exact" ? 1 : 0,
    hasKnownManufacturer(candidate.product) ? 1 : 0,
    isTruthy(candidate.product.metadata_review_required) ? 0 : 1,
    hasKnownStockUnit(candidate.product) ? 1 : 0,
    hasSpecificRateType(candidate.product) ? 1 : 0,
    candidate.confidence,
  ];
}

function compareCandidates(left: CandidateMatch, right: CandidateMatch, input: KnowledgeIntakeMatchInput): number {
  const leftScores = candidateSortScores(left, input);
  const rightScores = candidateSortScores(right, input);
  for (let index = 0; index < leftScores.length; index += 1) {
    if (rightScores[index] !== leftScores[index]) return rightScores[index] - leftScores[index];
  }
  return buildProductDisplayLabel(left.product).localeCompare(buildProductDisplayLabel(right.product), "ru");
}

export function buildKnowledgeRecommendation(matches: KnowledgeProductMatch[]): KnowledgeRecommendation {
  if (!matches.length) return "POSSIBLE_NEW_PRODUCT";
  const highConfidence = matches.filter((match) => match.confidence >= 0.85);
  if (highConfidence.length > 1) return "REVIEW_POSSIBLE_DUPLICATES";
  if (highConfidence.length === 1 && ["exact", "alias", "manufacturer_prefix"].includes(highConfidence[0].match_type)) {
    return "UPDATE_EXISTING_PRODUCT";
  }
  return "REVIEW_POSSIBLE_DUPLICATES";
}

function buildInputSearchTerms(input: KnowledgeIntakeMatchInput): string[] {
  const inputValue = text(input.inputValue);
  const stripped = stripManufacturerPrefixCandidate(inputValue);
  const shortPrefix = stripShortManufacturerPrefix(inputValue);
  const inputGroup = aliasGroupFor(inputValue);
  const strippedGroup = aliasGroupFor(stripped.proposedTradeName || shortPrefix.stripped);
  const groups = [inputGroup, strippedGroup].map(aliasGroupById).filter(Boolean) as AliasGroup[];
  return uniqueNonEmpty([
    inputValue,
    stripped.proposedTradeName,
    shortPrefix.stripped,
    ...(groups.flatMap((group) => group.aliases)),
  ])
    .map(sanitizePostgrestSearchTerm)
    .filter((term) => term.length >= 2)
    .slice(0, 18);
}

function buildCandidateFilter(terms: string[]): string {
  const conditions: string[] = [];
  for (const term of terms) {
    conditions.push(`name.ilike.%${term}%`);
    conditions.push(`trade_name.ilike.%${term}%`);
    conditions.push(`normalized_name.ilike.%${term}%`);
    conditions.push(`manufacturer.ilike.%${term}%`);
  }
  return conditions.join(",");
}

function candidateCacheKey(terms: string[]): string {
  return terms.map(normalized).filter(Boolean).sort().join("|");
}

function isActiveProduct(product: ProductRow): boolean {
  return !isTruthy(product.archived) && product.is_active !== false;
}

async function loadProductCandidatesForIntake(
  supabase: SupabaseClient,
  input: KnowledgeIntakeMatchInput,
  timings: KnowledgeMatcherTimings
): Promise<IndexedProduct[]> {
  const terms = buildInputSearchTerms(input);
  if (!terms.length) return [];

  const cacheKey = candidateCacheKey(terms);
  const cached = candidateCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs()) {
    timings.cache_hit = true;
    timings.db_products_fetch_ms = 0;
    timings.db_candidate_count = cached.indexes.length;
    timings.products_scanned = cached.indexes.length;
    return cached.indexes;
  }

  const dbStart = nowMs();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .or(buildCandidateFilter(terms))
    .limit(PRODUCT_CANDIDATE_LIMIT);
  timings.db_products_fetch_ms = elapsedMs(dbStart);

  if (error) {
    throw new Error(`Failed to load products for intake matcher: ${error.message}`);
  }

  const byId = new Map<string, ProductRow>();
  for (const product of ((data || []) as unknown as ProductRow[])) {
    if (!product?.id || !isActiveProduct(product)) continue;
    byId.set(product.id, product);
  }

  const indexes = Array.from(byId.values()).map(indexProduct);
  timings.db_candidate_count = indexes.length;
  timings.products_scanned = indexes.length;

  candidateCache.set(cacheKey, {
    expiresAt: nowMs() + PRODUCT_CANDIDATE_CACHE_TTL_MS,
    indexes,
    dbFetchMs: timings.db_products_fetch_ms,
  });

  return indexes;
}

function addCandidate(byProductId: Map<string, CandidateMatch>, candidate: CandidateMatch) {
  const existing = byProductId.get(candidate.product.id);
  if (!existing || candidate.confidence > existing.confidence) byProductId.set(candidate.product.id, candidate);
}

function collectExactMatches(indexes: IndexedProduct[], inputNorm: string): CandidateMatch[] {
  if (!inputNorm) return [];
  return indexes
    .filter((index) => index.normalizedNames.has(inputNorm))
    .map((index) => ({
      product: index.product,
      match_type: "exact" as KnowledgeMatchType,
      confidence: 0.95,
      reason: "normalized trade/name exact match",
    }));
}

function collectAliasMatches(indexes: IndexedProduct[], inputValue: string): CandidateMatch[] {
  const inputGroup = aliasGroupFor(inputValue);
  if (!inputGroup) return [];
  return indexes
    .filter((index) => index.aliasGroup === inputGroup)
    .map((index) => ({
      product: index.product,
      match_type: "alias" as KnowledgeMatchType,
      confidence: 0.9,
      reason: `known identity alias group: ${inputGroup}`,
    }));
}

function collectManufacturerPrefixMatches(indexes: IndexedProduct[], inputValue: string): CandidateMatch[] {
  const stripped = stripManufacturerPrefixCandidate(inputValue);
  const shortPrefix = stripShortManufacturerPrefix(inputValue);
  const strippedInput = stripped.isCandidate ? stripped.proposedTradeName : shortPrefix.stripped;
  const prefixMatched = stripped.isCandidate || shortPrefix.matched;
  if (!prefixMatched || !strippedInput) return [];

  const strippedNorm = normalized(strippedInput);
  const strippedGroup = aliasGroupFor(strippedInput);
  return indexes
    .filter((index) => {
      if (index.normalizedNames.has(strippedNorm)) return true;
      if (strippedGroup && index.aliasGroup === strippedGroup) return true;
      return index.searchNorm.includes(strippedNorm);
    })
    .map((index) => ({
      product: index.product,
      match_type: "manufacturer_prefix" as KnowledgeMatchType,
      confidence: 0.85,
      reason: "manufacturer/brand prefix stripped before matching",
    }));
}

function collectContainsMatches(indexes: IndexedProduct[], inputNorm: string): CandidateMatch[] {
  if (!inputNorm) return [];
  return indexes
    .filter((index) => index.searchNorm.includes(inputNorm))
    .map((index) => ({
      product: index.product,
      match_type: "transliteration" as KnowledgeMatchType,
      confidence: 0.75,
      reason: "catalog search/alias text matched",
    }));
}

function collectFuzzyMatches(indexes: IndexedProduct[], inputValue: string): CandidateMatch[] {
  const inputNorm = normalized(inputValue);
  if (inputNorm.length < 4) return [];
  const loosePrefix = inputNorm.slice(0, Math.min(4, inputNorm.length));
  return indexes
    .map((index) => {
      if (loosePrefix && !index.searchNorm.includes(loosePrefix[0])) return null;
      let bestSimilarity = 0;
      for (const value of index.names) bestSimilarity = Math.max(bestSimilarity, similarity(inputValue, value));
      if (bestSimilarity < 0.68) return null;
      return {
        product: index.product,
        match_type: "fuzzy" as KnowledgeMatchType,
        confidence: Math.max(0.5, Math.min(0.7, Number(bestSimilarity.toFixed(2)))),
        reason: `normalized fuzzy similarity ${bestSimilarity.toFixed(2)}`,
      };
    })
    .filter(Boolean) as CandidateMatch[];
}

export async function matchProductsForIntake(
  supabase: SupabaseClient,
  input: KnowledgeIntakeMatchInput
): Promise<KnowledgeMatcherResult> {
  const totalStart = nowMs();
  const inputValue = text(input.inputValue);
  const timings: KnowledgeMatcherTimings = {
    total_ms: 0,
    db_products_fetch_ms: 0,
    exact_match_ms: 0,
    alias_match_ms: 0,
    manufacturer_prefix_ms: 0,
    contains_match_ms: 0,
    fuzzy_match_ms: 0,
    products_scanned: 0,
    db_candidate_count: 0,
    cache_hit: false,
  };
  if (!inputValue) return { matches: [], recommendation: "POSSIBLE_NEW_PRODUCT", timings };

  const indexes = await loadProductCandidatesForIntake(supabase, input, timings);
  const inputNorm = normalized(inputValue);

  const byProductId = new Map<string, CandidateMatch>();

  let stageStart = nowMs();
  collectExactMatches(indexes, inputNorm).forEach((candidate) => addCandidate(byProductId, candidate));
  timings.exact_match_ms = elapsedMs(stageStart);

  stageStart = nowMs();
  collectAliasMatches(indexes, inputValue).forEach((candidate) => addCandidate(byProductId, candidate));
  timings.alias_match_ms = elapsedMs(stageStart);

  stageStart = nowMs();
  collectManufacturerPrefixMatches(indexes, inputValue).forEach((candidate) => addCandidate(byProductId, candidate));
  timings.manufacturer_prefix_ms = elapsedMs(stageStart);

  stageStart = nowMs();
  collectContainsMatches(indexes, inputNorm).forEach((candidate) => addCandidate(byProductId, candidate));
  timings.contains_match_ms = elapsedMs(stageStart);

  const hasHighConfidence = Array.from(byProductId.values()).some((candidate) => candidate.confidence >= 0.85);
  if (!hasHighConfidence) {
    stageStart = nowMs();
    collectFuzzyMatches(indexes, inputValue).forEach((candidate) => addCandidate(byProductId, candidate));
    timings.fuzzy_match_ms = elapsedMs(stageStart);
  }

  const candidates = Array.from(byProductId.values());
  const highConfidenceCandidates = candidates.filter((candidate) => candidate.confidence >= 0.85);
  const visibleCandidates = highConfidenceCandidates.length ? highConfidenceCandidates : candidates;

  const matches = visibleCandidates
    .sort((left, right) => compareCandidates(left, right, input))
    .slice(0, 20)
    .map(toKnowledgeMatch);

  timings.total_ms = elapsedMs(totalStart);
  return { matches, recommendation: buildKnowledgeRecommendation(matches), timings };
}
