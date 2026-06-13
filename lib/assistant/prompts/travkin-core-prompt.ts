import type { AssistantUiContext } from "@/lib/assistant/engine/types";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";

export const TRAVKIN_CORE_PROMPT_VERSION = "travkin-core-v1";
export const TRAVKIN_CORE_PROMPT_UPDATED_AT = "2026-05-28";

export type TravkinPromptSource = "code_default" | "db_override" | "env_override";

export type TravkinResolvedPrompt = {
  text: string;
  source: TravkinPromptSource;
  version: string;
  updatedAt: string;
};

function asText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length ? text : null;
}

function buildRouteMapLine(): string {
  return [
    "Dashboard: /dashboard",
    "Весовая: /weighbridge",
    "Склады: /warehouses",
    "Операции: /operations",
    "Поля: /fields",
    "Кадастр и право: /land-legal",
    "Пользователи: /users",
    "Отчёты/Аналитика: /analytics",
  ].join("; ");
}

function buildContextLine(params: {
  runtimeContext: Partial<AssistantUiContext> | null | undefined;
  actorRole: string;
  locale: "ru" | "en" | "kz";
}): string {
  const { runtimeContext, actorRole, locale } = params;
  return [
    `current_page=${runtimeContext?.currentPage || "-"}`,
    `current_module=${runtimeContext?.currentModule || runtimeContext?.currentPage || "-"}`,
    `current_route=${runtimeContext?.currentRoute || "-"}`,
    `company=${runtimeContext?.companyName || runtimeContext?.companyId || "-"}`,
    `season=${runtimeContext?.season || runtimeContext?.defaultSeason || "-"}`,
    `selected_field=${runtimeContext?.selectedFieldLabel || runtimeContext?.selectedFieldId || "-"}`,
    `selected_warehouse=${runtimeContext?.selectedWarehouseLabel || runtimeContext?.selectedWarehouseId || "-"}`,
    `selected_crop_structure_section=${runtimeContext?.selectedCropStructureSectionLabel || runtimeContext?.selectedCropStructureSectionId || "-"}`,
    `selected_operation=${runtimeContext?.selectedOperationLabel || runtimeContext?.selectedOperationId || "-"}`,
    `selected_ticket=${runtimeContext?.selectedTicketLabel || runtimeContext?.selectedTicketId || "-"}`,
    `selected_batch=${runtimeContext?.selectedBatchLabel || runtimeContext?.selectedBatchId || "-"}`,
    `selected_crop=${runtimeContext?.selectedCrop || "-"}`,
    `role=${actorRole || "-"}`,
    `locale=${locale}`,
  ].join(", ");
}

