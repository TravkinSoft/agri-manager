export type GlbdComponentRow = {
  id: string;
  legacy_active_ingredient_id?: string | null;
  canonical_name?: string | null;
  name_ru?: string | null;
  name_en?: string | null;
  component_type?: string | null;
  is_active?: boolean | null;
  archived_at?: string | null;
};

export type GlbdComponentAliasRow = {
  component_id: string;
  alias_text?: string | null;
  normalized_text?: string | null;
  language?: string | null;
};

export type GlbdComponentSearchEntry = GlbdComponentRow & {
  aliases: GlbdComponentAliasRow[];
};

export type GlbdComponentSourceRow = {
  id: string;
  component_id: string;
  source_type?: string | null;
  source_url?: string | null;
  source_title?: string | null;
  claim_scope?: string | null;
  checked_at?: string | null;
};

export type GlbdComponentSourceDisplay = {
  id: string;
  title: string;
  typeLabel: string;
  claimLabels: string[];
  checkedAt: string | null;
  url: string | null;
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  official_registry: "Официальный реестр",
  official_label: "Официальная этикетка",
  manufacturer_site: "Сайт производителя",
  distributor_catalog: "Каталог поставщика",
  scientific_source: "Научный источник",
  internal_existing_data: "Существующие данные каталога",
  owner_verified: "Проверено владельцем каталога",
};

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  active_ingredient: "Действующее вещество",
  safener: "Антидот",
  synergist: "Синергист",
  biological_component: "Биологический компонент",
  formulation_component: "Компонент препаративной формы",
  unknown_component: "Тип уточняется",
};

const CLAIM_SCOPE_LABELS: Record<string, string> = {
  component_name: "Подтверждает название",
  component_identity: "Подтверждает название",
  component_type: "Подтверждает тип компонента",
  concentration: "Подтверждает концентрацию",
  role_in_product: "Подтверждает роль в составе",
  active_role: "Подтверждает роль в составе",
  formulation: "Подтверждает препаративную форму",
};

