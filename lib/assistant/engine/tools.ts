import type { AssistantToolContext, AssistantToolDefinition, AssistantToolName } from "@/lib/assistant/engine/types";
import { getFieldDisplayName } from "@/lib/fields/display";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import {
  findCropAliasesInText,
  findCropGroupsInText,
  getAgroTaxonomySnapshot,
  listCropsByGroup,
  resolveKnownCropAlias,
} from "@/lib/assistant/agro-taxonomy";
import {
  buildMorningReportRows,
  buildQuickInsightRows,
  buildWarehouseInsightRows,
  buildWeighbridgeInsightRows,
  collectAssistantContextRows,
  normalizeWarehouseAlias,
  resolveAssistantEntityRows,
} from "@/lib/assistant/context-engine";
import { applySemanticExpansions } from "@/lib/assistant/knowledge/semantic-memory";
import { getAssistantRouteRegistry } from "@/lib/assistant/route-registry";

const DEFAULT_SEASON_YEAR = "2026";

const WAREHOUSE_ALIAS_RULES_RU: Array<{ match: RegExp; normalized: string }> = [
  { match: /(овощн|картофел|овощехранил|хранилищ|vegetable|potato)/i, normalized: "овощной склад" },
  { match: /(семенн|seed)/i, normalized: "склад семян" },
  { match: /(зернов|grain)/i, normalized: "зерновой склад" },
  { match: /(удобр|fertiliz|диам|dap|аммоф)/i, normalized: "склад удобрений" },
  { match: /(сзр|хим|pestic|fungic|herbic)/i, normalized: "склад сзр" },
];

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

function isQaMarkerText(value: unknown): boolean {
  const text = normalizeSearchText(value);
  if (!text) return false;
  const compact = text.replace(/[\s_-]+/g, "");
  if (compact.includes("qatest") || compact.includes("qacodex")) return true;
  return /(^|[\s_-])(test|temp|demo|archived|inactive)([\s_-]|$)/i.test(text);
}

function isDebugOrTestDataAllowed(context: AssistantToolContext): boolean {
  return (
    parseBoolish(context.intent.parameters.include_test_data) ||
    parseBoolish(context.intent.parameters.debug) ||
    parseBoolish(context.intent.parameters.test_mode)
  );
}

function rowHasQaMarker(row: Record<string, unknown>, keys?: string[]): boolean {
  const values = keys?.length ? keys.map((key) => row[key]) : Object.values(row);
  return values.some(isQaMarkerText);
}

function filterQaRows(
  context: AssistantToolContext,
  rows: Array<Record<string, unknown>>,
  keys?: string[]
): Array<Record<string, unknown>> {
  if (isDebugOrTestDataAllowed(context)) return rows;
  return rows.filter((row) => !rowHasQaMarker(row, keys));
}

type AssistantSeasonScope = {
  seasonYear: string | null;
  seasonId: string | null;
  source: string;
  seasonStartIso: string | null;
  seasonEndIso: string | null;
};

