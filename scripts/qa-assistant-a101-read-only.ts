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

let passed = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

async function main() {
await scenario("Привет — без ERP tools", async () => {
  let toolCount = 0;
  const result = await run({
    message: "Привет",
    sequence: [assistantMessage("Привет! Чем помочь?")],
    executor: async () => { toolCount += 1; return output([]); },
  });
  assert.equal(toolCount, 0);
  assert.equal(result.toolCalls.length, 0);
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

await scenario("create_operation_draft — отсутствует и DENIED", async () => {
  let executorCalled = false;
  const result = await run({
    message: "Создай операцию",
    sequence: [toolMessage("create_operation_draft", { field: "28" })],
    executor: async () => { executorCalled = true; return output([]); },
  });
  assert.equal(executorCalled, false);
  assert.equal(result.answerSource, "policy_block");
  assert.equal(result.runtimeDiagnostics.blockedToolName, "create_operation_draft");
});

await scenario("generic SQL — отсутствует и DENIED", async () => {
  const result = await run({
    message: "Выполни SQL",
    sequence: [toolMessage("execute_sql", { sql: "select 1" })],
  });
  assert.equal(result.answerSource, "policy_block");
  assert.equal(result.runtimeDiagnostics.blockedToolName, "execute_sql");
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
  assert.ok(result.runtimeDiagnostics.conversationMessageCount <= 20);
});

await scenario("все allowlisted tools имеют side_effect=none", () => {
  const schemaNames = getReadOnlyModelToolSchemas().map((tool) => tool.function.name);
  assert.deepEqual(schemaNames, [...READ_ONLY_MODEL_TOOL_NAMES]);
  assert.equal(schemaNames.length, 8);
  READ_ONLY_MODEL_TOOL_NAMES.forEach((name) => assert.equal(READ_ONLY_TOOL_POLICIES[name].sideEffect, "none"));
  assert.equal(schemaNames.some((name) => name.startsWith("create_") || name.includes("sql") || name.includes("navigate")), false);
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

process.stdout.write(`A101 mocked QA complete: ${passed} scenarios passed; production calls=0; DB writes=0.\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
