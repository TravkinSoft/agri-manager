import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerActorContext } from "@/lib/auth/server-session";
import { DEFAULT_ASSISTANT_PLATFORM_SETTINGS } from "@/lib/assistant/settings-types";
import type { AssistantToolOutput } from "@/lib/assistant/engine/types";
import { productIdentityMatchesQuery } from "@/lib/assistant/engine/tools";
import { runReadOnlyAssistantV1, type ReadOnlyToolExecutor } from "@/lib/assistant/v1/engine";
import { emptyReadOnlyThreadState } from "@/lib/assistant/v1/conversation";
import {
  isCompanyWideOperationsRequest,
  isExplicitFieldFollowUp,
  isGenericFieldDirectoryRequest,
  isIndependentFieldSearchRequest,
  scopeThreadStateForMessage,
} from "@/lib/assistant/v1/context-scope";
import { parseTypedFieldSearchParameters } from "@/lib/assistant/v1/field-parameters";
import { READ_ONLY_MODEL_TOOL_NAMES, type ReadOnlyThreadState } from "@/lib/assistant/v1/types";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const FIELD_15_ID = "33333333-3333-4333-8333-333333333333";

const actor: ServerActorContext = {
  id: USER_ID,
  authUserId: "44444444-4444-4444-8444-444444444444",
  role: "agronomist",
  roleRawKey: "agronomist",
  roleIsLegacyAlias: false,
  companyId: COMPANY_ID,
  homeCompanyId: COMPANY_ID,
  contextCompanyId: null,
  status: "active",
  email: "a109@example.invalid",
  isImpersonating: false,
  impersonatedProfileId: null,
  impersonatedCompanyId: null,
  impersonatedByProfileId: null,
  impersonatedByAuthUserId: null,
};

const settings = {
  ...DEFAULT_ASSISTANT_PLATFORM_SETTINGS,
  model: "gpt-5.6-terra",
  allowedTools: [...READ_ONLY_MODEL_TOOL_NAMES],
};

const runtimeContext = {
  currentPage: "fields",
  currentRoute: "/fields",
  currentModule: "fields",
  companyId: COMPANY_ID,
  companyName: "A109 QA Farm",
  userId: USER_ID,
  userRole: actor.role,
  season: "2026",
  defaultSeason: "2026",
  locale: "ru" as const,
};

const fieldRows = Array.from({ length: 8 }, (_, index) => ({
  field_id: `field-${index + 1}`,
  field_name: index === 0 ? "Поле 15" : `Поле ${index + 20}`,
  area_ha: 100 + index,
  crop_name: index === 0 ? "Соя" : "Пшеница",
  variety_name: index === 0 ? "Аванта" : null,
}));

function output(rows: Array<Record<string, unknown>>, title = "A109 mock"): AssistantToolOutput {
  return {
    title,
    rows,
    source: {
      module: "a109",
      tableOrView: "mock_rls_company_read",
      season: "2026",
      fetchedAt: "2026-07-18T00:00:00.000Z",
    },
  };
}

