import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyAssistantIntent } from "@/lib/assistant/engine/router";
import { getAssistantTool } from "@/lib/assistant/engine/tools";
import { normalizeAssistantUiContext } from "@/lib/assistant/engine/runtime";
import {
  EMPTY_ASSISTANT_SESSION_STATE,
  normalizeSessionState,
  updateSessionStateFromToolOutput,
} from "@/lib/assistant/engine/session-state";
import type {
  AssistantEngineInput,
  AssistantEngineResult,
  AssistantIntent,
  AssistantIntentName,
  AssistantNavigationAction,
  AssistantSessionState,
  AssistantToolCallLog,
  AssistantToolName,
  AssistantToolOutput,
} from "@/lib/assistant/engine/types";
import { resolveAssistantModelConfig } from "@/lib/assistant/openai";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import type { ServerActorContext } from "@/lib/auth/server-session";

type UsageStats = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

function cleanString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length ? text : null;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function safeText(value: unknown, fallback = "—"): string {
  return cleanString(value) || fallback;
}

function formatNumber(value: number, maximumFractionDigits = 3): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits });
}

function formatKg(value: unknown): string {
  const qty = asNumber(value);
  return `${formatNumber(qty, 3)} кг`;
}

function formatKgAndTons(value: unknown): string {
  const qty = asNumber(value);
  return `${formatNumber(qty, 3)} кг / ${formatNumber(qty / 1000, 3)} т`;
}

function formatDateTime(value: unknown): string {
  const text = cleanString(value);
  if (!text) return "—";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("ru-RU");
}

function mapBatchClassLabel(value: unknown): string {
  switch (safeText(value, "commodity").toLowerCase()) {
    case "seed":
      return "Семенной";
    case "feed":
      return "Кормовой";
    case "waste":
      return "Отход";
    case "processing":
      return "Доработка";
    case "rejected":
      return "Брак";
    case "commodity":
    default:
      return "Товарный";
  }
}

function mapDirectionLabel(value: unknown): string {
  switch (safeText(value, "").toLowerCase()) {
    case "in":
    case "incoming":
      return "Приход";
    case "out":
    case "outgoing":
      return "Расход";
    case "transfer":
      return "Перемещение";
    default:
      return safeText(value);
  }
}

function mapTicketStatusLabel(value: unknown): string {
  switch (safeText(value, "").toLowerCase()) {
    case "open":
    case "active":
      return "Открыт";
    case "closed":
      return "Закрыт";
    case "voided":
      return "Сторно";
    default:
      return safeText(value);
  }
}

function mapFuelMovementType(value: unknown): string {
  switch (safeText(value, "").toLowerCase()) {
    case "issue":
      return "Выдача";
    case "transfer":
      return "Перемещение";
    case "refill":
      return "Пополнение";
    default:
      return safeText(value);
  }
}

function isRoleAllowed(settings: AssistantPlatformSettings, role: string): boolean {
  return (settings.allowedRoles || []).includes(role as any);
}

function parseFiltersJson(value: unknown): Record<string, string> | null {
  const raw = cleanString(value);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const output: Record<string, string> = {};
    Object.entries(parsed || {}).forEach(([key, inner]) => {
      const text = cleanString(inner);
      if (text) output[key] = text;
    });
    return Object.keys(output).length ? output : null;
  } catch {
    return null;
  }
}

function looksLikeErpDataQuestion(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return /(остат|склад|парт|движен|провод|ledger|inventory|warehouse|batch|stock|balance|талон|весов|гсм|топлив|азс|поле|посев|операц|урожа)/.test(
    text
  );
}

function isCapabilitiesQuestion(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return /(что ты умеешь|твои возможности|чем поможешь|help|what can you do)/.test(text);
}

function formatInventoryRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "По текущему фильтру складские остатки не найдены.";

  const buckets = new Map<
    string,
    {
      total: number;
      byClass: Map<string, number>;
      byWarehouse: Map<string, number>;
      varieties: Set<string>;
      reproductions: Set<string>;
    }
  >();

  rows.forEach((row) => {
    const product = safeText(row.product_name);
    const batchClass = mapBatchClassLabel(row.batch_class);
    const warehouse = safeText(row.warehouse_name);
    const qty = asNumber(row.quantity);
    const variety = cleanString(row.variety_name);
    const reproduction = cleanString(row.reproduction_name);

    if (!buckets.has(product)) {
      buckets.set(product, {
        total: 0,
        byClass: new Map<string, number>(),
        byWarehouse: new Map<string, number>(),
        varieties: new Set<string>(),
        reproductions: new Set<string>(),
      });
    }
    const bucket = buckets.get(product)!;
    bucket.total += qty;
    bucket.byClass.set(batchClass, (bucket.byClass.get(batchClass) || 0) + qty);
    bucket.byWarehouse.set(warehouse, (bucket.byWarehouse.get(warehouse) || 0) + qty);
    if (variety && variety !== "-") bucket.varieties.add(variety);
    if (reproduction && reproduction !== "-") bucket.reproductions.add(reproduction);
  });

  return Array.from(buckets.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 6)
    .map(([product, bucket]) => {
      const lines: string[] = [];
      lines.push(`Остатки ${product.toLowerCase()}:`);
      lines.push(`Всего: ${formatKgAndTons(bucket.total)}`);
      lines.push("");
      lines.push("По классам:");
      Array.from(bucket.byClass.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([cls, qty]) => lines.push(`• ${cls}: ${formatKgAndTons(qty)}`));
      lines.push("");
      lines.push("По складам:");
      Array.from(bucket.byWarehouse.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([warehouse, qty]) => lines.push(`• ${warehouse} — ${formatKgAndTons(qty)}`));

      if (bucket.varieties.size) {
        lines.push("");
        lines.push("Сорта:");
        Array.from(bucket.varieties)
          .sort()
          .slice(0, 12)
          .forEach((item) => lines.push(`• ${item}`));
      }

      if (bucket.reproductions.size) {
        lines.push("");
        lines.push("Репродукции:");
        Array.from(bucket.reproductions)
          .sort()
          .slice(0, 12)
          .forEach((item) => lines.push(`• ${item}`));
      }

      lines.push("");
      lines.push("Сезон в остатках не указан: это складские текущие остатки.");
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatWarehouseMovementsRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Последние движения по складам не найдены.";
  const lines = rows.slice(0, 12).map((row) => {
    return `• ${formatDateTime(row.date)} · ${mapDirectionLabel(row.direction)} · ${safeText(row.warehouse_name)} · ${safeText(
      row.product_name
    )} · ${formatKg(row.quantity)} (${mapBatchClassLabel(row.batch_class)})`;
  });
  return `Последние движения склада:\n\n${lines.join("\n")}`;
}

function formatFieldsRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Поля по текущему фильтру не найдены.";
  const lines = rows
    .slice(0, 12)
    .map((row) => `• ${safeText(row.field_name)} — ${formatNumber(asNumber(row.area_ha), 2)} га`);
  return `Поля компании:\n\n${lines.join("\n")}`;
}

function formatCropStructureRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Структура посевов по текущему сезону не найдена.";
  const lines = rows.slice(0, 12).map((row) => {
    return `• ${safeText(row.field_name)}: ${safeText(row.crop_name)} / ${safeText(row.variety_name)} / ${safeText(
      row.reproduction_name
    )} — ${formatNumber(asNumber(row.area_ha), 2)} га (сезон ${safeText(row.season_year)})`;
  });
  return `Структура посевов:\n\n${lines.join("\n")}`;
}

function formatTicketsRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Талоны не найдены.";
  const lines = rows.slice(0, 10).map((row) => {
    return `• ${safeText(row.ticket_no)} · ${mapTicketStatusLabel(row.status)} · ${safeText(
      row.operation
    )} · брутто ${formatKg(row.gross_kg)}, тара ${formatKg(row.tare_kg)}, нетто ${formatKg(row.net_kg)} · ${formatDateTime(row.date)}`;
  });
  return `Талоны весовой:\n\n${lines.join("\n")}`;
}

function formatOperationsRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Последние операции не найдены.";
  const lines = rows
    .slice(0, 10)
    .map((row) => `• ${formatDateTime(row.date)} · ${safeText(row.operation_type)} · поле ${safeText(row.field_name)}`);
  return `Последние операции:\n\n${lines.join("\n")}`;
}

function formatFuelRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Движения ГСМ не найдены.";
  const lines = rows.slice(0, 14).map((row) => {
    const sourceFrom = cleanString(row.from_fuel_source_name);
    const sourceTo = cleanString(row.to_fuel_source_name);
    const sourceSingle = cleanString(row.fuel_source_name);
    const sourceLabel = sourceFrom && sourceTo ? `${sourceFrom} → ${sourceTo}` : sourceSingle || "—";
    return `• ${formatDateTime(row.date)} · ${mapFuelMovementType(row.type)} · ${sourceLabel} · ${formatNumber(
      asNumber(row.liters),
      0
    )} л`;
  });
  return `Движения ГСМ:\n\n${lines.join("\n")}`;
}

function formatCompanyContextRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Контекст компании не определён.";
  const row = rows[0];
  return [
    "Контекст компании:",
    "",
    `• Компания: ${safeText(row.company_name)}`,
    `• Сезон: ${safeText(row.season)}`,
  ].join("\n");
}

function formatGroundedToolOutput(params: {
  toolName: AssistantToolName;
  intentName: AssistantIntentName;
  output: AssistantToolOutput;
}): string | null {
  const { toolName, intentName, output } = params;
  const rows = output.rows || [];

  if (intentName === "inventory_balance" || toolName === "get_warehouse_balances" || toolName === "get_inventory") {
    return formatInventoryRows(rows);
  }
  if (intentName === "warehouse_movements" || toolName === "get_warehouse_movements") {
    return formatWarehouseMovementsRows(rows);
  }
  if (intentName === "fields_overview" || toolName === "get_fields") {
    return formatFieldsRows(rows);
  }
  if (intentName === "crop_structure_overview" || toolName === "get_crop_structure") {
    return formatCropStructureRows(rows);
  }
  if (intentName === "weighbridge_tickets" || toolName === "get_weighbridge_tickets") {
    return formatTicketsRows(rows);
  }
  if (intentName === "operations_recent" || toolName === "get_operations") {
    return formatOperationsRows(rows);
  }
  if (intentName === "fuel_movements" || toolName === "get_fuel_movements" || toolName === "get_fuel_balances") {
    return formatFuelRows(rows);
  }
  if (intentName === "company_context" || toolName === "get_company_context" || toolName === "get_current_season") {
    return formatCompanyContextRows(rows);
  }
  if (toolName.startsWith("create_")) {
    const message = cleanString(rows[0]?.message);
    return (
      message ||
      "Черновик подготовлен. Проверьте обязательные поля и подтвердите выполнение вручную."
    );
  }

  return null;
}

function buildCapabilitiesAnswer(locale: "ru" | "en" | "kz"): string {
  if (locale === "en") {
    return [
      "I can help in Travkin Flow with:",
      "• Warehouse balances and identity-level stock.",
      "• Batch search and class split (commodity/seed/feed/waste).",
      "• Warehouse, ledger and fuel movement summaries.",
      "• Crop structure and field material usage context.",
      "• ERP navigation to the needed page/entity.",
      "• Action draft preparation with human confirmation.",
    ].join("\n");
  }

  if (locale === "kz") {
    return [
      "Travkin Flow бойынша көмектесе аламын:",
      "• Қойма қалдықтары мен identity бойынша бөлініс.",
      "• Партияларды және class бөлінісін көрсету.",
      "• Қойма/ledger/ГСМ қозғалыстарының қысқаша есебі.",
      "• Егіс құрылымы мен материал шығынын түсіндіру.",
      "• ERP ішінде керек бетке/объектіге өту.",
      "• Әрекет черновигін дайындау (міндетті растаумен).",
    ].join("\n");
  }

  return [
    "Я могу помочь в Travkin Flow с такими задачами:",
    "• Показать остатки по складам и identity-структуре.",
    "• Найти партии и разрез по классам (товарный/семенной/кормовой/отход).",
    "• Показать движения склада, ledger и ГСМ.",
    "• Объяснить структуру посевов и выдачу материалов по полям.",
    "• Открыть нужную страницу или объект в ERP.",
    "• Подготовить черновик действия с подтверждением человека.",
  ].join("\n");
}

