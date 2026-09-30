import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCatalogName } from "@/lib/catalog/catalog-identity";
import type { KnowledgeExtractionDraft } from "@/lib/knowledge/extraction";

export type KnowledgeDraftTargetType = "disease" | "pest" | "weed" | "unknown";

export type KnowledgeCatalogOption = {
  id: string;
  name: string;
  aliases: string[];
};

export type KnowledgeCatalogTargetOption = KnowledgeCatalogOption & {
  type: Exclude<KnowledgeDraftTargetType, "unknown">;
};

export type KnowledgeDraftCatalogResolution = {
  resolved: {
    active_ingredients: Array<{
      id: string;
      name: string;
      concentration: string | null;
      raw: string;
      confidence: number;
    }>;
    crops: Array<{
      id: string;
      name: string;
      raw: string;
      confidence: number;
    }>;
    targets: Array<{
      type: KnowledgeDraftTargetType;
      id: string | null;
      name: string;
      raw: string;
      confidence: number;
    }>;
  };
  unresolved: {
    active_ingredients: Array<{
      name: string;
      concentration: string | null;
      raw: string;
      reason: string;
    }>;
    crops: Array<{
      raw: string;
      reason: string;
    }>;
    targets: Array<{
      type: "unknown";
      raw: string;
      reason: string;
    }>;
  };
  inferred: {
    product_type: KnowledgeExtractionDraft["product_type"] | null;
    subcategory: string | null;
    stock_unit: KnowledgeExtractionDraft["stock_unit"] | null;
    default_rate_type: KnowledgeExtractionDraft["default_rate_type"] | null;
    default_rate_unit: string | null;
  };
  options: {
    active_ingredients: KnowledgeCatalogOption[];
    crops: KnowledgeCatalogOption[];
    targets: KnowledgeCatalogTargetOption[];
  };
};

type CatalogRef = {
  id: string;
  name: string;
  aliases: string[];
  normalizedAliases: string[];
};

type CatalogTargetRef = CatalogRef & {
  type: Exclude<KnowledgeDraftTargetType, "unknown">;
};

