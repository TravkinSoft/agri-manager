import type { AssistantToolContext, AssistantToolDefinition, AssistantToolName } from "@/lib/assistant/engine/types";
import { getFieldDisplayName } from "@/lib/fields/display";
import {
  findCropAliasesInText,
  findCropGroupsInText,
  getAgroTaxonomySnapshot,
  listCropsByGroup,
  resolveKnownCropAlias,
} from "@/lib/assistant/agro-taxonomy";
import { applySemanticExpansions } from "@/lib/assistant/knowledge/semantic-memory";
import { getAssistantRouteRegistry } from "@/lib/assistant/route-registry";

const DEFAULT_SEASON_YEAR = "2026";

const WAREHOUSE_ALIAS_RULES_V2: Array<{ match: RegExp; normalized: string }> = [
  { match: /(овощн|картофел|картофелехранил|хранилищ|vegetable)/i, normalized: "овощной склад" },
  { match: /(семенн|seed)/i, normalized: "склад семян" },
  { match: /(зернов|grain)/i, normalized: "зерновой склад" },
  { match: /(удобр|fertiliz|диам|dap|аммоф)/i, normalized: "склад удобрений" },
  { match: /(сзр|хим|pestic|fungic|гербиц)/i, normalized: "склад сзр" },
];

const WAREHOUSE_ALIAS_RULES: Array<{ match: RegExp; normalized: string }> = [
  { match: /(овощн|картофельн|картофелехранил|хранилищ)/i, normalized: "овощной склад" },
  { match: /(семенн|seed)/i, normalized: "склад семян" },
  { match: /(зернов|grain)/i, normalized: "зерновой склад" },
  { match: /(удобр|fertiliz|диам|dap|аммоф)/i, normalized: "склад удобрений" },
  { match: /(сзр|хим|pestic|фунгиц|гербиц)/i, normalized: "склад сзр" },
];

function cleanString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length ? text : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isMissingRelationError(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return text.includes("does not exist") || text.includes("schema cache") || text.includes("not found");
}

function normalizeSearchText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,!?;:()"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBoolish(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = normalizeSearchText(value);
  return text === "true" || text === "1" || text === "yes";
}

function resolveWarehouseAliasQuery(raw: string | null): string | null {
  const text = normalizeSearchText(raw);
  if (!text) return null;
  for (const rule of WAREHOUSE_ALIAS_RULES_V2) {
    if (rule.match.test(text)) {
      return rule.normalized;
    }
  }
  for (const rule of WAREHOUSE_ALIAS_RULES) {
    if (rule.match.test(text)) {
      return rule.normalized;
    }
  }
  return cleanString(raw);
}

function normalizeTicketStatuses(rawStatus: string | null): string[] {
  const status = normalizeSearchText(rawStatus);
  if (!status) return [];

  if (["active", "open", "открыт", "открытые", "не закрыт", "незакрытые"].includes(status)) {
    return ["draft", "active", "ready_to_close"];
  }
  if (["finalized", "closed", "закрыт", "закрытые", "completed"].includes(status)) {
    return ["finalized"];
  }
  if (["voided", "void", "storno", "сторно", "аннулирован"].includes(status)) {
    return ["voided"];
  }
  if (["draft", "ready_to_close"].includes(status)) {
    return [status];
  }
  return [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value && value.trim().length > 0)));
}

function cropAliasToSearchTerms(alias: string): string[] {
  const key = normalizeSearchText(alias);
  if (!key) return [];
  const map: Record<string, string[]> = {
    potato: ["potato", "картофель", "картофеля", "seed potato", "семенной картофель"],
    gala: ["gala", "гала"],
    soraya: ["soraya", "сорая"],
    "baltic rose": ["baltic rose", "балтик роуз"],
    azilit: ["azilit", "азилит"],
    colombo: ["colombo", "коломбо"],
    impala: ["impala", "импала"],
    "диаммофоска": ["диаммофоска", "диамофоска", "dap", "аммофос", "аммофоска"],
    wheat: ["wheat", "пшеница"],
    barley: ["barley", "ячмень"],
    corn: ["corn", "кукуруза"],
  };
  return map[key] || [key];
}

function buildSearchTerms(value: string | null): string[] {
  const expanded = value ? applySemanticExpansions(value) : value;
  const normalized = normalizeSearchText(expanded);
  if (!normalized) return [];
  const stopwords = new Set([
    "и",
    "в",
    "во",
    "на",
    "по",
    "с",
    "со",
    "у",
    "к",
    "за",
    "что",
    "как",
    "есть",
    "ли",
    "мне",
    "покажи",
    "сколько",
    "наличие",
    "остатки",
    "остаток",
    "show",
    "with",
    "for",
    "have",
    "stock",
  ]);

  const tokens = normalized.split(" ").filter(Boolean);
  const terms = new Set<string>();
  terms.add(normalized);
  tokens
    .filter((token) => token.length > 2 && !stopwords.has(token))
    .forEach((token) => terms.add(token));

  for (let index = 0; index < tokens.length - 1; index += 1) {
    terms.add(`${tokens[index]} ${tokens[index + 1]}`);
  }

  const aliases = findCropAliasesInText(normalized);
  aliases.forEach((alias) => {
    terms.add(normalizeSearchText(alias));
    cropAliasToSearchTerms(alias).forEach((item) => terms.add(normalizeSearchText(item)));
  });
  const known = resolveKnownCropAlias(normalized);
  if (known) {
    terms.add(normalizeSearchText(known));
    cropAliasToSearchTerms(known).forEach((item) => terms.add(normalizeSearchText(item)));
  }

  return Array.from(terms).filter((term) => term.length > 0);
}

function matchesAnyTerm(haystack: unknown, terms: string[]): boolean {
  if (!terms.length) return true;
  const text = normalizeSearchText(haystack);
  if (!text) return false;
  return terms.some((term) => term && text.includes(term));
}

function inferAclResult(context: AssistantToolContext): string {
  if (context.actor.role === "global_admin") return "global_admin_context";
  if (context.actor.homeCompanyId && context.actor.homeCompanyId === context.companyId) return "company_scope_home_match";
  if (context.actor.contextCompanyId && context.actor.contextCompanyId === context.companyId) {
    return "company_scope_context_match";
  }
  return "company_scope_unverified";
}

function logToolEvent(
  context: AssistantToolContext,
  toolName: string,
  phase: "start" | "success" | "error",
  details: Record<string, unknown>
) {
  const payload = {
    ts: nowIso(),
    tool: toolName,
    phase,
    company_id: context.companyId,
    user_id: context.actor.id,
    role: context.actor.role,
    acl_result: inferAclResult(context),
    ...details,
  };

  if (phase === "error") {
    console.error("[assistant-tool]", payload);
    return;
  }
  console.info("[assistant-tool]", payload);
}

function parseSearchQuery(context: AssistantToolContext): string | null {
  const raw =
    cleanString(context.intent.parameters.query) ||
    cleanString(context.intent.parameters.entityQuery) ||
    cleanString(context.runtimeContext.filters.search) ||
    context.sessionState.lastCrop ||
    null;
  return raw ? applySemanticExpansions(raw) : null;
}

function parseLimit(value: unknown, fallback = 30, min = 1, max = 300): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function parseFieldQueryFromContext(context: AssistantToolContext): string | null {
  const explicitField = cleanString(context.intent.parameters.field);
  if (explicitField) return explicitField;

  const explicitEntityQuery = cleanString(context.intent.parameters.entityQuery);
  if (explicitEntityQuery) return explicitEntityQuery;

  const fromQuery = parseSearchQuery(context);
  if (fromQuery) {
    const normalized = normalizeSearchText(fromQuery);
    const codeMatch = normalized.match(/\b\d{1,3}(?:-\d{1,3}){0,2}\b/);
    if (codeMatch?.[0]) return codeMatch[0];

    const withoutPrefix = normalized
      .replace(/^(что на|что по|покажи|открой|поле|fields?|field)\s+/i, "")
      .trim();
    const genericFieldQuery =
      /^(поля|поле|какие есть поля|какие поля|список полей|сколько полей|все поля)$/i.test(normalized) ||
      /^(fields?|field list|all fields)$/i.test(normalized);

    if (!genericFieldQuery && withoutPrefix.length > 0 && withoutPrefix.length <= 48) {
      return withoutPrefix;
    }
  }

  const entity = context.runtimeContext.entity;
  if (entity?.type?.toLowerCase() === "fields" || entity?.type?.toLowerCase() === "field") {
    return cleanString(entity.label) || cleanString(entity.id);
  }

  const fieldFromFilter =
    cleanString(context.runtimeContext.selectedFieldId) ||
    cleanString(context.runtimeContext.filters.field) ||
    cleanString(context.runtimeContext.filters.fieldId);
  if (fieldFromFilter) return fieldFromFilter;

  return null;
}

function parseFieldQueryFromContextV2(context: AssistantToolContext): string | null {
  const explicitField = cleanString(context.intent.parameters.field);
  if (explicitField) return explicitField;

  const explicitEntityQuery = cleanString(context.intent.parameters.entityQuery);
  if (explicitEntityQuery) return explicitEntityQuery;

  const fromQuery = parseSearchQuery(context);
  if (fromQuery) {
    const normalized = normalizeSearchText(fromQuery);
    const codeMatch = normalized.match(/\b\d{1,3}(?:-\d{1,3}){0,2}\b/);
    if (codeMatch?.[0]) return codeMatch[0];

    const withoutPrefix = normalized
      .replace(/^(что на|что по|покажи|открой|поле|fields?|field)\s+/i, "")
      .trim();
    const genericFieldQuery =
      /^(поля|поле|какие есть поля|какие поля|список полей|сколько полей|все поля)$/i.test(normalized) ||
      /^(fields?|field list|all fields)$/i.test(normalized);

    if (!genericFieldQuery && withoutPrefix.length > 0 && withoutPrefix.length <= 48) {
      return withoutPrefix;
    }
  }

  const entity = context.runtimeContext.entity;
  if (entity?.type?.toLowerCase() === "fields" || entity?.type?.toLowerCase() === "field") {
    return cleanString(entity.label) || cleanString(entity.id);
  }

  const fieldFromFilter =
    cleanString(context.runtimeContext.selectedFieldId) ||
    cleanString(context.runtimeContext.filters.field) ||
    cleanString(context.runtimeContext.filters.fieldId);
  if (fieldFromFilter) return fieldFromFilter;

  return null;
}

function parseFiltersJsonSafe(value: unknown): Record<string, string> {
  const raw = cleanString(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    Object.entries(parsed || {}).forEach(([key, val]) => {
      const text = cleanString(val);
      if (text) out[key] = text;
    });
    return out;
  } catch {
    return {};
  }
}

function applyTextFilter(rows: Array<Record<string, unknown>>, query: string | null): Array<Record<string, unknown>> {
  const text = cleanString(query)?.toLowerCase();
  if (!text) return rows;
  return rows.filter((row) => Object.values(row).some((value) => String(value || "").toLowerCase().includes(text)));
}

async function getCurrentSeason(companyId: string, context: AssistantToolContext): Promise<string | null> {
  const seasonHint = cleanString(context.runtimeContext.season) || context.sessionState.lastSeason || null;

  if (seasonHint) {
    const numericHint = Number(seasonHint);
    if (Number.isFinite(numericHint)) {
      const byYear = await context.supabase
        .from("seasons")
        .select("year")
        .eq("company_id", companyId)
        .eq("year", Math.trunc(numericHint))
        .limit(1)
        .maybeSingle();
      if (!byYear.error && byYear.data?.year != null) {
        return String(byYear.data.year);
      }
    }
  }

  const default2026 = await context.supabase
    .from("seasons")
    .select("year")
    .eq("company_id", companyId)
    .eq("year", Number(DEFAULT_SEASON_YEAR))
    .limit(1)
    .maybeSingle();
  if (!default2026.error && default2026.data?.year != null) {
    return String(default2026.data.year);
  }

  const latestSeason = await context.supabase
    .from("seasons")
    .select("year")
    .eq("company_id", companyId)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latestSeason.error && latestSeason.data?.year != null) {
    return String(latestSeason.data.year);
  }

  const cropRes = await context.supabase
    .from("crop_structure")
    .select("season_id,seasons:season_id(year)")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!cropRes.error && (cropRes.data || []).length > 0) {
    const yearFromJoin = cleanString((cropRes.data?.[0] as any)?.seasons?.year);
    if (yearFromJoin) return yearFromJoin;
  }

  const fallbackOldSeasonYear = await context.supabase
    .from("crop_structure")
    .select("season_year")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("season_year", { ascending: false })
    .limit(1);

  if (!fallbackOldSeasonYear.error && (fallbackOldSeasonYear.data || []).length > 0) {
    return cleanString((fallbackOldSeasonYear.data?.[0] as any)?.season_year);
  }

  const fallbackOldSeason = await context.supabase
    .from("crop_structure")
    .select("season")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("season", { ascending: false })
    .limit(1);

  if (!fallbackOldSeason.error && (fallbackOldSeason.data || []).length > 0) {
    return cleanString((fallbackOldSeason.data?.[0] as any)?.season);
  }

  return null;
}

