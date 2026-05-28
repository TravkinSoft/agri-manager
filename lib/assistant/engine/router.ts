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

function cleanString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length > 0 ? text : null;
}

function normalizeText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function extractQuotedValue(rawMessage: string): string | null {
  const quoted = String(rawMessage || "").match(/["«](.+?)["»]/);
  return cleanString(quoted?.[1]);
}

function extractFieldCode(text: string): string | null {
  const match = text.match(/\b\d{1,3}(?:-\d{1,3}){0,2}\b/);
  return cleanString(match?.[0]);
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

function detectNavigationIntent(message: string, sessionState: AssistantSessionState): NavigationDetection | null {
  const raw = String(message || "");
  const text = normalizeText(raw);
  const looksLikeNavigation = hasAny(text, [
    "открой",
    "открыть",
    "перейди",
    "перейти",
    "зайди",
    "open",
    "go to",
    "navigate",
  ]);
  if (!looksLikeNavigation) return null;

  if (hasAny(text, ["весов", "талон", "weighbridge", "ticket"])) {
    return { page: "weighbridge", route: "/weighbridge", action: "open_page" };
  }
  if (hasAny(text, ["склад", "warehouse"])) {
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
  if (hasAny(text, ["поле", "поля", "field", "fields"])) {
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
  if (hasAny(text, ["азс", "гсм", "топлив", "fuel"])) {
    const query = extractEntityQuery(raw, [
      "открой",
      "открыть",
      "перейди",
      "перейти",
      "зайди",
      "азс",
      "гсм",
      "топливо",
      "fuel",
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
  if (hasAny(text, ["кадастр", "право", "land legal"])) {
    return { page: "land-legal", route: "/land-legal", action: "open_page" };
  }
  if (hasAny(text, ["операц", "operations"])) {
    return { page: "operations", route: "/operations", action: "open_page" };
  }
  if (hasAny(text, ["структур", "посев", "crop-structure"])) {
    return { page: "crop-structure", route: "/crop-structure", action: "open_page" };
  }
  if (hasAny(text, ["отчет по картоф", "отчёт по картоф", "potato report"])) {
    return {
      page: "analytics",
      route: "/analytics",
      action: "apply_filter",
      filters: { report: "potato-material-consumption" },
    };
  }
  if (hasAny(text, ["отчет", "отчёт", "analytics", "report"])) {
    return { page: "analytics", route: "/analytics", action: "open_page" };
  }
  if (hasAny(text, ["пользовател", "users"])) {
    return { page: "users", route: "/users", action: "open_page" };
  }
  if (hasAny(text, ["панель", "главная", "dashboard"])) {
    return { page: "dashboard", route: "/dashboard", action: "open_page" };
  }

  if (hasAny(text, ["открой его", "открой ее", "открой это", "перейди к нему"])) {
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

function needsClarification(text: string): boolean {
  return [
    "склад",
    "склады",
    "поле",
    "поля",
    "операция",
    "операции",
    "весовая",
    "талон",
    "отчет",
    "отчеты",
    "отчёт",
    "отчёты",
  ].includes(text);
}

function pickCropAlias(raw: string, normalized: string): string | null {
  const quoted = extractQuotedValue(raw);
  if (quoted) {
    const knownQuoted = resolveKnownCropAlias(quoted);
    if (knownQuoted) return knownQuoted;
  }
  const aliasesInText = findCropAliasesInText(raw);
  if (aliasesInText.length) return aliasesInText[0];
  const knownDirect = resolveKnownCropAlias(normalized);
  if (knownDirect) return knownDirect;
  if (normalized.includes("картоф")) return "potato";
  return null;
}

function fallbackIntent(message: string, sessionState: AssistantSessionState): AssistantIntent {
  const raw = String(message || "");
  const text = normalizeText(raw);
  const navigation = detectNavigationIntent(raw, sessionState);
  const cropGroups = findCropGroupsInText(text);
  const normalizedAlias = normalizeCropAlias(text);
  const cropAlias = pickCropAlias(raw, text);

  if (navigation) {
    return {
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
    };
  }

  if (hasAny(text, ["создай", "подготов", "черновик", "draft"])) {
    return {
      name: "create_draft",
      confidence: 0.8,
      needsData: true,
      parameters: { query: cleanString(raw) },
    };
  }

  if (hasAny(text, ["гсм", "азс", "топлив", "дизель", "бензин", "заправ", "fuel"])) {
    return { name: "fuel_movements", confidence: 0.9, needsData: true, parameters: { query: cleanString(raw) } };
  }

  if (hasAny(text, ["талон", "весов", "ticket", "weighbridge"])) {
    return { name: "weighbridge_tickets", confidence: 0.88, needsData: true, parameters: { query: cleanString(raw) } };
  }

  if (hasAny(text, ["остат", "склад", "налич", "balance", "stock", "inventory", "warehouse"])) {
    return {
      name: "inventory_balance",
      confidence: 0.91,
      needsData: true,
      parameters: {
        query: cleanString(raw),
        product: cropAlias || null,
        allWarehouses: true,
      },
    };
  }

  if (hasAny(text, ["движен", "провод", "ledger", "movement", "journal"])) {
    return { name: "warehouse_movements", confidence: 0.82, needsData: true, parameters: { query: cleanString(raw) } };
  }

  if (hasAny(text, ["активные операции", "active operations", "операции в работе"])) {
    return {
      name: "operations_recent",
      confidence: 0.86,
      needsData: true,
      parameters: { query: cleanString(raw), status: "active" },
    };
  }

  if (hasAny(text, ["операц", "operations"])) {
    return { name: "operations_recent", confidence: 0.8, needsData: true, parameters: { query: cleanString(raw) } };
  }

  if (hasAny(text, ["картоф", "potato report", "материал по картоф"])) {
    return {
      name: "crop_structure_overview",
      confidence: 0.9,
      needsData: true,
      parameters: {
        query: cleanString(raw),
        crop: "картофель",
        crop_alias: cropAlias || "potato",
      },
    };
  }

  if (cropGroups.length || cropAlias || hasAny(text, ["структур", "посев", "посевн", "crop structure"])) {
    return {
      name: "crop_structure_overview",
      confidence: 0.86,
      needsData: true,
      parameters: {
        query: cleanString(raw),
        crop_group: cropGroups[0] || null,
        crop_alias: cropAlias || normalizedAlias,
      },
    };
  }

  if (hasAny(text, ["поле", "поля", "field", "fields"])) {
    return { name: "fields_overview", confidence: 0.8, needsData: true, parameters: { query: cleanString(raw) } };
  }

  if (hasAny(text, ["контекст", "компания", "сезон", "context", "season", "company"])) {
    return {
      name: "company_context",
      confidence: 0.7,
      needsData: true,
      parameters: { season: sessionState.lastSeason },
    };
  }

  if (needsClarification(text)) {
    return {
      name: "clarification_required",
      confidence: 0.72,
      needsData: false,
      parameters: { query: cleanString(raw), focus: text },
    };
  }

  return {
    name: "general_question",
    confidence: 0.45,
    needsData: false,
    parameters: {},
  };
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