function toStartOfDayIso(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const withTime = text.includes("T") ? text : `${text}T00:00:00.000Z`;
  const dt = new Date(withTime);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function toEndOfDayIso(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const withTime = text.includes("T") ? text : `${text}T23:59:59.999Z`;
  const dt = new Date(withTime);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function seasonBoundariesFromYear(seasonYear: string | null): { start: string | null; end: string | null } {
  const year = Number(seasonYear);
  if (!Number.isFinite(year)) return { start: null, end: null };
  const normalizedYear = Math.trunc(year);
  return {
    start: `${normalizedYear}-01-01T00:00:00.000Z`,
    end: `${normalizedYear}-12-31T23:59:59.999Z`,
  };
}

function isDateWithinSeasonRange(
  value: unknown,
  seasonStartIso: string | null,
  seasonEndIso: string | null
): boolean {
  const text = cleanString(value);
  if (!text) return false;
  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) return false;
  const ts = dt.getTime();
  const start = seasonStartIso ? new Date(seasonStartIso).getTime() : Number.NEGATIVE_INFINITY;
  const end = seasonEndIso ? new Date(seasonEndIso).getTime() : Number.POSITIVE_INFINITY;
  return ts >= start && ts <= end;
}

function matchesSeasonIdentity(
  seasonScope: AssistantSeasonScope,
  row: Record<string, unknown>,
  options?: { allowDateFallback?: boolean; dateKeys?: string[] }
): boolean {
  const allowDateFallback = Boolean(options?.allowDateFallback);
  const dateKeys = options?.dateKeys || ["date", "consumed_at", "finalized_at", "created_at"];
  const rowSeasonId = cleanString((row as any).season_id);
  if (seasonScope.seasonId && rowSeasonId) {
    return rowSeasonId === seasonScope.seasonId;
  }

  const rowSeasonYear =
    cleanString((row as any).season_year) ||
    cleanString((row as any).season) ||
    cleanString((row as any).year) ||
    cleanString((row as any).harvest_year) ||
    null;
  if (seasonScope.seasonYear && rowSeasonYear) {
    return String(rowSeasonYear) === String(seasonScope.seasonYear);
  }

  if (!allowDateFallback) return false;
  for (const key of dateKeys) {
    if (isDateWithinSeasonRange((row as any)[key], seasonScope.seasonStartIso, seasonScope.seasonEndIso)) {
      return true;
    }
  }
  return false;
}

function hasArchiveWords(value: unknown): boolean {
  const text = normalizeSearchText(value);
  if (!text) return false;
  return /(архив|неактив|стар(ые|ый)?|including archive|with archive|inactive)/i.test(text);
}

function hasArchiveWordsV2(value: unknown): boolean {
  const text = normalizeSearchText(value);
  if (!text) return false;
  return /(архив|неактив|стар(ые|ый)?|including archive|with archive|inactive|old)/i.test(text);
}

function includeArchivedByRequest(context: AssistantToolContext): boolean {
  if (parseBoolish(context.intent.parameters.include_archived)) return true;
  const directQuery = cleanString(context.intent.parameters.query);
  if (hasArchiveWordsV2(directQuery) || hasArchiveWords(directQuery)) return true;
  const searchQuery = parseSearchQuery(context);
  if (hasArchiveWordsV2(searchQuery) || hasArchiveWords(searchQuery)) return true;
  return false;
}

function resolveWarehouseAliasQuery(raw: string | null): string | null {
  const text = normalizeSearchText(raw);
  if (!text) return null;
  const unicodeAlias = normalizeWarehouseAlias(raw);
  if (unicodeAlias && normalizeSearchText(unicodeAlias) !== text) {
    return unicodeAlias;
  }
  for (const rule of WAREHOUSE_ALIAS_RULES_RU) {
    if (rule.match.test(text)) {
      return rule.normalized;
    }
  }
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

    const genericFieldQueryLoose =
      /(какие|сколько|список|все|назови|покажи|list|all|count)/i.test(normalized) &&
      /(поля|поле|fields?|field)/i.test(normalized);
    if (!genericFieldQuery && !genericFieldQueryLoose && withoutPrefix.length > 0 && withoutPrefix.length <= 48) {
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

    const genericFieldQueryLoose =
      /(какие|сколько|список|все|назови|покажи|list|all|count)/i.test(normalized) &&
      /(поля|поле|fields?|field)/i.test(normalized);
    if (!genericFieldQuery && !genericFieldQueryLoose && withoutPrefix.length > 0 && withoutPrefix.length <= 48) {
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

async function resolveSeasonScope(companyId: string, context: AssistantToolContext): Promise<AssistantSeasonScope> {
  const base = await resolveSeasonContext(companyId, context);
  let seasonYear = base.seasonYear || null;
  let seasonId = base.seasonId || null;
  let seasonStartIso: string | null = null;
  let seasonEndIso: string | null = null;

  if (seasonId) {
    const byId = await context.supabase
      .from("seasons")
      .select("id,year,start_date,end_date")
      .eq("company_id", companyId)
      .eq("id", seasonId)
      .limit(1)
      .maybeSingle();

    if (!byId.error && byId.data) {
      seasonYear = cleanString(byId.data.year) || seasonYear;
      seasonStartIso = toStartOfDayIso((byId.data as any).start_date);
      seasonEndIso = toEndOfDayIso((byId.data as any).end_date);
    }
  } else if (seasonYear) {
    const yearNum = Number(seasonYear);
    if (Number.isFinite(yearNum)) {
      const byYear = await context.supabase
        .from("seasons")
        .select("id,year,start_date,end_date")
        .eq("company_id", companyId)
        .eq("year", Math.trunc(yearNum))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!byYear.error && byYear.data) {
        seasonId = cleanString(byYear.data.id) || seasonId;
        seasonYear = cleanString(byYear.data.year) || seasonYear;
        seasonStartIso = toStartOfDayIso((byYear.data as any).start_date);
        seasonEndIso = toEndOfDayIso((byYear.data as any).end_date);
      }
    }
  }

  if (!seasonStartIso || !seasonEndIso) {
    const boundaries = seasonBoundariesFromYear(seasonYear);
    seasonStartIso = seasonStartIso || boundaries.start;
    seasonEndIso = seasonEndIso || boundaries.end;
  }

  return {
    seasonYear,
    seasonId,
    source: base.source,
    seasonStartIso,
    seasonEndIso,
  };
}

async function queryLookupRowsById(
  context: AssistantToolContext,
  table: string,
  select: string,
  ids: string[],
  strictActive: boolean
): Promise<any[]> {
  if (!ids.length) return [];

  const attempts = strictActive
    ? [
        () => context.supabase.from(table).select(select).in("id", ids).eq("archived", false).eq("is_active", true),
        () => context.supabase.from(table).select(select).in("id", ids).eq("archived", false),
        () => context.supabase.from(table).select(select).in("id", ids).eq("is_active", true),
        () => context.supabase.from(table).select(select).in("id", ids),
      ]
    : [() => context.supabase.from(table).select(select).in("id", ids)];

  let lastError: string | null = null;
  for (const attempt of attempts) {
    const res: any = await attempt();
    if (!res.error) {
      return res.data || [];
    }
    const message = String(res.error?.message || res.error || "");
    lastError = message;
    if (isMissingRelationError(message)) {
      continue;
    }
  }

  if (lastError) {
    throw new Error(lastError);
  }
  return [];
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
  },
  options?: { strictActive?: boolean }
) {
  const strictActive = Boolean(options?.strictActive);
  const [warehousesRes, productsRes, cropsRes, varietiesRes, reproductionsRes, fieldsRes, fuelSourcesRes] = await Promise.all([
    (ids.warehouses || []).length
      ? context.supabase.from("warehouses").select("id,name").in("id", ids.warehouses as string[])
      : Promise.resolve({ data: [], error: null } as any),
    (ids.products || []).length
      ? queryLookupRowsById(context, "products", "id,name,trade_name", ids.products as string[], strictActive)
      : Promise.resolve({ data: [], error: null } as any),
    (ids.crops || []).length
      ? queryLookupRowsById(context, "crops", "id,name,name_ru,name_kz,name_en,slug", ids.crops as string[], strictActive)
      : Promise.resolve({ data: [], error: null } as any),
    (ids.varieties || []).length
      ? queryLookupRowsById(context, "varieties", "id,name", ids.varieties as string[], strictActive)
      : Promise.resolve({ data: [], error: null } as any),
    (ids.reproductions || []).length
      ? queryLookupRowsById(context, "seed_reproductions", "id,name,name_ru,name_kz,name_en,code", ids.reproductions as string[], strictActive)
      : Promise.resolve({ data: [], error: null } as any),
    (ids.fields || []).length
      ? (strictActive
          ? context.supabase
              .from("fields")
              .select("id,name,notes")
              .in("id", ids.fields as string[])
              .eq("archived", false)
          : context.supabase.from("fields").select("id,name,notes").in("id", ids.fields as string[]))
      : Promise.resolve({ data: [], error: null } as any),
    (ids.fuelSources || []).length
      ? context.supabase.from("fuel_sources").select("id,name").in("id", ids.fuelSources as string[])
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const byWarehouse = new Map<string, string>();
  (warehousesRes.data || warehousesRes || []).forEach((row: any) => byWarehouse.set(String(row.id), String(row.name || row.id)));

  const byProduct = new Map<string, string>();
  (productsRes.data || productsRes || []).forEach((row: any) =>
    byProduct.set(String(row.id), brandName(row) || String(row.id))
  );

  const byCrop = new Map<string, string>();
  (cropsRes.data || cropsRes || []).forEach((row: any) =>
    byCrop.set(String(row.id), localizedName(row, "ru") || String(row.id))
  );

  const byVariety = new Map<string, string>();
  (varietiesRes.data || varietiesRes || []).forEach((row: any) => byVariety.set(String(row.id), brandName(row) || String(row.id)));

  const byReproduction = new Map<string, string>();
  (reproductionsRes.data || reproductionsRes || []).forEach((row: any) =>
    byReproduction.set(String(row.id), localizedName(row, "ru", ["name", "code"]) || String(row.id))
  );

  const byField = new Map<string, string>();
  (fieldsRes.data || fieldsRes || []).forEach((row: any) =>
    byField.set(String(row.id), getFieldDisplayName(row) || String(row.id))
  );

  const byFuelSource = new Map<string, string>();
  (fuelSourcesRes.data || fuelSourcesRes || []).forEach((row: any) => byFuelSource.set(String(row.id), String(row.name || row.id)));

  return { byWarehouse, byProduct, byCrop, byVariety, byReproduction, byField, byFuelSource };
}

async function getWarehouseScope(
  context: AssistantToolContext,
  includeArchived: boolean
): Promise<{ ids: Set<string>; names: Set<string> } | null> {
  if (includeArchived) return null;

  let res: any = await context.supabase
    .from("warehouses")
    .select("id,name,archived,is_archived")
    .eq("company_id", context.companyId)
    .limit(1500);

  if (res.error && String(res.error.message || "").toLowerCase().includes("is_archived")) {
    res = await context.supabase
      .from("warehouses")
      .select("id,name,archived")
      .eq("company_id", context.companyId)
      .limit(1500);
  }
  if (res.error) throw new Error(res.error.message);

  const rows = (res.data || []).filter((row: any) => {
    const archivedFlag = Boolean(row.archived || row.is_archived);
    return !archivedFlag;
  });

  return {
    ids: new Set(rows.map((row: any) => String(row.id))),
    names: new Set(rows.map((row: any) => normalizeSearchText(row.name))),
  };
}

function extractFieldCode(value: string | null): string | null {
  const normalized = normalizeSearchText(value || "");
  if (!normalized) return null;
  const codeMatch = normalized.match(/\b\d{1,3}(?:-\d{1,3}){0,2}\b/);
  return cleanString(codeMatch?.[0]);
}

async function resolveBestFieldMatches(
  context: AssistantToolContext,
  rawQuery: string,
  maxRows = 6
): Promise<
  Array<{ id: string; name: string; displayName: string; area: number; notes: string | null; score: number; reason: string }>
> {
  const query = normalizeSearchText(rawQuery);
  if (!query) return [];
  const code = extractFieldCode(rawQuery);
  const exactQuery = cleanString(rawQuery);
  const byId = new Map<string, { id: string; name: string; displayName: string; area: number; notes: string | null }>();

  const exactTerms = uniqueStrings([exactQuery, code]);
  for (const term of exactTerms) {
    const exactRes = await context.supabase
      .from("fields")
      .select("id,name,area,notes")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .eq("name", term)
      .limit(12);
    if (exactRes.error) throw new Error(exactRes.error.message);
    (exactRes.data || []).forEach((row: any) => {
      const id = String(row.id);
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: String(row.name || row.id),
          displayName: getFieldDisplayName(row) || String(row.name || row.id),
          area: Number(row.area || 0),
          notes: cleanString(row.notes),
        });
      }
    });
  }

  const fuzzyNeedle = code || query;
  const fuzzyRes = await context.supabase
    .from("fields")
    .select("id,name,area,notes")
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .ilike("name", `%${fuzzyNeedle}%`)
    .order("name", { ascending: true })
    .limit(260);

  if (fuzzyRes.error) throw new Error(fuzzyRes.error.message);
  (fuzzyRes.data || []).forEach((row: any) => {
    const id = String(row.id);
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: String(row.name || row.id),
        displayName: getFieldDisplayName(row) || String(row.name || row.id),
        area: Number(row.area || 0),
        notes: cleanString(row.notes),
      });
    }
  });

  const scoreField = (nameRaw: unknown, displayRaw: unknown): { score: number; reason: string } => {
    const name = normalizeSearchText(nameRaw);
    const display = normalizeSearchText(displayRaw);
    if (!name) return { score: 0, reason: "empty_name" };
    let score = 0;
    const reasons: string[] = [];

    if (code) {
      if (display === code) {
        score += 900;
        reasons.push("display_exact_code");
      }
      if (name === code) {
        score += 500;
        reasons.push("name_exact_code");
      }
      if (name.startsWith(`${code} `) || name.startsWith(`${code}-`) || name.includes(` ${code} `)) {
        score += 300;
        reasons.push("name_contains_code");
      }
    }
    if (display === query) {
      score += 800;
      reasons.push("display_exact_query");
    }
    if (name === query) {
      score += 240;
      reasons.push("name_exact_query");
    }
    if (name.startsWith(query)) {
      score += 140;
      reasons.push("name_starts_query");
    }
    if (name.includes(query)) {
      score += 80;
      reasons.push("name_contains_query");
    }

    return { score, reason: reasons.join("|") || "score_0" };
  };

  return Array.from(byId.values())
    .map((row) => {
      const scored = scoreField(row.name, row.displayName);
      return {
        ...row,
        score: scored.score,
        reason: scored.reason,
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => (b.score - a.score) || a.displayName.localeCompare(b.displayName, "ru") || a.name.localeCompare(b.name, "ru"))
    .slice(0, maxRows);
}

async function resolveFieldSelection(
  context: AssistantToolContext,
  rawQuery: string | null,
  maxRows = 8
): Promise<{
  selected: { id: string; name: string; displayName: string; area: number; notes: string | null } | null;
  candidates: Array<{ id: string; name: string; displayName: string; area: number; notes: string | null; score: number; reason: string }>;
  ambiguityReason: string | null;
}> {
  if (!cleanString(rawQuery)) {
    return { selected: null, candidates: [], ambiguityReason: null };
  }

  const query = normalizeSearchText(rawQuery);
  const matches = await resolveBestFieldMatches(context, String(rawQuery), maxRows);
  if (!matches.length) {
    return { selected: null, candidates: [], ambiguityReason: null };
  }

  const selectedFieldIdFromContext =
    cleanString(context.runtimeContext.selectedFieldId) ||
    cleanString(context.runtimeContext.selectedEntityId) ||
    cleanString(context.runtimeContext.entity?.id);

  const displayExact = matches.filter((item) => normalizeSearchText(item.displayName) === query);
  if (displayExact.length === 1) {
    return { selected: displayExact[0], candidates: matches, ambiguityReason: null };
  }
  if (displayExact.length > 1) {
    if (selectedFieldIdFromContext) {
      const contextual = displayExact.find((item) => item.id === selectedFieldIdFromContext);
      if (contextual) {
        return { selected: contextual, candidates: matches, ambiguityReason: null };
      }
    }
    return { selected: null, candidates: displayExact, ambiguityReason: "multiple_segments_for_display_key" };
  }

  const rawExact = matches.filter((item) => normalizeSearchText(item.name) === query);
  if (rawExact.length === 1) {
    return { selected: rawExact[0], candidates: matches, ambiguityReason: null };
  }

  if (rawExact.length > 1) {
    if (selectedFieldIdFromContext) {
      const contextual = rawExact.find((item) => item.id === selectedFieldIdFromContext);
      if (contextual) {
        return { selected: contextual, candidates: matches, ambiguityReason: null };
      }
    }
    return { selected: null, candidates: rawExact, ambiguityReason: "multiple_exact_raw_matches" };
  }

  const bestScore = matches[0].score;
  const topGroup = matches.filter((item) => item.score === bestScore);
  const segmentAgnosticNumericQuery = /^\d{1,3}$/u.test(query);
  if (segmentAgnosticNumericQuery && topGroup.length > 1) {
    if (selectedFieldIdFromContext) {
      const contextual = topGroup.find((item) => item.id === selectedFieldIdFromContext);
      if (contextual) {
        return { selected: contextual, candidates: matches, ambiguityReason: null };
      }
    }
    return { selected: null, candidates: topGroup, ambiguityReason: "multiple_segment_candidates" };
  }

  return { selected: matches[0], candidates: matches, ambiguityReason: null };
}

async function resolveSingleFieldMatch(
  context: AssistantToolContext,
  rawQuery: string | null
): Promise<{ id: string; name: string; area: number; notes: string | null } | null> {
  if (!cleanString(rawQuery)) return null;
  const resolved = await resolveFieldSelection(context, String(rawQuery), 6);
  if (!resolved.selected) return null;
  const first = resolved.selected;
  return {
    id: first.id,
    name: first.name,
    area: first.area,
    notes: first.notes,
  };
}

async function enrichTickets(
  context: AssistantToolContext,
  rawRows: Array<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  if (!rawRows.length) return [];

  const ticketIds = Array.from(
    new Set(rawRows.map((row) => cleanString(row.id)).filter(Boolean))
  ) as string[];
  const driverIds = Array.from(
    new Set(rawRows.map((row) => cleanString(row.driver_id)).filter(Boolean))
  ) as string[];
  const vehicleIds = Array.from(
    new Set(rawRows.map((row) => cleanString(row.vehicle_id)).filter(Boolean))
  ) as string[];
  const fieldIds = Array.from(
    new Set(rawRows.map((row) => cleanString(row.field_id)).filter(Boolean))
  ) as string[];

  const [linesRes, driversRes, vehiclesRes, lookup] = await Promise.all([
    ticketIds.length
      ? context.supabase
          .from("ticket_lines")
          .select("ticket_id,product_id,variety_id")
          .in("ticket_id", ticketIds)
          .limit(1200)
      : Promise.resolve({ data: [], error: null } as any),
    driverIds.length
      ? context.supabase
          .from("reference_specialists")
          .select("id,full_name")
          .in("id", driverIds)
      : Promise.resolve({ data: [], error: null } as any),
    vehicleIds.length
      ? context.supabase
          .from("reference_vehicles")
          .select("id,name,plate_number")
          .in("id", vehicleIds)
      : Promise.resolve({ data: [], error: null } as any),
    buildLookupMaps(context, { fields: fieldIds }),
  ]);

  const productIds = Array.from(
    new Set((linesRes.data || []).map((row: any) => cleanString(row.product_id)).filter(Boolean))
  ) as string[];
  const varietyIds = Array.from(
    new Set((linesRes.data || []).map((row: any) => cleanString(row.variety_id)).filter(Boolean))
  ) as string[];
  const lineLookup = await buildLookupMaps(context, {
    products: productIds,
    varieties: varietyIds,
  });

  const firstLineByTicket = new Map<string, { product_name: string | null; variety_name: string | null }>();
  (linesRes.data || []).forEach((row: any) => {
    const ticketId = cleanString(row.ticket_id);
    if (!ticketId || firstLineByTicket.has(ticketId)) return;
    const productId = cleanString(row.product_id);
    const varietyId = cleanString(row.variety_id);
    firstLineByTicket.set(ticketId, {
      product_name: productId ? lineLookup.byProduct.get(productId) || productId : null,
      variety_name: varietyId ? lineLookup.byVariety.get(varietyId) || varietyId : null,
    });
  });

  const driverMap = new Map<string, string>();
  if (!driversRes.error) {
    (driversRes.data || []).forEach((row: any) => {
      driverMap.set(String(row.id), cleanString(row.full_name) || cleanString(row.email) || String(row.id));
    });
  }

  const vehicleMap = new Map<string, string>();
  if (!vehiclesRes.error) {
    (vehiclesRes.data || []).forEach((row: any) => {
      const label = cleanString(row.plate_number) || cleanString(row.name) || String(row.id);
      vehicleMap.set(String(row.id), label);
    });
  }

  return rawRows.map((row) => {
    const id = cleanString(row.id);
    const driverId = cleanString(row.driver_id);
    const vehicleId = cleanString(row.vehicle_id);
    const fieldId = cleanString(row.field_id);
    const line = id ? firstLineByTicket.get(id) : null;
    return {
      ...row,
      driver_name: driverId ? driverMap.get(driverId) || null : null,
      vehicle_label: vehicleId ? vehicleMap.get(vehicleId) || null : null,
      field_name: fieldId ? lookup.byField.get(fieldId) || null : null,
      product_name: line?.product_name || null,
      variety_name: line?.variety_name || null,
    };
  });
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
    const includeArchived = includeArchivedByRequest(context);
    const allowTestData = isDebugOrTestDataAllowed(context);
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
      return normalized && normalized !== "склад" && normalized !== "warehouse" && normalized !== "storage";
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
      include_archived: includeArchived,
      negative_only: negativeOnly,
      rls_acl_result: inferAclResult(context),
    });

    try {
      const activeWarehouseScope = await getWarehouseScope(context, includeArchived);
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
            warehouse_id: warehouseId,
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
              warehouse_id: warehouseId,
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
            .select("warehouse_id,product_id,variety_id,reproduction_id,batch_id_text,batch_class,direction,qty_abs,delta_qty_signed,quantity,reason_type,notes")
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
          (ledgerRes.data || [])
            .filter((row: any) => {
              if (allowTestData) return true;
              return ![
                row.notes,
                row.reason_type,
                row.batch_id_text,
                row.batch_class,
              ].some(isQaMarkerText);
            })
            .forEach((row: any) => {
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
            warehouse_id: row.warehouse_id,
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
          if (!allowTestData && [
            row.warehouse_name,
            row.product_name,
            row.variety_name,
            row.reproduction_name,
            row.batch_id,
            row.batch_class,
          ].some(isQaMarkerText)) {
            return false;
          }
          if (activeWarehouseScope) {
            const id = cleanString((row as any).warehouse_id);
            const name = normalizeSearchText((row as any).warehouse_name);
            if (id && !activeWarehouseScope.ids.has(id) && !activeWarehouseScope.names.has(name)) {
              return false;
            }
          }
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
    const allowTestData = isDebugOrTestDataAllowed(context);
    const directionFilter = normalizeSearchText(context.intent.parameters.direction);
    const movementQuery = parseSearchQuery(context);
    const queryProductAlias = movementQuery
      ? resolveKnownCropAlias(movementQuery) || findCropAliasesInText(movementQuery)[0] || null
      : null;
    const productQuery =
      cleanString(context.intent.parameters.product) ||
      cleanString(context.intent.parameters.crop) ||
      cleanString(context.intent.parameters.crop_alias) ||
      queryProductAlias;
    const productTerms = buildSearchTerms(productQuery);
    const queryWarehouseHint = resolveWarehouseAliasQuery(movementQuery);
    const explicitWarehouseInput =
      cleanString(context.intent.parameters.warehouse) ||
      cleanString(context.intent.parameters.warehouse_alias) ||
      cleanString(context.runtimeContext.filters.warehouse);
    const warehouseQuery =
      explicitWarehouseInput ||
      queryWarehouseHint ||
      cleanString(context.sessionState.lastWarehouseLabel) ||
      cleanString(context.sessionState.lastWarehouse) ||
      cleanString(context.sessionState.lastWarehouseId);
    const warehouseIdFilter =
      cleanString(context.intent.parameters.warehouse_id) ||
      (!explicitWarehouseInput && !queryWarehouseHint ? cleanString(context.sessionState.lastWarehouseId) : null);
    const warehouseTerms = buildSearchTerms(resolveWarehouseAliasQuery(warehouseQuery));
    const fetchLimit = warehouseTerms.length || warehouseIdFilter || productTerms.length ? Math.max(limit * 6, 240) : limit;
    const res = await context.supabase
      .from("stock_ledger_entries")
      .select("*")
      .eq("company_id", context.companyId)
      .order("created_at", { ascending: false })
      .limit(fetchLimit);

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
        warehouse_id: warehouseId,
        product_id: productId,
        warehouse_name: lookup.byWarehouse.get(warehouseId) || warehouseId,
        product_name: lookup.byProduct.get(productId) || productId,
        variety_name: varietyId ? lookup.byVariety.get(varietyId) || "-" : "-",
        reproduction_name: reproductionId ? lookup.byReproduction.get(reproductionId) || "-" : "-",
          batch_class: cleanString(row.batch_class) || "commodity",
          batch_id: cleanString(row.batch_id_text || row.batch_id),
          reason: cleanString(row.reason_type || row.reason) || "-",
          document_ref: cleanString(row.reason_ref_id || row.ticket_id || row.processing_id),
          ticket_id: cleanString(row.ticket_id),
          source_system: "stock_ledger_entries",
        };
      })
      .filter((row) => {
        if (!allowTestData && [
          row.warehouse_name,
          row.product_name,
          row.variety_name,
          row.reproduction_name,
          row.batch_id,
          row.batch_class,
          row.reason,
          row.document_ref,
        ].some(isQaMarkerText)) {
          return false;
        }
        if (directionFilter) {
          const dir = normalizeSearchText(row.direction);
          if (directionFilter === "in" && !(dir === "in" || dir === "incoming")) return false;
          if (directionFilter === "out" && !(dir === "out" || dir === "outgoing")) return false;
        }
        if (warehouseIdFilter && row.warehouse_id !== warehouseIdFilter) return false;
        if (warehouseTerms.length && !matchesAnyTerm(row.warehouse_name, warehouseTerms)) return false;
        if (productTerms.length) {
          const productBlob = [row.product_name, row.variety_name, row.reproduction_name, row.batch_class].join(" ");
          return matchesAnyTerm(productBlob, productTerms);
        }
        return true;
      })
      .slice(0, limit);

    return {
      title: "Последние движения склада",
      rows,
      source: {
        module: "ledger",
        tableOrView: "stock_ledger_entries",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getFieldLandBankSummaryTool: AssistantToolDefinition = {
  name: "get_field_land_bank_summary",
  description: "Aggregate field land bank summary",
  domains: ["fields", "reports"],
  run: async (context) => {
    const queryUsed = "fields.select(id,area).eq(company_id).eq(archived,false)";
    logToolEvent(context, "get_field_land_bank_summary", "start", {
      input_args: context.intent.parameters,
      query_used: queryUsed,
      source_of_truth: "fields",
      scope: "company_id + archived=false",
      rls_acl_result: inferAclResult(context),
    });

    try {
      const res = await context.supabase
        .from("fields")
        .select("id,area")
        .eq("company_id", context.companyId)
        .eq("archived", false)
        .limit(5000);

      if (res.error) throw new Error(res.error.message);

      const rows = res.data || [];
      const totalFields = rows.length;
      const totalAreaHa = Number(rows.reduce((sum, row: any) => sum + Number(row.area || 0), 0).toFixed(3));

      logToolEvent(context, "get_field_land_bank_summary", "success", {
        input_args: context.intent.parameters,
        query_used: queryUsed,
        rows_count: 1,
        total_fields: totalFields,
        total_area_ha: totalAreaHa,
        source_of_truth: "fields",
        scope: "company_id + archived=false",
        rls_acl_result: inferAclResult(context),
      });

      return {
        title: "Field land bank summary",
        rows: [
          {
            metric: "field_land_bank",
            total_fields: totalFields,
            total_area_ha: totalAreaHa,
            source: "fields",
            scope: "company_id + archived=false",
          },
        ],
        source: {
          module: "fields",
          tableOrView: "fields (land_bank_summary)",
          season: null,
          fetchedAt: nowIso(),
        },
        summary: `Field land bank: ${totalFields} fields, ${totalAreaHa} ha. Source of truth: fields where archived=false.`,
      };
    } catch (error) {
      logToolEvent(context, "get_field_land_bank_summary", "error", {
        input_args: context.intent.parameters,
        query_used: queryUsed,
        rows_count: 0,
        error_message: error instanceof Error ? error.message : "unknown error",
        rls_acl_result: inferAclResult(context),
      });
      throw error;
    }
  },
};

const getFieldsTool: AssistantToolDefinition = {
  name: "get_fields",
  description: "Список полей",
  domains: ["fields"],
  run: async (context) => {
    const searchQuery = parseFieldQueryFromContextV2(context);
    const rawQuery = normalizeSearchText(parseSearchQuery(context) || searchQuery || "");
    const hasExplicitFieldNumber = /\b\d{1,3}(?:-\d{1,3}){0,2}\b/.test(rawQuery);
    const asksLargestField =
      /(?:сам\w*\s+больш|наибольш|крупн|макс|больше\s+всего|largest|biggest|max(?:imum)?|СЃР°Рј\w*\s+Р±РѕР»СЊС€|РЅР°РёР±РѕР»СЊС€|РєСЂСѓРїРЅ|РјР°РєСЃ|Р±РѕР»СЊС€Рµ\s+РІСЃРµРіРѕ)/i.test(
        rawQuery
      );
    const outputType = cleanString(context.intent.parameters.output_type);
    const shouldApplySearchFilter = outputType === "filtered_summary" || (outputType === "list" && hasExplicitFieldNumber);
    const res = await context.supabase
      .from("fields")
      .select("id,name,notes,area,archived")
      .eq("company_id", context.companyId)
      .eq("archived", false)
      .order("name", { ascending: true })
      .limit(300);

    if (res.error) throw new Error(res.error.message);

    const fieldRowsWithNotes = applyTextFilter(
      (res.data || []).map((row: any) => ({
        field_id: String(row.id),
        field_name: getFieldDisplayName(row) || String(row.id),
        area_ha: Number(row.area || 0),
        field_notes: cleanString(row.notes),
      })),
      shouldApplySearchFilter ? searchQuery : null
    );
    const rows = filterQaRows(context, fieldRowsWithNotes, ["field_name", "field_notes"])
      .sort((a, b) => (asksLargestField ? Number((b as any).area_ha || 0) - Number((a as any).area_ha || 0) : 0))
      .map(({ field_notes: _fieldNotes, ...row }, index) =>
        asksLargestField && index === 0
          ? { ...row, assistant_focus: "field", assistant_focus_reason: "largest_field_by_area" }
          : row
      )
      .slice(0, 120);

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

    const mappedRows = raw.map((row: any) => {
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
    const rows = filterQaRows(context, mappedRows, [
      "field_name",
      "crop_name",
      "variety_name",
      "reproduction_name",
    ]);

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
      "crop_structure.select(id,field_id,crop_id,variety_id,reproduction_id,season_id,area,notes,seasons:season_id(year)).eq(company_id)";

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
            "crop_structure.select(id,field_id,crop_id,variety_id,reproduction_id,season_id,area,notes,seasons:season_id(year)).eq(company_id).eq(archived,false).eq(season_id)",
          run: async () => {
            if (!seasonCtx.seasonId) return { data: [], error: new Error("season_id_unavailable") };
            return context.supabase
              .from("crop_structure")
              .select("id,field_id,crop_id,variety_id,reproduction_id,season_id,area,notes,seasons:season_id(year)")
              .eq("company_id", context.companyId)
              .eq("archived", false)
              .eq("season_id", seasonCtx.seasonId)
              .limit(1000);
          },
        },
        {
          queryUsed:
            "crop_structure.select(id,field_id,crop_id,variety_id,reproduction_id,season_year,area,notes).eq(company_id).eq(archived,false).eq(season_year)",
          run: async () =>
            context.supabase
              .from("crop_structure")
              .select("id,field_id,crop_id,variety_id,reproduction_id,season_year,area,notes")
              .eq("company_id", context.companyId)
              .eq("archived", false)
              .eq("season_year", forcedSeasonYear)
              .limit(1000),
        },
        {
          queryUsed:
            "crop_structure.select(id,field_id,crop_id,variety_id,reproduction_id,season,area,notes).eq(company_id).eq(archived,false).eq(season)",
          run: async () =>
            context.supabase
              .from("crop_structure")
              .select("id,field_id,crop_id,variety_id,reproduction_id,season,area,notes")
              .eq("company_id", context.companyId)
              .eq("archived", false)
              .eq("season", Number(forcedSeasonYear))
              .limit(1000),
        },
        {
          queryUsed:
            "crop_structure.select(id,field_id,crop_id,variety_id,reproduction_id,season_id,area,notes,seasons:season_id(year)).eq(company_id).eq(archived,false)",
          run: async () =>
            context.supabase
              .from("crop_structure")
              .select("id,field_id,crop_id,variety_id,reproduction_id,season_id,area,notes,seasons:season_id(year)")
              .eq("company_id", context.companyId)
              .eq("archived", false)
              .limit(1000),
        },
        {
          queryUsed:
            "crop_structure.select(id,field_id,crop_id,variety_id,reproduction_id,season_year,area,notes).eq(company_id).eq(archived,false)",
          run: async () =>
            context.supabase
              .from("crop_structure")
              .select("id,field_id,crop_id,variety_id,reproduction_id,season_year,area,notes")
              .eq("company_id", context.companyId)
              .eq("archived", false)
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
        const cropName = lookup.byCrop.get(cropId) || "";
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
          crop_catalog_match: Boolean(cropName),
          crop_name: cropName || cropId,
          variety_name: varietyId ? lookup.byVariety.get(varietyId) || "-" : "-",
          reproduction_name: reproductionId ? lookup.byReproduction.get(reproductionId) || "-" : "-",
          area_ha: Number(row.area ?? row.area_ha ?? 0),
          notes: cleanString(row.notes),
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
      const varietyAliases = new Set(["gala", "soraya", "baltic rose", "azilit", "colombo", "impala"]);
      const allowAliasMatchOnVariety = cropAliasTerm
        ? varietyAliases.has(normalizeSearchText(cropAliasTerm))
        : false;

      const canonicalRows = mappedRows.filter((row) => row.crop_catalog_match);

      const filteredRows = canonicalRows.filter((row) => {
        if (seasonFilter && cleanString(row.season_year) && cleanString(row.season_year) !== seasonFilter) {
          return false;
        }

        if (cropTerms.length) {
          const cropBlob = [row.crop_name].join(" ");
          const varietyBlob = [row.variety_name, row.reproduction_name].join(" ");
          if (!matchesAnyTerm(cropBlob, cropTerms) && !(allowAliasMatchOnVariety && matchesAnyTerm(varietyBlob, cropTerms))) {
            return false;
          }
        }

        if (varietyTerms.length && !matchesAnyTerm(row.variety_name, varietyTerms)) {
          return false;
        }

        return true;
      });
      const rows = filterQaRows(context, filteredRows, [
        "field_name",
        "crop_name",
        "variety_name",
        "reproduction_name",
        "notes",
      ]);

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
    const limit = parseLimit(context.intent.parameters.limit, 10, 1, 80);
    const status = cleanString(context.intent.parameters.status);
    const normalizedStatuses = normalizeTicketStatuses(status);
    let query = context.supabase
      .from("tickets")
      .select(
        "id,ticket_no,status,op_type,created_at,gross_weight_kg,tare_weight_kg,net_weight_kg,driver_id,vehicle_id,field_id"
      )
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
    const mappedRows = (res.data || []).map((row: any) => ({
      id: String(row.id),
      ticket_no: String(row.ticket_no || row.id),
      status: String(row.status || "-"),
      operation: String(row.op_type || "-"),
      gross_kg: Number(row.gross_weight_kg || 0),
      tare_kg: Number(row.tare_weight_kg || 0),
      net_kg: Number(row.net_weight_kg || 0),
      date: String(row.created_at || ""),
      driver_id: cleanString(row.driver_id),
      vehicle_id: cleanString(row.vehicle_id),
      field_id: cleanString(row.field_id),
    }));
    const rows = filterQaRows(context, await enrichTickets(context, mappedRows), [
      "ticket_no",
      "status",
      "operation",
      "driver_name",
      "vehicle_label",
      "field_name",
      "product_name",
      "variety_name",
    ]).slice(0, limit);

    return {
      title: "Талоны весовой",
      rows,
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

    const filteredRows = raw
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
      });
    const rows = filterQaRows(context, filteredRows, [
      "operation_type",
      "field_name",
      "notes",
      "status",
    ]).slice(0, 120);

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
  const includeArchived = includeArchivedByRequest(context);
  if (!query) {
    return {
      title: "Поиск склада",
      rows: [],
      source: { module: "assistant", tableOrView: "resolve_warehouse_by_name", fetchedAt: nowIso() },
      summary: "Уточните название склада.",
    };
  }

  let res: any = await context.supabase
    .from("warehouses")
    .select("id,name,archived,is_archived")
    .eq("company_id", context.companyId)
    .order("name", { ascending: true })
    .limit(600);
  if (res.error && String(res.error.message || "").toLowerCase().includes("is_archived")) {
    res = await context.supabase
      .from("warehouses")
      .select("id,name,archived")
      .eq("company_id", context.companyId)
      .order("name", { ascending: true })
      .limit(600);
  }
  if (res.error) throw new Error(res.error.message);

  const terms = buildSearchTerms(query);
  const normalizedQuery = normalizeSearchText(query);
  const genericWarehouseTerms = new Set(["склад", "склады", "warehouse", "warehouses", "storage"]);
  const specificTerms = terms.filter((term) => {
    const normalized = normalizeSearchText(term);
    return normalized && !genericWarehouseTerms.has(normalized);
  });

  const scored: Array<{ row: any; score: number; normalizedName: string }> = (res.data || [])
    .filter((row: any) => includeArchived || !(row.archived || row.is_archived))
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
    .filter((item: { row: any; score: number; normalizedName: string }) => {
      if (item.score <= 0) return false;
      if (!specificTerms.length) return true;
      return specificTerms.some((term) => matchesAnyTerm(item.normalizedName, [term]));
    })
    .sort(
      (a: { row: any; score: number; normalizedName: string }, b: { row: any; score: number; normalizedName: string }) =>
        (b.score - a.score) || a.normalizedName.localeCompare(b.normalizedName, "ru")
    )
    .slice(0, 8);

  const matched = scored.map((item: { row: any; score: number; normalizedName: string }) => item.row);

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

  const matched = await resolveBestFieldMatches(context, query, 8);

  return {
    title: "Найденные поля",
    rows: matched.map((row) => ({
        entity_type: "field",
        entity_id: row.id,
        entity_name: row.name,
        page: "field-card",
        route: `/fields/${row.id}`,
        filters: {
          search: row.name || query,
          field: row.name || query,
          fieldId: row.id,
          entityId: row.id,
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

type DraftRequiredField = {
  label: string;
  signals: RegExp[];
};

function getDraftRequiredFields(kind: string): DraftRequiredField[] {
  switch (kind) {
    case "create_weighbridge_ticket_draft":
      return [
        { label: "тип движения", signals: [/постав|приход|отгруз|перемещ|выдач|списан|урожай|receipt|shipment|transfer/i] },
        { label: "склад", signals: [/склад|овощ|семен|зерно|картоф|универс|warehouse/i] },
        {
          label: "строки товаров",
          signals: [
            /товар|продукт|материал|номенклатур|product|material|line/i,
            /селитр|ревус|актар|диаммофоск|аммофоск|ph\s*power|смерч|agriful|ammonium|nitrate/i,
          ],
        },
      ];
    case "create_operation_draft":
      return [
        { label: "поле", signals: [/поле|field/i] },
        { label: "тип операции", signals: [/посадк|уборк|удобрен|сзр|обработ|operation|fertiliz|spray|harvest/i] },
        { label: "дата или срок", signals: [/\b\d{1,2}[./-]\d{1,2}/i, /сегодня|завтра|дата|date|today|tomorrow/i] },
      ];
    case "create_field_draft":
      return [
        { label: "название или номер поля", signals: [/поле\s+\S+|field\s+\S+|номер|назван/i] },
        { label: "площадь", signals: [/(\d+[,.]?\d*)\s*(га|ha)|площад/i] },
        { label: "сезон или культура", signals: [/сезон|культур|crop|season|картоф|пшен|ячмен|лук|морков/i] },
      ];
    case "create_meal_order_draft":
      return [
        { label: "дата питания", signals: [/\b\d{1,2}[./-]\d{1,2}/i, /сегодня|завтра|дата|date|today|tomorrow/i] },
        { label: "тип питания", signals: [/обед|ужин|завтрак|meal|lunch|dinner|breakfast/i] },
        { label: "список людей", signals: [/люд|человек|бригада|people|person|список/i] },
        { label: "место доставки", signals: [/достав|место|поле|адрес|delivery|location/i] },
      ];
    case "create_warehouse_draft":
      return [
        { label: "название склада", signals: [/назван|склад\s+\S+|warehouse\s+\S+/i] },
        { label: "тип склада", signals: [/тип|овощ|семен|удобр|сзр|гсм|type|fuel|seed/i] },
        { label: "ответственный", signals: [/ответствен|кладовщик|manager|owner/i] },
      ];
    default:
      return [];
  }
}

function createDraftRows(kind: string, context: AssistantToolContext): Array<Record<string, unknown>> {
  const requestText = cleanString(context.intent.parameters.query) || cleanString(context.intent.parameters.entityQuery) || "";
  const hasFieldContext = Boolean(
    cleanString(context.runtimeContext.selectedFieldId) ||
      cleanString(context.runtimeContext.selectedFieldLabel) ||
      cleanString(context.sessionState.lastFieldId) ||
      cleanString(context.sessionState.lastFieldLabel)
  );
  const hasWarehouseContext = Boolean(
    cleanString(context.runtimeContext.selectedWarehouseId) ||
      cleanString(context.runtimeContext.selectedWarehouseLabel) ||
      cleanString(context.sessionState.lastWarehouseId) ||
      cleanString(context.sessionState.lastWarehouseLabel)
  );
  const hasOperationContext = Boolean(
    cleanString(context.runtimeContext.selectedOperationId) ||
      cleanString(context.runtimeContext.selectedOperationLabel) ||
      cleanString(context.sessionState.lastOperationId) ||
      cleanString(context.sessionState.lastOperationLabel)
  );
  const contextSignals = [
    requestText,
    hasFieldContext ? " field " : "",
    hasWarehouseContext ? " warehouse " : "",
    hasOperationContext ? " operation " : "",
  ].join(" ");
  const missingFields = getDraftRequiredFields(kind)
    .filter((field) => !field.signals.some((signal) => signal.test(contextSignals)))
    .map((field) => field.label);
  const draftStatus = missingFields.length ? "needs_clarification" : "draft_ready";
  const draftPreview = missingFields.length
    ? `Подготовил сценарий действия, но данных недостаточно. Чтобы продолжить, уточните: ${missingFields.join(", ")}.`
    : "Черновик подготовлен. Проверьте обязательные поля и подтвердите выполнение вручную.";
  const basePayload = {
    kind,
    company_id: context.companyId,
    requested_by_profile_id: context.actor.id,
    message: requestText || null,
    requires_confirmation: true,
    status: "draft",
    draft_status: draftStatus,
    missing_fields: missingFields,
  };

  return [
    {
      ...basePayload,
      draft_preview: draftPreview,
      next_step: missingFields.length
        ? `Уточните: ${missingFields.join(", ")}.`
        : "Откройте соответствующий модуль и подтвердите черновик вручную.",
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
          hint: filters ? `Подготовил переход на страницу ${page} с фильтром.` : `Подготовил переход на страницу ${page}.`,
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
        selected_crop_structure_section:
          context.runtimeContext.selectedCropStructureSectionId ||
          cleanString(context.runtimeContext.filters.cropStructureId) ||
          cleanString(context.runtimeContext.filters.sectionId) ||
          cleanString(context.runtimeContext.filters.structureId) ||
          null,
        selected_operation:
          context.runtimeContext.selectedOperationId ||
          cleanString(context.runtimeContext.filters.operationId) ||
          cleanString(context.runtimeContext.filters.operation_id) ||
          null,
        selected_ticket:
          context.runtimeContext.selectedTicketId ||
          cleanString(context.runtimeContext.filters.ticketId) ||
          cleanString(context.runtimeContext.filters.ticket_id) ||
          cleanString(context.runtimeContext.filters.ticketNo) ||
          null,
        selected_batch:
          context.runtimeContext.selectedBatchId ||
          cleanString(context.runtimeContext.filters.batchId) ||
          cleanString(context.runtimeContext.filters.batch_id) ||
          cleanString(context.runtimeContext.filters.batchCode) ||
          null,
        context_engine: collectAssistantContextRows(context)[0],
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

const resolveEntityTool: AssistantToolDefinition = {
  name: "resolve_entity",
  description: "Resolve a user phrase to TravkinFlow entities: field, warehouse, operation, ticket, crop structure section, or batch",
  domains: ["assistant", "context", "navigation"],
  run: async (context) => ({
    title: "Resolved entities",
    rows: await resolveAssistantEntityRows(context, {
      query: cleanString(context.intent.parameters.query) || cleanString(context.intent.parameters.entityQuery),
      entityType: cleanString(context.intent.parameters.entityType),
      limit: parseLimit(context.intent.parameters.limit, 12, 1, 30),
    }),
    source: {
      module: "assistant",
      tableOrView: "resolve_entity",
      season: context.runtimeContext.season,
      fetchedAt: nowIso(),
    },
  }),
};

const getQuickInsightsTool: AssistantToolDefinition = {
  name: "get_quick_insights",
  description: "Quick read-only insight for the current or resolved entity",
  domains: ["assistant", "context", "insights"],
  run: async (context) => ({
    title: "Quick insights",
    rows: await buildQuickInsightRows(context),
    source: {
      module: "assistant",
      tableOrView: "quick_insights",
      season: context.runtimeContext.season,
      fetchedAt: nowIso(),
    },
  }),
};

const getMorningReportTool: AssistantToolDefinition = {
  name: "get_morning_report",
  description: "Read-only operational morning report foundation",
  domains: ["assistant", "operations", "warehouses", "weighbridge", "reports"],
  run: async (context) => ({
    title: "Morning report",
    rows: await buildMorningReportRows(context),
    source: {
      module: "assistant",
      tableOrView: "operations + tickets + v_stock_balance_identity",
      season: context.runtimeContext.season,
      fetchedAt: nowIso(),
    },
  }),
};

const getOperationInsightsTool: AssistantToolDefinition = {
  name: "get_operation_insights",
  description: "Read-only operation insight using progress/material context",
  domains: ["assistant", "operations", "insights"],
  run: async (context) => ({
    title: "Operation insights",
    rows: await buildQuickInsightRows({
      ...context,
      intent: {
        ...context.intent,
        parameters: {
          ...context.intent.parameters,
          entityType: "operation",
        },
      },
    }),
    source: {
      module: "assistant",
      tableOrView: "operation_progress + operation_materials",
      season: context.runtimeContext.season,
      fetchedAt: nowIso(),
    },
  }),
};

const getWarehouseInsightsTool: AssistantToolDefinition = {
  name: "get_warehouse_insights",
  description: "Read-only warehouse insight: stock rows, total quantity, problem rows",
  domains: ["assistant", "warehouses", "insights"],
  run: async (context) => ({
    title: "Warehouse insights",
    rows: await buildWarehouseInsightRows(context),
    source: {
      module: "assistant",
      tableOrView: "v_stock_balance_identity",
      season: context.runtimeContext.season,
      fetchedAt: nowIso(),
    },
  }),
};

const getWeighbridgeInsightsTool: AssistantToolDefinition = {
  name: "get_weighbridge_insights",
  description: "Read-only weighbridge insight: active tickets and recent receipts/shipments",
  domains: ["assistant", "weighbridge", "insights"],
  run: async (context) => ({
    title: "Weighbridge insights",
    rows: await buildWeighbridgeInsightRows(context),
    source: {
      module: "assistant",
      tableOrView: "tickets",
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
      tasks: "Мои задачи",
      fields: "Поля",
      "field-card": "Карточка поля",
      "fields-map": "Карта полей",
      "crop-structure": "Структура посевов",
      "field-history": "История полей",
      operations: "Операции",
      warehouses: "Склады",
      "warehouse-card": "Карточка склада",
      weighbridge: "Весовая",
      "weighbridge-history": "История талонов",
      "meal-thermoses": "Питание / Термосы",
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
    const rawQuery = normalizeSearchText(parseSearchQuery(context) || "");
    const outputType = cleanString(context.intent.parameters.output_type);
    const hasExplicitFieldNumber = /\b\d{1,3}(?:-\d{1,3}){0,2}\b/.test(rawQuery);
    const mentionsFieldList =
      /(поля|поле|fields?|field|РїРѕР»СЏ|РїРѕР»Рµ)/i.test(rawQuery);
    const asksGenericFieldList =
      /(какие|сколько|список|все|назови|покажи|list|all|count|РєР°РєРёРµ|СЃРєРѕР»СЊРєРѕ|СЃРїРёСЃРѕРє|РІСЃРµ|РЅР°Р·РѕРІРё|РїРѕРєР°Р¶Рё)/i.test(
        rawQuery
      );
    const asksLargestField =
      /(?:сам\w*\s+больш|наибольш|крупн|макс|больше\s+всего|largest|biggest|max(?:imum)?|СЃР°Рј\w*\s+Р±РѕР»СЊС€|РЅР°РёР±РѕР»СЊС€|РєСЂСѓРїРЅ|РјР°РєСЃ|Р±РѕР»СЊС€Рµ\s+РІСЃРµРіРѕ)/i.test(
        rawQuery
      );
    const genericListQuery =
      !hasExplicitFieldNumber &&
      (outputType === "list" || ((asksGenericFieldList || asksLargestField) && mentionsFieldList));
    const effectiveQuery = genericListQuery ? null : query;
    logToolEvent(context, "search_fields", "start", {
      input_args: context.intent.parameters,
      resolved_season: cleanString(context.runtimeContext.season),
      query_used: "fields.select(id,name,notes,area,archived).eq(company_id).eq(archived=false)",
      search_query: effectiveQuery,
      rls_acl_result: inferAclResult(context),
    });
    try {
      const output = await getFieldsTool.run(context);
      const rows = applyTextFilter(output.rows || [], effectiveQuery)
        .sort((a, b) => (effectiveQuery ? 0 : Number((b as any).area_ha || 0) - Number((a as any).area_ha || 0)))
        .map((row, index) =>
          !effectiveQuery && outputType === "list" && index === 0
            ? { ...row, assistant_focus: "field", assistant_focus_reason: "largest_field_by_area" }
            : row
        )
        .slice(0, 80);
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
    const includeArchived = includeArchivedByRequest(context);
    const allowTestData = isDebugOrTestDataAllowed(context);
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
      include_archived: includeArchived,
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
      const visibleRows = allowTestData
        ? baseRows
        : baseRows.filter((row: Record<string, unknown>) => !rowHasQaMarker(row, ["warehouse_name", "warehouse_type"]));
      const activeScoped = includeArchived
        ? visibleRows
        : visibleRows.filter((row: { archived: boolean; is_archived: boolean }) => !(row.archived || row.is_archived));
      const rows = terms.length
        ? activeScoped.filter((row: any) => matchesAnyTerm(`${row.warehouse_name} ${row.warehouse_type}`, terms))
        : activeScoped;

      logToolEvent(context, "get_warehouse_count", "success", {
        input_args: context.intent.parameters,
        resolved_season: cleanString(context.runtimeContext.season),
        query_used: queryUsed,
        rows_count: rows.length,
        qa_filtered_rows: allowTestData ? 0 : baseRows.length - visibleRows.length,
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

type OperationRowsOptions = {
  activeOnly?: boolean;
};

function relationOneValue<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return (value ?? null) as T | null;
}

function normalizeOperationWorkStatus(row: Record<string, unknown>): string {
  const workStatus = normalizeSearchText((row as any).work_status);
  if (workStatus) return workStatus;
  const status = normalizeSearchText((row as any).status);
  if (status === "completed" || status === "verified") return "completed";
  if (status === "in_progress") return "in_progress";
  return "active";
}

function isActiveOperationRow(row: Record<string, unknown>): boolean {
  const workStatus = normalizeOperationWorkStatus(row);
  const status = normalizeSearchText((row as any).status);
  return workStatus === "active" && status !== "cancelled" && status !== "archived";
}

function calculateOperationAreaHa(row: Record<string, unknown>): number {
  const lines = Array.isArray((row as any).operation_lines) ? ((row as any).operation_lines as any[]) : [];
  const lineArea = lines.reduce((sum, line) => sum + Number(line?.planned_area_ha || 0), 0);
  if (lineArea > 0) return Number(lineArea.toFixed(3));

  const config = (row as any).operation_config && typeof (row as any).operation_config === "object"
    ? ((row as any).operation_config as Record<string, unknown>)
    : {};
  const configArea = Number(config.planned_area_ha || 0);
  return Number((Number.isFinite(configArea) ? configArea : 0).toFixed(3));
}

function operationFieldLabel(row: Record<string, unknown>): string {
  const primaryField = relationOneValue((row as any).fields);
  const fromOperation = cleanString((primaryField as any)?.name) || cleanString((row as any).field_id);
  const lines = Array.isArray((row as any).operation_lines) ? ((row as any).operation_lines as any[]) : [];
  const lineFields = uniqueStrings(
    lines.map((line) => {
      const field = relationOneValue(line?.fields);
      return cleanString((field as any)?.name) || cleanString(line?.field_id);
    })
  );
  if (lineFields.length > 0) return lineFields.slice(0, 3).join(", ");
  return fromOperation || "-";
}

function operationExecutorLabel(row: Record<string, unknown>): string | null {
  const responsible = relationOneValue((row as any).responsible);
  return (
    cleanString((responsible as any)?.full_name) ||
    cleanString((responsible as any)?.email) ||
    cleanString((row as any).responsible_user_id)
  );
}

function normalizeOperationMaterials(row: Record<string, unknown>): Array<Record<string, unknown>> {
  const operationMaterials = Array.isArray((row as any).operation_materials)
    ? ((row as any).operation_materials as any[])
    : [];
  return operationMaterials.map((item) => {
    const product = relationOneValue(item?.products);
    const productName =
      cleanString((product as any)?.trade_name) ||
      cleanString((product as any)?.name) ||
      cleanString(item?.product_id) ||
      "material";
    const issued = Number(item?.issued_quantity || 0);
    const consumed = Number(item?.consumed_quantity || 0);
    const planned = Number(item?.planned_quantity || 0);
    const actualRate = Number(item?.actual_rate || 0);
    const plannedRate = Number(item?.planned_rate || 0);
    const quantity = [issued, consumed, planned, actualRate, plannedRate].find((value) => Number.isFinite(value) && value > 0) || 0;
    const quantitySource =
      issued > 0
        ? "issued_quantity"
        : consumed > 0
          ? "consumed_quantity"
          : planned > 0
            ? "planned_quantity"
            : actualRate > 0
              ? "actual_rate"
              : plannedRate > 0
                ? "planned_rate"
                : "not_set";
    return {
      product_name: productName,
      material_type: cleanString(item?.material_type),
      quantity: Number(quantity.toFixed(3)),
      quantity_source: quantitySource,
      unit: cleanString(item?.unit) || "unit",
      planned_rate: Number.isFinite(plannedRate) ? plannedRate : null,
      actual_rate: Number.isFinite(actualRate) ? actualRate : null,
      issued_quantity: Number.isFinite(issued) ? issued : null,
      notes: cleanString(item?.notes),
    };
  });
}

function shouldTreatOperationQueryAsStatusOnly(query: string | null, statusFilter: string | null): boolean {
  const text = normalizeSearchText(query);
  if (!text) return false;
  if (statusFilter) return true;
  const statusWords = /(active|in progress|waiting materials|current|сейчас|актив|работе|ожидан)/i;
  const operationWords = /(operation|операц)/i;
  const hasSpecificField = /\b\d{1,3}(?:-\d{1,3}){0,2}\b/.test(text);
  return statusWords.test(text) && operationWords.test(text) && !hasSpecificField;
}

async function buildOperationRows(
  context: AssistantToolContext,
  options: OperationRowsOptions
): Promise<Array<Record<string, unknown>>> {
  const rawStatus = cleanString(context.intent.parameters.status)?.toLowerCase() || null;
  const queryText = parseSearchQuery(context);
  const inferredActive =
    options.activeOnly ||
    rawStatus === "active" ||
    /(active|current|сейчас|актив)/i.test(normalizeSearchText(queryText));
  const statusFilter = inferredActive ? "active" : rawStatus;
  const ignoreSearchTerms = shouldTreatOperationQueryAsStatusOnly(queryText, statusFilter);
  const terms = ignoreSearchTerms ? [] : buildSearchTerms(queryText);

  const res = await context.supabase
    .from("operations")
    .select(
      "id,date,operation_type,operation_type_slug,operation_category_slug,status,work_status,field_id,responsible_user_id,notes,operation_config," +
        "fields:field_id(name)," +
        "responsible:responsible_user_id(full_name,email,role)," +
        "operation_materials:operation_materials(id,product_id,unit,planned_rate,actual_rate,planned_quantity,issued_quantity,consumed_quantity,returned_quantity,material_type,notes,products:product_id(name,trade_name))," +
        "operation_lines:operation_lines(id,field_id,planned_area_ha,actual_area_ha,fields:field_id(name))"
    )
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .order("date", { ascending: false })
    .limit(260);
  if (res.error) throw new Error(res.error.message);

  const rows = (res.data || [])
    .filter((row: any) => {
      const workStatus = normalizeOperationWorkStatus(row);
      if (statusFilter === "active" && !isActiveOperationRow(row)) return false;
      if (statusFilter === "in_progress" && workStatus !== "in_progress") return false;
      if (statusFilter === "completed" && workStatus !== "completed") return false;
      if (statusFilter === "waiting_materials") {
        const status = normalizeSearchText(row.status);
        if (status !== "waiting_materials") return false;
      }
      if (!terms.length) return true;
      const materials = normalizeOperationMaterials(row).map((item) => item.product_name).join(" ");
      const blob = [
        row.operation_type,
        row.operation_type_slug,
        row.operation_category_slug,
        operationFieldLabel(row),
        workStatus,
        row.status,
        row.notes,
        materials,
      ].join(" ");
      return matchesAnyTerm(blob, terms);
    })
    .map((row: any) => {
      const materials = normalizeOperationMaterials(row);
      return {
        operation_id: String(row.id || ""),
        date: cleanString(row.date),
        operation_type: cleanString(row.operation_type) || "-",
        operation_type_slug: cleanString(row.operation_type_slug),
        operation_category_slug: cleanString(row.operation_category_slug),
        field_name: operationFieldLabel(row),
        status: cleanString(row.status) || "-",
        work_status: normalizeOperationWorkStatus(row),
        area_ha: calculateOperationAreaHa(row),
        executor: operationExecutorLabel(row),
        materials_count: materials.length,
        materials,
        materials_text: materials
          .map((item) => `${cleanString(item.product_name)} ${cleanString(item.quantity)} ${cleanString(item.unit)}`.trim())
          .join("; "),
        notes: cleanString(row.notes),
      };
    });

  return filterQaRows(context, rows, [
    "operation_type",
    "operation_type_slug",
    "operation_category_slug",
    "field_name",
    "status",
    "work_status",
    "materials_text",
    "notes",
  ]);
}

const getOperationsToolV2: AssistantToolDefinition = {
  name: "get_operations",
  description: "Operations from canonical UI source",
  domains: ["operations", "fields"],
  run: async (context) => {
    const rows = await buildOperationRows(context, { activeOnly: false });
    return {
      title: "Operations",
      rows: rows.slice(0, 120),
      source: {
        module: "operations",
        tableOrView: "operations + operation_lines + operation_materials",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getActiveOperationsSummaryToolAlias: AssistantToolDefinition = {
  name: "get_active_operations_summary",
  description: "Active operations summary from canonical UI source",
  domains: ["operations"],
  run: async (context) => {
    const rows = await buildOperationRows(context, { activeOnly: true });
    return {
      title: "Active operations summary",
      rows: rows.slice(0, 120),
      summary: `count=${rows.length}`,
      source: {
        module: "operations",
        tableOrView: "operations + operation_lines + operation_materials (active summary)",
        season: context.runtimeContext.season,
        fetchedAt: nowIso(),
      },
    };
  },
};

const getActiveOperationsToolV2: AssistantToolDefinition = {
  ...getActiveOperationsSummaryToolAlias,
  name: "get_active_operations",
};

const searchOperationsToolAlias: AssistantToolDefinition = {
  name: "search_operations",
  description: "Search operations",
  domains: ["operations"],
  run: async (context) => {
    const output = await getOperationsToolV2.run(context);
    return {
      ...output,
      rows: (output.rows || []).slice(0, 100),
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
    const output = await getOperationsToolV2.run(context);
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

    const activeRows = rowsRaw
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
    const rows = filterQaRows(context, activeRows, ["operation_type", "status", "field_name"]);

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
      .select(
        "id,ticket_no,status,op_type,created_at,gross_weight_kg,tare_weight_kg,net_weight_kg,driver_id,vehicle_id,field_id"
      )
      .eq("company_id", context.companyId)
      .eq("is_voided", false)
      .in("status", ["draft", "active", "ready_to_close"])
      .order("created_at", { ascending: false })
      .limit(120);
    if (res.error) throw new Error(res.error.message);
    const mappedRows = (res.data || []).map((row: any) => ({
      id: String(row.id),
      ticket_id: String(row.id),
      ticket_no: cleanString(row.ticket_no) || String(row.id),
      status: cleanString(row.status),
      type: cleanString(row.op_type),
      operation: cleanString(row.op_type),
      gross_kg: Number(row.gross_weight_kg || 0),
      tare_kg: Number(row.tare_weight_kg || 0),
      net_kg: Number(row.net_weight_kg || 0),
      date: cleanString(row.created_at),
      driver_id: cleanString(row.driver_id),
      vehicle_id: cleanString(row.vehicle_id),
      field_id: cleanString(row.field_id),
    }));
    const rows = filterQaRows(context, await enrichTickets(context, mappedRows), [
      "ticket_no",
      "status",
      "type",
      "operation",
      "driver_name",
      "vehicle_label",
      "field_name",
      "product_name",
      "variety_name",
    ]);
    return {
      title: "Активные талоны",
      rows,
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
      .select(
        "id,ticket_no,status,op_type,created_at,gross_weight_kg,tare_weight_kg,net_weight_kg,driver_id,vehicle_id,field_id"
      )
      .eq("company_id", context.companyId)
      .eq("is_voided", false)
      .order("created_at", { ascending: false })
      .limit(40);
    if (query) q = q.or(`ticket_no.ilike.%${query}%`);
    const res = await q;
    if (res.error) throw new Error(res.error.message);
    const mappedRows = (res.data || []).map((row: any) => ({
      id: String(row.id),
      ticket_id: String(row.id),
      ticket_no: cleanString(row.ticket_no) || String(row.id),
      type: cleanString(row.op_type),
      operation: cleanString(row.op_type),
      status: cleanString(row.status),
      gross_kg: Number(row.gross_weight_kg || 0),
      tare_kg: Number(row.tare_weight_kg || 0),
      net_kg: Number(row.net_weight_kg || 0),
      date: cleanString(row.created_at),
      driver_id: cleanString(row.driver_id),
      vehicle_id: cleanString(row.vehicle_id),
      field_id: cleanString(row.field_id),
    }));
    const rows = filterQaRows(context, await enrichTickets(context, mappedRows), [
      "ticket_no",
      "type",
      "operation",
      "status",
      "driver_name",
      "vehicle_label",
      "field_name",
      "product_name",
      "variety_name",
    ]);
    return {
      title: "Детали талона",
      rows,
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
      const queryText = `${cleanString(context.intent.parameters.query) || ""} ${parseSearchQuery(context) || ""}`;
      const negativeRequested =
        parseBoolish(context.intent.parameters.negative_only) ||
        /(\u043e\u0442\u0440\u0438\u0446\u0430\u0442|\u043c\u0438\u043d\u0443\u0441|negative|below\s+zero)/i.test(queryText);
      const balanceContext = negativeRequested
        ? {
            ...context,
            intent: {
              ...context.intent,
              parameters: {
                ...context.intent.parameters,
                negative_only: true,
              },
            },
          }
        : context;
      const output = await getWarehouseBalancesTool.run(balanceContext);
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
      cleanString(context.runtimeContext.filters.warehouse) ||
      resolveWarehouseAliasQuery(searchQuery);
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
      if (/(\u0443\u0434\u043e\u0431\u0440|fertiliz|dap|\u0430\u043c\u043c\u043e\u0444)/.test(normalized)) return "удобрение";
      if (/(\u0441\u0437\u0440|\u0445\u0438\u043c|pestic|fungic|herbic)/.test(normalized)) return "сзр";
      if (/(\u0441\u0435\u043c\u044f\u043d|seed)/.test(normalized)) return "семена";
      if (/(\u0431\u0435\u043d\u0437|\u0441\u043e\u043b\u044f\u0440|\u0434\u0438\u0437\u0435\u043b|\u0433\u0441\u043c|fuel)/.test(normalized)) return "топливо";
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
      return normalized && normalized !== "склад" && normalized !== "warehouse" && normalized !== "storage";
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
      const varietyAliases = new Set(["gala", "soraya", "baltic rose", "azilit", "colombo", "impala"]);
      const allowAliasMatchOnVariety = cropAliasTerms.some((alias) =>
        varietyAliases.has(normalizeSearchText(alias || ""))
      );

      const filtered = (output.rows || []).filter((row) => {
        if (!aliasTerms.length) return true;
        const cropBlob = [row.crop_name].join(" ");
        const varietyBlob = [row.variety_name, row.reproduction_name].join(" ");
        return matchesAnyTerm(cropBlob, aliasTerms) || (allowAliasMatchOnVariety && matchesAnyTerm(varietyBlob, aliasTerms));
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
      const grouped = new Map<string, { crop_name: string; area_ha: number; row_count: number; fields: Set<string> }>();
      const groupByVariety = cropAliasTerms.some((alias) => varietyAliases.has(normalizeSearchText(alias || "")));

      rows.forEach((row) => {
        const crop = cleanString(row.crop_name) || "Не указано";
        const variety = cleanString(row.variety_name);
        const cropKey = groupByVariety && variety ? `${crop} / ${variety}` : crop;
        const area = Number(row.area_ha || 0);
        const field = cleanString(row.field_name) || "—";
        const current = grouped.get(cropKey) || { crop_name: cropKey, area_ha: 0, row_count: 0, fields: new Set<string>() };
        current.area_ha += Number.isFinite(area) ? area : 0;
        current.row_count += 1;
        current.fields.add(field);
        grouped.set(cropKey, current);
      });

      const summaryRows = Array.from(grouped.values())
        .map((item) => ({
          crop_name: item.crop_name,
          area_ha: Number(item.area_ha.toFixed(3)),
          fields_count: item.row_count,
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
    const seasonScope = await resolveSeasonScope(context.companyId, context);
    const seasonLabel = seasonScope.seasonYear || DEFAULT_SEASON_YEAR;
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

    // Resolve exact/fuzzy field match in one place; avoid extra pre-query here.
    if (false) {
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

    const allowTestData = isDebugOrTestDataAllowed(context);
    const selection = await resolveFieldSelection(context, query, 10);
    if (!selection.selected && selection.ambiguityReason && selection.candidates.length > 1) {
      return {
        title: "Карточка поля",
        rows: selection.candidates.slice(0, 8).map((item) => ({
          field_id: item.id,
          field_name: item.displayName,
          field_segment: item.name,
          area_ha: Number(item.area || 0),
          selection_reason: "ambiguous_segments",
        })),
        source: {
          module: "fields",
          tableOrView: "fields (field_card resolver)",
          season: seasonLabel,
          fetchedAt: nowIso(),
        },
        summary: "Найдено несколько сегментов поля. Уточните подполе, например 28-1.",
      };
    }
    const matchedField = selection.selected
      ? {
          id: selection.selected.id,
          name: selection.selected.name,
          area: selection.selected.area,
          notes: selection.selected.notes,
        }
      : null;
    if (!matchedField) {
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

    const fieldId = String(matchedField.id);
    const fieldLabel = getFieldDisplayName({ name: matchedField.name, notes: matchedField.notes } as any) || matchedField.name;
    logToolEvent(context, "get_field_card", "start", {
      input_args: context.intent.parameters,
      resolved_field_query: query,
      resolved_field_id: fieldId,
      resolved_season: seasonLabel,
      resolved_season_id: seasonScope.seasonId,
      season_source: seasonScope.source,
      query_used:
        "fields + operations(season scope) + crop_structure(plan scope) + field_material_consumptions(fact scope) + tickets(harvest only)",
      rls_acl_result: inferAclResult(context),
    });
    const [opsRes, allocRes, consumptionRes, ticketRes] = await Promise.all([
      context.supabase
        .from("operations")
        .select("id,status,work_status,date,created_at,crop_structure_id")
        .eq("company_id", context.companyId)
        .eq("archived", false)
        .eq("field_id", fieldId)
        .limit(1200),
      context.supabase
        .from("crop_structure")
        .select("*")
        .eq("company_id", context.companyId)
        .eq("archived", false)
        .eq("field_id", fieldId)
        .limit(800),
      context.supabase
        .from("field_material_consumptions")
        .select("product_id,quantity_kg,season_id,consumed_at,notes")
        .eq("company_id", context.companyId)
        .eq("field_id", fieldId)
        .limit(2400),
      context.supabase
        .from("tickets")
        .select("season_id,harvest_year,net_weight_kg,finalized_at,created_at,op_type,is_finalized,is_voided")
        .eq("company_id", context.companyId)
        .eq("field_id", fieldId)
        .eq("is_voided", false)
        .eq("op_type", "harvest_incoming")
        .eq("is_finalized", true)
        .limit(1200),
    ]);

    if (opsRes.error) throw new Error(opsRes.error.message);
    if (allocRes.error) throw new Error(allocRes.error.message);
    if (consumptionRes.error) throw new Error(consumptionRes.error.message);
    if (ticketRes.error) throw new Error(ticketRes.error.message);

    const rawAllocations = allocRes.data || [];
    const allocationsBySeason = rawAllocations.filter((row: any) =>
      matchesSeasonIdentity(seasonScope, row as Record<string, unknown>, { allowDateFallback: false })
    );
    const allocations = allocationsBySeason.filter((row: any) => {
      if (allowTestData) return true;
      return !isQaMarkerText(row.notes);
    });
    const crops = new Set<string>();
    const varieties = new Set<string>();
    const reproductions = new Set<string>();
    const lookup = await buildLookupMaps(
      context,
      {
        crops: Array.from(new Set(allocations.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
        products: Array.from(new Set(allocations.map((x: any) => String(x.crop_id || "")).filter(Boolean))),
        varieties: Array.from(new Set(allocations.map((x: any) => String(x.variety_id || "")).filter(Boolean))),
        reproductions: Array.from(new Set(allocations.map((x: any) => String(x.reproduction_id || "")).filter(Boolean))),
      },
      { strictActive: true }
    );

    allocations.forEach((row: any) => {
      const cropId = cleanString(row.crop_id);
      const varietyId = cleanString(row.variety_id);
      const reproductionId = cleanString(row.reproduction_id);
      if (cropId) {
        const cropName = lookup.byCrop.get(cropId) || lookup.byProduct.get(cropId);
        if (cropName) crops.add(cropName);
      }
      if (varietyId) {
        const varietyName = lookup.byVariety.get(varietyId);
        if (varietyName) varieties.add(varietyName);
      }
      if (reproductionId) {
        const reproductionName = lookup.byReproduction.get(reproductionId);
        if (reproductionName) reproductions.add(reproductionName);
      }
    });

    const rawConsumptions = consumptionRes.data || [];
    const consumptionsBySeason = rawConsumptions.filter((row: any) =>
      matchesSeasonIdentity(seasonScope, row as Record<string, unknown>, {
        allowDateFallback: true,
        dateKeys: ["consumed_at", "created_at"],
      })
    );
    const productLookup = await buildLookupMaps(
      context,
      {
        products: Array.from(new Set(consumptionsBySeason.map((x: any) => String(x.product_id || "")).filter(Boolean))),
      },
      { strictActive: true }
    );
    const consumptions = consumptionsBySeason.filter((row: any) => {
      const productId = cleanString(row.product_id);
      const productName = productId ? productLookup.byProduct.get(productId) : null;
      if (productId && !productName) return false;
      if (allowTestData) return true;
      return !isQaMarkerText(productName) && !isQaMarkerText(row.notes);
    });
    const issuedKg = consumptions.reduce((acc: number, row: any) => {
      const qty = Number(row.quantity_kg || 0);
      return acc + (Number.isFinite(qty) ? Math.abs(qty) : 0);
    }, 0);

    const rawTickets = ticketRes.data || [];
    const harvestTickets = rawTickets.filter((row: any) =>
      matchesSeasonIdentity(seasonScope, row as Record<string, unknown>, {
        allowDateFallback: true,
        dateKeys: ["finalized_at", "created_at"],
      })
    );
    const harvestKg = harvestTickets.reduce((acc: number, row: any) => {
      const qty = Number(row.net_weight_kg || 0);
      return acc + (Number.isFinite(qty) ? qty : 0);
    }, 0);

    const rawOperations = opsRes.data || [];
    const cropStructureIds = Array.from(
      new Set(rawOperations.map((row: any) => cleanString(row.crop_structure_id)).filter(Boolean))
    ) as string[];
    let seasonCropStructureIds = new Set<string>();
    if (cropStructureIds.length > 0) {
      const opStructureRes = await context.supabase
        .from("crop_structure")
        .select("*")
        .in("id", cropStructureIds)
        .eq("company_id", context.companyId)
        .eq("archived", false)
        .limit(2400);
      if (opStructureRes.error) throw new Error(opStructureRes.error.message);
      seasonCropStructureIds = new Set(
        (opStructureRes.data || [])
          .filter((row: any) => matchesSeasonIdentity(seasonScope, row as Record<string, unknown>, { allowDateFallback: false }))
          .filter((row: any) => (allowTestData ? true : !isQaMarkerText(row.notes)))
          .map((row: any) => String(row.id))
      );
    }
    const operations = rawOperations.filter((row: any) => {
      const cropStructureId = cleanString(row.crop_structure_id);
      if (cropStructureId) return seasonCropStructureIds.has(cropStructureId);
      return matchesSeasonIdentity(seasonScope, row as Record<string, unknown>, {
        allowDateFallback: true,
        dateKeys: ["date", "created_at"],
      });
    });

    const activeOperations = operations.filter((item: any) => {
      const status = cleanString(item.status)?.toLowerCase() || "";
      return !["completed", "verified", "cancelled"].includes(status);
    }).length;

    logToolEvent(context, "get_field_card", "success", {
      resolved_field_id: fieldId,
      resolved_season: seasonLabel,
      resolved_season_id: seasonScope.seasonId,
      rows_count: 1,
      plan_rows_count: allocations.length,
      fact_operations_rows_count: operations.length,
      fact_material_rows_count: consumptions.length,
      fact_harvest_ticket_rows_count: harvestTickets.length,
      qa_filtered_plan_rows: allocationsBySeason.length - allocations.length,
      qa_filtered_rows: consumptionsBySeason.length - consumptions.length,
      rls_acl_result: inferAclResult(context),
    });

    return {
      title: "Карточка поля",
      rows: [
        {
          field_id: fieldId,
          field_name: fieldLabel,
          field_segment: matchedField.name,
          area_ha: Number(matchedField.area || 0),
          season_year: seasonLabel,
          season_id: seasonScope.seasonId,
          plan: {
            crops: Array.from(crops).sort(),
            varieties: Array.from(varieties).sort(),
            reproductions: Array.from(reproductions).sort(),
          },
          fact: {
            active_operations_count: activeOperations,
            material_issued_kg: Number(issuedKg.toFixed(3)),
            harvest_net_kg: Number(harvestKg.toFixed(3)),
          },
          crops: Array.from(crops).sort(),
          varieties: Array.from(varieties).sort(),
          reproductions: Array.from(reproductions).sort(),
          active_operations_count: activeOperations,
          material_issued_kg: Number(issuedKg.toFixed(3)),
          harvest_net_kg: Number(harvestKg.toFixed(3)),
          debug_meta: {
            season_source: seasonScope.source,
            plan_rows_count: allocations.length,
            fact_rows_count: {
              operations: operations.length,
              materials: consumptions.length,
              harvest_tickets: harvestTickets.length,
            },
            qa_filtered_rows: consumptionsBySeason.length - consumptions.length,
            qa_filtered_plan_rows: allocationsBySeason.length - allocations.length,
          },
        },
      ],
      source: {
        module: "fields",
        tableOrView:
          "fields + operations(season scoped) + crop_structure(plan) + field_material_consumptions(fact) + tickets(harvest_incoming finalized)",
        season: seasonLabel,
        fetchedAt: nowIso(),
      },
    };
  },
};

async function buildFieldOperationTimelineRowsForFieldRefs(
  context: AssistantToolContext,
  fieldRefs: Array<{ id: string; name: string; displayName?: string | null }>
): Promise<Array<Record<string, unknown>>> {
  const fieldIds = uniqueStrings(fieldRefs.map((field) => field.id));
  if (!fieldIds.length) return [];
  const fieldRefsById = new Map(fieldRefs.map((field) => [field.id, field]));
  const res = await context.supabase
    .from("operations")
    .select(
      "id,date,operation_type,operation_type_slug,operation_category_slug,status,work_status,field_id,responsible_user_id,notes,operation_config," +
        "fields:field_id(name)," +
        "responsible:responsible_user_id(full_name,email,role)," +
        "operation_materials:operation_materials(id,product_id,unit,planned_rate,actual_rate,planned_quantity,issued_quantity,consumed_quantity,returned_quantity,material_type,notes,products:product_id(name,trade_name))," +
        "operation_lines:operation_lines(id,field_id,planned_area_ha,actual_area_ha,fields:field_id(name))"
    )
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .order("date", { ascending: false })
    .limit(600);
  if (res.error) throw new Error(res.error.message);

  const rows: Array<Record<string, unknown>> = [];
  (res.data || []).forEach((row: any) => {
    const operationRow = row as Record<string, unknown>;
    const operationFieldIds = uniqueStrings([cleanString(row.field_id), ...getOperationLineFieldIds(operationRow)]);
    const scopedOperationFieldIds = operationFieldIds.filter((id) => fieldIds.includes(id));
    if (!scopedOperationFieldIds.length) return;
    const materials = normalizeOperationMaterials(row);
    rows.push({
      event_type: "operation_fact",
      date: cleanString(row.date),
      title: cleanString(row.operation_type),
      operation_type: cleanString(row.operation_type),
      operation_type_slug: cleanString(row.operation_type_slug),
      operation_category_slug: cleanString(row.operation_category_slug),
      status: cleanString(row.status),
      work_status: normalizeOperationWorkStatus(row),
      field_id: scopedOperationFieldIds.join(","),
      field_name: getOperationFieldNamesForScope(operationRow, fieldRefsById as any) || operationFieldLabel(row),
      area_ha: calculateOperationAreaHa(row),
      executor: operationExecutorLabel(row),
      materials_count: materials.length,
      materials,
      materials_text: materials
        .map((item) => `${cleanString(item.product_name)} ${cleanString(item.quantity)} ${cleanString(item.unit)}`.trim())
        .join("; "),
      ref_id: cleanString(row.id),
    });
  });
  return rows;
}

const getFieldTimelineToolAlias: AssistantToolDefinition = {
  name: "get_field_timeline",
  description: "Field timeline",
  domains: ["fields", "operations", "inventory", "weighbridge"],
  run: async (context) => {
    const query = parseFieldQueryFromContextV2(context);
    const seasonScope = await resolveSeasonScope(context.companyId, context);
    const seasonLabel = seasonScope.seasonYear || DEFAULT_SEASON_YEAR;
    if (!query) {
      return {
        title: "Timeline поля",
        rows: [],
        source: {
          module: "fields",
          tableOrView: "field_timeline",
          season: seasonLabel,
          fetchedAt: nowIso(),
        },
      };
    }

    if (false) {
      return {
        title: "Timeline поля",
        rows: [],
        source: {
          module: "fields",
          tableOrView: "field_timeline",
          season: seasonLabel,
          fetchedAt: nowIso(),
        },
      };
    }
    const allowTestData = isDebugOrTestDataAllowed(context);
    const selection = await resolveFieldSelection(context, query, 10);
    if (!selection.selected && selection.ambiguityReason && selection.candidates.length > 1) {
      const fieldRefs = selection.candidates.slice(0, 12).map((item) => ({
        id: item.id,
        name: item.name,
        displayName: item.displayName,
      }));
      const rows = await buildFieldOperationTimelineRowsForFieldRefs(context, fieldRefs);
      return {
        title: "Field timeline",
        rows,
        source: {
          module: "fields",
          tableOrView: "operations + operation_lines (field_timeline segmented scope)",
          season: seasonLabel,
          fetchedAt: nowIso(),
        },
      };
    }
    if (!selection.selected && selection.ambiguityReason && selection.candidates.length > 1) {
      return {
        title: "Материалы поля",
        rows: selection.candidates.slice(0, 8).map((item) => ({
          field_id: item.id,
          field_name: item.displayName,
          field_segment: item.name,
          area_ha: Number(item.area || 0),
          selection_reason: "ambiguous_segments",
        })),
        source: {
          module: "fields",
          tableOrView: "field_timeline resolver",
          season: seasonLabel,
          fetchedAt: nowIso(),
        },
      };
    }
    const matchedField = selection.selected
      ? {
          id: selection.selected.id,
          name: selection.selected.name,
          area: selection.selected.area,
          notes: selection.selected.notes,
        }
      : null;
    if (!matchedField) {
      return {
        title: "История поля",
        rows: [],
        source: {
          module: "fields",
          tableOrView: "field_timeline",
          season: seasonLabel,
          fetchedAt: nowIso(),
        },
      };
    }
    const fieldId = String(matchedField.id);
    const [opsRes, ticketsRes] = await Promise.all([
      context.supabase
        .from("operations")
        .select(
          "id,date,operation_type,operation_type_slug,operation_category_slug,status,work_status,field_id,responsible_user_id,notes,operation_config," +
            "fields:field_id(name)," +
            "responsible:responsible_user_id(full_name,email,role)," +
            "operation_materials:operation_materials(id,product_id,unit,planned_rate,actual_rate,planned_quantity,issued_quantity,consumed_quantity,returned_quantity,material_type,notes,products:product_id(name,trade_name))," +
            "operation_lines:operation_lines(id,field_id,planned_area_ha,actual_area_ha,fields:field_id(name))"
        )
        .eq("company_id", context.companyId)
        .eq("archived", false)
        .order("date", { ascending: false })
        .limit(600),
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
      (opsRes.data || []).forEach((row: any) => {
        const operationRow = row as Record<string, unknown>;
        const operationFieldIds = uniqueStrings([cleanString(row.field_id), ...getOperationLineFieldIds(operationRow)]);
        if (!operationFieldIds.includes(fieldId)) return;
        const materials = normalizeOperationMaterials(row);
        rows.push({
          event_type: "operation_fact",
          date: cleanString(row.date),
          title: cleanString(row.operation_type),
          operation_type: cleanString(row.operation_type),
          operation_type_slug: cleanString(row.operation_type_slug),
          operation_category_slug: cleanString(row.operation_category_slug),
          status: cleanString(row.status),
          work_status: normalizeOperationWorkStatus(row),
          field_id: operationFieldIds.filter((id) => id === fieldId).join(",") || fieldId,
          field_name: operationFieldLabel(row) || matchedField.name,
          area_ha: calculateOperationAreaHa(row),
          executor: operationExecutorLabel(row),
          materials_count: materials.length,
          materials,
          materials_text: materials
            .map((item) => `${cleanString(item.product_name)} ${cleanString(item.quantity)} ${cleanString(item.unit)}`.trim())
            .join("; "),
          ref_id: cleanString(row.id),
        });
      });
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

type FieldMaterialScope = {
  id: string;
  name: string;
  displayName?: string | null;
};

function chooseMaterialQuantity(item: Record<string, unknown>): { quantity: number; source: string } {
  const issued = Number((item as any).issued_quantity || 0);
  const consumed = Number((item as any).consumed_quantity || 0);
  const planned = Number((item as any).planned_quantity || 0);
  const actualRate = Number((item as any).actual_rate || 0);
  const plannedRate = Number((item as any).planned_rate || 0);
  if (Number.isFinite(issued) && issued > 0) return { quantity: issued, source: "issued_quantity" };
  if (Number.isFinite(consumed) && consumed > 0) return { quantity: consumed, source: "consumed_quantity" };
  if (Number.isFinite(planned) && planned > 0) return { quantity: planned, source: "planned_quantity" };
  if (Number.isFinite(actualRate) && actualRate > 0) return { quantity: actualRate, source: "actual_rate" };
  if (Number.isFinite(plannedRate) && plannedRate > 0) return { quantity: plannedRate, source: "planned_rate" };
  return { quantity: 0, source: "not_set" };
}

function getOperationLineFieldIds(row: Record<string, unknown>): string[] {
  const lines = Array.isArray((row as any).operation_lines) ? ((row as any).operation_lines as any[]) : [];
  return uniqueStrings(lines.map((line) => cleanString(line?.field_id)));
}

function getOperationFieldNamesForScope(row: Record<string, unknown>, fieldRefsById: Map<string, FieldMaterialScope>): string {
  const names: string[] = [];
  const directFieldId = cleanString((row as any).field_id);
  if (directFieldId && fieldRefsById.has(directFieldId)) {
    names.push(fieldRefsById.get(directFieldId)?.displayName || fieldRefsById.get(directFieldId)?.name || directFieldId);
  }
  const lines = Array.isArray((row as any).operation_lines) ? ((row as any).operation_lines as any[]) : [];
  for (const line of lines) {
    const lineFieldId = cleanString(line?.field_id);
    if (!lineFieldId || !fieldRefsById.has(lineFieldId)) continue;
    const lineField = relationOneValue(line?.fields);
    names.push(
      cleanString((lineField as any)?.name) ||
        fieldRefsById.get(lineFieldId)?.displayName ||
        fieldRefsById.get(lineFieldId)?.name ||
        lineFieldId
    );
  }
  return uniqueStrings(names).slice(0, 4).join(", ") || "-";
}

async function buildFieldMaterialRows(
  context: AssistantToolContext,
  fieldRefs: FieldMaterialScope[],
  seasonScope: AssistantSeasonScope,
  allowTestData: boolean
): Promise<Array<Record<string, unknown>>> {
  const fieldIds = uniqueStrings(fieldRefs.map((field) => field.id));
  if (!fieldIds.length) return [];
  const fieldRefsById = new Map(fieldRefs.map((field) => [field.id, field]));
  const rows: Array<Record<string, unknown>> = [];

  const operationsRes = await context.supabase
    .from("operations")
    .select(
      "id,date,operation_type,status,work_status,field_id,notes,archived," +
        "fields:field_id(name)," +
        "operation_materials:operation_materials(id,product_id,unit,planned_rate,actual_rate,planned_quantity,issued_quantity,consumed_quantity,returned_quantity,material_type,notes,products:product_id(name,trade_name))," +
        "operation_lines:operation_lines(id,field_id,planned_area_ha,actual_area_ha,fields:field_id(name))"
    )
    .eq("company_id", context.companyId)
    .eq("archived", false)
    .order("date", { ascending: false })
    .limit(600);
  if (operationsRes.error) throw new Error(operationsRes.error.message);

  for (const operation of operationsRes.data || []) {
    const operationRow = operation as unknown as Record<string, unknown>;
    const directFieldId = cleanString((operation as any).field_id);
    const lineFieldIds = getOperationLineFieldIds(operationRow);
    const operationFieldIds = uniqueStrings([directFieldId, ...lineFieldIds]);
    const matchesScope = operationFieldIds.some((fieldId) => fieldIds.includes(fieldId));
    if (!matchesScope) continue;

    const materials = Array.isArray((operation as any).operation_materials)
      ? (((operation as any).operation_materials || []) as any[])
      : [];
    const fieldName = getOperationFieldNamesForScope(operationRow, fieldRefsById);
    for (const material of materials) {
      const product = relationOneValue(material?.products);
      const productName =
        cleanString((product as any)?.trade_name) ||
        cleanString((product as any)?.name) ||
        cleanString(material?.product_id) ||
        "material";
      if (!allowTestData && (isQaMarkerText(productName) || isQaMarkerText(material?.notes) || isQaMarkerText((operation as any).notes))) {
        continue;
      }
      const { quantity, source } = chooseMaterialQuantity(material as Record<string, unknown>);
      rows.push({
        field_id: operationFieldIds.filter((fieldId) => fieldIds.includes(fieldId)).join(","),
        field_name: fieldName,
        product_name: productName,
        quantity: Number(quantity.toFixed(3)),
        qty_kg: Number(quantity.toFixed(3)),
        unit: cleanString(material?.unit) || "unit",
        date: cleanString((operation as any).date),
        operation: cleanString((operation as any).operation_type) || "-",
        operation_id: cleanString((operation as any).id),
        status: cleanString((operation as any).status),
        work_status: normalizeOperationWorkStatus(operationRow),
        material_type: cleanString(material?.material_type),
        quantity_source: source,
        source_type: "operation_materials",
      });
    }
  }

  const consumptionsRes = await context.supabase
    .from("field_material_consumptions")
    .select("field_id,product_id,quantity_kg,season_id,consumed_at,created_at,notes")
    .eq("company_id", context.companyId)
    .in("field_id", fieldIds)
    .limit(2000);
  if (consumptionsRes.error && !isMissingRelationError(consumptionsRes.error.message)) {
    throw new Error(consumptionsRes.error.message);
  }

  const rawConsumptions = (consumptionsRes.data || []).filter((row: any) =>
    matchesSeasonIdentity(seasonScope, row as Record<string, unknown>, {
      allowDateFallback: true,
      dateKeys: ["consumed_at", "created_at"],
    })
  );
  const lookup = await buildLookupMaps(
    context,
    {
      products: Array.from(new Set(rawConsumptions.map((x: any) => String(x.product_id || "")).filter(Boolean))),
    },
    { strictActive: true }
  );

  for (const row of rawConsumptions) {
    const productId = cleanString((row as any).product_id);
    const productName = productId ? lookup.byProduct.get(productId) : null;
    if (productId && !productName) continue;
    if (!allowTestData && (isQaMarkerText(productName) || isQaMarkerText((row as any).notes))) continue;
    const fieldId = cleanString((row as any).field_id);
    const quantity = Math.abs(Number((row as any).quantity_kg || 0));
    rows.push({
      field_id: fieldId,
      field_name: fieldId ? fieldRefsById.get(fieldId)?.displayName || fieldRefsById.get(fieldId)?.name || fieldId : "-",
      product_name: productName || "material",
      quantity: Number((Number.isFinite(quantity) ? quantity : 0).toFixed(3)),
      qty_kg: Number((Number.isFinite(quantity) ? quantity : 0).toFixed(3)),
      unit: "kg",
      date: cleanString((row as any).consumed_at) || cleanString((row as any).created_at),
      operation: cleanString((row as any).notes) || "field material fact",
      operation_id: null,
      status: "fact",
      work_status: "fact",
      material_type: "fact_consumption",
      quantity_source: "quantity_kg",
      source_type: "field_material_consumptions",
    });
  }

  const ticketsRes = await context.supabase
    .from("tickets")
    .select("id,ticket_no,status,op_type,created_at,net_weight_kg,driver_id,vehicle_id,field_id,is_voided")
    .eq("company_id", context.companyId)
    .in("field_id", fieldIds)
    .eq("is_voided", false)
    .limit(1000);
  if (ticketsRes.error && !isMissingRelationError(ticketsRes.error.message)) {
    throw new Error(ticketsRes.error.message);
  }

  const materialTickets = (ticketsRes.data || []).filter((ticket: any) => {
    const opType = normalizeSearchText(ticket.op_type);
    if (!/(issue_to_field|material_issue|field_issue|выдач|списан|внес)/i.test(opType)) return false;
    return matchesSeasonIdentity(seasonScope, ticket as Record<string, unknown>, {
      allowDateFallback: true,
      dateKeys: ["created_at"],
    });
  });
  const enrichedTickets = await enrichTickets(
    context,
    materialTickets.map((ticket: any) => ({
      id: cleanString(ticket.id),
      ticket_no: cleanString(ticket.ticket_no),
      status: cleanString(ticket.status),
      operation: cleanString(ticket.op_type),
      op_type: cleanString(ticket.op_type),
      net_kg: Number(ticket.net_weight_kg || 0),
      date: cleanString(ticket.created_at),
      created_at: cleanString(ticket.created_at),
      driver_id: cleanString(ticket.driver_id),
      vehicle_id: cleanString(ticket.vehicle_id),
      field_id: cleanString(ticket.field_id),
    }))
  );
  for (const ticket of enrichedTickets) {
    const fieldId = cleanString((ticket as any).field_id);
    const productName = cleanString((ticket as any).product_name) || cleanString((ticket as any).variety_name) || "material";
    if (!allowTestData && (isQaMarkerText(productName) || isQaMarkerText((ticket as any).ticket_no))) continue;
    const quantity = Math.abs(Number((ticket as any).net_kg || 0));
    rows.push({
      field_id: fieldId,
      field_name: fieldId ? fieldRefsById.get(fieldId)?.displayName || fieldRefsById.get(fieldId)?.name || fieldId : "-",
      product_name: productName,
      quantity: Number((Number.isFinite(quantity) ? quantity : 0).toFixed(3)),
      qty_kg: Number((Number.isFinite(quantity) ? quantity : 0).toFixed(3)),
      unit: "kg",
      date: cleanString((ticket as any).created_at) || cleanString((ticket as any).date),
      operation: cleanString((ticket as any).op_type) || cleanString((ticket as any).operation) || "ticket issue",
      operation_id: cleanString((ticket as any).id),
      status: cleanString((ticket as any).status),
      work_status: "fact",
      material_type: "ticket_issue",
      quantity_source: "ticket_net_weight_kg",
      ticket_no: cleanString((ticket as any).ticket_no),
      source_type: "tickets",
    });
  }

  return rows
    .filter((row) => allowTestData || !rowHasQaMarker(row, ["field_name", "product_name", "operation", "status"]))
    .sort((a, b) => String((b as any).date || "").localeCompare(String((a as any).date || "")))
    .slice(0, 300);
}

const getFieldMaterialsToolAlias: AssistantToolDefinition = {
  name: "get_field_materials",
  description: "Field materials from operation_materials and field_material_consumptions",
  domains: ["fields", "inventory", "ledger", "operations"],
  run: async (context) => {
    const query = parseFieldQueryFromContextV2(context);
    const seasonScope = await resolveSeasonScope(context.companyId, context);
    const seasonLabel = seasonScope.seasonYear || DEFAULT_SEASON_YEAR;
    if (!query) {
      return {
        title: "Field materials",
        rows: [],
        source: {
          module: "fields",
          tableOrView: "operation_materials + field_material_consumptions + tickets",
          season: seasonLabel,
          fetchedAt: nowIso(),
        },
      };
    }

    const allowTestData = isDebugOrTestDataAllowed(context);
    const selection = await resolveFieldSelection(context, query, 12);
    const fieldRefs: FieldMaterialScope[] = selection.selected
      ? [
          {
            id: selection.selected.id,
            name: selection.selected.name,
            displayName: selection.selected.displayName,
          },
        ]
      : selection.ambiguityReason && selection.candidates.length > 1
        ? selection.candidates.slice(0, 12).map((item) => ({
            id: item.id,
            name: item.name,
            displayName: item.displayName,
          }))
        : [];

    if (!fieldRefs.length) {
      return {
        title: "Field materials",
        rows: [],
        source: {
          module: "fields",
          tableOrView: "operation_materials + field_material_consumptions + tickets",
          season: seasonLabel,
          fetchedAt: nowIso(),
        },
      };
    }

    const rows = await buildFieldMaterialRows(context, fieldRefs, seasonScope, allowTestData);
    return {
      title: "Field materials",
      rows,
      source: {
        module: "fields",
        tableOrView: "operation_materials + field_material_consumptions + tickets",
        season: seasonLabel,
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
  resolve_entity: resolveEntityTool,
  get_quick_insights: getQuickInsightsTool,
  get_morning_report: getMorningReportTool,
  get_operation_insights: getOperationInsightsTool,
  get_warehouse_insights: getWarehouseInsightsTool,
  get_weighbridge_insights: getWeighbridgeInsightsTool,
  get_field_land_bank_summary: getFieldLandBankSummaryTool,
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
  get_active_operations: getActiveOperationsToolV2,
  get_active_operations_summary: getActiveOperationsSummaryToolAlias,
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
  get_operations: getOperationsToolV2,
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
  create_field_draft: makeDraftTool("create_field_draft", "Создать черновик поля"),
  create_meal_order_draft: makeDraftTool("create_meal_order_draft", "Создать черновик заявки питания"),
  create_warehouse_draft: makeDraftTool("create_warehouse_draft", "Создать черновик склада"),
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