async function resolveSeasonContext(companyId: string, context: AssistantToolContext): Promise<{ seasonYear: string | null; seasonId: string | null; source: string }> {
  const hint = cleanString(context.runtimeContext.season) || context.sessionState.lastSeason || null;

  if (hint) {
    const byId = await context.supabase
      .from("seasons")
      .select("id,year")
      .eq("company_id", companyId)
      .eq("id", hint)
      .limit(1)
      .maybeSingle();
    if (!byId.error && byId.data) {
      return { seasonYear: cleanString(byId.data.year), seasonId: cleanString(byId.data.id), source: "runtime_season_id" };
    }

    const numericHint = Number(hint);
    if (Number.isFinite(numericHint)) {
      const byYear = await context.supabase
        .from("seasons")
        .select("id,year")
        .eq("company_id", companyId)
        .eq("year", Math.trunc(numericHint))
        .limit(1)
        .maybeSingle();
      if (!byYear.error && byYear.data) {
        return { seasonYear: cleanString(byYear.data.year), seasonId: cleanString(byYear.data.id), source: "runtime_year" };
      }
    }
  }

  const byDefault2026 = await context.supabase
    .from("seasons")
    .select("id,year")
    .eq("company_id", companyId)
    .eq("year", Number(DEFAULT_SEASON_YEAR))
    .limit(1)
    .maybeSingle();
  if (!byDefault2026.error && byDefault2026.data) {
    return { seasonYear: cleanString(byDefault2026.data.year), seasonId: cleanString(byDefault2026.data.id), source: "default_2026" };
  }

  const latest = await context.supabase
    .from("seasons")
    .select("id,year")
    .eq("company_id", companyId)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest.error && latest.data) {
    return { seasonYear: cleanString(latest.data.year), seasonId: cleanString(latest.data.id), source: "latest_season" };
  }

  const bySeasonYear = await context.supabase
    .from("crop_structure")
    .select("season_year")
    .eq("company_id", companyId)
    .order("season_year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!bySeasonYear.error && bySeasonYear.data && cleanString((bySeasonYear.data as any).season_year)) {
    return {
      seasonYear: cleanString((bySeasonYear.data as any).season_year),
      seasonId: null,
      source: "crop_structure_season_year",
    };
  }

  const bySeason = await context.supabase
    .from("crop_structure")
    .select("season")
    .eq("company_id", companyId)
    .order("season", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!bySeason.error && bySeason.data && cleanString((bySeason.data as any).season)) {
    return {
      seasonYear: cleanString((bySeason.data as any).season),
      seasonId: null,
      source: "crop_structure_season",
    };
  }

  return { seasonYear: null, seasonId: null, source: "seasons_not_found" };
}

