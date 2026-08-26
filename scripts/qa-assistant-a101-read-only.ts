import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_ASSISTANT_PLATFORM_SETTINGS } from "@/lib/assistant/settings-types";
import type { AssistantToolOutput } from "@/lib/assistant/engine/types";
import type { ServerActorContext } from "@/lib/auth/server-session";
import { runReadOnlyAssistantV1, type ReadOnlyToolExecutor } from "@/lib/assistant/v1/engine";
import {
  buildBoundedConversation,
  emptyReadOnlyThreadState,
  normalizeReadOnlyThreadState,
} from "@/lib/assistant/v1/conversation";
import { parseTypedFieldSearchParameters } from "@/lib/assistant/v1/field-parameters";
import { READ_ONLY_TOOL_POLICIES } from "@/lib/assistant/v1/policy";
import { ReadOnlyModelPreflightError, resolveReadOnlyQaModel } from "@/lib/assistant/v1/model-preflight";
import { getReadOnlyModelToolSchemas } from "@/lib/assistant/v1/tool-schemas";
import { READ_ONLY_MODEL_TOOL_NAMES, type ReadOnlyThreadState } from "@/lib/assistant/v1/types";

const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const AUTH_USER_ID = "44444444-4444-4444-8444-444444444444";

const actor: ServerActorContext = {
  id: USER_ID,
  authUserId: AUTH_USER_ID,
  role: "agronomist",
  roleRawKey: "agronomist",
  roleIsLegacyAlias: false,
  companyId: COMPANY_A,
  homeCompanyId: COMPANY_A,
  contextCompanyId: null,
  status: "active",
  email: "mock@example.invalid",
  isImpersonating: false,
  impersonatedProfileId: null,
  impersonatedCompanyId: null,
  impersonatedByProfileId: null,
  impersonatedByAuthUserId: null,
};

const settings = {
  ...DEFAULT_ASSISTANT_PLATFORM_SETTINGS,
  model: "gpt-4o-mini",
  allowedTools: [...READ_ONLY_MODEL_TOOL_NAMES],
};

const runtimeContext = {
  currentPage: "fields",
  currentRoute: "/fields",
  currentModule: "fields",
  companyId: COMPANY_A,
  companyName: "Mock Farm",
  userId: USER_ID,
  userRole: actor.role,
  season: "2026",
  defaultSeason: "2026",
  locale: "ru" as const,
};

function output(rows: Array<Record<string, unknown>>, title = "Mock result"): AssistantToolOutput {
  return {
    title,
    rows,
    source: {
      module: "mock",
      tableOrView: "mock_company_scoped_view",
      season: "2026",
      fetchedAt: "2026-07-13T00:00:00.000Z",
    },
  };
}