function nonEmpty(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeGlbdSearchText(value: unknown): string {
  return nonEmpty(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s\-_.,;:/\\()[\]{}'"`«»‐‑‒–—―−]+/g, "")
    .trim();
}

export function glbdComponentDisplayName(component: GlbdComponentRow): string {
  return (
    nonEmpty(component.name_ru) ||
    nonEmpty(component.canonical_name) ||
    nonEmpty(component.name_en) ||
    "Компонент"
  );
}

export function glbdComponentTypeLabel(value: unknown): string {
  const key = nonEmpty(value).toLowerCase();
  return COMPONENT_TYPE_LABELS[key] || "Компонент";
}

export function isVisibleGlbdComponent(component: GlbdComponentRow): boolean {
  return component.is_active !== false && !component.archived_at;
}

export function buildGlbdComponentSearchEntries(
  components: GlbdComponentRow[],
  aliases: GlbdComponentAliasRow[]
): GlbdComponentSearchEntry[] {
  const aliasesByComponent = new Map<string, GlbdComponentAliasRow[]>();
  for (const alias of aliases) {
    if (!alias.component_id) continue;
    const list = aliasesByComponent.get(alias.component_id) || [];
    list.push(alias);
    aliasesByComponent.set(alias.component_id, list);
  }

  return components.map((component) => ({
    ...component,
    aliases: aliasesByComponent.get(component.id) || [],
  }));
}

function componentSearchValues(component: GlbdComponentSearchEntry): string[] {
  return [
    component.canonical_name,
    component.name_ru,
    component.name_en,
    ...component.aliases.flatMap((alias) => [alias.alias_text, alias.normalized_text]),
  ]
    .map(normalizeGlbdSearchText)
    .filter(Boolean);
}

export function glbdComponentMatchesSearch(
  component: GlbdComponentSearchEntry,
  search: unknown
): boolean {
  const needle = normalizeGlbdSearchText(search);
  if (!needle) return true;
  return componentSearchValues(component).some((value) => value.includes(needle));
}

export function matchedGlbdAlias(
  component: GlbdComponentSearchEntry,
  search: unknown
): string | null {
  const needle = normalizeGlbdSearchText(search);
  if (!needle) return null;

  const primaryValues = [component.canonical_name, component.name_ru, component.name_en]
    .map(normalizeGlbdSearchText)
    .filter(Boolean);
  if (primaryValues.some((value) => value.includes(needle))) return null;

  const alias = component.aliases.find((item) =>
    [item.alias_text, item.normalized_text]
      .map(normalizeGlbdSearchText)
      .some((value) => value.includes(needle))
  );
  return alias ? nonEmpty(alias.alias_text) || nonEmpty(alias.normalized_text) || null : null;
}

export function findExactGlbdAliasConflict(
  components: GlbdComponentSearchEntry[],
  search: unknown
): GlbdComponentSearchEntry[] {
  const needle = normalizeGlbdSearchText(search);
  if (!needle) return [];

  return components.filter(
    (component) =>
      isVisibleGlbdComponent(component) &&
      component.aliases.some((alias) =>
        [alias.alias_text, alias.normalized_text]
          .map(normalizeGlbdSearchText)
          .some((value) => value === needle)
      )
  );
}

export function dedupeByCanonicalComponent<T extends { id: string; glbd_component_id?: string | null }>(
  rows: T[]
): T[] {
  const unique = new Map<string, T>();
  for (const row of rows) {
    const key = nonEmpty(row.glbd_component_id) || nonEmpty(row.id);
    if (key && !unique.has(key)) unique.set(key, row);
  }
  return Array.from(unique.values());
}

export function glbdSourceTypeLabel(value: unknown): string {
  const key = nonEmpty(value).toLowerCase();
  return SOURCE_TYPE_LABELS[key] || "Подтверждающий источник";
}

export function localizeGlbdClaimScope(value: unknown): string[] {
  const raw = nonEmpty(value);
  const normalized = raw.toLowerCase();
  if (!normalized) return ["Подтверждает сведения о компоненте"];

  const labels = new Set<string>();
  for (const token of raw.split(/[;,|]+/)) {
    const key = token.trim().toLowerCase().replace(/\s+/g, "_");
    if (CLAIM_SCOPE_LABELS[key]) labels.add(CLAIM_SCOPE_LABELS[key]);
  }

  if (normalized.includes("current ru identity") || normalized.includes("component identity")) {
    labels.add(CLAIM_SCOPE_LABELS.component_name);
  }
  if (normalized.includes("preliminary component classification")) {
    labels.add(CLAIM_SCOPE_LABELS.component_type);
  }
  if (normalized.includes("active role") || normalized.includes("role in product")) {
    labels.add(CLAIM_SCOPE_LABELS.role_in_product);
  }
  if (normalized.includes("concentration") && !normalized.includes("does not confirm product concentration")) {
    labels.add(CLAIM_SCOPE_LABELS.concentration);
  }
  if (normalized.includes("formulation") && !normalized.includes("does not confirm")) {
    labels.add(CLAIM_SCOPE_LABELS.formulation);
  }

  return labels.size ? Array.from(labels) : ["Подтверждает сведения о компоненте"];
}

export function safeGlbdSourceUrl(value: unknown): string | null {
  const raw = nonEmpty(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function glbdSourceTitle(value: unknown, sourceType: unknown): string {
  const title = nonEmpty(value);
  if (title === "Legacy active_ingredients plus owner-reviewed normalized master") {
    return "Существующий каталог и проверенный мастер-список";
  }
  return title || glbdSourceTypeLabel(sourceType);
}

export function toGlbdComponentSourceDisplay(
  source: GlbdComponentSourceRow
): GlbdComponentSourceDisplay | null {
  if (nonEmpty(source.source_type).toLowerCase() === "needs_source") return null;
  return {
    id: source.id,
    title: glbdSourceTitle(source.source_title, source.source_type),
    typeLabel: glbdSourceTypeLabel(source.source_type),
    claimLabels: localizeGlbdClaimScope(source.claim_scope),
    checkedAt: nonEmpty(source.checked_at) || null,
    url: safeGlbdSourceUrl(source.source_url),
  };
}