function getToolNamesForIntent(intent: AssistantIntent, settings: AssistantPlatformSettings): AssistantToolName[] {
  const byIntent: Record<AssistantIntentName, AssistantToolName[]> = {
    inventory_balance: ["get_warehouse_balances"],
    warehouse_movements: ["get_warehouse_movements"],
    weighbridge_tickets: ["get_weighbridge_tickets"],
    fields_overview: ["get_fields"],
    crop_structure_overview: ["get_crop_structure"],
    operations_recent: ["get_operations"],
    fuel_movements: ["get_fuel_movements"],
    entity_resolution: [],
    company_context: ["get_company_context"],
    navigation_help: ["navigate_to_page"],
    create_draft: ["create_operation_draft"],
    clarification_required: [],
    general_question: [],
  };

  const action = cleanString(intent.parameters.action);
  const entityType = cleanString(intent.parameters.entityType);
  const queryText = cleanString(intent.parameters.query)?.toLowerCase() || "";
  const tools = [...(byIntent[intent.name] || [])];

  if (intent.name === "navigation_help" && action === "open_entity") {
    if (entityType === "warehouse") tools.unshift("resolve_warehouse_by_name");
    if (entityType === "field") tools.unshift("resolve_field_by_number");
    if (entityType === "fuel") tools.unshift("resolve_fuel_source_by_name");
    tools.push("open_entity");
  }

  if (intent.name === "navigation_help" && action === "apply_filter") {
    tools.push("apply_filter");
  }

  if (intent.name === "create_draft") {
    if (/(гсм|топлив|дизел|бензин|азс|fuel)/.test(queryText)) {
      tools[0] = "create_fuel_issue_draft";
    } else if (/(перемещ|transfer)/.test(queryText)) {
      tools[0] = "create_transfer_draft";
    } else if (/(талон|весов|ticket|weighbridge)/.test(queryText)) {
      tools[0] = "create_weighbridge_ticket_draft";
    } else if (/(поле|задач|task)/.test(queryText)) {
      tools[0] = "create_field_task_draft";
    }
  }

  return tools.filter((toolName) => (settings.allowedTools || []).includes(toolName));
}

function getNavigationActions(params: {
  intent: AssistantIntent;
  outputs: AssistantToolOutput[];
}): AssistantNavigationAction[] {
  const { intent, outputs } = params;
  if (intent.name !== "navigation_help") return [];

  const route = cleanString(intent.parameters.route) || "/dashboard";
  const page = cleanString(intent.parameters.page) || "dashboard";
  const action = cleanString(intent.parameters.action) || "open_page";
  const entityType = cleanString(intent.parameters.entityType);
  const entityQuery = cleanString(intent.parameters.entityQuery);
  const filters = parseFiltersJson(intent.parameters.filters);

  const resolverOutput = outputs.find((output) => output.source.tableOrView.startsWith("resolve_"));
  const resolverRow = resolverOutput?.rows?.[0] || null;
  const resolvedId = cleanString(resolverRow?.entity_id);
  const resolvedName = cleanString(resolverRow?.entity_name);
  const resolvedRoute = cleanString(resolverRow?.route);
  const resolvedPage = cleanString(resolverRow?.page);
  const resolvedFilters =
    resolverRow?.filters && typeof resolverRow.filters === "object"
      ? (resolverRow.filters as Record<string, string>)
      : null;

  if (action === "open_entity" && entityType && ["warehouse", "field", "fuel"].includes(entityType)) {
    return [
      {
        type: "open_entity",
        page: resolvedPage || page,
        route: resolvedRoute || route,
        entityType: entityType as "warehouse" | "field" | "fuel",
        entityId: resolvedId,
        entityQuery: resolvedName || entityQuery,
        filters: resolvedFilters || filters || (entityQuery ? { search: entityQuery } : {}),
      },
    ];
  }

  if (action === "apply_filter" && filters) {
    return [{ type: "apply_filter", page, route, filters }];
  }

  if (filters && Object.keys(filters).length) {
    return [{ type: "open_page_with_filter", page, route, filters }];
  }

  return [{ type: "open_page", page, route }];
}

function buildNavigationAnswer(actions: AssistantNavigationAction[]): string {
  if (!actions.length) {
    return "Не удалось определить страницу для перехода. Уточните команду.";
  }

  const first = actions[0];
  if (first.type === "open_entity") {
    const noun =
      first.entityType === "warehouse"
        ? "склад"
        : first.entityType === "field"
          ? "поле"
          : "источник ГСМ";
    const label = first.entityQuery || first.entityId || noun;
    return `Открываю ${label}.`;
  }

  if (first.type === "open_page_with_filter" || first.type === "apply_filter") {
    return `Открываю страницу ${first.page} и применяю фильтр.`;
  }

  return `Открываю страницу ${first.page}.`;
}

