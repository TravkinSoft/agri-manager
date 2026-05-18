import type {
  AssistantIntent,
  AssistantSessionState,
  AssistantUiContext,
} from "@/lib/assistant/engine/types";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";

type NavigationDetection = {
  page: string;
  route: string;
  action: "open_page" | "open_entity";
  entityType?: "warehouse" | "field" | "fuel";
  entityQuery?: string | null;
  filters?: Record<string, string>;
};

function cleanString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length ? text : null;
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

function isLikelyNavigationMessage(text: string): boolean {
  return hasAny(text, [
    "открой",
    "открыть",
    "перейди",
    "перейти",
    "зайди",
    "покажи страницу",
    "покажи раздел",
    "перенеси на страницу",
    "open",
    "go to",
    "navigate",
  ]);
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

function isGenericWarehouseQuery(value: string | null): boolean {
  const token = normalizeText(value || "");
  return [
    "склад",
    "склады",
    "складов",
    "warehouse",
    "warehouses",
    "страница складов",
    "раздел складов",
  ].includes(token);
}

function isGenericFieldQuery(value: string | null): boolean {
  const token = normalizeText(value || "");
  return ["поле", "поля", "fields", "field", "страница полей", "раздел полей"].includes(token);
}

function isGenericFuelQuery(value: string | null): boolean {
  const token = normalizeText(value || "");
  return [
    "азс",
    "гсм",
    "топливо",
    "заправка",
    "fuel",
    "страница гсм",
    "раздел гсм",
  ].includes(token);
}

function detectNavigationIntent(message: string, sessionState: AssistantSessionState): NavigationDetection | null {
  const raw = String(message || "");
  const text = normalizeText(raw);
  if (!isLikelyNavigationMessage(text)) return null;

  // Fuel must win over generic warehouse words.
  if (hasAny(text, ["азс", "гсм", "топливо", "дизель", "бензин", "заправ", "fuel"])) {
    const query = extractEntityQuery(raw, [
      "открой",
      "открыть",
      "перейди",
      "перейти",
      "зайди",
      "покажи",
      "раздел",
      "страницу",
      "страница",
      "в",
      "на",
      "азс",
      "гсм",
      "топливо",
      "дизель",
      "бензин",
      "заправку",
      "заправка",
      "fuel",
    ]);

    const entityQuery = isGenericFuelQuery(query) ? null : query;
    return entityQuery
      ? {
          page: "fuel",
          route: "/fuel",
          action: "open_entity",
          entityType: "fuel",
          entityQuery,
          filters: { search: entityQuery },
        }
      : { page: "fuel", route: "/fuel", action: "open_page" };
  }

  if (hasAny(text, ["склады", "склад", "warehouse", "warehouses"])) {
    const query = extractEntityQuery(raw, [
      "открой",
      "открыть",
      "перейди",
      "перейти",
      "зайди",
      "покажи",
      "раздел",
      "страницу",
      "страница",
      "склад",
      "склады",
      "складов",
      "warehouse",
      "warehouses",
      "мне",
      "пожалуйста",
    ]);

    const entityQuery = isGenericWarehouseQuery(query) ? null : query;
    return entityQuery
      ? {
          page: "warehouses",
          route: "/warehouses",
          action: "open_entity",
          entityType: "warehouse",
          entityQuery,
          filters: { search: entityQuery },
        }
      : { page: "warehouses", route: "/warehouses", action: "open_page" };
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
        "раздел",
        "страницу",
        "поле",
        "поля",
        "field",
        "fields",
        "мне",
        "пожалуйста",
      ]);

    const entityQuery = isGenericFieldQuery(query) ? null : query;
    return entityQuery
      ? {
          page: "fields",
          route: "/fields",
          action: "open_entity",
          entityType: "field",
          entityQuery,
          filters: { search: entityQuery },
        }
      : { page: "fields", route: "/fields", action: "open_page" };
  }

  if (hasAny(text, ["весовая", "талон", "weighbridge", "ticket"])) {
    return { page: "weighbridge", route: "/weighbridge", action: "open_page" };
  }

  if (hasAny(text, ["операции", "операция", "operations"])) {
    return { page: "operations", route: "/operations", action: "open_page" };
  }

  if (hasAny(text, ["структура посевов", "посев", "crop-structure"])) {
    return { page: "crop-structure", route: "/crop-structure", action: "open_page" };
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

function fallbackIntent(message: string, sessionState: AssistantSessionState): AssistantIntent {
  const raw = String(message || "");
  const text = normalizeText(raw);
  const navigation = detectNavigationIntent(raw, sessionState);

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

  // Ambiguous one-word commands should ask clarification first.
  if (["склад", "склады", "поле", "поля", "операция", "операции", "заправка", "гсм"].includes(text)) {
    return {
      name: "clarification_required",
      confidence: 0.7,
      needsData: false,
      parameters: { query: cleanString(raw) },
    };
  }

  if (hasAny(text, ["создай", "подготовь", "сделай черновик", "draft"])) {
    return {
      name: "create_draft",
      confidence: 0.74,
      needsData: true,
      parameters: { query: cleanString(raw) },
    };
  }

  if (hasAny(text, ["гсм", "азс", "топливо", "дизель", "бензин", "заправ", "fuel"])) {
    return { name: "fuel_movements", confidence: 0.84, needsData: true, parameters: { query: cleanString(raw) } };
  }

  if (hasAny(text, ["остат", "склад", "налич", "balance", "stock", "inventory", "warehouse"])) {
    return { name: "inventory_balance", confidence: 0.8, needsData: true, parameters: { query: cleanString(raw) } };
  }

  if (hasAny(text, ["движен", "провод", "ledger", "movement", "journal"])) {
    return { name: "warehouse_movements", confidence: 0.76, needsData: true, parameters: {} };
  }

  if (hasAny(text, ["талон", "весов", "ticket", "weighbridge"])) {
    return { name: "weighbridge_tickets", confidence: 0.74, needsData: true, parameters: {} };
  }

  if (hasAny(text, ["структура посев", "посевная", "crop structure"])) {
    return { name: "crop_structure_overview", confidence: 0.72, needsData: true, parameters: {} };
  }

  if (hasAny(text, ["поле", "поля", "field", "fields"])) {
    return { name: "fields_overview", confidence: 0.7, needsData: true, parameters: { query: cleanString(raw) } };
  }

  if (hasAny(text, ["операц", "operations"])) {
    return { name: "operations_recent", confidence: 0.68, needsData: true, parameters: {} };
  }

  if (hasAny(text, ["контекст", "компания", "сезон", "context", "season", "company"])) {
    return {
      name: "company_context",
      confidence: 0.64,
      needsData: true,
      parameters: { season: sessionState.lastSeason },
    };
  }

  return {
    name: "general_question",
    confidence: 0.4,
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
