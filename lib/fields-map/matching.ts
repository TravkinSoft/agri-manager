import { getFieldDisplayName, getFieldMetadata, getFieldTechnicalKey } from "@/lib/fields/display";

const UNIQUE_AREA_DELTA_MAX_PCT = 3;
const DUPLICATE_AREA_DELTA_MAX_PCT = 5;
const DUPLICATE_AREA_MARGIN_MIN_PCT = 5;
const DUPLICATE_AREA_MARGIN_MIN_RATIO = 2;

type FieldSource = {
  id: string;
  name: string;
  area?: number | string | null;
  notes?: string | null;
  display_name?: string | null;
  original_field_key?: string | null;
  technical_key?: string | null;
};

export type FieldMatchCandidate = {
  field_id: string;
  field_display_name: string;
  technical_key: string | null;
  field_area_ha: number | null;
  area_delta_ha?: number | null;
  area_delta_pct?: number | null;
};

export type FieldMatchContext = {
  area_ha?: number | null;
  conflict_polygon_ids?: readonly string[];
};

export type FieldMatchResult = {
  status: "matched" | "ambiguous" | "not_found";
  stage: "auto_matched" | "manual_required" | "unmatched";
  confidence_score: number;
  matched_by: string | null;
  field_id: string | null;
  field_display_name: string | null;
  suggested_field_id: string | null;
  reason_codes: string[];
  candidates: FieldMatchCandidate[];
};

type AliasIndex = {
  byId: Map<string, FieldMatchCandidate>;
  displayMap: Map<string, Set<string>>;
  originalMap: Map<string, Set<string>>;
  technicalMap: Map<string, Set<string>>;
  nameMap: Map<string, Set<string>>;
  aliasMap: Map<string, Set<string>>;
};

function normalizeFieldToken(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[№#]/gu, "")
    .replace(/(?<![\p{L}\p{N}_])(?:поле|field|контур)(?![\p{L}\p{N}_])/giu, "")
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/[()[\]{}]/gu, " ")
    .replace(/[\\/]/gu, "-")
    .replace(/[^\p{L}\p{N}\-\s]/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/-+/gu, "-")
    .trim();
}

function normalizeCompact(value: string | null | undefined): string {
  const token = normalizeFieldToken(value);
  if (/^\d+(?:[\s-]+\d+)*$/u.test(token)) {
    return token
      .split(/[\s-]+/u)
      .filter(Boolean)
      .map((part) => String(Number(part)))
      .join("-");
  }
  return token.replace(/\s+/gu, "");
}

function positiveNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function put(map: Map<string, Set<string>>, key: string, id: string) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set<string>());
  map.get(key)?.add(id);
}

function fieldAliasVariants(value: string | null | undefined): string[] {
  const token = normalizeFieldToken(value);
  const compact = normalizeCompact(value);
  const variants = new Set<string>();
  if (token) variants.add(token);
  if (compact && compact !== token) variants.add(compact);
  return Array.from(variants);
}

export function buildFieldAliasIndex(fields: FieldSource[]): AliasIndex {
  const index: AliasIndex = {
    byId: new Map<string, FieldMatchCandidate>(),
    displayMap: new Map<string, Set<string>>(),
    originalMap: new Map<string, Set<string>>(),
    technicalMap: new Map<string, Set<string>>(),
    nameMap: new Map<string, Set<string>>(),
    aliasMap: new Map<string, Set<string>>(),
  };

  (fields || []).forEach((field) => {
    const displayName = getFieldDisplayName(field);
    const technicalKey = getFieldTechnicalKey(field);
    const metadata = getFieldMetadata(field);
    const originalKey = field.original_field_key || metadata?.original_field_key || null;

    index.byId.set(field.id, {
      field_id: field.id,
      field_display_name: displayName,
      technical_key: String(technicalKey || "").trim() && technicalKey !== "-" ? technicalKey : null,
      field_area_ha: positiveNumber(field.area),
    });

    put(index.displayMap, normalizeCompact(displayName), field.id);
    put(index.originalMap, normalizeCompact(originalKey), field.id);
    put(index.technicalMap, normalizeCompact(technicalKey), field.id);
    put(index.nameMap, normalizeCompact(field.name), field.id);

    [
      ...fieldAliasVariants(displayName),
      ...fieldAliasVariants(originalKey),
      ...fieldAliasVariants(technicalKey),
      ...fieldAliasVariants(field.name),
    ].forEach((variant) => put(index.aliasMap, variant, field.id));
  });

  return index;
}

function takeExact(map: Map<string, Set<string>>, token: string): Set<string> {
  const ids = map.get(token);
  return ids ? new Set(ids) : new Set();
}

function addSet(target: Set<string>, source: Set<string>) {
  source.forEach((id) => target.add(id));
}

