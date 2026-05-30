import { getFieldDisplayName, getFieldMetadata, getFieldTechnicalKey } from "@/lib/fields/display";

type FieldSource = {
  id: string;
  name: string;
  notes?: string | null;
  original_field_key?: string | null;
  technical_key?: string | null;
};

export type FieldMatchCandidate = {
  field_id: string;
  field_display_name: string;
  technical_key: string | null;
};

export type FieldMatchResult = {
  status: "matched" | "ambiguous" | "not_found";
  field_id: string | null;
  field_display_name: string | null;
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
    .trim()
    .toLowerCase()
    .replace(/[№#]/gu, "")
    .replace(/\bполе\b/gu, "")
    .replace(/[()[\]{}]/gu, " ")
    .replace(/[\\\/]/gu, "-")
    .replace(/[^0-9a-zа-яё\-\s]/giu, "")
    .replace(/\s+/gu, " ")
    .replace(/-+/gu, "-")
    .trim();
}

function normalizeCompact(value: string | null | undefined): string {
  return normalizeFieldToken(value).replace(/\s+/gu, "");
}

function put(map: Map<string, Set<string>>, key: string, id: string) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set<string>());
  map.get(key)?.add(id);
}

function fieldAliasVariants(value: string | null | undefined): string[] {
  const token = normalizeFieldToken(value);
  const compact = normalizeCompact(value);
  const set = new Set<string>();
  if (token) set.add(token);
  if (compact && compact !== token) set.add(compact);

  const digitGroups = compact.match(/\d+/gu) || [];
  if (digitGroups.length) {
    const joined = digitGroups.join("-");
    set.add(joined);
    const first = digitGroups[0];
    if (first) set.add(first);
  }

  if (/^\d+(?:-\d+)+$/u.test(compact)) {
    set.add(compact.replace(/-\d+$/u, ""));
  }

  if (/^\d+(?:-\d+)+$/u.test(token)) {
    set.add(token.replace(/-\d+$/u, ""));
  }

  return Array.from(set).filter(Boolean);
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
    });

    put(index.displayMap, normalizeCompact(displayName), field.id);
    put(index.originalMap, normalizeCompact(originalKey), field.id);
    put(index.technicalMap, normalizeCompact(technicalKey), field.id);
    put(index.nameMap, normalizeCompact(field.name), field.id);

    const variants = [
      ...fieldAliasVariants(displayName),
      ...fieldAliasVariants(originalKey),
      ...fieldAliasVariants(technicalKey),
      ...fieldAliasVariants(field.name),
    ];
    variants.forEach((variant) => put(index.aliasMap, variant, field.id));
  });

  return index;
}

function collectCandidates(index: AliasIndex, ids: Set<string>): FieldMatchCandidate[] {
  return Array.from(ids)
    .map((id) => index.byId.get(id))
    .filter((item): item is FieldMatchCandidate => Boolean(item))
    .sort((a, b) => a.field_display_name.localeCompare(b.field_display_name, "ru"));
}

function takeExact(map: Map<string, Set<string>>, token: string): Set<string> {
  const ids = map.get(token);
  return ids ? new Set(ids) : new Set();
}

function addSet(target: Set<string>, source: Set<string>) {
  source.forEach((id) => target.add(id));
}

export function resolveFieldByPolygonName(name: string, index: AliasIndex): FieldMatchResult {
  const compact = normalizeCompact(name);
  const aliases = fieldAliasVariants(name);
  const matched = new Set<string>();

  addSet(matched, takeExact(index.displayMap, compact));
  if (matched.size === 0) addSet(matched, takeExact(index.originalMap, compact));
  if (matched.size === 0) addSet(matched, takeExact(index.technicalMap, compact));
  if (matched.size === 0) addSet(matched, takeExact(index.nameMap, compact));

  if (matched.size === 0) {
    aliases.forEach((variant) => addSet(matched, takeExact(index.aliasMap, variant)));
  }

  const candidates = collectCandidates(index, matched);
  if (candidates.length === 1) {
    return {
      status: "matched",
      field_id: candidates[0].field_id,
      field_display_name: candidates[0].field_display_name,
      candidates,
    };
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      field_id: null,
      field_display_name: null,
      candidates,
    };
  }

  return {
    status: "not_found",
    field_id: null,
    field_display_name: null,
    candidates: [],
  };
}
