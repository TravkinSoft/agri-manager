export type KnowledgeIntakeApiInputType = "text" | "url";
export type KnowledgeIntakeDbInputType = "name" | "url";

export type KnowledgeMatchType =
  | "exact"
  | "alias"
  | "transliteration"
  | "manufacturer_prefix"
  | "fuzzy"
  | "possible_duplicate";

export type KnowledgeRecommendation =
  | "UPDATE_EXISTING_PRODUCT"
  | "REVIEW_POSSIBLE_DUPLICATES"
  | "POSSIBLE_NEW_PRODUCT";

export type KnowledgeIntakeRunStatus =
  | "draft"
  | "analyzing"
  | "matched"
  | "extracted"
  | "needs_review"
  | "approved"
  | "applied"
  | "rejected"
  | "failed";

export type KnowledgeProductMatch = {
  product_id: string;
  display_name: string;
  trade_name: string;
  manufacturer: string | null;
  product_type: string | null;
  subcategory: string | null;
  stock_unit: string | null;
  default_rate_type: string | null;
  default_rate_unit: string | null;
  metadata_review_required: boolean;
  match_type: KnowledgeMatchType;
  confidence: number;
  reason: string;
};

export type KnowledgeIntakeMatchInput = {
  inputValue: string;
  manufacturer?: string | null;
};

export type KnowledgeMatcherResult = {
  matches: KnowledgeProductMatch[];
  recommendation: KnowledgeRecommendation;
};