function intersectSets(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set<string>();
  const intersection = new Set(sets[0]);
  for (const candidate of Array.from(intersection)) {
    if (sets.slice(1).some((set) => !set.has(candidate))) {
      intersection.delete(candidate);
    }
  }
  return intersection;
}

function candidateWithArea(
  candidate: FieldMatchCandidate,
  polygonAreaHa: number | null
): FieldMatchCandidate {
  if (polygonAreaHa == null || candidate.field_area_ha == null) {
    return { ...candidate, area_delta_ha: null, area_delta_pct: null };
  }
  const areaDeltaHa = Math.abs(polygonAreaHa - candidate.field_area_ha);
  return {
    ...candidate,
    area_delta_ha: Number(areaDeltaHa.toFixed(4)),
    area_delta_pct: Number(((areaDeltaHa / candidate.field_area_ha) * 100).toFixed(4)),
  };
}

function collectCandidates(
  index: AliasIndex,
  ids: Set<string>,
  polygonAreaHa: number | null
): FieldMatchCandidate[] {
  return Array.from(ids)
    .map((id) => index.byId.get(id))
    .filter((item): item is FieldMatchCandidate => Boolean(item))
    .map((candidate) => candidateWithArea(candidate, polygonAreaHa))
    .sort((first, second) => {
      const firstDelta = first.area_delta_pct;
      const secondDelta = second.area_delta_pct;
      if (firstDelta != null && secondDelta != null && firstDelta !== secondDelta) {
        return firstDelta - secondDelta;
      }
      if (firstDelta != null && secondDelta == null) return -1;
      if (firstDelta == null && secondDelta != null) return 1;
      return first.field_display_name.localeCompare(second.field_display_name, "ru");
    });
}

function createResult(params: {
  status: FieldMatchResult["status"];
  confidence_score: number;
  matched_by: string | null;
  candidates: FieldMatchCandidate[];
  field_id?: string | null;
  field_display_name?: string | null;
  suggested_field_id?: string | null;
  reason_codes?: string[];
}): FieldMatchResult {
  const stage =
    params.status === "matched"
      ? "auto_matched"
      : params.status === "ambiguous"
        ? "manual_required"
        : "unmatched";
  return {
    status: params.status,
    stage,
    confidence_score: Number(params.confidence_score.toFixed(2)),
    matched_by: params.matched_by,
    field_id: params.field_id ?? null,
    field_display_name: params.field_display_name ?? null,
    suggested_field_id: params.suggested_field_id ?? null,
    reason_codes: params.reason_codes || [],
    candidates: params.candidates,
  };
}

function resolveConservativeExact(params: {
  candidates: FieldMatchCandidate[];
  context: FieldMatchContext;
  matchedBy: string;
  confidence: number;
}): FieldMatchResult {
  const { candidates, context, matchedBy, confidence } = params;
  const suggested = candidates[0] || null;
  if ((context.conflict_polygon_ids || []).length > 0) {
    return createResult({
      status: "ambiguous",
      confidence_score: Math.min(confidence, 0.5),
      matched_by: matchedBy,
      suggested_field_id: suggested?.field_id,
      candidates,
      reason_codes: ["geometry_conflict"],
    });
  }

  const polygonAreaHa = positiveNumber(context.area_ha);
  if (polygonAreaHa == null) {
    return createResult({
      status: "ambiguous",
      confidence_score: Math.min(confidence, 0.5),
      matched_by: matchedBy,
      suggested_field_id: suggested?.field_id,
      candidates,
      reason_codes: ["source_area_missing"],
    });
  }
  if (candidates.some((candidate) => candidate.field_area_ha == null)) {
    return createResult({
      status: "ambiguous",
      confidence_score: Math.min(confidence, 0.5),
      matched_by: matchedBy,
      suggested_field_id: suggested?.field_id,
      candidates,
      reason_codes: ["field_area_missing"],
    });
  }

  if (candidates.length === 1) {
    const candidate = candidates[0];
    if ((candidate.area_delta_pct ?? Number.POSITIVE_INFINITY) > UNIQUE_AREA_DELTA_MAX_PCT) {
      return createResult({
        status: "ambiguous",
        confidence_score: Math.min(confidence, 0.5),
        matched_by: matchedBy,
        suggested_field_id: candidate.field_id,
        candidates,
        reason_codes: ["area_mismatch"],
      });
    }
    return createResult({
      status: "matched",
      confidence_score: confidence,
      matched_by: matchedBy + "+area_gate",
      field_id: candidate.field_id,
      field_display_name: candidate.field_display_name,
      suggested_field_id: candidate.field_id,
      candidates,
      reason_codes: ["exact_name", "area_within_3pct"],
    });
  }

  const best = candidates[0];
  const second = candidates[1];
  const bestDeltaPct = best?.area_delta_pct ?? Number.POSITIVE_INFINITY;
  const secondDeltaPct = second?.area_delta_pct ?? Number.POSITIVE_INFINITY;
  const percentageMargin = secondDeltaPct - bestDeltaPct;
  const ratioMargin =
    bestDeltaPct === 0
      ? secondDeltaPct > 0
        ? Number.POSITIVE_INFINITY
        : 1
      : secondDeltaPct / bestDeltaPct;
  if (
    best &&
    second &&
    bestDeltaPct <= DUPLICATE_AREA_DELTA_MAX_PCT &&
    percentageMargin >= DUPLICATE_AREA_MARGIN_MIN_PCT &&
    ratioMargin >= DUPLICATE_AREA_MARGIN_MIN_RATIO
  ) {
    return createResult({
      status: "matched",
      confidence_score: Math.min(confidence, 0.9),
      matched_by: matchedBy + "+area_margin_gate",
      field_id: best.field_id,
      field_display_name: best.field_display_name,
      suggested_field_id: best.field_id,
      candidates,
      reason_codes: ["exact_name", "area_within_5pct", "area_margin_clear"],
    });
  }

  return createResult({
    status: "ambiguous",
    confidence_score: Math.min(confidence, 0.5),
    matched_by: matchedBy,
    suggested_field_id: best?.field_id,
    candidates,
    reason_codes: [
      bestDeltaPct > DUPLICATE_AREA_DELTA_MAX_PCT ? "area_mismatch" : "area_margin_too_small",
    ],
  });
}