type CatalogReferences = {
  activeIngredients: CatalogRef[];
  crops: CatalogRef[];
  targets: CatalogTargetRef[];
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function uniqueTexts(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const next = text(value);
    if (!next) continue;
    const key = normalizeCatalogName(next);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

function normalized(value: unknown): string {
  return normalizeCatalogName(text(value)) || "";
}

function isVisibleCatalogRow(row: Record<string, unknown>): boolean {
  return row.archived !== true && row.is_active !== false;
}

function rowAliases(row: Record<string, unknown>): string[] {
  const glbdAliases = Array.isArray(row.glbd_aliases)
    ? row.glbd_aliases.map((value) => text(value))
    : [];
  return uniqueTexts([
    text(row.name),
    text(row.name_ru),
    text(row.name_en),
    text(row.latin_name),
    text(row.normalized_name),
    text(row.slug),
    ...glbdAliases,
  ]);
}

function rowDisplayName(row: Record<string, unknown>): string {
  return (
    text(row.name_ru) ||
    text(row.name) ||
    text(row.name_en) ||
    text(row.latin_name) ||
    text(row.slug) ||
    text(row.id)
  );
}

function toCatalogRef(row: Record<string, unknown>): CatalogRef | null {
  const id = text(row.id);
  if (!id || !isVisibleCatalogRow(row)) return null;
  const name = rowDisplayName(row);
  const aliases = rowAliases(row);
  if (!name || !aliases.length) return null;
  return {
    id,
    name,
    aliases,
    normalizedAliases: aliases.map(normalized).filter(Boolean),
  };
}

function toTargetRef(type: Exclude<KnowledgeDraftTargetType, "unknown">, row: Record<string, unknown>): CatalogTargetRef | null {
  const ref = toCatalogRef(row);
  return ref ? { ...ref, type } : null;
}

async function loadRows(supabase: SupabaseClient, table: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.from(table).select("*").limit(2000);
  if (error) throw new Error(`Failed to load ${table}: ${error.message}`);
  return (data || []) as Record<string, unknown>[];
}

export async function loadKnowledgeCatalogReferences(supabase: SupabaseClient): Promise<CatalogReferences> {
  const [
    activeIngredientsRows,
    glbdComponentsResult,
    glbdAliasesResult,
    cropRows,
    diseaseRows,
    pestRows,
    weedRows,
  ] = await Promise.all([
    loadRows(supabase, "active_ingredients"),
    supabase
      .from("glbd_components")
      .select("id,legacy_active_ingredient_id,canonical_name,name_ru,name_en")
      .eq("is_active", true)
      .is("archived_at", null),
    supabase
      .from("glbd_component_aliases")
      .select("component_id,alias_text,normalized_text"),
    loadRows(supabase, "crops"),
    loadRows(supabase, "diseases"),
    loadRows(supabase, "pests"),
    loadRows(supabase, "weeds"),
  ]);

  if (glbdComponentsResult.error) {
    throw new Error(`Failed to load glbd_components: ${glbdComponentsResult.error.message}`);
  }
  if (glbdAliasesResult.error) {
    throw new Error(`Failed to load glbd_component_aliases: ${glbdAliasesResult.error.message}`);
  }

  const aliasesByComponent = new Map<string, string[]>();
  for (const alias of glbdAliasesResult.data || []) {
    const list = aliasesByComponent.get(alias.component_id) || [];
    list.push(alias.alias_text, alias.normalized_text);
    aliasesByComponent.set(alias.component_id, list);
  }

  const componentByLegacyId = new Map<string, any>();
  for (const component of glbdComponentsResult.data || []) {
    if (component.legacy_active_ingredient_id) {
      componentByLegacyId.set(component.legacy_active_ingredient_id, component);
    }
  }

  const enrichedActiveIngredientRows = activeIngredientsRows.map((row) => {
    const component = componentByLegacyId.get(text(row.id));
    if (!component) return row;
    return {
      ...row,
      name_ru: component.name_ru || row.name_ru,
      name_en: component.name_en || row.name_en,
      glbd_aliases: uniqueTexts([
        component.canonical_name,
        component.name_ru,
        component.name_en,
        ...(aliasesByComponent.get(component.id) || []),
      ]),
    };
  });

  return {
    activeIngredients: enrichedActiveIngredientRows.map(toCatalogRef).filter(Boolean) as CatalogRef[],
    crops: cropRows.map(toCatalogRef).filter(Boolean) as CatalogRef[],
    targets: [
      ...(diseaseRows.map((row) => toTargetRef("disease", row)).filter(Boolean) as CatalogTargetRef[]),
      ...(pestRows.map((row) => toTargetRef("pest", row)).filter(Boolean) as CatalogTargetRef[]),
      ...(weedRows.map((row) => toTargetRef("weed", row)).filter(Boolean) as CatalogTargetRef[]),
    ],
  };
}

export function catalogReferencesToOptions(refs: CatalogReferences): KnowledgeDraftCatalogResolution["options"] {
  const option = (ref: CatalogRef): KnowledgeCatalogOption => ({
    id: ref.id,
    name: ref.name,
    aliases: ref.aliases,
  });
  return {
    active_ingredients: refs.activeIngredients.map(option).sort((a, b) => a.name.localeCompare(b.name, "ru")),
    crops: refs.crops.map(option).sort((a, b) => a.name.localeCompare(b.name, "ru")),
    targets: refs.targets
      .map((ref) => ({ ...option(ref), type: ref.type }))
      .sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`, "ru")),
  };
}

function splitRawList(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    for (const part of text(value).split(/\s*(?:[,;]|\n|\r)\s*/)) {
      const next = part.trim();
      if (next) out.push(next);
    }
  }
  return uniqueTexts(out);
}

function splitIngredient(value: { name: string; concentration: string | null }) {
  const raw = text(value.name);
  const explicitConcentration = text(value.concentration);
  const concentrationMatch = raw.match(/(.+?)\s+((?:\d+[,.]?\d*)\s*(?:г|g|гр|mg|мг|мл|ml|л|l)\/\s*(?:л|l|кг|kg|га|ha))/i);
  if (!concentrationMatch) {
    return {
      raw,
      name: raw,
      concentration: explicitConcentration || null,
    };
  }

  return {
    raw,
    name: text(concentrationMatch[1]) || raw,
    concentration: explicitConcentration || text(concentrationMatch[2]) || null,
  };
}

function cropSearchTerms(raw: string): string[] {
  const norm = normalized(raw);
  const terms = [raw];
  if (/пшени|wheat/.test(norm)) terms.push("Пшеница", "Wheat");
  if (/ячмен|barley/.test(norm)) terms.push("Ячмень", "Barley");
  if (/рож|rye/.test(norm)) terms.push("Рожь", "Rye");
  if (/овес|овёс|oat/.test(norm)) terms.push("Овёс", "Овес", "Oat", "Oats");
  return uniqueTexts(terms);
}

function targetSearchTerms(raw: string): string[] {
  const norm = normalized(raw);
  const terms = [raw];
  if (/септори|septoria/.test(norm)) terms.push("Септориоз", "Septoria");
  if (/мучнист|powdery mildew/.test(norm)) terms.push("Мучнистая роса", "Powdery mildew");
  if (/ржав|rust/.test(norm)) terms.push("Ржавчина", "Rust");
  if (/гельминт|helminth/.test(norm)) terms.push("Гельминтоспориоз", "Helminthosporium");
  return uniqueTexts(terms);
}

function matchRef<T extends CatalogRef>(raw: string, refs: T[], extraTerms: string[] = []): { ref: T; confidence: number } | null {
  const terms = uniqueTexts([raw, ...extraTerms]);
  const normalizedTerms = terms.map(normalized).filter(Boolean);
  if (!normalizedTerms.length) return null;

  for (const term of normalizedTerms) {
    const exact = refs.find((ref) => ref.normalizedAliases.includes(term));
    if (exact) return { ref: exact, confidence: 1 };
  }

  for (const term of normalizedTerms) {
    const contains = refs.find((ref) =>
      ref.normalizedAliases.some((alias) => alias.length >= 4 && term.length >= 4 && (alias.includes(term) || term.includes(alias)))
    );
    if (contains) return { ref: contains, confidence: 0.86 };
  }

  return null;
}

function matchTarget(raw: string, refs: CatalogTargetRef[], preferDiseases: boolean) {
  const sortedRefs = preferDiseases
    ? [...refs.filter((ref) => ref.type === "disease"), ...refs.filter((ref) => ref.type !== "disease")]
    : refs;
  return matchRef(raw, sortedRefs, targetSearchTerms(raw));
}

function sourceText(draft: KnowledgeExtractionDraft, extraSourceText?: string): string {
  return [
    draft.trade_name,
    draft.manufacturer,
    draft.product_type,
    draft.subcategory,
    draft.human_description,
    ...draft.application_rules,
    ...draft.admin_warnings,
    ...draft.missing_fields,
    ...draft.notes,
    ...draft.targets,
    extraSourceText,
  ]
    .map(text)
    .filter(Boolean)
    .join("\n");
}

function inferFields(
  draft: KnowledgeExtractionDraft,
  extraSourceText?: string
): KnowledgeDraftCatalogResolution["inferred"] {
  const combined = sourceText(draft, extraSourceText);
  const norm = normalized(combined);
  const next = {
    product_type: draft.product_type,
    subcategory: draft.subcategory,
    stock_unit: draft.stock_unit,
    default_rate_type: draft.default_rate_type,
    default_rate_unit: draft.default_rate_unit,
  };

  if (!next.product_type && /(фунгицид|fungicide|болезн)/.test(norm)) next.product_type = "pesticide";
  if ((!next.subcategory || next.subcategory === "unknown") && /(фунгицид|fungicide|болезн)/.test(norm)) {
    next.subcategory = "fungicide";
  }
  if (!next.stock_unit && /(л\/га|l\/ha|литр)/i.test(combined)) next.stock_unit = "l";
  if ((!next.default_rate_type || next.default_rate_type === "manual") && /(л\/га|l\/ha)/i.test(combined)) {
    next.default_rate_type = "per_ha";
    next.default_rate_unit = "l/ha";
    next.stock_unit = next.stock_unit || "l";
  }

  return next;
}

function emptyResolution(options: KnowledgeDraftCatalogResolution["options"]): KnowledgeDraftCatalogResolution {
  return {
    resolved: {
      active_ingredients: [],
      crops: [],
      targets: [],
    },
    unresolved: {
      active_ingredients: [],
      crops: [],
      targets: [],
    },
    inferred: {
      product_type: null,
      subcategory: null,
      stock_unit: null,
      default_rate_type: null,
      default_rate_unit: null,
    },
    options,
  };
}

export async function loadKnowledgeCatalogOptions(
  supabase: SupabaseClient
): Promise<KnowledgeDraftCatalogResolution["options"]> {
  return catalogReferencesToOptions(await loadKnowledgeCatalogReferences(supabase));
}

export async function resolveKnowledgeExtractionDraft(
  supabase: SupabaseClient,
  draft: KnowledgeExtractionDraft,
  options?: { sourceText?: string }
): Promise<KnowledgeDraftCatalogResolution> {
  const refs = await loadKnowledgeCatalogReferences(supabase);
  const resolution = emptyResolution(catalogReferencesToOptions(refs));
  resolution.inferred = inferFields(draft, options?.sourceText);

  const seenIngredients = new Set<string>();
  for (const item of draft.active_ingredients) {
    const ingredient = splitIngredient(item);
    if (!ingredient.name) continue;
    const key = normalized(`${ingredient.name}|${ingredient.concentration || ""}`);
    if (seenIngredients.has(key)) continue;
    seenIngredients.add(key);
    const match = matchRef(ingredient.name, refs.activeIngredients);
    if (match) {
      resolution.resolved.active_ingredients.push({
        id: match.ref.id,
        name: match.ref.name,
        concentration: ingredient.concentration,
        raw: ingredient.raw,
        confidence: match.confidence,
      });
    } else {
      resolution.unresolved.active_ingredients.push({
        name: ingredient.name,
        concentration: ingredient.concentration,
        raw: ingredient.raw,
        reason: "Не найдено в справочнике ДВ",
      });
    }
  }

  const seenCrops = new Set<string>();
  for (const raw of splitRawList(draft.crops)) {
    const match = matchRef(raw, refs.crops, cropSearchTerms(raw));
    if (match) {
      if (seenCrops.has(match.ref.id)) continue;
      seenCrops.add(match.ref.id);
      resolution.resolved.crops.push({
        id: match.ref.id,
        name: match.ref.name,
        raw,
        confidence: match.confidence,
      });
    } else {
      resolution.unresolved.crops.push({
        raw,
        reason: "Не найдено в справочнике культур",
      });
    }
  }

  const preferDiseases =
    resolution.inferred.subcategory === "fungicide" || normalized(draft.subcategory).includes("fungicide");
  const seenTargets = new Set<string>();
  for (const raw of splitRawList(draft.targets)) {
    const match = matchTarget(raw, refs.targets, preferDiseases);
    if (match && "type" in match.ref) {
      const targetRef = match.ref as CatalogTargetRef;
      if (seenTargets.has(`${targetRef.type}:${targetRef.id}`)) continue;
      seenTargets.add(`${targetRef.type}:${targetRef.id}`);
      resolution.resolved.targets.push({
        type: targetRef.type,
        id: targetRef.id,
        name: targetRef.name,
        raw,
        confidence: match.confidence,
      });
    } else {
      resolution.unresolved.targets.push({
        type: "unknown",
        raw,
        reason: "Не найдено в справочниках болезней/вредителей/сорняков",
      });
    }
  }

  return resolution;
}
