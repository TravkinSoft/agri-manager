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
  AssistantOutputType,
  AssistantSessionState,
  AssistantToolCallLog,
  AssistantToolName,
  AssistantToolOutput,
} from "@/lib/assistant/engine/types";
import { resolveAssistantModelConfig } from "@/lib/assistant/openai";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import type { ServerActorContext } from "@/lib/auth/server-session";
import { isAgroKnowledgeQuestion, resolveAssistantMode } from "@/lib/assistant/agro-taxonomy";
import {
  resolveTravkinCorePrompt,
  TRAVKIN_CORE_PROMPT_UPDATED_AT,
  TRAVKIN_CORE_PROMPT_VERSION,
  type TravkinPromptSource,
} from "@/lib/assistant/prompts/travkin-core-prompt";
import {
  applySemanticExpansions,
  buildSemanticMemoryContext,
} from "@/lib/assistant/knowledge/semantic-memory";

type UsageStats = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type PromptMeta = {
  promptVersion: string;
  promptSource: TravkinPromptSource;
  promptUpdatedAt: string;
};

type LlmDiagnostics = {
  status: "not_called" | "ok" | "missing_api_key" | "network_error" | "http_error" | "invalid_response";
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  missingEnv: string[];
};

function llmNotCalled(): LlmDiagnostics {
  return {
    status: "not_called",
    httpStatus: null,
    errorCode: null,
    errorMessage: null,
    missingEnv: [],
  };
}

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

function resolveOutputType(intent: AssistantIntent): AssistantOutputType {
  const raw = cleanString(intent.parameters.output_type);
  if (
    raw === "summary_total" ||
    raw === "filtered_summary" ||
    raw === "list" ||
    raw === "action_navigation" ||
    raw === "balance" ||
    raw === "movements"
  ) {
    return raw;
  }

  const fallbackByIntent: Record<AssistantIntentName, AssistantOutputType> = {
    inventory_balance: "balance",
    warehouse_movements: "movements",
    weighbridge_tickets: "filtered_summary",
    fields_overview: "list",
    crop_structure_overview: "summary_total",
    operations_recent: "list",
    fuel_balance: "balance",
    fuel_movements: "movements",
    entity_resolution: "filtered_summary",
    company_context: "summary_total",
    navigation_help: "action_navigation",
    create_draft: "filtered_summary",
    clarification_required: "filtered_summary",
    general_question: "filtered_summary",
  };

  return fallbackByIntent[intent.name] || "filtered_summary";
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
  if (!rows.length) return "По всем складам по текущему фильтру остатки не найдены.";

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

function formatFieldsSummaryRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Поля по компании не найдены.";

  const totalArea = rows.reduce((acc, row) => acc + asNumber(row.area_ha), 0);
  const fieldsCount = rows.length;
  const filledAreaCount = rows.reduce((acc, row) => acc + (asNumber(row.area_ha) > 0 ? 1 : 0), 0);
  const withoutAreaCount = Math.max(0, fieldsCount - filledAreaCount);

  return [
    `Всего земли в хозяйстве: ${formatNumber(totalArea, 2)} га`,
    `Полей: ${formatNumber(fieldsCount, 0)}`,
    `Заполнено по площади: ${formatNumber(filledAreaCount, 0)}, без площади: ${formatNumber(withoutAreaCount, 0)}`,
  ].join("\n");
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

function formatCropStructureSummaryRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "Структура посевов по текущему сезону не найдена.";
  const totalArea = rows.reduce((acc, row) => acc + asNumber(row.area_ha), 0);
  const lines = rows.slice(0, 12).map((row) => {
    const fieldsCount = Number.isFinite(Number(row.fields_count)) ? Number(row.fields_count) : 0;
    const fieldsLabel = fieldsCount > 0 ? ` (${fieldsCount} полей)` : "";
    return `• ${safeText(row.crop_name)} — ${formatNumber(asNumber(row.area_ha), 2)} га${fieldsLabel}`;
  });
  return `Всего посевных площадей: ${formatNumber(totalArea, 2)} га\n\n${lines.join("\n")}`;
}