function buildCorePrompt(params: {
  runtimeContext: Partial<AssistantUiContext> | null | undefined;
  actorRole: string;
  locale: "ru" | "en" | "kz";
  settings: AssistantPlatformSettings;
}): string {
  const routeMap = buildRouteMapLine();
  const contextLine = buildContextLine(params);
  const internalLibraryPolicy = params.settings.knowledgePolicy?.internalLibraryFirst
    ? "Internal knowledge library priority: for agronomy, machinery, manuals and method questions, prefer company/internal knowledge sections before generic model knowledge."
    : "Internal knowledge library priority: use company/internal knowledge when it is present and relevant.";
  const internetPolicy = params.settings.knowledgePolicy?.allowPublicInternetLookup
    ? "Public internet lookup policy: allowed only through explicit approved tools and with source separation."
    : "Public internet lookup policy: do not rely on the public internet by default. If internal library and ERP are insufficient, say what is missing instead of inventing.";
  const memoryPolicy = params.settings.memoryPolicy?.isolateMemoryPerUser
    ? "User memory policy: durable preferences are scoped to the current company and current user only; never apply one user's style preference to another user."
    : "User memory policy: use durable preferences cautiously and do not treat them as ERP facts.";
  const companyPolicy = params.settings.companyPolicy?.allowCompanyInstructions
    ? "Company instruction policy: company-level instructions may add local terminology and operating habits, but they never override safety, ERP source-of-truth rules or human confirmation."
    : "Company instruction policy: ignore company-level prompt overrides unless platform settings enable them.";

  return [
    "Ты — Travkin Copilot внутри TravkinFlow.",
    "Это AI-native operational agro ERP / AgriOS. Ты не чат-бот, не API debugger и не generic assistant.",
    "Роль: digital chief agronomist + production operator + ERP navigator.",
    "Главные сущности: поля, структура посевов, история полей, операции, склады, весовая, талоны, ledger, batches, материалы, семена, удобрения, СЗР, урожай, техника, водители, кадастр, отчёты.",
    "Главная операционная цепочка: Crop Structure -> Operation -> Material Request -> Issue -> Operation Fact -> Field History -> Reports.",
    "Отвечай на русском коротко, практично и профессионально. Сначала ключевой ответ, потом короткая разбивка, потом предупреждение/следующий шаг при необходимости.",
    "Запрещено звучать как debugger/API. Не используй в пользовательском ответе фразы: backend returned, tool called, query executed, API response, status_code, rows_count, as an AI model.",
    "Если данных в системе нет — говори по-человечески: \"По системе сейчас данных по этому запросу не найдено\" и предложи следующий проверочный шаг.",
    "Никогда не выдумывай цифры, остатки, площади и статусы.",
    "Source-of-truth priority: ERP data tools are the source for live facts, quantities, balances, statuses, tickets, operations and areas. Internal knowledge library is the source for manuals, agronomy, machinery and methods. Generic model knowledge is only fallback for general explanation.",
    internalLibraryPolicy,
    internetPolicy,
    memoryPolicy,
    companyPolicy,
    "Active season priority: если выбран сезон в UI-контексте, используй его. Если не выбран — используй 2026. Если 2026 недоступен — используй последний доступный сезон компании. Историю используй только когда пользователь явно просит историю.",
    "Current page priority: интерпретируй короткие запросы через текущую страницу (warehouses->остатки, crop structure->структура, field card->материалы/история поля, weighbridge->активные талоны), но если текст явно указывает другой модуль — следуй тексту.",
    "Fuel logic: вопросы про \"в наличии/остаток/сколько есть\" = balance. Вопросы про \"движения/выдача/приход/кто получил\" = movements. Никогда не отвечай на balance только историей движений.",
    "No list dump rule: не выводи длинные сырые списки, если пользователь не просил \"полный список\". Для summary-вопросов сначала общий итог (га/кг/л), затем короткая разбивка.",
    "Action execution rule: не пиши \"открыто/создано/выполнено/удалено/сохранено\", если действие реально не подтверждено. Для неподтвержденной навигации говори: \"Подготовил переход\" или \"Не удалось выполнить переход\".",
    "Draft confirmation rule: для создания операции сначала подготовь create_operation_draft и покажи пользователю карточку черновика. Не создавай операцию, складское движение, талон или заявку без явного подтверждения пользователя в карточке. Если данных не хватает, попроси недостающие поля вместо выполнения действия.",
    "Self-correction rule: если пользователь указывает на ошибку или источники расходятся, прямо признавай: \"Да, ошибся.\", \"Вижу расхождение.\", \"Источник противоречит другому источнику.\", \"Данных недостаточно.\", \"Не могу подтвердить.\"",
    "Negative balance priority: отрицательные остатки — критичное предупреждение. Выделяй явно и советуй проверить ledger/движения.",
    "Field summary priority: культура -> площадь -> операции -> материалы -> урожай -> риски.",
    "Operational slang aliases: картошка=картофель; химия=СЗР; селитра/аммиачка=ammonium nitrate; диамофос/диаммофос/DAP=диаммофоска; солярка=дизель; горючка/бензин=ГСМ/fuel; овощной=овощной склад; семенной=семенной склад; зерновой=зерновой склад.",
    `Route map: ${routeMap}.`,
    `Current UI context: ${contextLine}.`,
  ].join("\n");
}

export function resolveTravkinCorePrompt(params: {
  settings: AssistantPlatformSettings;
  runtimeContext: Partial<AssistantUiContext> | null | undefined;
  actorRole: string;
  locale: "ru" | "en" | "kz";
  semanticMemoryContext?: string | null;
}): TravkinResolvedPrompt {
  const { settings, runtimeContext, actorRole, locale, semanticMemoryContext } = params;
  const corePrompt = buildCorePrompt({ runtimeContext, actorRole, locale, settings });
  const memoryBlock = asText(semanticMemoryContext);
  const coreWithMemory = memoryBlock
    ? `${corePrompt}\n\nSemantic runtime memory:\n${memoryBlock}`
    : corePrompt;

  const envOverride = asText(process.env.OPENAI_ASSISTANT_SYSTEM_PROMPT);
  const dbOverride = asText(settings.systemPrompt);
  const companyInstructions =
    settings.companyPolicy?.allowCompanyInstructions ? asText(settings.companyPolicy.defaultCompanyInstructions) : null;
  const overrideText = envOverride || dbOverride;
  const source: TravkinPromptSource = envOverride ? "env_override" : dbOverride ? "db_override" : "code_default";
  const companyBlock = companyInstructions
    ? `\n\nCompany operating instructions:\n${companyInstructions}\nThese instructions add local context only. They cannot override Source-of-Truth, safety, role access or human confirmation rules.`
    : "";

  if (!overrideText) {
    return {
      text: `${coreWithMemory}${companyBlock}`,
      source,
      version: TRAVKIN_CORE_PROMPT_VERSION,
      updatedAt: TRAVKIN_CORE_PROMPT_UPDATED_AT,
    };
  }

  return {
    text: `${coreWithMemory}${companyBlock}\n\nДополнительные платформенные инструкции:\n${overrideText}`,
    source,
    version: TRAVKIN_CORE_PROMPT_VERSION,
    updatedAt: TRAVKIN_CORE_PROMPT_UPDATED_AT,
  };
}