async function generateGeneralAnswer(params: {
  message: string;
  locale: "ru" | "en" | "kz";
  settings: AssistantPlatformSettings;
}): Promise<{ answer: string; actualModel: string | null; usage: UsageStats }> {
  const { message, locale, settings } = params;
  const modelConfig = resolveAssistantModelConfig(settings);
  const emptyUsage: UsageStats = { promptTokens: null, completionTokens: null, totalTokens: null };

  if (!process.env.OPENAI_API_KEY) {
    if (locale === "en") {
      return {
        answer: "Assistant is ready for ERP navigation and tool-grounded answers.",
        actualModel: null,
        usage: emptyUsage,
      };
    }
    if (locale === "kz") {
      return {
        answer: "Assistant ERP навигациясы және tool-grounded жауаптар үшін дайын.",
        actualModel: null,
        usage: emptyUsage,
      };
    }
    return {
      answer: "Ассистент готов для навигации по ERP и ответов через backend-инструменты.",
      actualModel: null,
      usage: emptyUsage,
    };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: modelConfig.actualModel,
      temperature: modelConfig.temperature,
      messages: [
        {
          role: "system",
          content: [
            "You are a concise ERP assistant.",
            "Do not fabricate company facts.",
            "If data is needed, ask the user to clarify so backend tools can be used.",
            `Reply locale: ${locale}.`,
          ].join("\n"),
        },
        { role: "user", content: message },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  const usage: UsageStats = {
    promptTokens: Number.isFinite(Number(data?.usage?.prompt_tokens)) ? Number(data.usage.prompt_tokens) : null,
    completionTokens: Number.isFinite(Number(data?.usage?.completion_tokens))
      ? Number(data.usage.completion_tokens)
      : null,
    totalTokens: Number.isFinite(Number(data?.usage?.total_tokens)) ? Number(data.usage.total_tokens) : null,
  };

  if (!response.ok) {
    if (locale === "en") return { answer: "I can help with ERP navigation and tool-based answers.", actualModel: modelConfig.actualModel, usage };
    if (locale === "kz") return { answer: "ERP навигациясы және tool-based жауаптар бойынша көмектесемін.", actualModel: modelConfig.actualModel, usage };
    return { answer: "Могу помочь с навигацией по ERP и запросами через инструменты.", actualModel: modelConfig.actualModel, usage };
  }

  const content = cleanString(data?.choices?.[0]?.message?.content);
  if (content) {
    return {
      answer: content,
      actualModel: modelConfig.actualModel,
      usage,
    };
  }

  if (locale === "en") return { answer: "I can help with ERP navigation and tool-based answers.", actualModel: modelConfig.actualModel, usage };
  if (locale === "kz") return { answer: "ERP навигациясы және tool-based жауаптар бойынша көмектесемін.", actualModel: modelConfig.actualModel, usage };
  return { answer: "Могу помочь с навигацией по ERP и запросами через инструменты.", actualModel: modelConfig.actualModel, usage };
}

export async function runAssistantEngine(params: {
  supabase: SupabaseClient;
  actor: ServerActorContext;
  companyId: string;
  settings: AssistantPlatformSettings;
  input: AssistantEngineInput;
}): Promise<AssistantEngineResult> {
  const { supabase, actor, companyId, settings, input } = params;
  const message = String(input.message || "").trim();
  const runtimeContext = normalizeAssistantUiContext(input.runtimeContext);
  const normalizedState = normalizeSessionState(input.sessionState);
  const initialSessionState: AssistantSessionState = {
    ...EMPTY_ASSISTANT_SESSION_STATE,
    ...normalizedState,
  };

  const modelConfig = resolveAssistantModelConfig(settings);
  const emptyPerformance: UsageStats = { promptTokens: null, completionTokens: null, totalTokens: null };

  if (!settings.enabled) {
    return {
      answer: "Ассистент отключён в глобальных настройках.",
      sessionState: initialSessionState,
      intent: { name: "general_question", confidence: 1, needsData: false, parameters: {} },
      toolCalls: [],
      navigationActions: [],
      sourceHints: [],
      answerSource: "disabled",
      grounded: false,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        requestMode: "tool_first",
      },
      performance: emptyPerformance,
    };
  }

  if (!isRoleAllowed(settings, actor.role)) {
    return {
      answer: "Для вашей роли ассистент недоступен.",
      sessionState: initialSessionState,
      intent: { name: "general_question", confidence: 1, needsData: false, parameters: {} },
      toolCalls: [],
      navigationActions: [],
      sourceHints: [],
      answerSource: "access_denied",
      grounded: false,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        requestMode: "tool_first",
      },
      performance: emptyPerformance,
    };
  }

  const intent = await classifyAssistantIntent({
    message,
    runtimeContext,
    sessionState: initialSessionState,
    settings,
  });

  if (intent.name === "clarification_required") {
    return {
      answer: "Уточните, пожалуйста: открыть страницу, показать данные или подготовить действие?",
      sessionState: { ...initialSessionState, lastIntent: intent.name },
      intent,
      toolCalls: [],
      navigationActions: [],
      sourceHints: [],
      answerSource: "no_data",
      grounded: false,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        requestMode: "tool_first",
      },
      performance: emptyPerformance,
    };
  }

  if (isCapabilitiesQuestion(message)) {
    return {
      answer: buildCapabilitiesAnswer(runtimeContext.locale || "ru"),
      sessionState: { ...initialSessionState, lastIntent: intent.name },
      intent,
      toolCalls: [],
      navigationActions: [],
      sourceHints: [],
      answerSource: "llm_fallback",
      grounded: false,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        requestMode: "tool_first",
      },
      performance: emptyPerformance,
    };
  }

  const toolNames = getToolNamesForIntent(intent, settings).slice(
    0,
    settings.limits.maxToolCallsPerQuery || 6
  );
  const toolCalls: AssistantToolCallLog[] = [];
  const outputs: AssistantToolOutput[] = [];
  const answerBlocks: string[] = [];
  const sourceHints: string[] = [];
  let nextSessionState = initialSessionState;

  if (toolNames.length) {
    for (const toolName of toolNames) {
      const tool = getAssistantTool(toolName);
      if (!tool) {
        toolCalls.push({
          tool: toolName,
          params: intent.parameters || {},
          ok: false,
          error: "Tool not found",
        });
        continue;
      }

      try {
        const output = await tool.run({
          supabase,
          actor,
          companyId,
          settings,
          runtimeContext,
          sessionState: nextSessionState,
          intent,
        });

        outputs.push(output);
        const formatted = formatGroundedToolOutput({
          toolName: tool.name,
          intentName: intent.name,
          output,
        });
        if (formatted) answerBlocks.push(formatted);

        sourceHints.push(
          `${output.source.module} • ${output.source.tableOrView} • ${output.source.season || "-"} • ${output.source.fetchedAt}`
        );
        nextSessionState = updateSessionStateFromToolOutput({
          previous: nextSessionState,
          intent,
          output,
          seasonFromContext: runtimeContext.season,
        });

        toolCalls.push({
          tool: tool.name,
          params: intent.parameters || {},
          ok: true,
          rows: output.rows.length,
        });
      } catch (error) {
        toolCalls.push({
          tool: tool.name,
          params: intent.parameters || {},
          ok: false,
          error: error instanceof Error ? error.message : "Tool execution failed",
        });
      }
    }
  }

  const navigationActions = getNavigationActions({ intent, outputs });
  if (intent.name === "navigation_help") {
    answerBlocks.unshift(buildNavigationAnswer(navigationActions));
  }

  const hasToolsAnswer = answerBlocks.length > 0;
  if (hasToolsAnswer) {
    return {
      answer: answerBlocks.join("\n\n"),
      sessionState: { ...nextSessionState, lastIntent: intent.name },
      intent,
      toolCalls,
      navigationActions,
      sourceHints: uniqueStrings(sourceHints),
      answerSource: "tools",
      grounded: true,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        requestMode: "tool_first",
      },
      performance: emptyPerformance,
    };
  }

  if (looksLikeErpDataQuestion(message) && settings.groundingRules.blockUngroundedDataAnswers) {
    return {
      answer:
        "Похоже на запрос ERP-данных. Уточните объект (склад, поле, период), и я отвечу по фактическим данным через backend tools.",
      sessionState: { ...nextSessionState, lastIntent: intent.name },
      intent,
      toolCalls,
      navigationActions,
      sourceHints: uniqueStrings(sourceHints),
      answerSource: "policy_block",
      grounded: false,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        requestMode: "tool_first",
      },
      performance: emptyPerformance,
    };
  }

  const locale = runtimeContext.locale || "ru";
  const fallback = await generateGeneralAnswer({ message, locale, settings });
  return {
    answer: fallback.answer,
    sessionState: { ...nextSessionState, lastIntent: intent.name },
    intent,
    toolCalls,
    navigationActions,
    sourceHints: uniqueStrings(sourceHints),
    answerSource: "llm_fallback",
    grounded: false,
    model: {
      configuredModel: modelConfig.configuredModel,
      actualModel: fallback.actualModel,
      settingsSource: modelConfig.settingsSource,
      requestMode: "tool_first",
    },
    performance: fallback.usage,
  };
}