async function buildLookupMaps(
  context: AssistantToolContext,
  ids: {
    warehouses?: string[];
    products?: string[];
    crops?: string[];
    varieties?: string[];
    reproductions?: string[];
    fields?: string[];
    fuelSources?: string[];
  }
) {
  const [warehousesRes, productsRes, cropsRes, varietiesRes, reproductionsRes, fieldsRes, fuelSourcesRes] = await Promise.all([
    (ids.warehouses || []).length
      ? context.supabase.from("warehouses").select("id,name").in("id", ids.warehouses as string[])
      : Promise.resolve({ data: [], error: null } as any),
    (ids.products || []).length
      ? context.supabase.from("products").select("id,name,trade_name").in("id", ids.products as string[])
      : Promise.resolve({ data: [], error: null } as any),
    (ids.crops || []).length
      ? context.supabase.from("crops").select("id,name,name_ru,name_en").in("id", ids.crops as string[])
      : Promise.resolve({ data: [], error: null } as any),
    (ids.varieties || []).length
      ? context.supabase.from("varieties").select("id,name").in("id", ids.varieties as string[])
      : Promise.resolve({ data: [], error: null } as any),
    (ids.reproductions || []).length
      ? context.supabase.from("seed_reproductions").select("id,name").in("id", ids.reproductions as string[])
      : Promise.resolve({ data: [], error: null } as any),
    (ids.fields || []).length
      ? context.supabase.from("fields").select("id,name,notes").in("id", ids.fields as string[])
      : Promise.resolve({ data: [], error: null } as any),
    (ids.fuelSources || []).length
      ? context.supabase.from("fuel_sources").select("id,name").in("id", ids.fuelSources as string[])
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const byWarehouse = new Map<string, string>();
  (warehousesRes.data || []).forEach((row: any) => byWarehouse.set(String(row.id), String(row.name || row.id)));

  const byProduct = new Map<string, string>();
  (productsRes.data || []).forEach((row: any) =>
    byProduct.set(String(row.id), String(row.trade_name || row.name || row.id))
  );

  const byCrop = new Map<string, string>();
  (cropsRes.data || []).forEach((row: any) =>
    byCrop.set(String(row.id), String(row.name_ru || row.name || row.name_en || row.id))
  );

  const byVariety = new Map<string, string>();
  (varietiesRes.data || []).forEach((row: any) => byVariety.set(String(row.id), String(row.name || row.id)));

  const byReproduction = new Map<string, string>();
  (reproductionsRes.data || []).forEach((row: any) => byReproduction.set(String(row.id), String(row.name || row.id)));

  const byField = new Map<string, string>();
  (fieldsRes.data || []).forEach((row: any) => byField.set(String(row.id), getFieldDisplayName(row) || String(row.id)));

  const byFuelSource = new Map<string, string>();
  (fuelSourcesRes.data || []).forEach((row: any) => byFuelSource.set(String(row.id), String(row.name || row.id)));

  return { byWarehouse, byProduct, byCrop, byVariety, byReproduction, byField, byFuelSource };
}

const getCompanyContextTool: AssistantToolDefinition = {
  name: "get_company_context",
  description: "Текущий контекст компании и сезона",
  domains: ["company", "season"],
  run: async (context) => {
    const companyRes = await context.supabase.from("companies").select("id,name").eq("id", context.companyId).maybeSingle();
    const season = await getCurrentSeason(context.companyId, context);
    return {
      title: "Контекст компании",
      rows: [
        {
          company_id: context.companyId,
          company_name: companyRes.data?.name || context.companyId,
          season: season || "-",
        },
      ],
      source: {
        module: "assistant",
        tableOrView: "companies + seasons/crop_structure",
        season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getCurrentSeasonTool: AssistantToolDefinition = {
  name: "get_current_season",
  description: "Активный сезон компании",
  domains: ["season"],
  run: async (context) => {
    const season = await getCurrentSeason(context.companyId, context);
    return {
      title: "Активный сезон",
      rows: [{ season }],
      source: {
        module: "assistant",
        tableOrView: "seasons/crop_structure",
        season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getWarehouseBalancesTool: AssistantToolDefinition = {
  name: "get_warehouse_balances",
  description: "Identity-aware остатки по складам",
  domains: ["inventory", "warehouses", "batches", "identity"],
  run: async (context) => {
    const searchQuery = parseSearchQuery(context);
    const explicitProduct =
      cleanString(context.intent.parameters.product) ||
      cleanString(context.intent.parameters.crop) ||
      cleanString(context.intent.parameters.crop_alias);
    const rawWarehouseQuery =
      cleanString(context.intent.parameters.warehouse) ||
      cleanString(context.intent.parameters.warehouse_alias) ||
      cleanString(context.runtimeContext.filters.warehouse);
    const explicitWarehouse = resolveWarehouseAliasQuery(rawWarehouseQuery);
    const allWarehouses = parseBoolish(context.intent.parameters.allWarehouses) || !explicitWarehouse;
    const negativeOnly = parseBoolish(context.intent.parameters.negative_only);
    const queryAliasHint = searchQuery
      ? resolveKnownCropAlias(searchQuery) || findCropAliasesInText(searchQuery)[0] || null
      : null;
    const queryMaterialHint = (() => {
      const normalized = normalizeSearchText(searchQuery || "");
      if (!normalized) return null;
      if (/(\u0443\u0434\u043e\u0431\u0440|fertiliz|dap|\u0430\u043c\u043c\u043e\u0444)/.test(normalized)) return "удобрение";
      if (/(\u0441\u0437\u0440|\u0445\u0438\u043c|pestic|fungic|herbic)/.test(normalized)) return "сзр";
      if (/(\u0441\u0435\u043c\u044f\u043d|seed)/.test(normalized)) return "семена";
      if (/(\u0431\u0435\u043d\u0437|\u0441\u043e\u043b\u044f\u0440|\u0434\u0438\u0437\u0435\u043b|\u0433\u0441\u043c|fuel)/.test(normalized)) return "топливо";
      return null;
    })();
    const effectiveProductHint = explicitProduct || queryAliasHint || queryMaterialHint;

    const productTerms = effectiveProductHint ? buildSearchTerms(effectiveProductHint) : [];
    const warehouseTerms = !allWarehouses && explicitWarehouse ? buildSearchTerms(explicitWarehouse) : [];
    const warehouseScope = normalizeSearchText(explicitWarehouse || "");
    const warehouseSpecificTermsSafe = warehouseTerms.filter((term) => {
      const normalized = normalizeSearchText(term);
      return normalized && normalized !== "склад" && normalized !== "warehouse" && normalized !== "storage";
    });
    const warehouseSpecificTerms = warehouseTerms.filter((term) => {
      const normalized = normalizeSearchText(term);
      return normalized && normalized !== "СЃРєР»Р°Рґ" && normalized !== "warehouse" && normalized !== "storage";
    });
    const matchesWarehouseScope = (warehouseName: unknown): boolean => {
      if (!warehouseTerms.length) return true;
      const normalizedName = normalizeSearchText(warehouseName);
      if (warehouseScope && normalizedName.includes(warehouseScope)) return true;
      const terms = warehouseSpecificTermsSafe.length ? warehouseSpecificTermsSafe : warehouseTerms;
      return terms.every((term) => matchesAnyTerm(warehouseName, [term]));
    };
    const queryUsed =
      "v_stock_balance_identity.select(warehouse_id,product_id,variety_id,reproduction_id,batch_id,batch_class,quantity).eq(company_id).gt(quantity,0)";

    logToolEvent(context, "get_warehouse_balances", "start", {
      input_args: context.intent.parameters,
      resolved_season: cleanString(context.runtimeContext.season),
      query_used: queryUsed,
      search_query: searchQuery,
      product_hint: effectiveProductHint,
      warehouse_hint: explicitWarehouse,
      all_warehouses: allWarehouses,
      negative_only: negativeOnly,
      rls_acl_result: inferAclResult(context),
    });

    try {
      const identityRes = await context.supabase
        .from("v_stock_balance_identity")
        .select("warehouse_id,product_id,variety_id,reproduction_id,batch_id,batch_class,quantity")
        .eq("company_id", context.companyId)
        .gt("quantity", negativeOnly ? Number.MIN_SAFE_INTEGER : 0)
        .limit(500);

      let rows: Array<Record<string, unknown>> = [];
      let viewName = "v_stock_balance_identity";

      if (!identityRes.error) {
        const raw = identityRes.data || [];
        const lookup = await buildLookupMaps(context, {
          warehouses: Array.from(new Set(raw.map((x: any) => String(x.warehouse_id || "")).filter(Boolean))),
          products: Array.from(new Set(raw.map((x: any) => String(x.product_id || "")).filter(Boolean))),
          varieties: Array.from(new Set(raw.map((x: any) => String(x.variety_id || "")).filter(Boolean))),
          reproductions: Array.from(new Set(raw.map((x: any) => String(x.reproduction_id || "")).filter(Boolean))),
        });

        rows = raw.map((row: any) => {
          const warehouseId = String(row.warehouse_id || "");
          const productId = String(row.product_id || "");
          const varietyId = cleanString(row.variety_id);
          const reproductionId = cleanString(row.reproduction_id);
          return {
            warehouse_name: lookup.byWarehouse.get(warehouseId) || warehouseId,
            product_name: lookup.byProduct.get(productId) || productId,
            variety_name: varietyId ? lookup.byVariety.get(varietyId) || "-" : "-",
            reproduction_name: reproductionId ? lookup.byReproduction.get(reproductionId) || "-" : "-",
            batch_id: cleanString(row.batch_id),
            batch_class: cleanString(row.batch_class) || "commodity",
            quantity: Number(row.quantity || 0),
          };
        });
      } else if (isMissingRelationError(identityRes.error.message)) {
        viewName = "v_stock_balance_canonical";
        const fallbackRes = await context.supabase
          .from("v_stock_balance_canonical")
          .select("warehouse_id,product_id,quantity")
          .eq("company_id", context.companyId)
          .gt("quantity", negativeOnly ? Number.MIN_SAFE_INTEGER : 0)
          .limit(500);

        if (!fallbackRes.error) {
          const raw = fallbackRes.data || [];
          const lookup = await buildLookupMaps(context, {
            warehouses: Array.from(new Set(raw.map((x: any) => String(x.warehouse_id || "")).filter(Boolean))),
            products: Array.from(new Set(raw.map((x: any) => String(x.product_id || "")).filter(Boolean))),
          });
          rows = raw.map((row: any) => {
            const warehouseId = String(row.warehouse_id || "");
            const productId = String(row.product_id || "");
            return {
              warehouse_name: lookup.byWarehouse.get(warehouseId) || warehouseId,
              product_name: lookup.byProduct.get(productId) || productId,
              variety_name: "-",
              reproduction_name: "-",
              batch_id: null,
              batch_class: "commodity",
              quantity: Number(row.quantity || 0),
            };
          });
        } else if (isMissingRelationError(fallbackRes.error.message)) {
          viewName = "stock_ledger_entries (aggregated fallback)";
          const ledgerRes = await context.supabase
            .from("stock_ledger_entries")
            .select("warehouse_id,product_id,variety_id,reproduction_id,batch_class,direction,qty_abs,delta_qty_signed,quantity")
            .eq("company_id", context.companyId)
            .limit(4000);
          if (ledgerRes.error) {
            throw new Error(ledgerRes.error.message);
          }

          type LedgerBucket = {
            warehouse_id: string;
            product_id: string;
            variety_id: string | null;
            reproduction_id: string | null;
            batch_class: string;
            quantity: number;
          };

          const buckets = new Map<string, LedgerBucket>();
          (ledgerRes.data || []).forEach((row: any) => {
            const warehouseId = String(row.warehouse_id || "");
            const productId = String(row.product_id || "");
            if (!warehouseId || !productId) return;
            const varietyId = cleanString(row.variety_id);
            const reproductionId = cleanString(row.reproduction_id);
            const batchClass = cleanString(row.batch_class) || "commodity";
            const signed =
              Number.isFinite(Number(row.delta_qty_signed))
                ? Number(row.delta_qty_signed)
                : (() => {
                    const direction = normalizeSearchText(row.direction);
                    const qtyAbs = Number(row.qty_abs ?? row.quantity ?? 0);
                    if (!Number.isFinite(qtyAbs) || qtyAbs === 0) return 0;
                    if (direction === "out" || direction === "outgoing") return -Math.abs(qtyAbs);
                    return Math.abs(qtyAbs);
                  })();

            const key = [warehouseId, productId, varietyId || "-", reproductionId || "-", batchClass].join("|");
            const current = buckets.get(key) || {
              warehouse_id: warehouseId,
              product_id: productId,
              variety_id: varietyId,
              reproduction_id: reproductionId,
              batch_class: batchClass,
              quantity: 0,
            };
            current.quantity += Number.isFinite(signed) ? signed : 0;
            buckets.set(key, current);
          });

          const raw = Array.from(buckets.values()).filter((item) =>
            negativeOnly ? item.quantity < 0 : item.quantity > 0
          );
          const lookup = await buildLookupMaps(context, {
            warehouses: Array.from(new Set(raw.map((x) => x.warehouse_id).filter(Boolean))),
            products: Array.from(new Set(raw.map((x) => x.product_id).filter(Boolean))),
            varieties: Array.from(new Set(raw.map((x) => x.variety_id || "").filter(Boolean))),
            reproductions: Array.from(new Set(raw.map((x) => x.reproduction_id || "").filter(Boolean))),
          });

          rows = raw.map((row) => ({
            warehouse_name: lookup.byWarehouse.get(row.warehouse_id) || row.warehouse_id,
            product_name: lookup.byProduct.get(row.product_id) || row.product_id,
            variety_name: row.variety_id ? lookup.byVariety.get(row.variety_id) || "-" : "-",
            reproduction_name: row.reproduction_id ? lookup.byReproduction.get(row.reproduction_id) || "-" : "-",
            batch_id: null,
            batch_class: row.batch_class,
            quantity: Number(row.quantity || 0),
          }));
        } else {
          throw new Error(fallbackRes.error.message);
        }
      } else {
        throw new Error(identityRes.error.message);
      }

      const filtered = rows
        .filter((row) => {
          if (!matchesWarehouseScope(row.warehouse_name)) return false;
          if (productTerms.length) {
            const productBlob = [row.product_name, row.variety_name, row.reproduction_name, row.batch_class].join(" ");
            return matchesAnyTerm(productBlob, productTerms);
          }
          return true;
        })
        .filter((row) => (negativeOnly ? Number(row.quantity || 0) < 0 : Number(row.quantity || 0) > 0))
        .slice(0, 200);

      logToolEvent(context, "get_warehouse_balances", "success", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: queryUsed,
        rows_count: filtered.length,
        total_rows_before_filter: rows.length,
        rls_acl_result: inferAclResult(context),
      });

      return {
        title: "Складские остатки",
        rows: filtered,
        source: {
          module: "warehouses",
          tableOrView: viewName,
          season: context.runtimeContext.season,
          fetchedAt: nowIso(),
        },
        summary: `Найдено строк: ${filtered.length}`,
      };
    } catch (error) {
      logToolEvent(context, "get_warehouse_balances", "error", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: queryUsed,
        rows_count: 0,
        error_message: error instanceof Error ? error.message : "unknown error",
        rls_acl_result: inferAclResult(context),
      });
      throw error;
    }
  },
};

const getInventoryTool: AssistantToolDefinition = {
  ...getWarehouseBalancesTool,
  name: "get_inventory",
  description: "Alias для get_warehouse_balances",
};

const getWarehouseMovementsTool: AssistantToolDefinition = {
  name: "get_warehouse_movements",
  description: "Последние движения ledger по складам",
  domains: ["ledger", "warehouses", "inventory"],
  run: async (context) => {
    const limit = parseLimit(context.intent.parameters.limit, 30, 1, 120);
    const directionFilter = normalizeSearchText(context.intent.parameters.direction);
    const productQuery =
      cleanString(context.intent.parameters.product) ||
      cleanString(context.intent.parameters.crop) ||
      cleanString(context.intent.parameters.crop_alias) ||
      parseSearchQuery(context);
    const productTerms = buildSearchTerms(productQuery);
    const warehouseQuery =
      cleanString(context.intent.parameters.warehouse) ||
      cleanString(context.intent.parameters.warehouse_alias) ||
      cleanString(context.runtimeContext.filters.warehouse);
    const warehouseTerms = buildSearchTerms(resolveWarehouseAliasQuery(warehouseQuery));
    const res = await context.supabase
      .from("stock_ledger_entries")
      .select("*")
      .eq("company_id", context.companyId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (res.error) throw new Error(res.error.message);
    const raw = res.data || [];
    const lookup = await buildLookupMaps(context, {
      warehouses: Array.from(new Set(raw.map((x: any) => String(x.warehouse_id || "")).filter(Boolean))),
      products: Array.from(new Set(raw.map((x: any) => String(x.product_id || "")).filter(Boolean))),
      varieties: Array.from(new Set(raw.map((x: any) => String(x.variety_id || "")).filter(Boolean))),
      reproductions: Array.from(new Set(raw.map((x: any) => String(x.reproduction_id || "")).filter(Boolean))),
    });

    const rows = raw
      .map((row: any) => {
        const warehouseId = String(row.warehouse_id || "");
        const productId = String(row.product_id || "");
        const varietyId = cleanString(row.variety_id);
        const reproductionId = cleanString(row.reproduction_id);
        const qtyAbs = Number(
        row.qty_abs ?? row.quantity ?? (row.delta_qty_signed != null ? Math.abs(Number(row.delta_qty_signed || 0)) : 0)
      );
      return {
        date: String(row.created_at || row.occurred_at || ""),
        direction: String(row.direction || "-"),
        quantity: Number.isFinite(qtyAbs) ? qtyAbs : 0,
        warehouse_name: lookup.byWarehouse.get(warehouseId) || warehouseId,
        product_name: lookup.byProduct.get(productId) || productId,
        variety_name: varietyId ? lookup.byVariety.get(varietyId) || "-" : "-",
        reproduction_name: reproductionId ? lookup.byReproduction.get(reproductionId) || "-" : "-",
          batch_class: cleanString(row.batch_class) || "commodity",
          reason: cleanString(row.reason_type || row.reason) || "-",
          ticket_id: cleanString(row.ticket_id),
        };
      })
      .filter((row) => {
        if (directionFilter) {
          const dir = normalizeSearchText(row.direction);
          if (directionFilter === "in" && !(dir === "in" || dir === "incoming")) return false;
          if (directionFilter === "out" && !(dir === "out" || dir === "outgoing")) return false;
        }
        if (warehouseTerms.length && !matchesAnyTerm(row.warehouse_name, warehouseTerms)) return false;
        if (productTerms.length) {
          const productBlob = [row.product_name, row.variety_name, row.reproduction_name, row.batch_class].join(" ");
          return matchesAnyTerm(productBlob, productTerms);
        }
        return true;
      });

    return {
      title: "Последние движения склада",
      rows,
      source: {
        module: "ledger",
        tableOrView: "field_material_consumptions",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getFieldsTool: AssistantToolDefinition = {
  name: "get_fields",
  description: "Список полей",
  domains: ["fields"],
  run: async (context) => {
    const searchQuery = parseFieldQueryFromContextV2(context);
    const outputType = cleanString(context.intent.parameters.output_type);
    const shouldApplySearchFilter = outputType === "list" || outputType === "filtered_summary";
    const res = await context.supabase
      .from("fields")
      .select("id,name,notes,area,archived")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("name", { ascending: true })
      .limit(300);

    if (res.error) throw new Error(res.error.message);

    const rows = applyTextFilter(
      (res.data || []).map((row: any) => ({
        field_id: String(row.id),
        field_name: getFieldDisplayName(row) || String(row.id),
        area_ha: Number(row.area || 0),
      })),
      shouldApplySearchFilter ? searchQuery : null
    ).slice(0, 120);

    return {
      title: "Поля компании",
      rows,
      source: {
        module: "fields",
        tableOrView: "fields",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getCropStructureTool: AssistantToolDefinition = {
  name: "get_crop_structure",
  description: "Структура посевов",
  domains: ["crop_structure", "fields"],
  run: async (context) => {
    const season =
      cleanString(context.runtimeContext.season) ||
      context.sessionState.lastSeason ||
      (await getCurrentSeason(context.companyId, context));

    let query = context.supabase
      .from("crop_structure")
      .select("id,field_id,crop_id,variety_id,reproduction_id,season_year,area")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("season_year", { ascending: false })
      .limit(400);

    if (season) query = query.eq("season_year", season);
    const res = await query;
    if (res.error) throw new Error(res.error.message);

    const raw = res.data || [];
    const lookup = await buildLookupMaps(context, {
      fields: Array.from(new Set(raw.map((x: any) => String(x.field_id || "")).filter(Boolean))),
      crops: Array.from(new Set(raw.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
      products: Array.from(new Set(raw.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
      varieties: Array.from(new Set(raw.map((x: any) => String(x.variety_id || "")).filter(Boolean))),
      reproductions: Array.from(new Set(raw.map((x: any) => String(x.reproduction_id || "")).filter(Boolean))),
    });

    const rows = raw.map((row: any) => {
      const fieldId = String(row.field_id || "");
      const cropId = String(row.crop_id || "");
      const varietyId = cleanString(row.variety_id);
      const reproductionId = cleanString(row.reproduction_id);
      return {
        allocation_id: String(row.id),
        season_year: String(row.season_year || "-"),
        field_name: lookup.byField.get(fieldId) || fieldId,
        crop_name: lookup.byCrop.get(cropId) || lookup.byProduct.get(cropId) || cropId,
        variety_name: varietyId ? lookup.byVariety.get(varietyId) || "-" : "-",
        reproduction_name: reproductionId ? lookup.byReproduction.get(reproductionId) || "-" : "-",
        area_ha: Number(row.area || 0),
      };
    });

    return {
      title: "Структура посевов",
      rows: rows.slice(0, 160),
      source: {
        module: "crop_structure",
        tableOrView: "crop_structure",
        season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getCropStructureToolV2: AssistantToolDefinition = {
  name: "get_crop_structure",
  description: "Структура посевов",
  domains: ["crop_structure", "fields"],
  run: async (context) => {
    const seasonCtx = await resolveSeasonContext(context.companyId, context);
    const forcedSeasonYear = seasonCtx.seasonYear || DEFAULT_SEASON_YEAR;
    const queryModern =
      "crop_structure.select(id,field_id,crop_id,variety_id,reproduction_id,season_id,area,seasons:season_id(year)).eq(company_id)";

    logToolEvent(context, "get_crop_structure", "start", {
      input_args: context.intent.parameters,
      resolved_season: forcedSeasonYear,
      resolved_season_id: seasonCtx.seasonId,
      season_source: seasonCtx.source,
      query_used: queryModern,
      rls_acl_result: inferAclResult(context),
    });

    try {
      const attempts: Array<{
        queryUsed: string;
        run: () => Promise<{ data: any[] | null; error: any | null }>;
      }> = [
        {
          queryUsed:
            "crop_structure.select(id,field_id,crop_id,variety_id,reproduction_id,season_id,area,seasons:season_id(year)).eq(company_id).eq(season_id)",
          run: async () => {
            if (!seasonCtx.seasonId) return { data: [], error: new Error("season_id_unavailable") };
            return context.supabase
              .from("crop_structure")
              .select("id,field_id,crop_id,variety_id,reproduction_id,season_id,area,seasons:season_id(year)")
              .eq("company_id", context.companyId)
              .eq("season_id", seasonCtx.seasonId)
              .limit(1000);
          },
        },
        {
          queryUsed:
            "crop_structure.select(id,field_id,crop_id,variety_id,reproduction_id,season_year,area).eq(company_id).eq(season_year)",
          run: async () =>
            context.supabase
              .from("crop_structure")
              .select("id,field_id,crop_id,variety_id,reproduction_id,season_year,area")
              .eq("company_id", context.companyId)
              .eq("season_year", forcedSeasonYear)
              .limit(1000),
        },
        {
          queryUsed:
            "crop_structure.select(id,field_id,crop_id,variety_id,reproduction_id,season,area).eq(company_id).eq(season)",
          run: async () =>
            context.supabase
              .from("crop_structure")
              .select("id,field_id,crop_id,variety_id,reproduction_id,season,area")
              .eq("company_id", context.companyId)
              .eq("season", Number(forcedSeasonYear))
              .limit(1000),
        },
        {
          queryUsed:
            "crop_structure.select(id,field_id,crop_id,variety_id,reproduction_id,season_id,area,seasons:season_id(year)).eq(company_id)",
          run: async () =>
            context.supabase
              .from("crop_structure")
              .select("id,field_id,crop_id,variety_id,reproduction_id,season_id,area,seasons:season_id(year)")
              .eq("company_id", context.companyId)
              .limit(1000),
        },
        {
          queryUsed:
            "crop_structure.select(id,field_id,crop_id,variety_id,reproduction_id,season_year,area).eq(company_id)",
          run: async () =>
            context.supabase
              .from("crop_structure")
              .select("id,field_id,crop_id,variety_id,reproduction_id,season_year,area")
              .eq("company_id", context.companyId)
              .limit(1000),
        },
      ];

      let raw: any[] = [];
      let queryUsedActual = queryModern;
      let lastError: string | null = null;

      for (const attempt of attempts) {
        const res = await attempt.run();
        if (!res.error) {
          raw = res.data || [];
          queryUsedActual = attempt.queryUsed;
          if (raw.length > 0 || attempt === attempts[attempts.length - 1]) {
            break;
          }
          continue;
        }

        const message = res.error instanceof Error ? res.error.message : String(res.error?.message || res.error || "");
        lastError = message;
        if (message === "season_id_unavailable") {
          continue;
        }
        if (isMissingRelationError(message)) {
          continue;
        }
      }

      if (!raw.length && lastError && !isMissingRelationError(lastError)) {
        throw new Error(`${queryModern} :: ${lastError}`);
      }

      const lookup = await buildLookupMaps(context, {
        fields: Array.from(new Set(raw.map((x: any) => String(x.field_id || "")).filter(Boolean))),
        crops: Array.from(new Set(raw.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
        varieties: Array.from(new Set(raw.map((x: any) => String(x.variety_id || "")).filter(Boolean))),
        reproductions: Array.from(new Set(raw.map((x: any) => String(x.reproduction_id || "")).filter(Boolean))),
      });

      const mappedRows = raw.map((row: any) => {
        const fieldId = String(row.field_id || "");
        const cropId = String(row.crop_id || "");
        const varietyId = cleanString(row.variety_id);
        const reproductionId = cleanString(row.reproduction_id);
        const seasonYear =
          cleanString(row?.seasons?.year) ||
          cleanString(row.season_year) ||
          cleanString(row.season) ||
          forcedSeasonYear ||
          "-";
        return {
          allocation_id: String(row.id),
          season_year: seasonYear,
          field_name: lookup.byField.get(fieldId) || fieldId,
          crop_name: lookup.byCrop.get(cropId) || lookup.byProduct.get(cropId) || cropId,
          variety_name: varietyId ? lookup.byVariety.get(varietyId) || "-" : "-",
          reproduction_name: reproductionId ? lookup.byReproduction.get(reproductionId) || "-" : "-",
          area_ha: Number(row.area ?? row.area_ha ?? 0),
        };
      });

      const queryText = parseSearchQuery(context) || "";
      const cropGroup = cleanString(context.intent.parameters.crop_group);
      const cropAliasTerm =
        cleanString(context.intent.parameters.crop_alias) ||
        cleanString(context.intent.parameters.crop) ||
        resolveKnownCropAlias(queryText) ||
        findCropAliasesInText(queryText)[0] ||
        null;
      const varietyFilter = cleanString(context.intent.parameters.variety);
      const seasonFilter =
        cleanString(context.intent.parameters.season) ||
        cleanString(context.runtimeContext.season) ||
        forcedSeasonYear ||
        null;

      const groupTerms = cropGroup ? listCropsByGroup(cropGroup).map((item) => normalizeSearchText(item)) : [];
      const cropTerms = buildSearchTerms(cropAliasTerm).concat(groupTerms).filter(Boolean);
      const varietyTerms = buildSearchTerms(varietyFilter);

      const rows = mappedRows.filter((row) => {
        if (seasonFilter && cleanString(row.season_year) && cleanString(row.season_year) !== seasonFilter) {
          return false;
        }

        if (cropTerms.length) {
          const cropBlob = [row.crop_name, row.variety_name, row.reproduction_name].join(" ");
          if (!matchesAnyTerm(cropBlob, cropTerms)) return false;
        }

        if (varietyTerms.length && !matchesAnyTerm(row.variety_name, varietyTerms)) {
          return false;
        }

        return true;
      });

      logToolEvent(context, "get_crop_structure", "success", {
        input_args: context.intent.parameters,
        resolved_season: forcedSeasonYear,
        resolved_season_id: seasonCtx.seasonId,
        query_used: queryUsedActual,
        rows_count: rows.length,
        rls_acl_result: inferAclResult(context),
      });

      return {
        title: "Структура посевов",
        rows: rows.slice(0, 220),
        source: {
          module: "crop_structure",
          tableOrView: queryUsedActual,
          season: forcedSeasonYear,
          fetchedAt: nowIso(),
        },
      };
    } catch (error) {
      logToolEvent(context, "get_crop_structure", "error", {
        input_args: context.intent.parameters,
        resolved_season: forcedSeasonYear,
        resolved_season_id: seasonCtx.seasonId,
        query_used: queryModern,
        rows_count: 0,
        error_message: error instanceof Error ? error.message : "unknown error",
        rls_acl_result: inferAclResult(context),
      });
      throw error;
    }
  },
};

const getWeighbridgeTicketsTool: AssistantToolDefinition = {
  name: "get_weighbridge_tickets",
  description: "Последние талоны весовой",
  domains: ["weighbridge", "tickets"],
  run: async (context) => {
    const status = cleanString(context.intent.parameters.status);
    const normalizedStatuses = normalizeTicketStatuses(status);
    let query = context.supabase
      .from("tickets")
      .select("id,ticket_no,status,op_type,created_at,gross_weight_kg,tare_weight_kg,net_weight_kg")
      .eq("company_id", context.companyId)
      .eq("is_voided", false)
      .order("created_at", { ascending: false })
      .limit(80);
    if (normalizedStatuses.length === 1) {
      query = query.eq("status", normalizedStatuses[0]);
    } else if (normalizedStatuses.length > 1) {
      query = query.in("status", normalizedStatuses);
    }
    const res = await query;
    if (res.error) throw new Error(res.error.message);

    return {
      title: "Талоны весовой",
      rows: (res.data || []).map((row: any) => ({
        ticket_no: String(row.ticket_no || row.id),
        status: String(row.status || "-"),
        operation: String(row.op_type || "-"),
        gross_kg: Number(row.gross_weight_kg || 0),
        tare_kg: Number(row.tare_weight_kg || 0),
        net_kg: Number(row.net_weight_kg || 0),
        date: String(row.created_at || ""),
      })),
      source: {
        module: "weighbridge",
        tableOrView: "tickets",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getOperationsTool: AssistantToolDefinition = {
  name: "get_operations",
  description: "Последние операции",
  domains: ["operations", "fields"],
  run: async (context) => {
    const statusFilter = cleanString(context.intent.parameters.status)?.toLowerCase() || null;
    const queryText = parseSearchQuery(context);
    const res = await context.supabase
      .from("operations")
      .select("id,date,operation_type,field_id,notes,status")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("date", { ascending: false })
      .limit(220);
    if (res.error) throw new Error(res.error.message);
    const raw = res.data || [];
    const lookup = await buildLookupMaps(context, {
      fields: Array.from(new Set(raw.map((x: any) => String(x.field_id || "")).filter(Boolean))),
    });
    const terms = buildSearchTerms(queryText);

    const rows = raw
      .map((row: any) => {
        const fieldId = String(row.field_id || "");
        return {
          operation_id: String(row.id || ""),
          date: String(row.date || ""),
          operation_type: String(row.operation_type || "-"),
          field_name: lookup.byField.get(fieldId) || fieldId,
          notes: cleanString(row.notes),
          status: cleanString(row.status) || "-",
        };
      })
      .filter((row) => {
        const status = normalizeSearchText(row.status);
        if (statusFilter === "active") {
          if (["completed", "cancelled", "verified"].includes(status)) return false;
        }
        if (statusFilter === "in_progress" && status !== "in_progress") return false;
        if (statusFilter === "waiting_materials" && status !== "waiting_materials") return false;
        if (!terms.length) return true;
        const blob = [row.operation_type, row.field_name, row.notes, row.status].join(" ");
        return matchesAnyTerm(blob, terms);
      })
      .slice(0, 120);

    return {
      title: "Операции",
      rows,
      source: {
        module: "operations",
        tableOrView: "operations",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getFuelSourcesTool: AssistantToolDefinition = {
  name: "get_fuel_sources",
  description: "Источники топлива",
  domains: ["fuel"],
  run: async (context) => {
    const searchQuery = parseSearchQuery(context);
    const res = await context.supabase
      .from("fuel_sources")
      .select("id,name,fuel_type,source_type,current_balance_liters,is_active,archived")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("name", { ascending: true })
      .limit(200);
    if (res.error) throw new Error(res.error.message);
    const rows = applyTextFilter(
      (res.data || []).map((row: any) => ({
        fuel_source_id: String(row.id),
        fuel_source_name: String(row.name || row.id),
        fuel_type: String(row.fuel_type || ""),
        source_type: String(row.source_type || ""),
        balance_liters: Number(row.current_balance_liters || 0),
        is_active: Boolean(row.is_active),
      })),
      searchQuery
    ).slice(0, 80);
    return {
      title: "Источники ГСМ",
      rows,
      source: {
        module: "fuel",
        tableOrView: "fuel_sources",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getFuelBalancesTool: AssistantToolDefinition = {
  name: "get_fuel_balances",
  description: "Остатки топлива по ёмкостям",
  domains: ["fuel"],
  run: async (context) => {
    const rowsOutput = await getFuelSourcesTool.run(context);
    return {
      ...rowsOutput,
      name: undefined as any,
      title: "Остатки топлива",
      rows: rowsOutput.rows.map((row) => ({
        fuel_source_name: row.fuel_source_name,
        fuel_type: row.fuel_type,
        balance_liters: row.balance_liters,
      })),
      source: {
        ...rowsOutput.source,
        tableOrView: "fuel_sources",
      },
    };
  },
};

const getFuelMovementsTool: AssistantToolDefinition = {
  name: "get_fuel_movements",
  description: "Последние движения ГСМ",
  domains: ["fuel"],
  run: async (context) => {
    const [issuesRes, transfersRes, refillsRes] = await Promise.all([
      context.supabase
        .from("fuel_issues")
        .select("id,issued_at,fuel_source_id,vehicle_id,mechanizator_id,liters")
        .eq("company_id", context.companyId)
        .order("issued_at", { ascending: false })
        .limit(20),
      context.supabase
        .from("fuel_transfers")
        .select("id,transferred_at,from_fuel_source_id,to_fuel_source_id,liters")
        .eq("company_id", context.companyId)
        .order("transferred_at", { ascending: false })
        .limit(20),
      context.supabase
        .from("fuel_refills")
        .select("id,refill_at,fuel_source_id,counterparty_id,liters,document_no")
        .eq("company_id", context.companyId)
        .order("refill_at", { ascending: false })
        .limit(20),
    ]);

    const allSourceIds = new Set<string>();
    (issuesRes.data || []).forEach((row: any) => cleanString(row.fuel_source_id) && allSourceIds.add(String(row.fuel_source_id)));
    (transfersRes.data || []).forEach((row: any) => {
      cleanString(row.from_fuel_source_id) && allSourceIds.add(String(row.from_fuel_source_id));
      cleanString(row.to_fuel_source_id) && allSourceIds.add(String(row.to_fuel_source_id));
    });
    (refillsRes.data || []).forEach((row: any) => cleanString(row.fuel_source_id) && allSourceIds.add(String(row.fuel_source_id)));
    const lookup = await buildLookupMaps(context, { fuelSources: Array.from(allSourceIds) });

    const rows: Array<Record<string, unknown>> = [];
    if (!issuesRes.error) {
      (issuesRes.data || []).forEach((row: any) => {
        rows.push({
          type: "issue",
          date: String(row.issued_at || ""),
          liters: Number(row.liters || 0),
          fuel_source_name: lookup.byFuelSource.get(String(row.fuel_source_id || "")) || String(row.fuel_source_id || ""),
        });
      });
    }
    if (!transfersRes.error) {
      (transfersRes.data || []).forEach((row: any) => {
        rows.push({
          type: "transfer",
          date: String(row.transferred_at || ""),
          liters: Number(row.liters || 0),
          from_fuel_source_name:
            lookup.byFuelSource.get(String(row.from_fuel_source_id || "")) || String(row.from_fuel_source_id || ""),
          to_fuel_source_name: lookup.byFuelSource.get(String(row.to_fuel_source_id || "")) || String(row.to_fuel_source_id || ""),
        });
      });
    }
    if (!refillsRes.error) {
      (refillsRes.data || []).forEach((row: any) => {
        rows.push({
          type: "refill",
          date: String(row.refill_at || ""),
          liters: Number(row.liters || 0),
          fuel_source_name: lookup.byFuelSource.get(String(row.fuel_source_id || "")) || String(row.fuel_source_id || ""),
          document_no: cleanString(row.document_no),
        });
      });
    }
    rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    return {
      title: "Движения ГСМ",
      rows: rows.slice(0, 40),
      source: {
        module: "fuel",
        tableOrView: "fuel_issues + fuel_transfers + fuel_refills",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getBatchesTool: AssistantToolDefinition = {
  name: "get_batches",
  description: "Партии склада",
  domains: ["batches", "inventory", "identity"],
  run: async (context) => {
    const queryText = parseSearchQuery(context);
    const res = await context.supabase
      .from("inventory_batches")
      .select("id,batch_code,crop_id,variety_id,reproduction_id,batch_class,origin_type,supplier_lot,created_at")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(160);
    if (res.error) throw new Error(res.error.message);

    const raw = res.data || [];
    const lookup = await buildLookupMaps(context, {
      crops: Array.from(new Set(raw.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
      products: Array.from(new Set(raw.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
      varieties: Array.from(new Set(raw.map((x: any) => String(x.variety_id || "")).filter(Boolean))),
      reproductions: Array.from(new Set(raw.map((x: any) => String(x.reproduction_id || "")).filter(Boolean))),
    });
    const rows = raw.map((row: any) => {
      const cropId = cleanString(row.crop_id);
      const varietyId = cleanString(row.variety_id);
      const reproductionId = cleanString(row.reproduction_id);
      return {
        batch_code: cleanString(row.batch_code),
        crop_name: cropId ? lookup.byCrop.get(cropId) || lookup.byProduct.get(cropId) || cropId : "-",
        variety_name: varietyId ? lookup.byVariety.get(varietyId) || "-" : "-",
        reproduction_name: reproductionId ? lookup.byReproduction.get(reproductionId) || "-" : "-",
        batch_class: cleanString(row.batch_class) || "commodity",
        origin_type: cleanString(row.origin_type) || "-",
        supplier_lot: cleanString(row.supplier_lot),
        date: String(row.created_at || ""),
      };
    });

    return {
      title: "Партии",
      rows: applyTextFilter(rows, queryText).slice(0, 100),
      source: {
        module: "batches",
        tableOrView: "inventory_batches",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

async function resolveWarehouseByName(context: AssistantToolContext) {
  const queryRaw = parseSearchQuery(context);
  const query = resolveWarehouseAliasQuery(queryRaw);
  if (!query) {
    return {
      title: "Поиск склада",
      rows: [],
      source: { module: "assistant", tableOrView: "resolve_warehouse_by_name", fetchedAt: nowIso() },
      summary: "Уточните название склада.",
    };
  }

  const res = await context.supabase
    .from("warehouses")
    .select("id,name")
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .order("name", { ascending: true })
    .limit(200);
  if (res.error) throw new Error(res.error.message);

  const terms = buildSearchTerms(query);
  const normalizedQuery = normalizeSearchText(query);
  const genericWarehouseTerms = new Set(["склад", "склады", "warehouse", "warehouses", "storage"]);
  const specificTerms = terms.filter((term) => {
    const normalized = normalizeSearchText(term);
    return normalized && !genericWarehouseTerms.has(normalized);
  });

  const scored = (res.data || [])
    .map((row: any) => {
      const name = String(row.name || "");
      const normalizedName = normalizeSearchText(name);
      let score = 0;
      if (normalizedName === normalizedQuery) score += 120;
      if (normalizedQuery && normalizedName.startsWith(normalizedQuery)) score += 80;
      if (normalizedQuery && normalizedName.includes(normalizedQuery)) score += 50;
      if (!specificTerms.length && matchesAnyTerm(name, terms)) score += 20;
      specificTerms.forEach((term) => {
        if (matchesAnyTerm(name, [term])) score += 25;
      });
      return { row, score, normalizedName };
    })
    .filter((item) => {
      if (item.score <= 0) return false;
      if (!specificTerms.length) return true;
      return specificTerms.some((term) => matchesAnyTerm(item.normalizedName, [term]));
    })
    .sort((a, b) => (b.score - a.score) || a.normalizedName.localeCompare(b.normalizedName, "ru"))
    .slice(0, 8);

  const matched = scored.map((item) => item.row);

  return {
    title: "Найденные склады",
    rows: matched.map((row: any) => ({
      entity_type: "warehouse",
      entity_id: String(row.id),
      entity_name: String(row.name || row.id),
      page: "warehouses",
      route: "/warehouses",
      filters: {
        search: String(row.name || queryRaw || query),
        warehouseId: String(row.id),
        entityId: String(row.id),
        entityType: "warehouse",
      },
    })),
    source: { module: "assistant", tableOrView: "resolve_warehouse_by_name", fetchedAt: nowIso() },
  };
}

async function resolveFieldByNumber(context: AssistantToolContext) {
  const query = parseSearchQuery(context);
  if (!query) {
    return {
      title: "Поиск поля",
      rows: [],
      source: { module: "assistant", tableOrView: "resolve_field_by_number", fetchedAt: nowIso() },
      summary: "Уточните код/название поля.",
    };
  }

  const res = await context.supabase
    .from("fields")
    .select("id,name")
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .ilike("name", `%${query}%`)
    .limit(5);
  if (res.error) throw new Error(res.error.message);

  return {
    title: "Найденные поля",
    rows: (res.data || []).map((row: any) => ({
        entity_type: "field",
        entity_id: String(row.id),
        entity_name: String(row.name || row.id),
        page: "fields",
        route: `/fields/${String(row.id)}`,
        filters: {
          search: String(row.name || query),
          entityId: String(row.id),
          entityType: "field",
        },
      })),
    source: { module: "assistant", tableOrView: "resolve_field_by_number", fetchedAt: nowIso() },
  };
}

async function resolveFuelSourceByName(context: AssistantToolContext) {
  const query = parseSearchQuery(context);
  if (!query) {
    return {
      title: "Поиск источника топлива",
      rows: [],
      source: { module: "assistant", tableOrView: "resolve_fuel_source_by_name", fetchedAt: nowIso() },
      summary: "Уточните название ёмкости/АЗС.",
    };
  }

  const res = await context.supabase
    .from("fuel_sources")
    .select("id,name")
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .ilike("name", `%${query}%`)
    .limit(5);
  if (res.error) throw new Error(res.error.message);

  return {
    title: "Найденные источники ГСМ",
    rows: (res.data || []).map((row: any) => ({
      entity_type: "fuel",
      entity_id: String(row.id),
      entity_name: String(row.name || row.id),
      page: "fuel",
      route: "/fuel",
      filters: {
        search: String(row.name || query),
        entityId: String(row.id),
        entityType: "fuel",
      },
    })),
    source: { module: "assistant", tableOrView: "resolve_fuel_source_by_name", fetchedAt: nowIso() },
  };
}

const resolvePageOrModuleTool: AssistantToolDefinition = {
  name: "resolve_page_or_module",
  description: "Резолв модуля/страницы по тексту",
  domains: ["navigation"],
  run: async (context) => {
    const query = parseSearchQuery(context) || "";
    return {
      title: "Резолв страницы",
      rows: [
        {
          query,
          page: cleanString(context.intent.parameters.page) || context.runtimeContext.currentPage || "dashboard",
          route: cleanString(context.intent.parameters.route) || "/dashboard",
        },
      ],
      source: { module: "assistant", tableOrView: "resolve_page_or_module", fetchedAt: nowIso() },
    };
  },
};

const resolveCropVarietyTool: AssistantToolDefinition = {
  name: "resolve_crop_variety",
  description: "Резолв культуры/сорта",
  domains: ["reference"],
  run: async (context) => {
    const query = parseSearchQuery(context);
    if (!query) {
      return {
        title: "Резолв культуры/сорта",
        rows: [],
        source: { module: "assistant", tableOrView: "resolve_crop_variety", fetchedAt: nowIso() },
      };
    }

    const [cropsRes, varietiesRes] = await Promise.all([
      context.supabase.from("products").select("id,name,trade_name").eq("company_id", context.companyId).ilike("name", `%${query}%`).limit(8),
      context.supabase.from("varieties").select("id,name").eq("company_id", context.companyId).ilike("name", `%${query}%`).limit(8),
    ]);

    const rows: Array<Record<string, unknown>> = [];
    if (!cropsRes.error) {
      (cropsRes.data || []).forEach((row: any) => rows.push({ entity_type: "crop", entity_id: row.id, entity_name: row.trade_name || row.name }));
    }
    if (!varietiesRes.error) {
      (varietiesRes.data || []).forEach((row: any) => rows.push({ entity_type: "variety", entity_id: row.id, entity_name: row.name }));
    }

    return {
      title: "Резолв культуры/сорта",
      rows,
      source: { module: "assistant", tableOrView: "resolve_crop_variety", fetchedAt: nowIso() },
    };
  },
};

const resolveVehicleOrEquipmentTool: AssistantToolDefinition = {
  name: "resolve_vehicle_or_equipment",
  description: "Резолв техники/машины",
  domains: ["reference", "transport"],
  run: async (context) => {
    const query = parseSearchQuery(context);
    if (!query) {
      return {
        title: "Резолв техники",
        rows: [],
        source: { module: "assistant", tableOrView: "resolve_vehicle_or_equipment", fetchedAt: nowIso() },
      };
    }

    const res = await context.supabase
      .from("reference_vehicles")
      .select("id,name,plate_number,type")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .or(`name.ilike.%${query}%,plate_number.ilike.%${query}%`)
      .limit(10);

    if (res.error) throw new Error(res.error.message);

    return {
      title: "Резолв техники",
      rows: (res.data || []).map((row: any) => ({
        entity_type: "vehicle",
        entity_id: String(row.id),
        entity_name: String(row.name || row.id),
        plate_number: cleanString(row.plate_number),
        vehicle_type: cleanString(row.type),
      })),
      source: { module: "assistant", tableOrView: "resolve_vehicle_or_equipment", fetchedAt: nowIso() },
    };
  },
};

const resolveOperationTypeTool: AssistantToolDefinition = {
  name: "resolve_operation_type",
  description: "Резолв типа операции",
  domains: ["operations"],
  run: async (context) => ({
    title: "Резолв типа операции",
    rows: [
      {
        query: parseSearchQuery(context),
        operation_type: cleanString(context.intent.parameters.operation_type) || null,
      },
    ],
    source: { module: "assistant", tableOrView: "resolve_operation_type", fetchedAt: nowIso() },
  }),
};

function createDraftRows(kind: string, context: AssistantToolContext): Array<Record<string, unknown>> {
  const basePayload = {
    kind,
    company_id: context.companyId,
    requested_by_profile_id: context.actor.id,
    message: cleanString(context.intent.parameters.query) || cleanString(context.intent.parameters.entityQuery) || null,
    requires_confirmation: true,
    status: "draft",
  };

  return [
    {
      ...basePayload,
      draft_preview:
        "Черновик подготовлен. Проверьте обязательные поля и подтвердите выполнение вручную.",
    },
  ];
}

function makeDraftTool(name: AssistantToolName, description: string): AssistantToolDefinition {
  return {
    name,
    description,
    domains: ["actions", "drafts"],
    run: async (context) => ({
      title: "Черновик действия",
      rows: createDraftRows(name, context),
      source: {
        module: "assistant",
        tableOrView: `draft:${name}`,
        fetchedAt: nowIso(),
      },
    }),
  };
}

const navigateToPageTool: AssistantToolDefinition = {
  name: "navigate_to_page",
  description: "Навигация по странице",
  domains: ["navigation"],
  run: async (context) => {
    const route = cleanString(context.intent.parameters.route) || "/dashboard";
    const page = cleanString(context.intent.parameters.page) || "dashboard";
    const filters = cleanString(context.intent.parameters.filters);
    return {
      title: "Навигация",
      rows: [
        {
          page,
          route,
          filters: filters ? JSON.parse(filters) : {},
          hint: filters ? `Открываю страницу ${page} и применяю фильтр.` : `Открываю страницу ${page}.`,
        },
      ],
      source: {
        module: "assistant",
        tableOrView: "navigate_to_page",
        fetchedAt: nowIso(),
      },
    };
  },
};

const openEntityTool: AssistantToolDefinition = {
  name: "open_entity",
  description: "Навигация к сущности",
  domains: ["navigation"],
  run: async (context) => ({
    title: "Открытие сущности",
    rows: [
      {
        entity_type: cleanString(context.intent.parameters.entityType),
        entity_query: cleanString(context.intent.parameters.entityQuery),
      },
    ],
    source: { module: "assistant", tableOrView: "open_entity", fetchedAt: nowIso() },
  }),
};

const applyFilterTool: AssistantToolDefinition = {
  name: "apply_filter",
  description: "Применение фильтра",
  domains: ["navigation"],
  run: async (context) => ({
    title: "Применение фильтра",
    rows: [
      {
        page: cleanString(context.intent.parameters.page),
        route: cleanString(context.intent.parameters.route),
        filters: cleanString(context.intent.parameters.filters),
      },
    ],
    source: { module: "assistant", tableOrView: "apply_filter", fetchedAt: nowIso() },
  }),
};

const resolveWarehouseByNameTool: AssistantToolDefinition = {
  name: "resolve_warehouse_by_name",
  description: "Найти склад по названию",
  domains: ["navigation", "warehouses"],
  run: resolveWarehouseByName,
};

const resolveFieldByNumberTool: AssistantToolDefinition = {
  name: "resolve_field_by_number",
  description: "Найти поле по коду/названию",
  domains: ["navigation", "fields"],
  run: resolveFieldByNumber,
};

const resolveFuelSourceByNameTool: AssistantToolDefinition = {
  name: "resolve_fuel_source_by_name",
  description: "Найти источник ГСМ по названию",
  domains: ["navigation", "fuel"],
  run: resolveFuelSourceByName,
};

const getCurrentContextToolAlias: AssistantToolDefinition = {
  name: "get_current_context",
  description: "Текущий контекст страницы/компании/сезона",
  domains: ["assistant", "context"],
  run: async (context) => ({
    title: "Текущий контекст",
    rows: [
      {
        company_id: context.companyId,
        company_name: context.runtimeContext.companyName || null,
        user_id: context.runtimeContext.userId || context.actor.authUserId || null,
        user_role: context.actor.role,
        page: context.runtimeContext.currentPage,
        module: context.runtimeContext.currentModule || context.runtimeContext.currentPage,
        route: context.runtimeContext.currentRoute,
        season: context.runtimeContext.season || context.runtimeContext.defaultSeason || DEFAULT_SEASON_YEAR,
        default_season: context.runtimeContext.defaultSeason || DEFAULT_SEASON_YEAR,
        selected_entity_type: context.runtimeContext.selectedEntityType || cleanString(context.runtimeContext.entity?.type),
        selected_entity_id: context.runtimeContext.selectedEntityId || cleanString(context.runtimeContext.entity?.id),
        selected_field:
          context.runtimeContext.selectedFieldId ||
          cleanString(context.runtimeContext.filters.field) ||
          cleanString(context.runtimeContext.filters.fieldId) ||
          (context.runtimeContext.entity?.type === "field" ? cleanString(context.runtimeContext.entity?.id) : null),
        selected_warehouse:
          context.runtimeContext.selectedWarehouseId ||
          cleanString(context.runtimeContext.filters.warehouse) ||
          cleanString(context.runtimeContext.filters.warehouseId) ||
          (context.runtimeContext.entity?.type === "warehouse" ? cleanString(context.runtimeContext.entity?.id) : null),
        selected_crop:
          context.runtimeContext.selectedCrop ||
          cleanString(context.runtimeContext.filters.crop) ||
          cleanString(context.runtimeContext.filters.culture) ||
          null,
        filters: context.runtimeContext.filters || {},
        language: context.runtimeContext.language || context.runtimeContext.locale || "ru",
        locale: context.runtimeContext.locale || context.runtimeContext.language || "ru",
      },
    ],
    source: {
      module: "assistant",
      tableOrView: "runtime_context",
      season: context.runtimeContext.season,
      fetchedAt: nowIso(),
    },
  }),
};

const getRoutesToolAlias: AssistantToolDefinition = {
  name: "get_routes",
  description: "Маршруты основных модулей Travkin Flow",
  domains: ["navigation", "assistant"],
  run: async (context) => {
    const routeNameMap: Record<string, string> = {
      dashboard: "Панель",
      fields: "Поля",
      "field-card": "Карточка поля",
      "crop-structure": "Структура посевов",
      "field-history": "История полей",
      operations: "Операции",
      warehouses: "Склады",
      "warehouse-card": "Карточка склада",
      weighbridge: "Весовая",
      reports: "Отчеты",
      cadastre: "Кадастр и право",
    };
    return {
      title: "Маршруты",
      rows: getAssistantRouteRegistry().map((entry) => ({
        route_key: entry.routeKey,
        name: routeNameMap[entry.routeKey] || entry.routeKey,
        route: entry.path,
        supported_filters: entry.supportedFilters.join(", "),
        open_strategy: entry.openStrategy,
      })),
      source: {
        module: "assistant",
        tableOrView: "route_registry",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const findFieldToolAlias: AssistantToolDefinition = {
  name: "find_field",
  description: "Найти поле",
  domains: ["fields", "navigation"],
  run: resolveFieldByNumber,
};

const findWarehouseToolAlias: AssistantToolDefinition = {
  name: "find_warehouse",
  description: "Найти склад",
  domains: ["warehouses", "navigation"],
  run: resolveWarehouseByName,
};

const searchFieldsToolAlias: AssistantToolDefinition = {
  name: "search_fields",
  description: "Search fields",
  domains: ["fields", "navigation"],
  run: async (context) => {
    const query = parseFieldQueryFromContextV2(context);
    logToolEvent(context, "search_fields", "start", {
      input_args: context.intent.parameters,
      resolved_season: cleanString(context.runtimeContext.season),
      query_used: "fields.select(id,name,notes,area,archived).eq(company_id).eq(archived=false)",
      search_query: query,
      rls_acl_result: inferAclResult(context),
    });
    try {
      const output = await getFieldsTool.run(context);
      const rows = applyTextFilter(output.rows || [], query).slice(0, 80);
      logToolEvent(context, "search_fields", "success", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: "fields (search_fields)",
        rows_count: rows.length,
        rls_acl_result: inferAclResult(context),
      });
      return {
        ...output,
        rows,
        source: {
          ...output.source,
          tableOrView: "fields (search_fields)",
        },
      };
    } catch (error) {
      logToolEvent(context, "search_fields", "error", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: "fields (search_fields)",
        rows_count: 0,
        error_message: error instanceof Error ? error.message : "unknown error",
        rls_acl_result: inferAclResult(context),
      });
      throw error;
    }
  },
};

const searchWarehousesToolAlias: AssistantToolDefinition = {
  name: "search_warehouses",
  description: "Search warehouses",
  domains: ["warehouses", "navigation"],
  run: resolveWarehouseByName,
};

const getWarehouseCountToolAlias: AssistantToolDefinition = {
  name: "get_warehouse_count",
  description: "Warehouse count/list",
  domains: ["warehouses"],
  run: async (context) => {
    const query = resolveWarehouseAliasQuery(
      cleanString(context.intent.parameters.entityQuery) ||
        cleanString(context.intent.parameters.warehouse) ||
        cleanString(context.intent.parameters.warehouse_alias)
    );
    const queryUsed = "warehouses.select(id,name,warehouse_type,archived,is_archived)";
    logToolEvent(context, "get_warehouse_count", "start", {
      input_args: context.intent.parameters,
      resolved_season: cleanString(context.runtimeContext.season),
      query_used: queryUsed,
      query_text: query,
      rls_acl_result: inferAclResult(context),
    });

    try {
      let res: any = await context.supabase
        .from("warehouses")
        .select("id,name,warehouse_type,archived,is_archived")
        .eq("company_id", context.companyId)
        .order("name", { ascending: true })
        .limit(500);
      if (res.error && String(res.error.message || "").toLowerCase().includes("is_archived")) {
        res = await context.supabase
          .from("warehouses")
          .select("id,name,warehouse_type,archived")
          .eq("company_id", context.companyId)
          .order("name", { ascending: true })
          .limit(500);
      }
      if (res.error) throw new Error(res.error.message);

      const terms = query ? buildSearchTerms(query) : [];
      const baseRows = (res.data || []).map((row: any) => ({
        warehouse_id: String(row.id),
        warehouse_name: cleanString(row.name) || String(row.id),
        warehouse_type: cleanString(row.warehouse_type) || "не указан",
        archived: Boolean(row.archived || row.is_archived),
        is_archived: Boolean(row.is_archived || row.archived),
      }));
      const rows = terms.length
        ? baseRows.filter((row: any) => matchesAnyTerm(`${row.warehouse_name} ${row.warehouse_type}`, terms))
        : baseRows;

      logToolEvent(context, "get_warehouse_count", "success", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: queryUsed,
        rows_count: rows.length,
        rls_acl_result: inferAclResult(context),
      });

      return {
        title: "Склады компании",
        rows,
        source: {
          module: "warehouses",
          tableOrView: "warehouses (count/list)",
          season: context.runtimeContext.season,
          fetchedAt: nowIso(),
        },
      };
    } catch (error) {
      logToolEvent(context, "get_warehouse_count", "error", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: queryUsed,
        rows_count: 0,
        error_message: error instanceof Error ? error.message : "unknown error",
        rls_acl_result: inferAclResult(context),
      });
      throw error;
    }
  },
};

const searchOperationsToolAlias: AssistantToolDefinition = {
  name: "search_operations",
  description: "Search operations",
  domains: ["operations"],
  run: async (context) => {
    const output = await getOperationsTool.run(context);
    const query = parseSearchQuery(context);
    return {
      ...output,
      rows: applyTextFilter(output.rows || [], query).slice(0, 100),
      source: {
        ...output.source,
        tableOrView: "operations (search_operations)",
      },
    };
  },
};

const findOperationToolAlias: AssistantToolDefinition = {
  name: "find_operation",
  description: "Найти операции по фильтру",
  domains: ["operations"],
  run: async (context) => {
    const output = await getOperationsTool.run(context);
    const query = parseSearchQuery(context);
    return {
      ...output,
      rows: applyTextFilter(output.rows || [], query).slice(0, 40),
      source: {
        ...output.source,
        tableOrView: "operations (find_operation)",
      },
    };
  },
};

const getActiveOperationsToolAlias: AssistantToolDefinition = {
  name: "get_active_operations",
  description: "Активные операции компании",
  domains: ["operations"],
  run: async (context) => {
    const res = await context.supabase
      .from("operations")
      .select("id,date,operation_type,status,field_id")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("date", { ascending: false })
      .limit(120);

    if (res.error) throw new Error(res.error.message);
    const rowsRaw = res.data || [];
    const fieldsLookup = await buildLookupMaps(context, {
      fields: Array.from(new Set(rowsRaw.map((row: any) => String(row.field_id || "")).filter(Boolean))),
    });

    const rows = rowsRaw
      .filter((row: any) => {
        const status = cleanString(row.status)?.toLowerCase() || "";
        return status !== "completed" && status !== "cancelled" && status !== "verified";
      })
      .map((row: any) => ({
        operation_id: String(row.id),
        date: cleanString(row.date),
        operation_type: cleanString(row.operation_type),
        status: cleanString(row.status),
        field_name: fieldsLookup.byField.get(String(row.field_id || "")) || String(row.field_id || ""),
      }));

    return {
      title: "Активные операции",
      rows: rows.slice(0, 60),
      source: {
        module: "operations",
        tableOrView: "operations",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getOperationDetailsToolAlias: AssistantToolDefinition = {
  name: "get_operation_details",
  description: "Operation details",
  domains: ["operations"],
  run: async (context) => {
    const query = parseSearchQuery(context);
    const limit = parseLimit(context.intent.parameters.limit, 1, 1, 10);
    const runOperationQuery = async (selectColumns: string) => {
      let opQuery = context.supabase
        .from("operations")
        .select(selectColumns)
        .eq("company_id", context.companyId)
        .eq("archived", false)
        .order("date", { ascending: false })
        .limit(limit);
      if (query) {
        opQuery = opQuery.or(`operation_type.ilike.%${query}%,notes.ilike.%${query}%`);
      }
      return opQuery;
    };

    let opRes = await runOperationQuery("id,date,operation_type,status,field_id,crop_id,planned_area_ha,notes");
    if (opRes.error && /column\\s+operations\\.(crop_id|planned_area_ha)\\s+does not exist/i.test(opRes.error.message || "")) {
      opRes = await runOperationQuery("id,date,operation_type,status,field_id,notes");
    }
    if (opRes.error) throw new Error(opRes.error.message);
    const ops = opRes.data || [];

    const lookup = await buildLookupMaps(context, {
      fields: Array.from(new Set(ops.map((x: any) => String(x.field_id || "")).filter(Boolean))),
      crops: Array.from(new Set(ops.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
      products: Array.from(new Set(ops.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
    });
    const opIds = ops.map((item: any) => String(item.id));

    let requestRows: Array<Record<string, unknown>> = [];
    if (opIds.length) {
      const reqRes = await context.supabase
        .from("warehouse_issue_requests")
        .select("operation_id,status,request_number")
        .eq("company_id", context.companyId)
        .in("operation_id", opIds);
      if (!reqRes.error) requestRows = reqRes.data || [];
    }

    return {
      title: "Детали операции",
      rows: ops.map((row: any) => {
        const opId = String(row.id);
        const req = requestRows.find((item) => String(item.operation_id || "") === opId);
        return {
          operation_id: opId,
          date: cleanString(row.date),
          operation_type: cleanString(row.operation_type),
          status: cleanString(row.status),
          field_name: lookup.byField.get(String(row.field_id || "")) || String(row.field_id || ""),
          crop_name:
            lookup.byCrop.get(String(row.crop_id || "")) ||
            lookup.byProduct.get(String(row.crop_id || "")) ||
            String(row.crop_id || ""),
          planned_area_ha: Number(row.planned_area_ha || 0),
          material_request_number: cleanString(req?.request_number),
          material_request_status: cleanString(req?.status),
          notes: cleanString(row.notes),
        };
      }),
      source: {
        module: "operations",
        tableOrView: "operations + warehouse_issue_requests",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getActiveTicketsToolAlias: AssistantToolDefinition = {
  name: "get_active_tickets",
  description: "Active weighbridge tickets",
  domains: ["weighbridge"],
  run: async (context) => {
    const res = await context.supabase
      .from("tickets")
      .select("id,ticket_no,status,op_type,created_at,gross_weight_kg,tare_weight_kg,net_weight_kg")
      .eq("company_id", context.companyId)
      .eq("is_voided", false)
      .in("status", ["draft", "active", "ready_to_close"])
      .order("created_at", { ascending: false })
      .limit(120);
    if (res.error) throw new Error(res.error.message);
    return {
      title: "Активные талоны",
      rows: (res.data || []).map((row: any) => ({
        ticket_id: String(row.id),
        ticket_no: cleanString(row.ticket_no) || String(row.id),
        status: cleanString(row.status),
        type: cleanString(row.op_type),
        gross_kg: Number(row.gross_weight_kg || 0),
        tare_kg: Number(row.tare_weight_kg || 0),
        net_kg: Number(row.net_weight_kg || 0),
        date: cleanString(row.created_at),
      })),
      source: {
        module: "weighbridge",
        tableOrView: "tickets (active)",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getRecentTicketsToolAlias: AssistantToolDefinition = {
  name: "get_recent_tickets",
  description: "Recent weighbridge tickets",
  domains: ["weighbridge"],
  run: getWeighbridgeTicketsTool.run,
};

const getTicketDetailsToolAlias: AssistantToolDefinition = {
  name: "get_ticket_details",
  description: "Ticket details",
  domains: ["weighbridge"],
  run: async (context) => {
    const query = parseSearchQuery(context);
    let q = context.supabase
      .from("tickets")
      .select("id,ticket_no,status,op_type,created_at,gross_weight_kg,tare_weight_kg,net_weight_kg")
      .eq("company_id", context.companyId)
      .eq("is_voided", false)
      .order("created_at", { ascending: false })
      .limit(40);
    if (query) q = q.or(`ticket_no.ilike.%${query}%`);
    const res = await q;
    if (res.error) throw new Error(res.error.message);
    return {
      title: "Детали талона",
      rows: (res.data || []).map((row: any) => ({
        ticket_id: String(row.id),
        ticket_no: cleanString(row.ticket_no) || String(row.id),
        type: cleanString(row.op_type),
        status: cleanString(row.status),
        gross_kg: Number(row.gross_weight_kg || 0),
        tare_kg: Number(row.tare_weight_kg || 0),
        net_kg: Number(row.net_weight_kg || 0),
        date: cleanString(row.created_at),
      })),
      source: {
        module: "weighbridge",
        tableOrView: "tickets (details)",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getWarehouseSummaryToolAlias: AssistantToolDefinition = {
  name: "get_warehouse_summary",
  description: "Сводка по складам",
  domains: ["warehouses", "inventory"],
  run: async (context) => {
    logToolEvent(context, "get_warehouse_summary", "start", {
      input_args: context.intent.parameters,
      resolved_season: cleanString(context.runtimeContext.season),
      query_used: "v_stock_balance_identity (summary by warehouse_name)",
      rls_acl_result: inferAclResult(context),
    });
    try {
      const output = await getWarehouseBalancesTool.run(context);
      const grouped = new Map<string, number>();
      (output.rows || []).forEach((row) => {
        const warehouse = cleanString(row.warehouse_name) || "—";
        const qty = Number(row.quantity || 0);
        grouped.set(warehouse, (grouped.get(warehouse) || 0) + (Number.isFinite(qty) ? qty : 0));
      });
      const rows = Array.from(grouped.entries())
        .map(([warehouse_name, quantity]) => ({ warehouse_name, quantity }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 60);
      logToolEvent(context, "get_warehouse_summary", "success", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: "v_stock_balance_identity (summary by warehouse_name)",
        rows_count: rows.length,
        rls_acl_result: inferAclResult(context),
      });
      return {
        title: "Сводка складов",
        rows,
        source: {
          module: "warehouses",
          tableOrView: "v_stock_balance_identity (summary)",
          season: context.runtimeContext.season,
          fetchedAt: nowIso(),
        },
      };
    } catch (error) {
      logToolEvent(context, "get_warehouse_summary", "error", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: "v_stock_balance_identity (summary by warehouse_name)",
        rows_count: 0,
        error_message: error instanceof Error ? error.message : "unknown error",
        rls_acl_result: inferAclResult(context),
      });
      throw error;
    }
  },
};

const getWarehouseStockToolAlias: AssistantToolDefinition = {
  name: "get_warehouse_stock",
  description: "Warehouse stock",
  domains: ["warehouses", "inventory"],
  run: async (context) => {
    const searchQuery = parseSearchQuery(context);
    const warehouseQueryRaw =
      cleanString(context.intent.parameters.entityQuery) ||
      cleanString(context.intent.parameters.warehouse) ||
      cleanString(context.intent.parameters.warehouse_alias) ||
      cleanString(context.runtimeContext.filters.warehouse);
    const warehouseQuery = resolveWarehouseAliasQuery(warehouseQueryRaw);
    const explicitProductQuery =
      cleanString(context.intent.parameters.product) ||
      cleanString(context.intent.parameters.crop) ||
      cleanString(context.intent.parameters.crop_alias);
    const queryAliasHint = searchQuery
      ? resolveKnownCropAlias(searchQuery) || findCropAliasesInText(searchQuery)[0] || null
      : null;
    const queryMaterialHint = (() => {
      const normalized = normalizeSearchText(searchQuery || "");
      if (!normalized) return null;
      if (/(\u0443\u0434\u043e\u0431\u0440|fertiliz|dap|\u0430\u043c\u043c\u043e\u0444)/.test(normalized)) return "СѓРґРѕР±СЂРµРЅРёРµ";
      if (/(\u0441\u0437\u0440|\u0445\u0438\u043c|pestic|fungic|herbic)/.test(normalized)) return "СЃР·СЂ";
      if (/(\u0441\u0435\u043c\u044f\u043d|seed)/.test(normalized)) return "СЃРµРјРµРЅР°";
      if (/(\u0431\u0435\u043d\u0437|\u0441\u043e\u043b\u044f\u0440|\u0434\u0438\u0437\u0435\u043b|\u0433\u0441\u043c|fuel)/.test(normalized)) return "С‚РѕРїР»РёРІРѕ";
      return null;
    })();
    const productQuery = explicitProductQuery || queryAliasHint || queryMaterialHint || null;
    const allWarehouses = parseBoolish(context.intent.parameters.allWarehouses) || !warehouseQuery;
    const negativeOnly = parseBoolish(context.intent.parameters.negative_only);

    logToolEvent(context, "get_warehouse_stock", "start", {
      input_args: context.intent.parameters,
      resolved_season: cleanString(context.runtimeContext.season),
      query_used: "v_stock_balance_identity (warehouse_stock alias)",
      warehouse_query: warehouseQuery,
      product_query: productQuery,
      all_warehouses: allWarehouses,
      negative_only: negativeOnly,
      rls_acl_result: inferAclResult(context),
    });

    try {
      const output = await getWarehouseBalancesTool.run({
        ...context,
        intent: {
          ...context.intent,
          parameters: {
            ...context.intent.parameters,
            warehouse: warehouseQuery,
            product: productQuery,
            allWarehouses,
            negative_only: negativeOnly,
          },
        },
      });
      const warehouseTerms = !allWarehouses && warehouseQuery ? buildSearchTerms(warehouseQuery) : [];
      const warehouseScope = normalizeSearchText(warehouseQuery || "");
      const warehouseSpecificTermsSafe = warehouseTerms.filter((term) => {
        const normalized = normalizeSearchText(term);
        return normalized && normalized !== "склад" && normalized !== "warehouse" && normalized !== "storage";
      });
      const warehouseSpecificTerms = warehouseTerms.filter((term) => {
        const normalized = normalizeSearchText(term);
        return normalized && normalized !== "СЃРєР»Р°Рґ" && normalized !== "warehouse" && normalized !== "storage";
      });
      const matchesWarehouseScope = (warehouseName: unknown): boolean => {
        if (!warehouseTerms.length) return true;
        const normalizedName = normalizeSearchText(warehouseName);
        if (warehouseScope && normalizedName.includes(warehouseScope)) return true;
        const terms = warehouseSpecificTermsSafe.length ? warehouseSpecificTermsSafe : warehouseTerms;
        return terms.every((term) => matchesAnyTerm(warehouseName, [term]));
      };
      const productTerms = productQuery ? buildSearchTerms(productQuery) : [];

      const rows = (output.rows || [])
        .filter((row) => {
          if (!matchesWarehouseScope(row.warehouse_name)) return false;
          if (productTerms.length) {
            const productBlob = [row.product_name, row.variety_name, row.reproduction_name, row.batch_class].join(" ");
            return matchesAnyTerm(productBlob, productTerms);
          }
          return true;
        })
        .filter((row) => (negativeOnly ? Number(row.quantity || 0) < 0 : true))
        .slice(0, 200);

      logToolEvent(context, "get_warehouse_stock", "success", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: "v_stock_balance_identity (warehouse_stock alias)",
        rows_count: rows.length,
        rls_acl_result: inferAclResult(context),
      });

      return {
        ...output,
        title: "Остатки склада",
        rows,
        source: {
          ...output.source,
          tableOrView: "v_stock_balance_identity (warehouse_stock)",
        },
      };
    } catch (error) {
      logToolEvent(context, "get_warehouse_stock", "error", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: "v_stock_balance_identity (warehouse_stock alias)",
        rows_count: 0,
        error_message: error instanceof Error ? error.message : "unknown error",
        rls_acl_result: inferAclResult(context),
      });
      throw error;
    }
  },
};

const getCropStructureSummaryToolAlias: AssistantToolDefinition = {
  name: "get_crop_structure_summary",
  description: "Crop structure summary",
  domains: ["reports", "crop_structure"],
  run: async (context) => {
    const query = parseSearchQuery(context);
    const cropGroup =
      cleanString(context.intent.parameters.crop_group) ||
      findCropGroupsInText(query || "")[0] ||
      null;
    const explicitAliasRaw = cleanString(context.intent.parameters.crop_alias);
    const explicitCropRaw = cleanString(context.intent.parameters.crop);
    const explicitAlias =
      (explicitAliasRaw
        ? resolveKnownCropAlias(explicitAliasRaw) || findCropAliasesInText(explicitAliasRaw)[0] || null
        : null);
    const explicitCrop =
      (explicitCropRaw
        ? resolveKnownCropAlias(explicitCropRaw) || findCropAliasesInText(explicitCropRaw)[0] || null
        : null);
    const cropAliasTerms = uniqueStrings([
      explicitAlias,
      explicitCrop,
      resolveKnownCropAlias(query || ""),
      ...findCropAliasesInText(query || ""),
    ]);

    logToolEvent(context, "get_crop_structure_summary", "start", {
      input_args: context.intent.parameters,
      resolved_season: cleanString(context.runtimeContext.season),
      query_used: "get_crop_structure + group by crop_name",
      query_text: query,
      crop_group: cropGroup,
      crop_aliases: cropAliasTerms,
      rls_acl_result: inferAclResult(context),
    });

    try {
      const output = await getCropStructureToolV2.run(context);
      const groupCrops = cropGroup ? listCropsByGroup(cropGroup).map((item) => normalizeSearchText(item)) : [];
      const aliasTerms = cropAliasTerms
        .flatMap((alias) => buildSearchTerms(alias))
        .concat(groupCrops)
        .filter(Boolean);

      const filtered = (output.rows || []).filter((row) => {
        if (!aliasTerms.length) return true;
        const searchBlob = [row.crop_name, row.variety_name, row.reproduction_name].join(" ");
        return matchesAnyTerm(searchBlob, aliasTerms);
      });

      const queryTerms = buildSearchTerms(query);
      const normalizedQuery = normalizeSearchText(query || "");
      const queryWordCount = normalizedQuery.split(" ").filter(Boolean).length;
      const queryLooksSpecific =
        /\b\d{1,3}(?:-\d{1,3}){0,2}\b/.test(normalizedQuery) ||
        /(\u043a\u0430\u0440\u0442\u043e\u0444|\u043f\u0448\u0435\u043d|\u044f\u0447\u043c\u0435\u043d|\u043a\u0443\u043a\u0443\u0440\u0443\u0437|\u0440\u0430\u043f\u0441|\u0441\u043e\u044f|\u043e\u0432\u0435\u0441|\u043b\u0435\u043d|\u043b\u0451\u043d|\u043c\u043e\u0440\u043a\u043e\u0432|\u043b\u0443\u043a|gala|soraya|baltic|azilit|colombo|impala|potato|wheat|barley|corn)/.test(
          normalizedQuery
        );
      const shouldApplyFreeText =
        !aliasTerms.length && queryWordCount > 0 && queryWordCount <= 8 && queryLooksSpecific;
      const rows = shouldApplyFreeText
        ? filtered.filter((row) => {
            const searchBlob = [row.crop_name, row.variety_name, row.reproduction_name, row.field_name].join(" ");
            return matchesAnyTerm(searchBlob, queryTerms);
          })
        : filtered;
      const grouped = new Map<string, { crop_name: string; area_ha: number; fields: Set<string> }>();
      const varietyAliases = new Set(["gala", "soraya", "baltic rose", "azilit", "colombo", "impala"]);
      const groupByVariety = cropAliasTerms.some((alias) => varietyAliases.has(normalizeSearchText(alias || "")));

      rows.forEach((row) => {
        const crop = cleanString(row.crop_name) || "Не указано";
        const variety = cleanString(row.variety_name);
        const cropKey = groupByVariety && variety ? `${crop} / ${variety}` : crop;
        const area = Number(row.area_ha || 0);
        const field = cleanString(row.field_name) || "—";
        const current = grouped.get(cropKey) || { crop_name: cropKey, area_ha: 0, fields: new Set<string>() };
        current.area_ha += Number.isFinite(area) ? area : 0;
        current.fields.add(field);
        grouped.set(cropKey, current);
      });

      const summaryRows = Array.from(grouped.values())
        .map((item) => ({
          crop_name: item.crop_name,
          area_ha: Number(item.area_ha.toFixed(3)),
          fields_count: item.fields.size,
        }))
        .sort((a, b) => b.area_ha - a.area_ha)
        .slice(0, 120);

      logToolEvent(context, "get_crop_structure_summary", "success", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(output.source.season),
        query_used: "get_crop_structure + group by crop_name",
        rows_count: summaryRows.length,
        raw_rows_count: rows.length,
        rls_acl_result: inferAclResult(context),
      });

      return {
        title: "Сводка структуры посевов",
        rows: summaryRows,
        source: {
          module: "crop_structure",
          tableOrView: "crop_structure (summary)",
          season: output.source.season,
          fetchedAt: nowIso(),
        },
      };
    } catch (error) {
      logToolEvent(context, "get_crop_structure_summary", "error", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: "get_crop_structure + group by crop_name",
        rows_count: 0,
        error_message: error instanceof Error ? error.message : "unknown error",
        rls_acl_result: inferAclResult(context),
      });
      throw error;
    }
  },
};

const searchCropsByGroupToolAlias: AssistantToolDefinition = {
  name: "search_crops_by_group",
  description: "Crop groups and aliases",
  domains: ["agro", "reference"],
  run: async (context) => {
    const query = parseSearchQuery(context);
    const groupFromIntent = cleanString(context.intent.parameters.crop_group);
    const groups = groupFromIntent ? [groupFromIntent] : query ? findCropGroupsInText(query) : [];
    const normalizedAlias = query
      ? resolveKnownCropAlias(query) || findCropAliasesInText(query)[0] || null
      : null;
    const taxonomy = getAgroTaxonomySnapshot();
    const queryUsed = "agro_taxonomy + crop_structure_summary";

    logToolEvent(context, "search_crops_by_group", "start", {
      input_args: context.intent.parameters,
      resolved_season: cleanString(context.runtimeContext.season),
      query_used: queryUsed,
      query_text: query,
      crop_group: groups,
      crop_alias: normalizedAlias,
      rls_acl_result: inferAclResult(context),
    });

    try {
      const structureOutput = await getCropStructureSummaryToolAlias.run({
        ...context,
        intent: {
          ...context.intent,
          parameters: {
            ...context.intent.parameters,
            crop_group: groups[0] || context.intent.parameters.crop_group || null,
            crop_alias: normalizedAlias || context.intent.parameters.crop_alias || null,
          },
        },
      });

      if (groups.length) {
        const groupRows = groups.flatMap((group) =>
          listCropsByGroup(group).map((crop) => ({
            crop_group: group,
            crop_name: crop,
            query_alias: normalizedAlias,
          }))
        );
        const summaryRows = (structureOutput.rows || []).map((row) => ({
          crop_group: groups[0],
          crop_name: cleanString(row.crop_name) || "—",
          query_alias: normalizedAlias,
          area_ha: Number(row.area_ha || 0),
        }));
        const rows = summaryRows.length ? summaryRows : groupRows;
        logToolEvent(context, "search_crops_by_group", "success", {
          input_args: context.intent.parameters,
          resolved_season: cleanString(structureOutput.source.season),
          query_used: queryUsed,
          rows_count: rows.length,
          rls_acl_result: inferAclResult(context),
        });
        return {
          title: "Группы культур",
          rows,
          source: {
            module: "agro",
            tableOrView: "static_crop_taxonomy + crop_structure_summary",
            season: structureOutput.source.season,
            fetchedAt: nowIso(),
          },
        };
      }

      const rows = Object.entries(taxonomy.groups).flatMap(([group, crops]) =>
        crops.map((crop) => ({
          crop_group: group,
          crop_name: crop,
          query_alias: normalizedAlias,
        }))
      );
      logToolEvent(context, "search_crops_by_group", "success", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(structureOutput.source.season),
        query_used: queryUsed,
        rows_count: rows.length,
        rls_acl_result: inferAclResult(context),
      });
      return {
        title: "Группы культур",
        rows,
        source: {
          module: "agro",
          tableOrView: "static_crop_taxonomy",
          season: structureOutput.source.season,
          fetchedAt: nowIso(),
        },
      };
    } catch (error) {
      logToolEvent(context, "search_crops_by_group", "error", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: queryUsed,
        rows_count: 0,
        error_message: error instanceof Error ? error.message : "unknown error",
        rls_acl_result: inferAclResult(context),
      });
      throw error;
    }
  },
};

const getPotatoMaterialReportToolAlias: AssistantToolDefinition = {
  name: "get_potato_material_report",
  description: "Отчет по материалам картофеля",
  domains: ["reports", "operations", "warehouses"],
  run: async (context) => {
    const queryUsed = "v_potato_material_consumption.select(*)";
    logToolEvent(context, "get_potato_material_report", "start", {
      input_args: context.intent.parameters,
      resolved_season: cleanString(context.runtimeContext.season),
      query_used: queryUsed,
      rls_acl_result: inferAclResult(context),
    });
    try {
      const viewRes = await context.supabase
        .from("v_potato_material_consumption")
        .select("*")
        .eq("company_id", context.companyId)
        .order("field_display_name", { ascending: true })
        .limit(300);

      if (!viewRes.error) {
        const rows = (viewRes.data || []).map((row: any) => ({ ...row }));
        logToolEvent(context, "get_potato_material_report", "success", {
          input_args: context.intent.parameters,
          resolved_season: cleanString(context.runtimeContext.season),
          query_used: queryUsed,
          rows_count: rows.length,
          rls_acl_result: inferAclResult(context),
        });
        return {
          title: "Отчет по картофелю",
          rows,
          source: {
            module: "reports",
            tableOrView: "v_potato_material_consumption",
            season: context.runtimeContext.season,
            fetchedAt: nowIso(),
          },
        };
      }

      if (isMissingRelationError(viewRes.error.message)) {
        const rows = [
          {
            info: "Пока не могу открыть отчет по картофелю напрямую. Откройте Операции или Склады и уточните фильтр.",
          },
        ];
        logToolEvent(context, "get_potato_material_report", "success", {
          input_args: context.intent.parameters,
          resolved_season: cleanString(context.runtimeContext.season),
          query_used: "fallback:get_potato_material_report",
          rows_count: rows.length,
          rls_acl_result: inferAclResult(context),
        });
        return {
          title: "Отчет по картофелю",
          rows,
          source: {
            module: "assistant",
            tableOrView: "fallback:get_potato_material_report",
            season: context.runtimeContext.season,
            fetchedAt: nowIso(),
          },
        };
      }

      throw new Error(viewRes.error.message);
    } catch (error) {
      logToolEvent(context, "get_potato_material_report", "error", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: queryUsed,
        rows_count: 0,
        error_message: error instanceof Error ? error.message : "unknown error",
        rls_acl_result: inferAclResult(context),
      });
      throw error;
    }
  },
};

const getFieldCardToolAlias: AssistantToolDefinition = {
  name: "get_field_card",
  description: "Field card summary",
  domains: ["fields", "operations", "inventory", "weighbridge"],
  run: async (context) => {
    const query = parseFieldQueryFromContextV2(context);
    if (!query) {
      return {
        title: "Карточка поля",
        rows: [],
        source: {
          module: "fields",
          tableOrView: "fields (field_card)",
          season: context.runtimeContext.season,
          fetchedAt: nowIso(),
        },
        summary: "Уточните поле: номер или название.",
      };
    }

    const fieldRes = await context.supabase
      .from("fields")
      .select("id,name,area,notes")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .ilike("name", `%${query}%`)
      .limit(1)
      .maybeSingle();
    if (fieldRes.error) throw new Error(fieldRes.error.message);
    if (!fieldRes.data) {
      return {
        title: "Карточка поля",
        rows: [],
        source: {
          module: "fields",
          tableOrView: "fields (field_card)",
          season: context.runtimeContext.season,
          fetchedAt: nowIso(),
        },
        summary: "Поле не найдено.",
      };
    }

    const fieldId = String(fieldRes.data.id);
    const [opsRes, allocRes, consumptionRes, ticketRes] = await Promise.all([
      context.supabase
        .from("operations")
        .select("id,status")
        .eq("company_id", context.companyId)
        .eq("archived", false)
        .eq("field_id", fieldId),
      context.supabase
        .from("crop_structure")
        .select("crop_id,variety_id,reproduction_id,area")
        .eq("company_id", context.companyId)
        .eq("archived", false)
        .eq("field_id", fieldId)
        .limit(120),
      context.supabase
        .from("field_material_consumptions")
        .select("quantity_kg")
        .eq("company_id", context.companyId)
        .eq("field_id", fieldId)
        .limit(600),
      context.supabase
        .from("tickets")
        .select("net_weight_kg")
        .eq("company_id", context.companyId)
        .eq("field_id", fieldId)
        .eq("is_voided", false)
        .limit(300),
    ]);

    const allocations = allocRes.error ? [] : allocRes.data || [];
    const crops = new Set<string>();
    const varieties = new Set<string>();
    const reproductions = new Set<string>();
    const lookup = await buildLookupMaps(context, {
      crops: Array.from(new Set(allocations.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
      products: Array.from(new Set(allocations.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
      varieties: Array.from(new Set(allocations.map((x: any) => String(x.variety_id || "")).filter(Boolean))),
      reproductions: Array.from(new Set(allocations.map((x: any) => String(x.reproduction_id || "")).filter(Boolean))),
    });

    allocations.forEach((row: any) => {
      const cropId = cleanString(row.crop_id);
      const varietyId = cleanString(row.variety_id);
      const reproductionId = cleanString(row.reproduction_id);
      if (cropId) crops.add(lookup.byCrop.get(cropId) || lookup.byProduct.get(cropId) || cropId);
      if (varietyId) varieties.add(lookup.byVariety.get(varietyId) || varietyId);
      if (reproductionId) reproductions.add(lookup.byReproduction.get(reproductionId) || reproductionId);
    });

    const issuedKg = (consumptionRes.error ? [] : consumptionRes.data || []).reduce((acc: number, row: any) => {
      const qty = Number(row.quantity_kg || 0);
      return acc + (Number.isFinite(qty) ? Math.abs(qty) : 0);
    }, 0);

    const harvestKg = (ticketRes.error ? [] : ticketRes.data || []).reduce((acc: number, row: any) => {
      const qty = Number(row.net_weight_kg || 0);
      return acc + (Number.isFinite(qty) ? qty : 0);
    }, 0);

    const activeOperations = (opsRes.error ? [] : opsRes.data || []).filter((item: any) => {
      const status = cleanString(item.status)?.toLowerCase() || "";
      return !["completed", "verified", "cancelled"].includes(status);
    }).length;

    return {
      title: "Карточка поля",
      rows: [
        {
          field_id: fieldId,
          field_name: getFieldDisplayName(fieldRes.data) || String(fieldRes.data.name || fieldId),
          area_ha: Number(fieldRes.data.area || 0),
          crops: Array.from(crops).sort(),
          varieties: Array.from(varieties).sort(),
          reproductions: Array.from(reproductions).sort(),
          active_operations_count: activeOperations,
          material_issued_kg: Number(issuedKg.toFixed(3)),
          harvest_net_kg: Number(harvestKg.toFixed(3)),
        },
      ],
      source: {
        module: "fields",
        tableOrView: "fields + operations + crop_structure + field_material_consumptions + tickets",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getFieldTimelineToolAlias: AssistantToolDefinition = {
  name: "get_field_timeline",
  description: "Field timeline",
  domains: ["fields", "operations", "inventory", "weighbridge"],
  run: async (context) => {
    const query = parseFieldQueryFromContextV2(context);
    if (!query) {
      return {
        title: "Timeline поля",
        rows: [],
        source: {
          module: "fields",
          tableOrView: "field_timeline",
          season: context.runtimeContext.season,
          fetchedAt: nowIso(),
        },
      };
    }

    const fieldRes = await context.supabase
      .from("fields")
      .select("id,name")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .ilike("name", `%${query}%`)
      .limit(1)
      .maybeSingle();
    if (fieldRes.error) throw new Error(fieldRes.error.message);
    if (!fieldRes.data) {
      return {
        title: "Timeline поля",
        rows: [],
        source: {
          module: "fields",
          tableOrView: "field_timeline",
          season: context.runtimeContext.season,
          fetchedAt: nowIso(),
        },
      };
    }
    const fieldId = String(fieldRes.data.id);
    const [opsRes, ticketsRes] = await Promise.all([
      context.supabase
        .from("operations")
        .select("id,date,operation_type,status")
        .eq("company_id", context.companyId)
        .eq("archived", false)
        .eq("field_id", fieldId)
        .limit(200),
      context.supabase
        .from("tickets")
        .select("id,ticket_no,created_at,op_type,status,net_weight_kg")
        .eq("company_id", context.companyId)
        .eq("field_id", fieldId)
        .eq("is_voided", false)
        .limit(400),
    ]);
    const consumptionsRes = await context.supabase
      .from("field_material_consumptions")
      .select("id,consumed_at,quantity_kg,operation_type,material_category,product_id")
      .eq("company_id", context.companyId)
      .eq("field_id", fieldId)
      .limit(400);
    if (consumptionsRes.error) throw new Error(consumptionsRes.error.message);

    const rows: Array<Record<string, unknown>> = [];
    if (!opsRes.error) {
      (opsRes.data || []).forEach((row: any) =>
        rows.push({
          event_type: "operation_fact",
          date: cleanString(row.date),
          title: cleanString(row.operation_type),
          status: cleanString(row.status),
          ref_id: cleanString(row.id),
        })
      );
    }
    const consumptionRows = consumptionsRes.data || [];
    const lookup = await buildLookupMaps(context, {
      products: Array.from(new Set(consumptionRows.map((x: any) => String(x.product_id || "")).filter(Boolean))),
    });
    consumptionRows.forEach((row: any) =>
        rows.push({
          event_type: "issue",
          date: cleanString(row.consumed_at),
          qty_kg: Number(row.quantity_kg || 0),
          material: lookup.byProduct.get(String(row.product_id || "")) || cleanString(row.product_id) || "Материал",
          material_category: cleanString(row.material_category),
          reason: cleanString(row.operation_type),
          ref_id: cleanString(row.id),
        })
      );
    if (!ticketsRes.error) {
      (ticketsRes.data || []).forEach((row: any) =>
        rows.push({
          event_type: "weighbridge",
          date: cleanString(row.created_at),
          title: cleanString(row.ticket_no),
          ticket_type: cleanString(row.op_type),
          status: cleanString(row.status),
          net_kg: Number(row.net_weight_kg || 0),
          ref_id: cleanString(row.id),
        })
      );
    }

    rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    return {
      title: "Timeline поля",
      rows: rows.slice(0, 220),
      source: {
        module: "fields",
        tableOrView: "operations + field_material_consumptions + tickets",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getFieldMaterialsToolAlias: AssistantToolDefinition = {
  name: "get_field_materials",
  description: "Field materials fact",
  domains: ["fields", "inventory", "ledger"],
  run: async (context) => {
    const query = parseFieldQueryFromContextV2(context);
    if (!query) {
      return {
        title: "Материалы поля",
        rows: [],
        source: {
          module: "fields",
          tableOrView: "field_materials",
          season: context.runtimeContext.season,
          fetchedAt: nowIso(),
        },
      };
    }
    const fieldRes = await context.supabase
      .from("fields")
      .select("id,name")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .ilike("name", `%${query}%`)
      .limit(1)
      .maybeSingle();
    if (fieldRes.error) throw new Error(fieldRes.error.message);
    if (!fieldRes.data) {
      return {
        title: "Материалы поля",
        rows: [],
        source: {
          module: "fields",
          tableOrView: "field_materials",
          season: context.runtimeContext.season,
          fetchedAt: nowIso(),
        },
      };
    }

    const fieldId = String(fieldRes.data.id);
    const consumptionsRes = await context.supabase
      .from("field_material_consumptions")
      .select("product_id,quantity_kg")
      .eq("company_id", context.companyId)
      .eq("field_id", fieldId)
      .limit(2000);
    if (consumptionsRes.error) throw new Error(consumptionsRes.error.message);
    const raw = consumptionsRes.data || [];
    const lookup = await buildLookupMaps(context, {
      products: Array.from(new Set(raw.map((x: any) => String(x.product_id || "")).filter(Boolean))),
    });

    const grouped = new Map<string, number>();
    raw.forEach((row: any) => {
      // field_material_consumptions already stores factual issued quantities for a field.
      const productId = cleanString(row.product_id);
      const product = productId ? lookup.byProduct.get(productId) || productId : "Материал";
      const qtyAbs = Number(row.quantity_kg || 0);
      grouped.set(product, (grouped.get(product) || 0) + Math.abs(Number.isFinite(qtyAbs) ? qtyAbs : 0));
    });

    return {
      title: "Материалы поля",
      rows: Array.from(grouped.entries())
        .map(([product_name, qty_kg]) => ({ product_name, qty_kg: Number(qty_kg.toFixed(3)) }))
        .sort((a, b) => b.qty_kg - a.qty_kg)
        .slice(0, 200),
      source: {
        module: "fields",
        tableOrView: "field_material_consumptions",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const toolRegistry: Record<AssistantToolName, AssistantToolDefinition> = {
  get_current_context: getCurrentContextToolAlias,
  get_routes: getRoutesToolAlias,
  get_company_context: getCompanyContextTool,
  get_current_season: getCurrentSeasonTool,
  search_fields: searchFieldsToolAlias,
  get_field_card: getFieldCardToolAlias,
  get_field_timeline: getFieldTimelineToolAlias,
  get_field_materials: getFieldMaterialsToolAlias,
  find_field: findFieldToolAlias,
  search_warehouses: searchWarehousesToolAlias,
  get_warehouse_count: getWarehouseCountToolAlias,
  get_warehouse_stock: getWarehouseStockToolAlias,
  find_warehouse: findWarehouseToolAlias,
  search_operations: searchOperationsToolAlias,
  get_operation_details: getOperationDetailsToolAlias,
  find_operation: findOperationToolAlias,
  get_active_operations: getActiveOperationsToolAlias,
  get_active_tickets: getActiveTicketsToolAlias,
  get_recent_tickets: getRecentTicketsToolAlias,
  get_ticket_details: getTicketDetailsToolAlias,
  get_potato_material_report: getPotatoMaterialReportToolAlias,
  get_crop_structure_summary: getCropStructureSummaryToolAlias,
  search_crops_by_group: searchCropsByGroupToolAlias,
  get_warehouse_summary: getWarehouseSummaryToolAlias,
  get_fields: getFieldsTool,
  get_crop_structure: getCropStructureToolV2,
  get_inventory: getInventoryTool,
  get_batches: getBatchesTool,
  get_warehouse_balances: getWarehouseBalancesTool,
  get_warehouse_movements: getWarehouseMovementsTool,
  get_weighbridge_tickets: getWeighbridgeTicketsTool,
  get_operations: getOperationsTool,
  get_fuel_sources: getFuelSourcesTool,
  get_fuel_balances: getFuelBalancesTool,
  get_fuel_movements: getFuelMovementsTool,
  resolve_warehouse_by_name: resolveWarehouseByNameTool,
  resolve_field_by_number: resolveFieldByNumberTool,
  resolve_fuel_source_by_name: resolveFuelSourceByNameTool,
  resolve_page_or_module: resolvePageOrModuleTool,
  resolve_crop_variety: resolveCropVarietyTool,
  resolve_vehicle_or_equipment: resolveVehicleOrEquipmentTool,
  resolve_operation_type: resolveOperationTypeTool,
  create_operation_draft: makeDraftTool("create_operation_draft", "Создать черновик операции"),
  create_transfer_draft: makeDraftTool("create_transfer_draft", "Создать черновик перемещения"),
  create_fuel_issue_draft: makeDraftTool("create_fuel_issue_draft", "Создать черновик выдачи ГСМ"),
  create_field_task_draft: makeDraftTool("create_field_task_draft", "Создать черновик полевого задания"),
  create_material_issue_draft: makeDraftTool("create_material_issue_draft", "Создать черновик выдачи материала"),
  create_weighbridge_ticket_draft: makeDraftTool("create_weighbridge_ticket_draft", "Создать черновик талона весовой"),
  navigate_to_page: navigateToPageTool,
  open_entity: openEntityTool,
  apply_filter: applyFilterTool,
};

export function getAssistantTool(name: AssistantToolName): AssistantToolDefinition | null {
  return toolRegistry[name] || null;
}

export function getAllAssistantTools(): AssistantToolDefinition[] {
  return Object.values(toolRegistry);
}