export function resolveFieldByPolygonName(
  name: string,
  index: AliasIndex,
  context: FieldMatchContext = {}
): FieldMatchResult {
  const compact = normalizeCompact(name);
  const polygonAreaHa = positiveNumber(context.area_ha);
  const directSteps: Array<{
    map: Map<string, Set<string>>;
    matchedBy: string;
    confidence: number;
  }> = [
    { map: index.displayMap, matchedBy: "display_name_exact", confidence: 1 },
    { map: index.originalMap, matchedBy: "original_field_key_exact", confidence: 0.97 },
    { map: index.technicalMap, matchedBy: "technical_key_exact", confidence: 0.95 },
    { map: index.nameMap, matchedBy: "raw_name_exact", confidence: 0.93 },
  ];

  const exactMatched = new Set<string>();
  const exactSets: Set<string>[] = [];
  const exactMethods: string[] = [];
  let exactConfidence = 0;
  for (const step of directSteps) {
    const matched = takeExact(step.map, compact);
    if (matched.size === 0) continue;
    exactSets.push(matched);
    addSet(exactMatched, matched);
    exactMethods.push(step.matchedBy);
    exactConfidence = Math.max(exactConfidence, step.confidence);
  }
  if (exactMatched.size > 0) {
    const agreed = intersectSets(exactSets);
    const candidateIds = agreed.size > 0 ? agreed : exactMatched;
    return resolveConservativeExact({
      candidates: collectCandidates(index, candidateIds, polygonAreaHa),
      context,
      matchedBy: exactMethods.join("+"),
      confidence: exactConfidence,
    });
  }

  const aliasMatched = new Set<string>();
  fieldAliasVariants(name).forEach((variant) =>
    addSet(aliasMatched, takeExact(index.aliasMap, variant))
  );
  if (aliasMatched.size > 0) {
    return resolveConservativeExact({
      candidates: collectCandidates(index, aliasMatched, polygonAreaHa),
      context,
      matchedBy: "normalized_alias",
      confidence: 0.88,
    });
  }

  if (compact.length >= 2) {
    const fuzzy = new Set<string>();
    index.aliasMap.forEach((ids, key) => {
      if (key.includes(compact) || compact.includes(key)) {
        addSet(fuzzy, ids);
      }
    });
    const candidates = collectCandidates(index, fuzzy, polygonAreaHa).slice(0, 10);
    if (candidates.length > 0) {
      return createResult({
        status: "ambiguous",
        confidence_score: 0.35,
        matched_by: "fuzzy_alias",
        suggested_field_id: candidates[0].field_id,
        candidates,
        reason_codes: [
          "fuzzy_suggestion_only",
          ...((context.conflict_polygon_ids || []).length > 0 ? ["geometry_conflict"] : []),
        ],
      });
    }
  }

  return createResult({
    status: "not_found",
    confidence_score: 0,
    matched_by: null,
    candidates: [],
    reason_codes: [
      "no_candidate",
      ...((context.conflict_polygon_ids || []).length > 0 ? ["geometry_conflict"] : []),
    ],
  });
}
