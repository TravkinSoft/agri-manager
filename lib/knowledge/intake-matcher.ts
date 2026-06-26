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
      "celest top ks",
      "celest top sc",
      "celest top fs",
      "\u0421\u0435\u043b\u0435\u0441\u0442 \u0422\u043e\u043f",
      "\u0421\u0435\u043b\u0435\u0441\u0442 \u0422\u043e\u043f \u041a\u0421",
      "\u0421\u0435\u043b\u0435\u0441\u0442 \u0422\u043e\u043f, \u041a\u0421",
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

export function buildKnowledgeRecommendation(matches: KnowledgeProductMatch[]): KnowledgeRecommendation {
  if (!matches.length) return "POSSIBLE_NEW_PRODUCT";
  const highConfidence = matches.filter((match) => match.confidence >= 0.85);
  if (highConfidence.length > 1) return "REVIEW_POSSIBLE_DUPLICATES";
  if (highConfidence.length === 1 && ["exact", "alias", "manufacturer_prefix"].includes(highConfidence[0].match_type)) {
    return "UPDATE_EXISTING_PRODUCT";
  }
  return "REVIEW_POSSIBLE_DUPLICATES";
}

export async function matchProductsForIntake(
  supabase: SupabaseClient,
  input: KnowledgeIntakeMatchInput
): Promise<KnowledgeMatcherResult> {
  const inputValue = text(input.inputValue);
  if (!inputValue) return { matches: [], recommendation: "POSSIBLE_NEW_PRODUCT" };

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .or("archived.is.false,archived.is.null")
    .limit(2000);

  if (error) {
    throw new Error(`Failed to load products for intake matcher: ${error.message}`);
  }

  const byProductId = new Map<string, CandidateMatch>();
  for (const product of ((data || []) as unknown as ProductRow[])) {
    if (!product?.id) continue;
    const candidate = pickBestMatch(product, input);
    if (!candidate) continue;
    const existing = byProductId.get(product.id);
    if (!existing || candidate.confidence > existing.confidence) byProductId.set(product.id, candidate);
  }

  const candidates = Array.from(byProductId.values());
  const highConfidenceCandidates = candidates.filter((candidate) => candidate.confidence >= 0.85);
  const visibleCandidates = highConfidenceCandidates.length ? highConfidenceCandidates : candidates;

  const matches = visibleCandidates
    .sort((left, right) => {
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      return buildProductDisplayLabel(left.product).localeCompare(buildProductDisplayLabel(right.product), "ru");
    })
    .slice(0, 20)
    .map(toKnowledgeMatch);

  return { matches, recommendation: buildKnowledgeRecommendation(matches) };
}
