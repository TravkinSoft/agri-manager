import {
  findCropAliasesInText,
  findCropGroupsInText,
  normalizeCropAlias,
  resolveKnownCropAlias,
} from "@/lib/assistant/agro-taxonomy";
import type {
  AssistantIntent,
  AssistantSessionState,
  AssistantUiContext,
} from "@/lib/assistant/engine/types";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";

type NavigationDetection = {
  page: string;
  route: string;
  action: "open_page" | "open_entity" | "apply_filter";
  entityType?: "warehouse" | "field" | "fuel";
  entityQuery?: string | null;
  filters?: Record<string, string>;
};

const DEFAULT_SEASON = "2026";

function cleanString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length > 0 ? text : null;
}

function normalizeText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,!?;:()"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function hasRegex(text: string, regex: RegExp): boolean {
  return regex.test(text);
}

function hasAll(text: string, words: string[]): boolean {
  return words.every((word) => text.includes(word));
}

function extractQuotedValue(rawMessage: string): string | null {
  const quoted = String(rawMessage || "").match(/["«](.+?)["»]/);
  return cleanString(quoted?.[1]);
}

function extractYear(text: string): string | null {
  const match = text.match(/\b(20\d{2})\b/);
  return cleanString(match?.[1]);
}

function extractFieldCode(text: string): string | null {
  const match = text.match(/\b\d{1,3}(?:-\d{1,3}){0,2}\b/);
  return cleanString(match?.[0]);
}

function resolveWarehouseAlias(text: string): string | null {
  const aliasMap: Array<{ match: RegExp; value: string }> = [
    { match: /(овощн|картофельн|картофелехранил|хранилищ)/, value: "овощной склад" },
    { match: /(семенн|seed)/, value: "склад семян" },
    { match: /(зернов|grain)/, value: "зерновой склад" },
    { match: /(удобр|fertiliz|диам|dap|аммоф)/, value: "склад удобрений" },
    { match: /(сзр|хим|pestic|фунгиц|гербиц)/, value: "склад СЗР" },
  ];

  for (const rule of aliasMap) {
    if (rule.match.test(text)) return rule.value;
  }

  return null;
}

function resolveProductAlias(raw: string, normalized: string): string | null {
  const quoted = extractQuotedValue(raw);
  const direct = resolveKnownCropAlias(quoted || normalized);
  if (direct) return direct;

  if (hasRegex(normalized, /(картошк|картоф|potato|seed potato)/)) return "potato";
  if (hasRegex(normalized, /(диам+офос|диаммофос|диамофос|dap|аммофос)/)) return "диаммофоска";
  if (hasRegex(normalized, /(гала|gala)/)) return "gala";
  if (hasRegex(normalized, /(сорая|soraya)/)) return "soraya";
  if (hasRegex(normalized, /(балтик роуз|baltic rose)/)) return "baltic rose";
  if (hasRegex(normalized, /(азилит|azilit)/)) return "azilit";
  if (hasRegex(normalized, /(коломбо|colombo)/)) return "colombo";
  if (hasRegex(normalized, /(импала|impala)/)) return "impala";

  return null;
}