function assistantMessage(content: string) {
  return { model: "gpt-4o-mini", choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
}

function toolMessage(name: string, args: Record<string, unknown>, id = `call-${name}`) {
  return {
    model: "gpt-4o-mini",
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function scriptedFetch(sequence: any[], captures: any[] = []): typeof fetch {
  let index = 0;
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    captures.push(JSON.parse(String(init?.body || "{}")));
    const body = sequence[index++];
    assert.ok(body, `Unexpected OpenAI mock call #${index}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

async function run(params: {
  message: string;
  threadId?: string;
  threadState?: ReadOnlyThreadState | null;
  history?: Array<{ role: unknown; content: unknown }>;
  historyThreadId?: string | null;
  sequence: any[];
  executor?: ReadOnlyToolExecutor;
  runtimeCompanyId?: string;
  customSettings?: typeof settings;
  captures?: any[];
}) {
  const threadId = params.threadId || "thread-a";
  return runReadOnlyAssistantV1({
    supabase: {} as SupabaseClient,
    actor,
    companyId: COMPANY_A,
    companyName: "Mock Farm",
    settings: params.customSettings || settings,
    input: {
      message: params.message,
      threadId,
      historyThreadId: params.historyThreadId === undefined ? threadId : params.historyThreadId,
      history: params.history || [],
      runtimeContext: { ...runtimeContext, companyId: params.runtimeCompanyId || COMPANY_A },
      threadState: params.threadState || emptyReadOnlyThreadState(threadId),
      locale: "ru",
    },
    dependencies: {
      apiKey: "mock-openai-key",
      fetchImpl: scriptedFetch(params.sequence, params.captures),
      executeTool: params.executor,
    },
  });
}

async function runWithoutModel(params: {
  message: string;
  executor?: ReadOnlyToolExecutor;
}) {
  return runReadOnlyAssistantV1({
    supabase: {} as SupabaseClient,
    actor,
    companyId: COMPANY_A,
    companyName: "Mock Farm",
    settings,
    input: {
      message: params.message,
      threadId: "thread-no-model",
      historyThreadId: "thread-no-model",
      history: [],
      runtimeContext: { ...runtimeContext, currentPage: "weighbridge", currentRoute: "/weighbridge", currentModule: "weighbridge" },
      threadState: emptyReadOnlyThreadState("thread-no-model"),
      locale: "ru",
    },
    dependencies: {
      apiKey: null,
      executeTool: params.executor,
    },
  });
}

let passed = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

async function main() {
await scenario("Привет — без ERP tools", async () => {
  let toolCount = 0;
  const captures: any[] = [];
  const result = await run({
    message: "Привет",
    sequence: [assistantMessage("Привет! Чем помочь?")],
    executor: async () => { toolCount += 1; return output([]); },
    captures,
  });
  assert.equal(toolCount, 0);
  assert.equal(result.toolCalls.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(captures[0], "tools"), false);
  assert.equal(result.runtimeDiagnostics.modelToolsEnabled, false);
  assert.equal(result.runtimeDiagnostics.requestPolicyDecision, "model_without_tools");
});

await scenario("привент — без поиска продукта", async () => {
  let toolCount = 0;
  const result = await run({
    message: "привент",
    sequence: [assistantMessage("Привет! Я на связи.")],
    executor: async () => { toolCount += 1; return output([]); },
  });
  assert.equal(toolCount, 0);
  assert.equal(result.toolCalls.length, 0);
});

await scenario("Спасибо и Как дела? — обычный разговор без tools", async () => {
  for (const message of ["Спасибо", "Как дела?"]) {
    let toolCount = 0;
    const captures: any[] = [];
    const result = await run({
      message,
      sequence: [assistantMessage("Рад помочь!")],
      executor: async () => { toolCount += 1; return output([]); },
      captures,
    });
    assert.equal(toolCount, 0);
    assert.equal(result.toolCalls.length, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(captures[0], "tools"), false);
    assert.equal(result.runtimeDiagnostics.requestPolicyDecision, "model_without_tools");
  }
});

await scenario("фертигация — объяснение без write tools", async () => {
  const result = await run({
    message: "Что такое фертигация?",
    sequence: [assistantMessage("Фертигация — внесение удобрений через поливную систему.")],
  });
  assert.equal(result.toolCalls.length, 0);
  assert.equal(result.runtimeDiagnostics.blockedToolName, null);
});

let field28State: ReadOnlyThreadState;
await scenario("поле 28 — typed number", async () => {
  let capturedArgs: Record<string, unknown> = {};
  const result = await run({
    message: "Покажи поле 28",
    sequence: [toolMessage("search_fields", { number: "28" }), assistantMessage("Поле 28 найдено.")],
    executor: async ({ args }) => {
      capturedArgs = args;
      return output([{ field_id: "field-28", field_name: "28", area_ha: 41.5 }]);
    },
  });
  assert.equal(capturedArgs.number, "28");
  assert.equal(capturedArgs.area_ha, undefined);
  assert.equal(result.threadState.selectedFieldId, "field-28");
  assert.equal(result.threadState.selectedFieldLabel, "28");
  field28State = result.threadState;
});

await scenario("follow-up материалы — то же поле 28", async () => {
  let capturedArgs: Record<string, unknown> = {};
  const result = await run({
    message: "А материалы?",
    threadState: field28State!,
    history: [
      { role: "user", content: "Покажи поле 28" },
      { role: "assistant", content: "Поле 28 найдено." },
    ],
    sequence: [toolMessage("get_field_materials", {}), assistantMessage("Материалы поля 28 показаны.")],
    executor: async ({ args }) => {
      capturedArgs = args;
      return output([{ field_id: "field-28", field_name: "28", product_name: "КАС", qty_kg: 120 }]);
    },
  });
  assert.equal(capturedArgs.field, "28");
  assert.equal(result.threadState.selectedFieldId, "field-28");
});

await scenario("follow-up операции — scope того же поля 28", async () => {
  let capturedArgs: Record<string, unknown> = {};
  const result = await run({
    message: "Какие операции по нему активны?",
    threadState: field28State!,
    history: [
      { role: "user", content: "Покажи поле 28" },
      { role: "assistant", content: "Поле 28 найдено." },
      { role: "user", content: "А материалы?" },
      { role: "assistant", content: "Материалы поля 28 показаны." },
    ],
    sequence: [toolMessage("get_active_operations_summary", {}), assistantMessage("Активных операций по полю 28 нет.")],
    executor: async ({ args }) => {
      capturedArgs = args;
      return output([]);
    },
  });
  assert.equal(capturedArgs.field_id, "field-28");
  assert.equal(capturedArgs.field, "28");
  assert.equal(result.runtimeDiagnostics.historyMessageCount, 4);
});

await scenario("Сад — typed name", async () => {
  let capturedArgs: Record<string, unknown> = {};
  await run({
    message: "Дай все поля с названием Сад",
    sequence: [toolMessage("search_fields", { name: "Сад" }), assistantMessage("Найдено поле Сад.")],
    executor: async ({ args }) => {
      capturedArgs = args;
      return output([{ field_id: "field-garden", field_name: "Сад", area_ha: 10 }]);
    },
  });
  assert.equal(capturedArgs.name, "Сад");
  assert.equal(parseTypedFieldSearchParameters("Дай все поля с названием Сад").name, "Сад");
});

await scenario("22 га — typed area, не number", async () => {
  let capturedArgs: Record<string, unknown> = {};
  await run({
    message: "Найди поле площадью 22 га",
    sequence: [toolMessage("search_fields", { number: "22" }), assistantMessage("Найдено поле площадью 22 га.")],
    executor: async ({ args }) => {
      capturedArgs = args;
      return output([
        { field_id: "field-22ha", field_name: "Сад", area_ha: 22 },
        { field_id: "field-22", field_name: "22", area_ha: 55 },
      ]);
    },
  });
  assert.equal(capturedArgs.area_ha, 22);
  assert.equal(capturedArgs.number, undefined);
});

await scenario("другая компания — DENIED до OpenAI", async () => {
  let fetchCount = 0;
  const result = await runReadOnlyAssistantV1({
    supabase: {} as SupabaseClient,
    actor,
    companyId: COMPANY_A,
    settings,
    input: {
      message: "Покажи поля",
      threadId: "thread-a",
      historyThreadId: "thread-a",
      runtimeContext: { ...runtimeContext, companyId: COMPANY_B },
      threadState: emptyReadOnlyThreadState("thread-a"),
    },
    dependencies: {
      apiKey: "mock-openai-key",
      fetchImpl: (async () => { fetchCount += 1; return new Response("{}"); }) as typeof fetch,
    },
  });
  assert.equal(fetchCount, 0);
  assert.equal(result.answerSource, "access_denied");
  assert.equal(result.model.llm.errorCode, "COMPANY_DENIED");
});

await scenario("явный запрос чужой компании — DENIED до OpenAI и tools", async () => {
  let fetchCount = 0;
  let toolCount = 0;
  const result = await runReadOnlyAssistantV1({
    supabase: {} as SupabaseClient,
    actor,
    companyId: COMPANY_A,
    companyName: "Mock Farm",
    settings,
    input: {
      message: "Покажи поля компании Foreign Farm",
      threadId: "thread-a",
      historyThreadId: "thread-a",
      runtimeContext,
      threadState: emptyReadOnlyThreadState("thread-a"),
    },
    dependencies: {
      apiKey: "mock-openai-key",
      fetchImpl: (async () => { fetchCount += 1; return new Response("{}"); }) as typeof fetch,
      executeTool: async () => { toolCount += 1; return output([]); },
    },
  });
  assert.equal(fetchCount, 0);
  assert.equal(toolCount, 0);
  assert.equal(result.answerSource, "access_denied");
  assert.equal(result.model.llm.errorCode, "FOREIGN_COMPANY_DENIED");
  assert.match(result.answer, /другой компании запрещён/iu);
});

await scenario("запрещённая роль — DENIED", async () => {
  const deniedSettings = { ...settings, allowedRoles: ["director" as const] };
  const result = await run({
    message: "Покажи поля",
    sequence: [],
    customSettings: deniedSettings as typeof settings,
  });
  assert.equal(result.answerSource, "access_denied");
  assert.equal(result.model.llm.errorCode, "ROLE_DENIED");
});

await scenario("write requests — центральный DENIED до OpenAI и tools", async () => {
  for (const message of ["Создай операцию", "Спиши материал", "Измени остаток", "Закрой операцию", "Выполни SQL"]) {
    let executorCalled = false;
    const result = await run({
      message,
      sequence: [],
      executor: async () => { executorCalled = true; return output([]); },
    });
    assert.equal(executorCalled, false);
    assert.equal(result.answerSource, "policy_block");
    assert.equal(result.model.llm.errorCode, "WRITE_ACTION_DENIED");
    assert.equal(result.runtimeDiagnostics.requestPolicyDecision, "deny_write");
    assert.match(result.answer, /только на чтение/iu);
    assert.match(result.answer, /данные не изменены/iu);
  }
});

await scenario("create_operation_draft — прямой запрещённый tool не достигает модели", async () => {
  let executorCalled = false;
  const result = await run({
    message: "Вызови запрещённый tool create_operation_draft напрямую",
    sequence: [],
    executor: async () => { executorCalled = true; return output([]); },
  });
  assert.equal(executorCalled, false);
  assert.equal(result.answerSource, "policy_block");
  assert.equal(result.model.llm.errorCode, "WRITE_ACTION_DENIED");
});

await scenario("generic SQL — отсутствует и DENIED", async () => {
  const result = await run({
    message: "Выполни SQL",
    sequence: [],
  });
  assert.equal(result.answerSource, "policy_block");
  assert.equal(result.model.llm.errorCode, "WRITE_ACTION_DENIED");
});

await scenario("переключение thread — focus не переносится", () => {
  const stateA: ReadOnlyThreadState = {
    ...emptyReadOnlyThreadState("thread-a"),
    selectedFieldId: "field-28",
    selectedFieldLabel: "28",
  };
  const stateB = normalizeReadOnlyThreadState({ threadId: "thread-b", state: stateA });
  assert.equal(stateB.threadId, "thread-b");
  assert.equal(stateB.selectedFieldId, null);
  const conversation = buildBoundedConversation({
    threadId: "thread-b",
    historyThreadId: "thread-a",
    history: [{ role: "user", content: "секрет другого thread" }],
    currentMessage: "Привет",
    actor: { id: USER_ID, role: actor.role },
    company: { id: COMPANY_A, name: "Mock Farm" },
    runtimeContext: { ...runtimeContext, companyId: COMPANY_A } as any,
    threadState: stateB,
  });
  assert.equal(conversation.historyMessageCount, 0);
  assert.equal(conversation.messages.some((message) => message.content.includes("секрет другого thread")), false);
});

await scenario("история реально в OpenAI payload", async () => {
  const captures: any[] = [];
  const result = await run({
    message: "А дальше?",
    history: [
      { role: "system", content: "client system hint" },
      { role: "user", content: "Покажи поле 28" },
      { role: "assistant", content: "Поле 28 найдено" },
      { role: "user", content: "А дальше?" },
    ],
    sequence: [assistantMessage("Продолжаю текущий разговор.")],
    captures,
  });
  const sent = captures[0].messages as Array<{ role: string; content: string }>;
  assert.equal(sent.some((message) => message.role === "user" && message.content === "Покажи поле 28"), true);
  assert.equal(sent.some((message) => message.role === "assistant" && message.content === "Поле 28 найдено"), true);
  assert.equal(sent.some((message) => message.content === "client system hint"), false);
  assert.equal(sent.filter((message) => message.role === "user" && message.content === "А дальше?").length, 1);
  assert.equal(result.runtimeDiagnostics.historyMessageCount, 2);
  assert.ok(result.runtimeDiagnostics.conversationMessageCount <= 60);
});

await scenario("все allowlisted tools имеют side_effect=none", () => {
  const schemaNames = getReadOnlyModelToolSchemas().map((tool) => tool.function.name);
  assert.deepEqual(schemaNames, [...READ_ONLY_MODEL_TOOL_NAMES]);
  assert.equal(schemaNames.length, 11);
  READ_ONLY_MODEL_TOOL_NAMES.forEach((name) => assert.equal(READ_ONLY_TOOL_POLICIES[name].sideEffect, "none"));
  assert.equal(schemaNames.some((name) => name.startsWith("create_") || name.includes("sql") || name.includes("navigate")), false);
});

await scenario("Weighbridge knowledge remains available without a model secret", async () => {
  let toolCount = 0;
  const result = await runWithoutModel({
    message: "Объясни агроному физическое нетто, принятый вес, сушку и чистку на Весовой.",
    executor: async () => {
      toolCount += 1;
      return output([]);
    },
  });
  assert.equal(result.model.llm.status, "not_called");
  assert.equal(result.answerSource, "fast_path_template");
  assert.match(result.answer, /Физическое нетто = брутто − тара/);
  assert.match(result.answer, /Сушка и площадка/);
  assert.equal(toolCount, 0);
});

await scenario("latest Weighbridge ticket is company-scoped and grounded without a model secret", async () => {
  let calledTool = "";
  const result = await runWithoutModel({
    message: "Покажи последний талон Весовой",
    executor: async ({ name }) => {
      calledTool = name;
      return output([{
        company_id: COMPANY_A,
        ticket_no: "WB-MOCK-1",
        status: "finalized",
        operation: "harvest_incoming",
        field_name: "Поле 20",
        product_name: "Пшеница",
        variety_name: "Ламис",
        source_name: "Поле 20",
        destination_name: "БИС",
        vehicle_label: "KAMAZ · 247 AP 15",
        driver_name: "Водитель",
        physical_net_kg: 19100,
        accepted_kg: 18900,
        deduction_kg: 200,
        moisture_percent: 17.3,
        operator_name: "Весовщик",
      }], "Последний талон" );
    },
  });
  assert.equal(calledTool, "get_recent_tickets");
  assert.equal(result.model.llm.status, "not_called");
  assert.equal(result.answerSource, "tools");
  assert.equal(result.grounded, true);
  assert.match(result.answer, /WB-MOCK-1/);
  assert.match(result.answer, /физическое нетто 19[\s\u00a0]100 кг/);
  assert.match(result.answer, /принято 18[\s\u00a0]900 кг/);
  assert.match(result.answer, /влажность 17,3%/);
  assert.match(result.answer, /весовщик Весовщик/);
});

await scenario("model preflight — только явный process override, без silent fallback", () => {
  const result = resolveReadOnlyQaModel({
    configuredModel: "gpt-5.3",
    processOverrideModel: "gpt-5.4-mini",
    availableModels: ["gpt-5.4-mini", "gpt-4o-mini"],
  });
  assert.equal(result.requestedModel, "gpt-5.3");
  assert.equal(result.effectiveModel, "gpt-5.4-mini");
  assert.equal(result.overrideApplied, true);
  assert.equal(result.silentFallback, false);
  assert.throws(
    () => resolveReadOnlyQaModel({ configuredModel: "gpt-5.3", availableModels: ["gpt-5.4-mini"] }),
    (error: unknown) => error instanceof ReadOnlyModelPreflightError && error.code === "MODEL_NOT_AVAILABLE"
  );
});

await scenario("несколько полей — без случайного выбора", async () => {
  const result = await run({
    message: "Покажи поле 28",
    sequence: [toolMessage("search_fields", { number: "28" }), assistantMessage("Найдено несколько сегментов: 28-1 и 28-2. Уточните.")],
    executor: async () => output([
      { field_id: "field-28-1", field_name: "28-1", area_ha: 10 },
      { field_id: "field-28-2", field_name: "28-2", area_ha: 11 },
    ]),
  });
  assert.equal(result.threadState.selectedFieldId, null);
  assert.ok(result.threadState.unresolvedQuestion);
});

await scenario("cross-company tool result — DENIED", async () => {
  const result = await run({
    message: "Какой контекст?",
    sequence: [toolMessage("get_current_context", {} )],
    executor: async () => output([{ company_id: COMPANY_B, value: "foreign" }]),
  });
  assert.equal(result.answerSource, "policy_block");
  assert.equal(result.model.llm.errorCode, "RESULT_COMPANY_DENIED");
});

await scenario("field name ending in digit beats inferred number", async () => {
  const parsed = parseTypedFieldSearchParameters(
    "\u041f\u043e\u043a\u0430\u0436\u0438 \u043f\u043e\u043b\u0435 \u0422\u0435\u0441\u0442\u043e\u0432\u043e\u0435 \u043f\u043e\u043b\u0435 1",
    { number: "1" }
  );
  assert.equal(parsed.name, "\u0422\u0435\u0441\u0442\u043e\u0432\u043e\u0435 \u043f\u043e\u043b\u0435 1");
  assert.equal(parsed.number, undefined);
});

await scenario("explicit nonexistent material is deterministically looked up", async () => {
  let capturedName = "";
  let capturedProduct = "";
  const result = await run({
    message: "\u0421\u043a\u043e\u043b\u044c\u043a\u043e \u043e\u0441\u0442\u0430\u043b\u043e\u0441\u044c \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u0430 A103-\u041d\u0415\u0421\u0423\u0429\u0415\u0421\u0422\u0412\u0423\u0415\u0422?",
    sequence: [assistantMessage("Need clarification."), assistantMessage("Material not found.")],
    executor: async ({ name, args }) => {
      capturedName = name;
      capturedProduct = String(args.product || "");
      return output([]);
    },
  });
  assert.equal(capturedName, "get_warehouse_stock");
  assert.equal(capturedProduct, "A103-\u041d\u0415\u0421\u0423\u0429\u0415\u0421\u0422\u0412\u0423\u0415\u0422");
  assert.equal(result.toolCalls[0]?.rows, 0);
});

await scenario("ambiguous material is clarified before model and tools", async () => {
  let toolCount = 0;
  const captures: any[] = [];
  const result = await run({
    message: "\u0421\u043a\u043e\u043b\u044c\u043a\u043e \u043e\u0441\u0442\u0430\u043b\u043e\u0441\u044c \u0443\u0434\u043e\u0431\u0440\u0435\u043d\u0438\u044f?",
    sequence: [],
    captures,
    executor: async () => {
      toolCount += 1;
      return output([]);
    },
  });
  assert.equal(result.runtimeDiagnostics.requestPolicyDecision, "clarify_material");
  assert.equal(result.model.llm.errorCode, "AMBIGUOUS_MATERIAL");
  assert.equal(captures.length, 0);
  assert.equal(toolCount, 0);
});

process.stdout.write(`A101 mocked QA complete: ${passed} scenarios passed; production calls=0; DB writes=0.\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