function assistantMessage(content: string) {
  return {
    model: "gpt-5.6-terra",
    choices: [{ message: { role: "assistant", content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function toolMessage(name: string, args: Record<string, unknown>, id = `call-${name}`) {
  return {
    model: "gpt-5.6-terra",
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

function scriptedFetch(sequence: any[]): typeof fetch {
  let index = 0;
  return (async () => {
    const body = sequence[index++];
    assert.ok(body, `Unexpected OpenAI mock call #${index}`);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

async function run(params: {
  message: string;
  state?: ReadOnlyThreadState;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  sequence: any[];
  executor: ReadOnlyToolExecutor;
}) {
  return runReadOnlyAssistantV1({
    supabase: {} as SupabaseClient,
    actor,
    companyId: COMPANY_ID,
    companyName: "A109 QA Farm",
    settings,
    input: {
      message: params.message,
      threadId: "a109-thread",
      historyThreadId: "a109-thread",
      history: params.history || [],
      runtimeContext,
      threadState: params.state || emptyReadOnlyThreadState("a109-thread"),
    },
    dependencies: {
      apiKey: "mock-openai-key",
      fetchImpl: scriptedFetch(params.sequence),
      executeTool: params.executor,
    },
  });
}

function selectedFieldState(): ReadOnlyThreadState {
  return {
    ...emptyReadOnlyThreadState("a109-thread"),
    selectedFieldId: FIELD_15_ID,
    selectedFieldLabel: "Поле 15",
    lastSuccessfulTool: "get_field_card",
    lastIntent: "fields_overview",
  };
}

let passed = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

async function main() {
  await scenario("scope classifier separates company-wide questions and explicit follow-ups", () => {
    assert.equal(isGenericFieldDirectoryRequest("Какие это поля?"), true);
    assert.equal(isGenericFieldDirectoryRequest("Покажи все поля"), true);
    assert.equal(isCompanyWideOperationsRequest("Какие операции идут сейчас?"), true);
    assert.equal(isExplicitFieldFollowUp("А какие там операции?"), true);
    assert.equal(isExplicitFieldFollowUp("А культура?"), true);
    assert.equal(isIndependentFieldSearchRequest("Найди поле, где выращивается соя."), true);
    assert.equal(scopeThreadStateForMessage(selectedFieldState(), "Какие операции идут сейчас?").selectedFieldId, null);
    assert.equal(scopeThreadStateForMessage(selectedFieldState(), "Найди поле, где выращивается соя.").selectedFieldId, null);
  });

  await scenario("Что по 15 полю resolves the postpositive field number and never calls warehouse stock", async () => {
    assert.equal(parseTypedFieldSearchParameters("Что по 15 полю?").number, "15");
    const names: string[] = [];
    const result = await run({
      message: "Что по 15 полю?",
      sequence: [assistantMessage(""), assistantMessage("Поле 15: 125 га, соя.")],
      executor: async ({ name }) => {
        names.push(name);
        return output([{ field_id: FIELD_15_ID, field_name: "Поле 15", area_ha: 125, crops: ["Соя"] }]);
      },
    });
    assert.deepEqual(names, ["get_field_card"]);
    assert.equal(result.threadState.selectedFieldId, FIELD_15_ID);
  });

  await scenario("company-wide field count clears stale selected field", async () => {
    const result = await run({
      message: "Сколько полей в хозяйстве?",
      state: selectedFieldState(),
      sequence: [toolMessage("get_field_land_bank_summary", {}), assistantMessage("В хозяйстве 8 полей.")],
      executor: async () => output([{ total_fields: 8, total_area_ha: 1000 }]),
    });
    assert.equal(result.toolCalls[0]?.tool, "get_field_land_bank_summary");
    assert.equal(result.threadState.selectedFieldId, null);
  });

  await scenario("Какие это поля repeats a mismatched 1-row query without field_id and returns all 8", async () => {
    const captured: Array<Record<string, unknown>> = [];
    let executions = 0;
    const result = await run({
      message: "Какие это поля?",
      state: selectedFieldState(),
      history: [
        { role: "user", content: "Сколько полей в хозяйстве?" },
        { role: "assistant", content: "В хозяйстве 8 полей." },
      ],
      sequence: [
        toolMessage("get_field_card", { field_id: FIELD_15_ID }),
        assistantMessage("Это Поле 15."),
        assistantMessage("Все восемь полей перечислены."),
      ],
      executor: async ({ args }) => {
        captured.push(args);
        executions += 1;
        return output(executions === 1 ? fieldRows.slice(0, 1) : fieldRows);
      },
    });
    assert.equal(executions, 2);
    assert.equal(result.toolCalls.every((call) => call.tool === "search_fields"), true);
    assert.equal(result.toolCalls[1]?.rows, 8);
    assert.equal(captured.every((args) => !args.field_id && !args.field), true);
    assert.equal(result.threadState.selectedFieldId, null);
  });

  await scenario("Какие операции идут сейчас ignores stale Field 15 focus", async () => {
    let captured: Record<string, unknown> = {};
    const result = await run({
      message: "Какие операции идут сейчас?",
      state: selectedFieldState(),
      sequence: [toolMessage("get_field_card", { field_id: FIELD_15_ID }), assistantMessage("Сейчас идут две операции.")],
      executor: async ({ args }) => {
        captured = args;
        return output([
          { operation_id: "op-1", operation_type: "Опрыскивание", field_name: "Поле 28" },
          { operation_id: "op-2", operation_type: "Полив", field_name: "Сад Южный" },
        ]);
      },
    });
    assert.equal(result.toolCalls[0]?.tool, "get_active_operations_summary");
    assert.equal(captured.field_id, null);
    assert.equal(captured.field, null);
    assert.equal(result.toolCalls[0]?.rows, 2);
  });

  await scenario("explicit operation follow-up keeps Field 15 focus", async () => {
    let captured: Record<string, unknown> = {};
    await run({
      message: "А какие там операции?",
      state: selectedFieldState(),
      sequence: [toolMessage("get_active_operations_summary", {}), assistantMessage("По Полю 15 одна операция.")],
      executor: async ({ args }) => {
        captured = args;
        return output([{ operation_id: "op-15", operation_type: "Посев", field_name: "Поле 15" }]);
      },
    });
    assert.equal(captured.field_id, FIELD_15_ID);
    assert.equal(captured.field, "Поле 15");
  });

  await scenario("planned Field 15 operation is not rendered as active", async () => {
    const result = await run({
      message: "Что по 15 полю?",
      state: selectedFieldState(),
      sequence: [
        toolMessage("get_active_operations_summary", { field: "15", status: "all" }),
        toolMessage("get_active_operations_summary", { field: "15", status: "all" }),
      ],
      executor: async () => output([{
        field_id: FIELD_15_ID,
        field_name: "Поле 15",
        area_ha: 125,
        operation_type: "Посев",
        status: "planned",
        planned_operations_count: 1,
        active_operations_count: 0,
        completed_operations_count: 0,
      }]),
    });
    assert.match(result.answer, /запланирована/iu);
    assert.doesNotMatch(result.answer, /выполняется сейчас|активн/iu);
    assert.equal(result.toolCalls.length, 1);
  });

  await scenario("empty DATA answer triggers one correct ERP retry", async () => {
    let executions = 0;
    const result = await run({
      message: "Какие поля есть?",
      sequence: [
        toolMessage("search_fields", {}),
        assistantMessage(""),
        assistantMessage("В хозяйстве восемь полей."),
      ],
      executor: async () => {
        executions += 1;
        return output(fieldRows);
      },
    });
    assert.equal(executions, 2);
    assert.equal(result.toolCalls.length, 2);
    assert.doesNotMatch(result.answer, /ответ не сформирован|безопасный ответ модели/iu);
  });

  await scenario("double empty DATA answer renders grounded rows without technical text", async () => {
    const result = await run({
      message: "Покажи все поля",
      sequence: [
        toolMessage("search_fields", {}),
        assistantMessage(""),
        assistantMessage(""),
      ],
      executor: async () => output(fieldRows),
    });
    assert.match(result.answer, /Поля хозяйства \(8\)/u);
    assert.match(result.answer, /Поле 15/u);
    assert.equal(result.answerSource, "tools");
    assert.doesNotMatch(result.answer, /ответ не сформирован|безопасный ответ модели|tool/iu);
  });

  await scenario("small Curamin typo and approved variants resolve to one product identity", () => {
    for (const query of ["курмаина", "курамин", "фолиар", "Curamin"]) {
      assert.equal(productIdentityMatchesQuery("Curamin Foliar", query), true, query);
    }
    assert.equal(productIdentityMatchesQuery("Curamin Foliar", "молодец"), false);
  });

  process.stdout.write(`A109_MOCK_PASS=${passed}\n`);
  process.stdout.write("ERP_WRITES=0\n");
  process.stdout.write("PRODUCTION_CONNECTIONS=0\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