function extractEntityQuery(rawMessage: string, stopWords: string[]): string | null {
  const quoted = extractQuotedValue(rawMessage);
  if (quoted) return quoted;

  const stop = new Set(stopWords.map((w) => w.toLowerCase()));
  const tokens = String(rawMessage || "")
    .replace(/[.,!?;:()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const filtered = tokens.filter((token) => !stop.has(token.toLowerCase()));
  return cleanString(filtered.join(" "));
}

function isCropAreaQuestion(text: string): boolean {
  return hasRegex(
    text,
    /(сколько\s+(посев|засея)|сколько\s+га|посевн|структура\s+посев|общая\s+площадь\s+пол|sown area|crop structure|total hectares)/
  );
}

function pickCropAlias(raw: string, normalized: string): string | null {
  return resolveProductAlias(raw, normalized);
}

function detectNavigationIntent(message: string, sessionState: AssistantSessionState): NavigationDetection | null {
  const raw = String(message || "");
  const text = normalizeText(raw);

  const looksLikeNavigation =
    hasRegex(text, /(открой|открыть|перейди|перейти|зайди|покажи\s+страниц|go to|open|navigate)/) ||
    hasAny(text, ["open", "go to", "navigate"]);
  if (!looksLikeNavigation) return null;

  if (hasRegex(text, /(весов|талон|weighbridge|ticket)/)) {
    return { page: "weighbridge", route: "/weighbridge", action: "open_page" };
  }
  if (hasRegex(text, /(склад|warehouse)/)) {
    const query = extractEntityQuery(raw, [
      "открой",
      "открыть",
      "перейди",
      "перейти",
      "зайди",
      "покажи",
      "склад",
      "склады",
      "warehouse",
      "warehouses",
      "open",
      "go",
      "to",
      "navigate",
      "show",
      "please",
      "мне",
      "пожалуйста",
    ]);
    if (query) {
      return {
        page: "warehouses",
        route: "/warehouses",
        action: "open_entity",
        entityType: "warehouse",
        entityQuery: query,
        filters: { search: query },
      };
    }
    return { page: "warehouses", route: "/warehouses", action: "open_page" };
  }
  if (hasRegex(text, /(поле|поля|field|fields)/)) {
    const fieldCode = extractFieldCode(text);
    const query =
      fieldCode ||
      extractEntityQuery(raw, [
        "открой",
        "открыть",
        "перейди",
        "перейти",
        "зайди",
        "покажи",
        "поле",
        "поля",
        "field",
        "fields",
        "open",
        "go",
        "to",
        "navigate",
        "show",
        "please",
        "мне",
        "пожалуйста",
      ]);
    if (query) {
      return {
        page: "fields",
        route: "/fields",
        action: "open_entity",
        entityType: "field",
        entityQuery: query,
        filters: { search: query },
      };
    }
    return { page: "fields", route: "/fields", action: "open_page" };
  }
  if (hasRegex(text, /(азс|гсм|топлив|fuel)/)) {
    const query = extractEntityQuery(raw, [
      "открой",
      "открыть",
      "перейди",
      "перейти",
      "зайди",
      "покажи",
      "азс",
      "гсм",
      "топливо",
      "fuel",
      "open",
      "go",
      "to",
      "navigate",
      "show",
      "please",
      "мне",
      "пожалуйста",
    ]);
    if (query) {
      return {
        page: "fuel",
        route: "/fuel",
        action: "open_entity",
        entityType: "fuel",
        entityQuery: query,
        filters: { search: query },
      };
    }
    return { page: "fuel", route: "/fuel", action: "open_page" };
  }
  if (hasRegex(text, /(кадастр|право|land legal)/)) {
    return { page: "land-legal", route: "/land-legal", action: "open_page" };
  }
  if (hasRegex(text, /(операц|operations)/)) {
    return { page: "operations", route: "/operations", action: "open_page" };
  }
  if (hasRegex(text, /(структур|посев|crop-structure)/)) {
    return { page: "crop-structure", route: "/crop-structure", action: "open_page" };
  }
  if (hasRegex(text, /(отч[её]т\s+по\s+картоф|potato report)/)) {
    return {
      page: "analytics",
      route: "/analytics",
      action: "apply_filter",
      filters: { report: "potato-material-consumption" },
    };
  }
  if (hasRegex(text, /(отч[её]т|analytics|report)/)) {
    return { page: "analytics", route: "/analytics", action: "open_page" };
  }
  if (hasRegex(text, /(пользоват|users)/)) {
    return { page: "users", route: "/users", action: "open_page" };
  }
  if (hasRegex(text, /(панел|главн|dashboard)/)) {
    return { page: "dashboard", route: "/dashboard", action: "open_page" };
  }

  if (hasRegex(text, /(открой его|открой ее|открой это|перейди к нему|open it)/)) {
    if (sessionState.lastWarehouse) {
      return {
        page: "warehouses",
        route: "/warehouses",
        action: "open_entity",
        entityType: "warehouse",
        entityQuery: sessionState.lastWarehouse,
        filters: { search: sessionState.lastWarehouse },
      };
    }
    if (sessionState.lastField) {
      return {
        page: "fields",
        route: "/fields",
        action: "open_entity",
        entityType: "field",
        entityQuery: sessionState.lastField,
        filters: { search: sessionState.lastField },
      };
    }
  }

  return { page: "dashboard", route: "/dashboard", action: "open_page" };
}

function shouldAskFieldClarification(text: string): boolean {
  if (!hasRegex(text, /(поле|field)/)) return false;
  if (extractFieldCode(text)) return false;
  if (hasRegex(text, /(все поля|всех пол|поля под|структура|картоф|зернов|маслич|овощ|га|площад)/)) return false;
  return hasRegex(text, /(^поле$|^поля$|история поля|что по полю|какое поле)/);
}

function shouldAskWarehouseClarification(text: string): boolean {
  if (!hasRegex(text, /(склад|склады|warehouse|stock|остатк|налич)/)) return false;
  if (hasRegex(text, /(все склады|по всем складам|остатки|наличие|отрицатель|последние движения|картоф|удобр|сзр|семян)/)) {
    return false;
  }
  return hasRegex(text, /(^склад$|^склады$|какой склад|по какому складу$)/);
}

function isWarehouseMovementQuestion(text: string): boolean {
  return hasRegex(text, /(последн.*движ|движен.*склад|журнал движ|что (пришло|ушло) (сегодня|за сегодня)|movement|ledger)/);
}

function isNegativeStockQuestion(text: string): boolean {
  return hasRegex(text, /(отрицательн.*остат|минус.*склад|negative stock)/);
}

function isWeighbridgeQuestion(text: string): boolean {
  return hasRegex(text, /(весов|талон|tickets?|рейс|машин.*не закрыт|сколько тонн сегодня|сколько рейсов сегодня)/);
}

function isOperationQuestion(text: string): boolean {
  return hasRegex(text, /(операц|в работе|жд[её]т материалы|не выполнено|не закрыт|active operations|material_waiting)/);
}

function isMaterialUsageQuestion(text: string): boolean {
  return hasRegex(text, /(сколько .*ушло|сколько .*внесл|перерасход|норма .*га|диаммофос|сзр|фунгицид|удобрени|семян)/);
}

function isCadastreQuestion(text: string): boolean {
  return hasRegex(text, /(кадастр|договор|собственник|без кадастра|land legal)/);
}

function isReportQuestion(text: string): boolean {
  return hasRegex(text, /(отчет|отч[её]т|report|экспорт|excel)/);
}

function isHarvestQuestion(text: string): boolean {
  return hasRegex(text, /(урожай|уборк|урожайн|партии|поступило на склад|harvest)/);
}

function withSeasonDefault(parameters: Record<string, string | number | boolean | null>, text: string): Record<string, string | number | boolean | null> {
  const explicitYear = extractYear(text);
  return {
    ...parameters,
    season: explicitYear || DEFAULT_SEASON,
  };
}

function withCommonDefaults(intent: AssistantIntent, text: string): AssistantIntent {
  const needsSeason =
    intent.name === "crop_structure_overview" ||
    intent.name === "operations_recent" ||
    intent.name === "fields_overview";
  const nextParams = needsSeason ? withSeasonDefault(intent.parameters, text) : intent.parameters;
  return {
    ...intent,
    parameters: nextParams,
  };
}

function fallbackIntent(message: string, sessionState: AssistantSessionState): AssistantIntent {
  const raw = String(message || "");
  const text = normalizeText(raw);
  const navigation = detectNavigationIntent(raw, sessionState);
  const cropGroups = findCropGroupsInText(text);
  const normalizedAlias = normalizeCropAlias(text);
  const cropAlias = pickCropAlias(raw, text);

  if (navigation) {
    return withCommonDefaults({
      name: "navigation_help",
      confidence: 0.98,
      needsData: false,
      parameters: {
        page: navigation.page,
        route: navigation.route,
        action: navigation.action,
        entityType: navigation.entityType || null,
        entityQuery: navigation.entityQuery || null,
        filters: navigation.filters ? JSON.stringify(navigation.filters) : null,
      },
    }, text);
  }

  if (isCropAreaQuestion(text)) {
    return withCommonDefaults({
      name: "crop_structure_overview",
      confidence: 0.98,
      needsData: true,
      parameters: {
        query: cleanString(raw),
        intent_group: "crop_structure",
      },
    }, text);
  }

  if (hasRegex(text, /(создай|подготов|черновик|draft)/)) {
    return withCommonDefaults({
      name: "create_draft",
      confidence: 0.8,
      needsData: true,
      parameters: { query: cleanString(raw) },
    }, text);
  }

  if (hasRegex(text, /(гсм|азс|топлив|дизел|бензин|заправ|fuel)/)) {
    return withCommonDefaults({
      name: "fuel_movements",
      confidence: 0.9,
      needsData: true,
      parameters: { query: cleanString(raw), intent_group: "fuel" },
    }, text);
  }

  if (isWeighbridgeQuestion(text)) {
    const wantOpen = hasRegex(text, /(активн|не закрыт|open)/);
    const wantRecent = hasRegex(text, /(последн|today|сегодня)/);
    return withCommonDefaults({
      name: "weighbridge_tickets",
      confidence: 0.93,
      needsData: true,
      parameters: {
        query: cleanString(raw),
        status: wantOpen ? "active" : null,
        limit: wantRecent ? 30 : null,
        intent_group: "weighbridge",
      },
    }, text);
  }

  if (isNegativeStockQuestion(text)) {
    return withCommonDefaults({
      name: "inventory_balance",
      confidence: 0.95,
      needsData: true,
      parameters: {
        query: cleanString(raw),
        allWarehouses: true,
        negative_only: true,
        intent_group: "inventory",
      },
    }, text);
  }

  if (isWarehouseMovementQuestion(text)) {
    const direction = hasRegex(text, /(ушло|outbound|расход)/) ? "out" : hasRegex(text, /(пришло|inbound|приход)/) ? "in" : null;
    return withCommonDefaults({
      name: "warehouse_movements",
      confidence: 0.92,
      needsData: true,
      parameters: {
        query: cleanString(raw),
        limit: hasRegex(text, /(последн|latest|last)/) ? 30 : null,
        direction,
        intent_group: "inventory",
      },
    }, text);
  }

  if (hasRegex(text, /(остат|склад|налич|balance|stock|inventory|warehouse)/)) {
    const productAlias = pickCropAlias(raw, text);
    return withCommonDefaults({
      name: "inventory_balance",
      confidence: 0.95,
      needsData: true,
      parameters: {
        query: cleanString(raw),
        product: productAlias || null,
        allWarehouses: true,
        warehouse_alias: resolveWarehouseAlias(text),
        intent_group: "inventory",
      },
    }, text);
  }

  if (hasRegex(text, /(движен|провод|ledger|movement|journal)/)) {
    return withCommonDefaults({
      name: "warehouse_movements",
      confidence: 0.86,
      needsData: true,
      parameters: { query: cleanString(raw), limit: 30, intent_group: "inventory" },
    }, text);
  }

  if (hasRegex(text, /(активные\s+операц|active operations|операции в работе)/)) {
    return withCommonDefaults({
      name: "operations_recent",
      confidence: 0.86,
      needsData: true,
      parameters: { query: cleanString(raw), status: "active", intent_group: "operations" },
    }, text);
  }

  if (isOperationQuestion(text) || isMaterialUsageQuestion(text) || isHarvestQuestion(text)) {
    const status = hasRegex(text, /(жд[её]т материалы|waiting_materials)/)
      ? "waiting_materials"
      : hasRegex(text, /(в работе|in_progress)/)
        ? "in_progress"
        : hasRegex(text, /(активн|active)/)
          ? "active"
          : null;
    return withCommonDefaults({
      name: "operations_recent",
      confidence: 0.82,
      needsData: true,
      parameters: {
        query: cleanString(raw),
        status,
        intent_group: isMaterialUsageQuestion(text) ? "materials" : isHarvestQuestion(text) ? "harvest" : "operations",
      },
    }, text);
  }

  if (hasRegex(text, /(операц|operations)/)) {
    return withCommonDefaults({
      name: "operations_recent",
      confidence: 0.8,
      needsData: true,
      parameters: { query: cleanString(raw), intent_group: "operations" },
    }, text);
  }

  if (hasRegex(text, /(картоф|potato report|материал по картоф)/)) {
    return withCommonDefaults({
      name: "crop_structure_overview",
      confidence: 0.93,
      needsData: true,
      parameters: {
        query: cleanString(raw),
        crop: "картофель",
        crop_alias: cropAlias || "potato",
        intent_group: "potato",
      },
    }, text);
  }

  if (cropGroups.length || cropAlias || hasRegex(text, /(структур|посев|посевн|crop structure)/)) {
    return withCommonDefaults({
      name: "crop_structure_overview",
      confidence: 0.9,
      needsData: true,
      parameters: {
        query: cleanString(raw),
        crop_group: cropGroups[0] || null,
        crop_alias: cropAlias || normalizedAlias,
        intent_group: cropGroups.length ? "crop_group" : cropAlias ? "crop_alias" : "crop_structure",
      },
    }, text);
  }

  if (hasRegex(text, /(поле|поля|field|fields)/)) {
    if (shouldAskFieldClarification(text)) {
      return withCommonDefaults({
        name: "clarification_required",
        confidence: 0.72,
        needsData: false,
        parameters: {
          query: cleanString(raw),
          focus: "поле",
          reason: "missing_field_identifier",
        },
      }, text);
    }
    return withCommonDefaults({
      name: "fields_overview",
      confidence: 0.84,
      needsData: true,
      parameters: {
        query: cleanString(raw),
        field: extractFieldCode(text),
        intent_group: "fields",
      },
    }, text);
  }

  if (isCadastreQuestion(text) || isReportQuestion(text)) {
    const route = isCadastreQuestion(text) ? "/land-legal" : "/analytics";
    const page = isCadastreQuestion(text) ? "land-legal" : "analytics";
    return withCommonDefaults({
      name: "navigation_help",
      confidence: 0.88,
      needsData: false,
      parameters: {
        page,
        route,
        action: "open_page",
      },
    }, text);
  }

  if (hasRegex(text, /(контекст|компания|сезон|context|season|company)/)) {
    return withCommonDefaults({
      name: "company_context",
      confidence: 0.75,
      needsData: true,
      parameters: { season: sessionState.lastSeason },
    }, text);
  }

  if (shouldAskWarehouseClarification(text)) {
    return withCommonDefaults({
      name: "clarification_required",
      confidence: 0.7,
      needsData: false,
      parameters: { query: cleanString(raw), focus: "склад", reason: "missing_warehouse_identifier" },
    }, text);
  }

  return withCommonDefaults({
    name: "general_question",
    confidence: 0.45,
    needsData: false,
    parameters: {},
  }, text);
}

export async function classifyAssistantIntent(params: {
  message: string;
  runtimeContext: AssistantUiContext;
  sessionState: AssistantSessionState;
  settings: AssistantPlatformSettings;
}): Promise<AssistantIntent> {
  const { message, sessionState } = params;
  return fallbackIntent(message, sessionState);
}