function formatCropStructureSummaryRowsV2(
  rows: Array<Record<string, unknown>>,
  outputType: AssistantOutputType
): string {
  if (!rows.length) return "По сезону 2026 данных не найдено.";
  const totalArea = rows.reduce((acc, row) => acc + asNumber(row.area_ha), 0);
  const cropsCount = rows.length;
  const fieldsTotal = rows.reduce((acc, row) => acc + asNumber(row.fields_count), 0);
  const topRowsLimit = outputType === "summary_total" ? 5 : 10;
  const topRows = rows.slice(0, topRowsLimit).map((row) => {
    const fieldsCount = Number.isFinite(Number(row.fields_count)) ? Number(row.fields_count) : 0;
    const fieldsLabel = fieldsCount > 0 ? ` (${fieldsCount} полей)` : "";
    return `• ${safeText(row.crop_name)} — ${formatNumber(asNumber(row.area_ha), 2)} га${fieldsLabel}`;
  });

  const header = [
    `Всего посевных площадей: ${formatNumber(totalArea, 2)} га`,
    `Культур: ${cropsCount}`,
    fieldsTotal > 0 ? `Полей в разрезе структуры: ${fieldsTotal}` : "Заполнено/не заполнено: нет данных",
  ];

  if (outputType === "summary_total") {
    return [...header, "", ...topRows].join("\n");
  }
  return [...header, "", ...topRows].join("\n");
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

function formatFuelBalanceRows(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "По всем источникам ГСМ остатки не найдены.";
  const totalLiters = rows.reduce((sum, row) => sum + asNumber(row.balance_liters), 0);
  const lines = rows
    .slice(0, 10)
    .map((row) => `• ${safeText(row.fuel_source_name)} — ${formatNumber(asNumber(row.balance_liters), 0)} л`);
  return [`В наличии топлива: ${formatNumber(totalLiters, 0)} л`, "", ...lines].join("\n");
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
  outputType: AssistantOutputType;
  intentParams: AssistantIntent["parameters"];
  output: AssistantToolOutput;
}): string | null {
  const { toolName, intentName, output, outputType, intentParams } = params;
  const rows = output.rows || [];
  const sourceSeason = cleanString(output.source.season);

  if (intentName === "inventory_balance" || toolName === "get_warehouse_balances" || toolName === "get_inventory") {
    return formatInventoryRows(rows);
  }
  if (intentName === "warehouse_movements" || toolName === "get_warehouse_movements") {
    return formatWarehouseMovementsRows(rows);
  }
  if (intentName === "fields_overview" || toolName === "get_fields") {
    return outputType === "summary_total" ? formatFieldsSummaryRows(rows) : formatFieldsRows(rows);
  }
  if (toolName === "get_crop_structure_summary") {
    if (!rows.length) {
      const queryText = cleanString(intentParams.query)?.toLowerCase() || "";
      const cropText = `${cleanString(intentParams.crop) || ""} ${cleanString(intentParams.crop_alias) || ""}`.toLowerCase();
      const potatoRequested = /картоф|potato|гала|gala|сорая|soraya|балтик|baltic|азилит|azilit/.test(
        `${cropText} ${queryText}`
      );
      if (potatoRequested) {
        return `В структуре ${sourceSeason || "2026"} картофель не найден.`;
      }
      return `По сезону ${sourceSeason || "2026"} данных не найдено.`;
    }
    return formatCropStructureSummaryRowsV2(rows, outputType);
  }
  if (intentName === "crop_structure_overview" || toolName === "get_crop_structure") {
    if (outputType !== "list") return null;
    if (!rows.length) {
      return `По сезону ${sourceSeason || "2026"} данных не найдено.`;
    }
    return formatCropStructureRows(rows);
  }
  if (intentName === "weighbridge_tickets" || toolName === "get_weighbridge_tickets") {
    return formatTicketsRows(rows);
  }
  if (intentName === "operations_recent" || toolName === "get_operations") {
    return formatOperationsRows(rows);
  }
  if (intentName === "fuel_balance" || toolName === "get_fuel_balances") {
    return formatFuelBalanceRows(rows);
  }
  if (intentName === "fuel_movements" || toolName === "get_fuel_movements") {
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

function mapToolNamespace(tool: AssistantToolName): string {
  const map: Record<string, string> = {
    get_current_context: "context.getPageContext",
    get_routes: "navigation.getRoutes",
    get_company_context: "context.getCompanyContext",
    get_current_season: "context.getCurrentSeason",
    find_field: "field.search",
    search_fields: "field.search",
    get_field_card: "field.summary",
    get_field_timeline: "field.history",
    get_field_materials: "field.materials",
    find_warehouse: "inventory.resolveWarehouse",
    search_warehouses: "inventory.searchWarehouses",
    get_warehouse_summary: "inventory.summary",
    get_warehouse_stock: "inventory.balance",
    get_warehouse_balances: "inventory.balance",
    get_warehouse_movements: "inventory.movements",
    find_operation: "operation.search",
    search_operations: "operation.search",
    get_operation_details: "operation.details",
    get_active_operations: "operation.active",
    get_operations: "operation.search",
    get_weighbridge_tickets: "weighbridge.tickets",
    get_active_tickets: "weighbridge.tickets",
    get_recent_tickets: "weighbridge.tickets",
    get_ticket_details: "weighbridge.ticketDetails",
    get_potato_material_report: "report.potato",
    get_crop_structure_summary: "crop.structure",
    get_crop_structure: "crop.structureRows",
    search_crops_by_group: "crop.group",
    get_fuel_balances: "fuel.balance",
    get_fuel_movements: "fuel.movements",
    navigate_to_page: "navigation.navigateToRoute",
    open_entity: "navigation.openEntity",
    apply_filter: "navigation.applyFilter",
  };
  return map[tool] || tool;
}

function buildToolActivityLogs(toolCalls: AssistantToolCallLog[]): string[] {
  return toolCalls.map((toolCall) => {
    const name = mapToolNamespace(toolCall.tool);
    if (toolCall.ok) {
      const rows = Number.isFinite(Number(toolCall.rows)) ? Number(toolCall.rows) : 0;
      return `${name}: ${rows} rows`;
    }
    return `${name}: error (${toolCall.error || "unknown error"})`;
  });
}

function buildSmartFollowUp(intent: AssistantIntent, locale: "ru" | "en" | "kz"): string {
  const ru = locale !== "en" && locale !== "kz";
  if (intent.name === "clarification_required") {
    const focus = cleanString(intent.parameters.focus)?.toLowerCase() || "";
    if (focus.includes("склад")) return ru ? "По какому складу показать данные?" : "Which warehouse should I open?";
    if (focus.includes("пол")) return ru ? "По какому полю нужен срез?" : "Which field do you want to inspect?";
    if (focus.includes("операц")) return ru ? "Нужны активные операции или история?" : "Do you need active operations or history?";
    if (focus.includes("весов") || focus.includes("талон")) return ru ? "Показать активные талоны или последние?" : "Show active tickets or recent ones?";
    if (focus.includes("отчет") || focus.includes("отч")) return ru ? "За какой период и по какой культуре?" : "Which period and crop?";
    if (focus.includes("картоф")) return ru ? "Все поля картофеля или конкретное поле?" : "All potato fields or one field?";
    return ru ? "Уточните объект: поле, склад, операция или период?" : "Specify object: field, warehouse, operation, or period.";
  }
  return "";
}

function getToolNamesForIntent(intent: AssistantIntent, settings: AssistantPlatformSettings): AssistantToolName[] {
  const byIntent: Record<AssistantIntentName, AssistantToolName[]> = {
    inventory_balance: ["get_warehouse_stock", "get_warehouse_summary", "get_warehouse_balances"],
    warehouse_movements: ["get_warehouse_movements"],
    weighbridge_tickets: ["get_active_tickets", "get_recent_tickets", "get_weighbridge_tickets", "get_ticket_details"],
    fields_overview: ["search_fields", "get_field_card", "get_field_timeline", "get_field_materials", "get_fields", "find_field"],
    crop_structure_overview: ["get_crop_structure_summary"],
    operations_recent: ["get_active_operations", "search_operations", "get_operations", "get_operation_details"],
    fuel_balance: ["get_fuel_balances"],
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
  const cropGroup = cleanString(intent.parameters.crop_group);
  const cropAlias = cleanString(intent.parameters.crop_alias) || cleanString(intent.parameters.crop);
  const status = cleanString(intent.parameters.status);
  const intentGroup = cleanString(intent.parameters.intent_group)?.toLowerCase() || "";
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

  if (intent.name === "fields_overview" && queryText) {
    tools.unshift("search_fields");
    tools.push("get_field_timeline", "get_field_materials");
  }

  if (intent.name === "weighbridge_tickets" && queryText) {
    tools.unshift("get_ticket_details");
  }

  if (intent.name === "operations_recent" && queryText) {
    tools.unshift("search_operations", "get_operation_details");
  }

  if (intent.name === "operations_recent" && status === "active") {
    tools.unshift("get_active_operations");
  }

  if (intent.name === "operations_recent" && (intentGroup === "materials" || intentGroup === "potato" || /картоф|гала|сорая|диамм|удобр|сзр|семян/.test(queryText))) {
    tools.unshift("get_potato_material_report");
  }

  if (intent.name === "crop_structure_overview" && (cropGroup || cropAlias)) {
    tools.unshift("search_crops_by_group");
  }

  if (intent.name === "crop_structure_overview" && /картоф|гала|сорая|балтик|азилит|коломбо|импала/.test(queryText)) {
    tools.unshift("get_potato_material_report");
  }

  if (intent.name === "inventory_balance" && /отрицатель|negative/.test(queryText)) {
    tools.unshift("get_warehouse_balances");
  }

  if (intent.name === "inventory_balance" && /движен|журнал|пришло|ушло/.test(queryText)) {
    tools.unshift("get_warehouse_movements");
  }

  if (intent.name === "crop_structure_overview" && resolveOutputType(intent) === "list") {
    tools.push("get_crop_structure");
  }

  const allowedTools = new Set(settings.allowedTools || []);
  const normalizeCandidates = (settings.allowedTools || []).map((value) => String(value || "").trim());
  const allowByNamespaceFallback = (toolName: AssistantToolName) => {
    if (allowedTools.has(toolName)) return true;
    const namespaceName = mapToolNamespace(toolName);
    return normalizeCandidates.includes(namespaceName);
  };
  const filtered = Array.from(new Set(tools)).filter((toolName) => allowByNamespaceFallback(toolName));
  if (filtered.length > 0) return filtered;

  const staleSettingsFallback: Record<AssistantIntentName, AssistantToolName[]> = {
    inventory_balance: ["get_warehouse_stock", "get_warehouse_balances"],
    warehouse_movements: ["get_warehouse_movements"],
    weighbridge_tickets: ["get_active_tickets", "get_recent_tickets", "get_weighbridge_tickets"],
    fields_overview: ["search_fields", "get_field_card", "get_field_timeline", "get_field_materials"],
    crop_structure_overview: ["get_crop_structure_summary", "search_crops_by_group"],
    operations_recent: ["get_active_operations", "search_operations", "get_operations"],
    fuel_balance: ["get_fuel_balances"],
    fuel_movements: ["get_fuel_movements"],
    entity_resolution: [],
    company_context: ["get_company_context"],
    navigation_help: ["navigate_to_page"],
    create_draft: ["create_operation_draft"],
    clarification_required: [],
    general_question: [],
  };

  if (!filtered.length) {
    return (staleSettingsFallback[intent.name] || [])
      .filter((toolName) => Boolean(getAssistantTool(toolName))) as AssistantToolName[];
  }

  return filtered;
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
    if (!resolvedId && !resolvedRoute) return [];
    if (entityType === "field" && !resolvedId) return [];
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

function buildNavigationAnswerV2(actions: AssistantNavigationAction[]): string {
  if (!actions.length) {
    return "Не смог открыть: route не найден.";
  }
  const first = actions[0];
  if (first.type === "open_entity") {
    const label = first.entityQuery || first.entityId || first.page;
    return `Подготовил переход к объекту: ${label}.`;
  }
  if (first.type === "open_page_with_filter" || first.type === "apply_filter") {
    return `Подготовил переход на страницу ${first.page} с фильтром.`;
  }
  return `Подготовил переход на страницу ${first.page}.`;
}

function unavailableAssistantMessage(locale: "ru" | "en" | "kz"): string {
  if (locale === "en") return "AI Assistant is temporarily unavailable. Please try again later.";
  if (locale === "kz") return "AI Assistant уақытша қолжетімсіз. Кейінірек қайталап көріңіз.";
  return "AI Assistant временно недоступен. Попробуйте позже.";
}

async function generateGeneralAnswer(params: {
  message: string;
  locale: "ru" | "en" | "kz";
  settings: AssistantPlatformSettings;
  intentName: AssistantIntentName;
  systemPrompt: string;
  promptMeta: PromptMeta;
}): Promise<{ answer: string; actualModel: string | null; usage: UsageStats; llm: LlmDiagnostics; promptMeta: PromptMeta }> {
  const { message, locale, settings, intentName, systemPrompt, promptMeta } = params;
  const modelConfig = resolveAssistantModelConfig(settings, { intentName, message });
  const emptyUsage: UsageStats = { promptTokens: null, completionTokens: null, totalTokens: null };

  if (!process.env.OPENAI_API_KEY) {
    return {
      answer: unavailableAssistantMessage(locale),
      actualModel: null,
      usage: emptyUsage,
      llm: {
        status: "missing_api_key",
        httpStatus: null,
        errorCode: "OPENAI_API_KEY_MISSING",
        errorMessage: "OPENAI_API_KEY is not configured",
        missingEnv: ["OPENAI_API_KEY"],
      },
      promptMeta,
    };
  }

  const candidateModels = Array.from(
    new Set(
      [
        cleanString(modelConfig.actualModel),
        cleanString(process.env.OPENAI_ASSISTANT_FALLBACK_MODEL),
        cleanString(process.env.OPENAI_ASSISTANT_MODEL),
        "gpt-4o-mini",
      ].filter((model): model is string => Boolean(model))
    )
  );

  let response: Response | null = null;
  let data: any = {};
  let usedModel = modelConfig.actualModel;

  for (const candidateModel of candidateModels) {
    const candidateResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: candidateModel,
        temperature: modelConfig.temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
      }),
    }).catch(() => null);

    if (!candidateResponse) continue;

    const candidateData = await candidateResponse.json().catch(() => ({}));
    response = candidateResponse;
    data = candidateData;
    usedModel = candidateModel;

    if (candidateResponse.ok) break;

    const errCode = cleanString(candidateData?.error?.code);
    const errType = cleanString(candidateData?.error?.type);
    const errMessage = cleanString(candidateData?.error?.message)?.toLowerCase() || "";
    const modelUnavailable =
      errCode === "model_not_found" ||
      errType === "invalid_request_error" ||
      errMessage.includes("does not exist") ||
      errMessage.includes("not found") ||
      errMessage.includes("not available") ||
      errMessage.includes("access") ||
      errMessage.includes("model");

    if (!modelUnavailable) break;
  }

  if (!response) {
    return {
      answer: unavailableAssistantMessage(locale),
      actualModel: usedModel,
      usage: emptyUsage,
      llm: {
        status: "network_error",
        httpStatus: null,
        errorCode: "OPENAI_NETWORK_ERROR",
        errorMessage: "Network request to OpenAI failed",
        missingEnv: [],
      },
      promptMeta,
    };
  }

  const usage: UsageStats = {
    promptTokens: Number.isFinite(Number(data?.usage?.prompt_tokens)) ? Number(data.usage.prompt_tokens) : null,
    completionTokens: Number.isFinite(Number(data?.usage?.completion_tokens))
      ? Number(data.usage.completion_tokens)
      : null,
    totalTokens: Number.isFinite(Number(data?.usage?.total_tokens)) ? Number(data.usage.total_tokens) : null,
  };

  if (!response.ok) {
    const errCode = cleanString(data?.error?.code);
    const errMessage = cleanString(data?.error?.message) || cleanString(data?.error?.type);
    return {
      answer: unavailableAssistantMessage(locale),
      actualModel: usedModel,
      usage,
      llm: {
        status: "http_error",
        httpStatus: response.status,
        errorCode: errCode,
        errorMessage: errMessage,
        missingEnv: [],
      },
      promptMeta,
    };
  }

  const content = cleanString(data?.choices?.[0]?.message?.content);
  if (content) {
    return {
      answer: content,
      actualModel: usedModel,
      usage,
      llm: {
        status: "ok",
        httpStatus: response.status,
        errorCode: null,
        errorMessage: null,
        missingEnv: [],
      },
      promptMeta,
    };
  }

  return {
    answer: unavailableAssistantMessage(locale),
    actualModel: usedModel,
    usage,
    llm: {
      status: "invalid_response",
      httpStatus: response.status,
      errorCode: "OPENAI_EMPTY_RESPONSE",
      errorMessage: "OpenAI response did not contain assistant message content",
      missingEnv: [],
    },
    promptMeta,
  };
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
  const messageForRouting = applySemanticExpansions(message);
  const assistantMode = resolveAssistantMode(messageForRouting);
  const runtimeContext = normalizeAssistantUiContext(input.runtimeContext);
  const promptBundle = resolveTravkinCorePrompt({
    settings,
    runtimeContext,
    actorRole: actor.role,
    locale: runtimeContext.locale || "ru",
  });
  const promptMeta: PromptMeta = {
    promptVersion: promptBundle.version || TRAVKIN_CORE_PROMPT_VERSION,
    promptSource: promptBundle.source,
    promptUpdatedAt: promptBundle.updatedAt || TRAVKIN_CORE_PROMPT_UPDATED_AT,
  };
  const normalizedState = normalizeSessionState(input.sessionState);
  const initialSessionState: AssistantSessionState = {
    ...EMPTY_ASSISTANT_SESSION_STATE,
    ...normalizedState,
  };

  const modelConfig = resolveAssistantModelConfig(settings);
  const emptyPerformance: UsageStats = { promptTokens: null, completionTokens: null, totalTokens: null };
  const modelLlmNotCalled = llmNotCalled();

  if (!settings.enabled) {
    return {
      answer: "Ассистент отключён в глобальных настройках.",
      sessionState: initialSessionState,
      intent: { name: "general_question", confidence: 1, needsData: false, parameters: {} },
      outputType: "filtered_summary",
      mode: assistantMode,
      toolCalls: [],
      toolActivity: [],
      navigationActions: [],
      sourceHints: [],
      answerSource: "disabled",
      grounded: false,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: "tool_first",
        llm: modelLlmNotCalled,
      },
      performance: emptyPerformance,
    };
  }

  if (!isRoleAllowed(settings, actor.role)) {
    return {
      answer: "Для вашей роли ассистент недоступен.",
      sessionState: initialSessionState,
      intent: { name: "general_question", confidence: 1, needsData: false, parameters: {} },
      outputType: "filtered_summary",
      mode: assistantMode,
      toolCalls: [],
      toolActivity: [],
      navigationActions: [],
      sourceHints: [],
      answerSource: "access_denied",
      grounded: false,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: "tool_first",
        llm: modelLlmNotCalled,
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
  const resolvedMode: AssistantEngineResult["mode"] =
    intent.name === "navigation_help" ? "navigation" : assistantMode;
  const resolvedOutputType = resolveOutputType(intent);

  if (intent.name === "clarification_required") {
    const smartFollowup = buildSmartFollowUp(intent, runtimeContext.locale || "ru");
    return {
      answer: smartFollowup || "Уточните объект запроса.",
      sessionState: { ...initialSessionState, lastIntent: intent.name },
      intent,
      outputType: resolvedOutputType,
      mode: resolvedMode,
      toolCalls: [],
      toolActivity: [],
      navigationActions: [],
      sourceHints: [],
      answerSource: "no_data",
      grounded: false,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: "tool_first",
        llm: modelLlmNotCalled,
      },
      performance: emptyPerformance,
    };
  }

  if (isCapabilitiesQuestion(messageForRouting)) {
    return {
      answer: buildCapabilitiesAnswer(runtimeContext.locale || "ru"),
      sessionState: { ...initialSessionState, lastIntent: intent.name },
      intent,
      outputType: resolvedOutputType,
      mode: resolvedMode,
      toolCalls: [],
      toolActivity: [],
      navigationActions: [],
      sourceHints: [],
      answerSource: "llm_fallback",
      grounded: false,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: "tool_first",
        llm: modelLlmNotCalled,
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
          outputType: resolvedOutputType,
          intentParams: intent.parameters,
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
    answerBlocks.unshift(buildNavigationAnswerV2(navigationActions));
  }

  const toolActivity = buildToolActivityLogs(toolCalls);
  const hasToolsAnswer = answerBlocks.length > 0;
  if (hasToolsAnswer) {
    return {
      answer: answerBlocks.join("\n\n"),
      sessionState: { ...nextSessionState, lastIntent: intent.name },
      intent,
      outputType: resolvedOutputType,
      mode: resolvedMode,
      toolCalls,
      toolActivity,
      navigationActions,
      sourceHints: uniqueStrings(sourceHints),
      answerSource: "tools",
      grounded: true,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: "tool_first",
        llm: modelLlmNotCalled,
      },
      performance: emptyPerformance,
    };
  }

  const firstToolError = toolCalls.find((call) => !call.ok);
  if (firstToolError) {
    const fallbackByIntent: Partial<Record<AssistantIntentName, string>> = {
      inventory_balance: "Не смог получить остатки со складов. Ошибка в инструменте.",
      warehouse_movements: "Не смог получить движения склада. Ошибка в инструменте.",
      weighbridge_tickets: "Не смог получить данные весовой. Ошибка в инструменте.",
      fields_overview: "Не смог получить данные по полям. Ошибка в инструменте.",
      crop_structure_overview: "Не смог получить структуру посевов. Ошибка в инструменте.",
      operations_recent: "Не смог получить операции. Ошибка в инструменте.",
      fuel_movements: "Не смог получить данные по ГСМ. Ошибка в инструменте.",
      entity_resolution: "Не смог найти объект. Ошибка в инструменте.",
      company_context: "Не смог получить контекст компании. Ошибка в инструменте.",
      navigation_help: "Не смог выполнить навигацию. Ошибка в инструменте.",
      create_draft: "Не смог подготовить черновик. Ошибка в инструменте.",
      clarification_required: "Не смог обработать запрос. Ошибка в инструменте.",
      general_question: "Не смог обработать запрос. Ошибка в инструменте.",
    };
    return {
      answer: fallbackByIntent[intent.name] || "Не смог получить данные. Ошибка в инструменте.",
      sessionState: { ...nextSessionState, lastIntent: intent.name },
      intent,
      outputType: resolvedOutputType,
      mode: resolvedMode,
      toolCalls,
      toolActivity,
      navigationActions,
      sourceHints: uniqueStrings(sourceHints),
      answerSource: "tool_error",
      grounded: false,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: "tool_first",
        llm: modelLlmNotCalled,
      },
      performance: emptyPerformance,
    };
  }

  if (looksLikeErpDataQuestion(messageForRouting) && settings.groundingRules.blockUngroundedDataAnswers) {
    const followup = buildSmartFollowUp(
      { ...intent, name: "clarification_required", parameters: { ...intent.parameters, focus: cleanString(intent.parameters.query) || "данные" } },
      runtimeContext.locale || "ru"
    );
    return {
      answer: followup || "Уточните объект запроса: склад, поле или период.",
      sessionState: { ...nextSessionState, lastIntent: intent.name },
      intent,
      outputType: resolvedOutputType,
      mode: resolvedMode,
      toolCalls,
      toolActivity,
      navigationActions,
      sourceHints: uniqueStrings(sourceHints),
      answerSource: "policy_block",
      grounded: false,
      model: {
        configuredModel: modelConfig.configuredModel,
        actualModel: null,
        settingsSource: modelConfig.settingsSource,
        promptVersion: promptMeta.promptVersion,
        promptSource: promptMeta.promptSource,
        promptUpdatedAt: promptMeta.promptUpdatedAt,
        requestMode: "tool_first",
        llm: modelLlmNotCalled,
      },
      performance: emptyPerformance,
    };
  }

  const locale = runtimeContext.locale || "ru";
  let llmPromptBundle = promptBundle;
  let llmPromptMeta = promptMeta;
  try {
    const semanticMemory = await buildSemanticMemoryContext({
      message,
      mode: resolvedMode,
      intentName: intent.name,
      runtimeContext,
    });
    llmPromptBundle = resolveTravkinCorePrompt({
      settings,
      runtimeContext,
      actorRole: actor.role,
      locale,
      semanticMemoryContext: semanticMemory.contextText,
    });
    llmPromptMeta = {
      promptVersion: llmPromptBundle.version || TRAVKIN_CORE_PROMPT_VERSION,
      promptSource: llmPromptBundle.source,
      promptUpdatedAt: llmPromptBundle.updatedAt || TRAVKIN_CORE_PROMPT_UPDATED_AT,
    };
  } catch {
    llmPromptBundle = promptBundle;
    llmPromptMeta = promptMeta;
  }
  const fallback = await generateGeneralAnswer({
    message,
    locale,
    settings,
    intentName: intent.name,
    systemPrompt: llmPromptBundle.text,
    promptMeta: llmPromptMeta,
  });
  return {
    answer: fallback.answer,
    sessionState: { ...nextSessionState, lastIntent: intent.name },
    intent,
    outputType: resolvedOutputType,
    mode:
      intent.name === "navigation_help"
        ? "navigation"
        : isAgroKnowledgeQuestion(messageForRouting)
          ? "agro_knowledge"
          : assistantMode,
    toolCalls,
    toolActivity,
    navigationActions,
    sourceHints: uniqueStrings(sourceHints),
    answerSource: "llm_fallback",
    grounded: false,
    model: {
      configuredModel: modelConfig.configuredModel,
      actualModel: fallback.actualModel,
      settingsSource: modelConfig.settingsSource,
      promptVersion: fallback.promptMeta.promptVersion,
      promptSource: fallback.promptMeta.promptSource,
      promptUpdatedAt: fallback.promptMeta.promptUpdatedAt,
      requestMode: "tool_first",
      llm: fallback.llm,
    },
    performance: fallback.usage,
  };
}
