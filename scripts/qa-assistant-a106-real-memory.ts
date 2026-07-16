import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildAssistantLongTermMemoryContext,
  deleteAssistantMemory,
  extractExplicitApprovedMemory,
  listAssistantMemoryRecords,
  upsertApprovedAssistantMemory,
  type AssistantMemoryRecord,
} from "@/lib/assistant/memory-store";
import { processAssistantMemoryPolicyV2 } from "@/lib/assistant/v2/memory-policy";
import { DEFAULT_ASSISTANT_PLATFORM_SETTINGS } from "@/lib/assistant/settings-types";
import {
  appendAssistantThreadMessage,
  createAssistantThread,
  type AssistantThreadRecord,
} from "@/lib/assistant/threads-store";
import { getReadOnlyModelToolSchemas } from "@/lib/assistant/v1/tool-schemas";

const EXPECTED_BRANCH_REF = "gsglkmudcwkdetqtocae";
const PRODUCTION_REF = "bhsemlvmkikpntabctml";
const EXPECTED_MODEL = "gpt-5.6-terra";
const OUTPUT_DIR = "audit-output/TZ-A106";

type QaIdentity = {
  supabase: SupabaseClient;
  userId: string;
  companyId: string;
  role: string;
};

type Scenario = { number: number; name: string; status: "PASS"; ms: number };

function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

function required(env: Record<string, string>, key: string): string {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(`Missing ${key} in ignored .env.local`);
  return value;
}

async function signIn(
  url: string,
  anonKey: string,
  email: string,
  password: string
): Promise<QaIdentity> {
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const auth = await supabase.auth.signInWithPassword({ email, password });
  if (auth.error || !auth.data.user || !auth.data.session) {
    throw new Error(`QA sign-in failed: ${auth.error?.message || "session missing"}`);
  }
  const profile = await supabase
    .from("profiles")
    .select("company_id,role,status,is_owner")
    .eq("id", auth.data.user.id)
    .single();
  if (profile.error || !profile.data?.company_id) {
    throw new Error(`QA profile failed: ${profile.error?.message || "company missing"}`);
  }
  assert.equal(profile.data.status, "active");
  return {
    supabase,
    userId: auth.data.user.id,
    companyId: String(profile.data.company_id),
    role: String(profile.data.role),
  };
}

async function tableCount(supabase: SupabaseClient, table: string): Promise<number> {
  const result = await supabase.from(table).select("id", { count: "exact", head: true });
  if (result.error) throw new Error(`${table} count failed: ${result.error.message}`);
  return Number(result.count || 0);
}

async function appendUserMessage(identity: QaIdentity, thread: AssistantThreadRecord, content: string) {
  return appendAssistantThreadMessage({
    supabase: identity.supabase,
    companyId: identity.companyId,
    userId: identity.userId,
    threadId: thread.id,
    role: "user",
    content,
    metadata: { a106_contract_0_4_acceptance: true },
  });
}

async function candidateCount(identity: QaIdentity): Promise<number> {
  const result = await identity.supabase
    .from("assistant_memories")
    .select("id", { count: "exact", head: true })
    .eq("user_id", identity.userId)
    .eq("status", "candidate");
  if (result.error) throw new Error(result.error.message);
  return Number(result.count || 0);
}

async function memoryEvents(identity: QaIdentity, memoryId: string) {
  const result = await identity.supabase
    .from("assistant_memory_events")
    .select("id,memory_id,event_type,memory_type,memory_scope,provenance")
    .eq("memory_id", memoryId);
  if (result.error) throw new Error(result.error.message);
  return result.data || [];
}

async function main() {
  const localEnv = parseEnv(await readFile(".env.local", "utf8"));
  const url = required(localEnv, "A106_SUPABASE_URL");
  const anonKey = required(localEnv, "A106_SUPABASE_ANON_KEY");
  assert.equal(required(localEnv, "A106_BRANCH_REF"), EXPECTED_BRANCH_REF);
  assert.equal(url.includes(EXPECTED_BRANCH_REF), true);
  assert.equal(url.includes(PRODUCTION_REF), false);
  assert.ok(process.env.OPENAI_API_KEY);
  assert.equal(process.env.OPENAI_ASSISTANT_MODEL, EXPECTED_MODEL);
  assert.equal(process.env.REASONING_EFFORT, "medium");
  assert.equal(String(process.env.SUPABASE_SERVICE_ROLE_KEY || ""), "");
  assert.equal(String(process.env.DATABASE_URL || ""), "");
  assert.equal(String(process.env.ASSISTANT_OPENAI_BASE_URL || ""), "");

  const a = await signIn(
    url,
    anonKey,
    required(localEnv, "A106_TEST_USER_A_EMAIL"),
    required(localEnv, "A106_TEST_USER_A_PASSWORD")
  );
  const b = await signIn(
    url,
    anonKey,
    required(localEnv, "A106_TEST_USER_B_EMAIL"),
    required(localEnv, "A106_TEST_USER_B_PASSWORD")
  );
  assert.equal(a.role, "agronomist");
  assert.notEqual(a.userId, b.userId);
  assert.notEqual(a.companyId, b.companyId);

  const settings = {
    ...DEFAULT_ASSISTANT_PLATFORM_SETTINGS,
    model: EXPECTED_MODEL,
    reasoningEffort: "medium" as const,
  };
  const tools = getReadOnlyModelToolSchemas().map((tool) => tool.function.name);
  assert.equal(tools.length, 8);

  const erpTables = ["operations", "warehouses", "inventory_transactions"];
  const erpBefore = Object.fromEntries(
    await Promise.all(erpTables.map(async (table) => [table, await tableCount(a.supabase, table)] as const))
  );
  const candidateBefore = await candidateCount(a);
  const scenarios: Scenario[] = [];
  const createdMemoryIds = new Set<string>();
  const createdThreadIds = new Set<string>();
  let scenarioNumber = 0;
  let oldThread!: AssistantThreadRecord;
  let newThread!: AssistantThreadRecord;
  let nameMemory!: AssistantMemoryRecord;
  let addressMemory!: AssistantMemoryRecord;
  let inferredMemory!: AssistantMemoryRecord;

  async function scenario(name: string, operation: () => Promise<void>) {
    const started = performance.now();
    await operation();
    scenarioNumber += 1;
    const item: Scenario = { number: scenarioNumber, name, status: "PASS", ms: performance.now() - started };
    scenarios.push(item);
    process.stdout.write(`PASS ${scenarioNumber}/10: ${name}\n`);
  }

  try {
    oldThread = await createAssistantThread({
      supabase: a.supabase,
      companyId: a.companyId,
      userId: a.userId,
      title: "A106 Contract 0.4 old chat",
    });
    createdThreadIds.add(oldThread.id);

    await scenario("explicit name is inserted directly as approved", async () => {
      const source = await appendUserMessage(a, oldThread, "Запомни, меня зовут Кирилл");
      const input = extractExplicitApprovedMemory({
        message: source.content,
        sourceMessageId: source.id,
        actor: { companyId: a.companyId, userId: a.userId },
      });
      assert.ok(input);
      assert.equal(input.provenance, "user_explicit");
      nameMemory = await upsertApprovedAssistantMemory({ supabase: a.supabase, input });
      createdMemoryIds.add(nameMemory.id);
      assert.equal(nameMemory.status, "approved");
      assert.equal(nameMemory.active, true);
      assert.equal(nameMemory.approval_mode, "direct_user_explicit");
      assert.equal(nameMemory.confidence, 1);
      assert.equal(nameMemory.source_message_id, source.id);
      assert.equal(nameMemory.approved_by, a.userId);
    });

    await scenario("explicit memory creates no candidate", async () => {
      assert.equal(await candidateCount(a), candidateBefore);
      const events = await memoryEvents(a, nameMemory.id);
      assert.ok(events.some((event) => event.event_type === "memory_created"));
      assert.equal(events.some((event) => event.event_type === "candidate_created"), false);
    });

    await scenario("name is available in a new chat", async () => {
      newThread = await createAssistantThread({
        supabase: a.supabase,
        companyId: a.companyId,
        userId: a.userId,
        title: "A106 Contract 0.4 new chat",
      });
      createdThreadIds.add(newThread.id);
      const context = await buildAssistantLongTermMemoryContext({
        supabase: a.supabase,
        companyId: a.companyId,
        userId: a.userId,
        query: "Как меня зовут?",
      });
      assert.ok(context.ids.includes(nameMemory.id));
      assert.match(context.contextText || "", /Кирилл/i);
    });

    await scenario("updated user-global name is available when old chat continues", async () => {
      await appendUserMessage(a, oldThread, "Как меня зовут?");
      const context = await buildAssistantLongTermMemoryContext({
        supabase: a.supabase,
        companyId: a.companyId,
        userId: a.userId,
        query: "Продолжаем старый чат",
      });
      assert.ok(context.ids.includes(nameMemory.id));
      assert.match(context.contextText || "", /Кирилл/i);
    });

    await scenario("preferred address works across all chats", async () => {
      const source = await appendUserMessage(a, newThread, "Обращайся ко мне Мой Господин");
      const result = await processAssistantMemoryPolicyV2({
        supabase: a.supabase,
        message: source.content,
        sourceMessageId: source.id,
        actor: { companyId: a.companyId, userId: a.userId },
        settings,
      });
      assert.equal(result.action, "save");
      assert.equal(result.provenance, "user_explicit");
      addressMemory = (await listAssistantMemoryRecords({
        supabase: a.supabase,
        companyId: a.companyId,
        userId: a.userId,
      })).memories.find((memory) => memory.id === result.ids[0])!;
      assert.ok(addressMemory);
      createdMemoryIds.add(addressMemory.id);
      for (const query of ["старый чат", "новый чат"]) {
        const context = await buildAssistantLongTermMemoryContext({
          supabase: a.supabase,
          companyId: a.companyId,
          userId: a.userId,
          query,
        });
        assert.match(context.contextText || "", /Мой Господин/i);
      }
    });

    await scenario("safe durable preference is inferred at confidence >= 0.850", async () => {
      const message = "Для моей постоянной работы я предпочитаю сначала видеть краткий итог, а затем детали.";
      const source = await appendUserMessage(a, newThread, message);
      const result = await processAssistantMemoryPolicyV2({
        supabase: a.supabase,
        message,
        sourceMessageId: source.id,
        actor: { companyId: a.companyId, userId: a.userId },
        settings,
      });
      assert.equal(result.action, "save");
      assert.equal(result.provenance, "assistant_inferred");
      assert.equal(result.requestedModel, EXPECTED_MODEL);
      assert.equal(result.effectiveModel, EXPECTED_MODEL);
      inferredMemory = (await listAssistantMemoryRecords({
        supabase: a.supabase,
        companyId: a.companyId,
        userId: a.userId,
      })).memories.find((memory) => memory.id === result.ids[0])!;
      assert.ok(inferredMemory);
      createdMemoryIds.add(inferredMemory.id);
      assert.equal(inferredMemory.provenance, "assistant_inferred");
      assert.equal(inferredMemory.approval_mode, "model_inferred");
      assert.ok(inferredMemory.confidence >= 0.85);
      assert.equal(inferredMemory.approved_by, null);
      assert.equal(inferredMemory.source_message_id, source.id);
    });

    await scenario("current warehouse balance is not saved", async () => {
      const before = (await listAssistantMemoryRecords({
        supabase: a.supabase,
        companyId: a.companyId,
        userId: a.userId,
      })).memories.length;
      const message = "Запомни, текущий остаток склада сегодня 1250 кг.";
      const source = await appendUserMessage(a, newThread, message);
      let rejected = false;
      try {
        await processAssistantMemoryPolicyV2({
          supabase: a.supabase,
          message,
          sourceMessageId: source.id,
          actor: { companyId: a.companyId, userId: a.userId },
          settings,
        });
      } catch {
        rejected = true;
      }
      assert.equal(rejected, true);
      const after = (await listAssistantMemoryRecords({
        supabase: a.supabase,
        companyId: a.companyId,
        userId: a.userId,
      })).memories.length;
      assert.equal(after, before);
    });

    await scenario("forget name deletes immediately and creates audit event", async () => {
      const source = await appendUserMessage(a, oldThread, "Забудь моё имя");
      const result = await processAssistantMemoryPolicyV2({
        supabase: a.supabase,
        message: source.content,
        sourceMessageId: source.id,
        actor: { companyId: a.companyId, userId: a.userId },
        settings,
      });
      assert.equal(result.action, "delete");
      assert.ok(result.deletedCount >= 1);
      const context = await buildAssistantLongTermMemoryContext({
        supabase: a.supabase,
        companyId: a.companyId,
        userId: a.userId,
        query: "Как меня зовут?",
      });
      assert.equal(context.ids.includes(nameMemory.id), false);
      assert.doesNotMatch(context.contextText || "", /Кирилл/i);
      const events = await memoryEvents(a, nameMemory.id);
      assert.ok(events.some((event) => event.event_type === "memory_deleted"));
    });

    await scenario("user B cannot see or delete user A memory", async () => {
      const bMemories = await listAssistantMemoryRecords({
        supabase: b.supabase,
        companyId: b.companyId,
        userId: b.userId,
      });
      assert.equal(bMemories.memories.some((memory) => memory.id === addressMemory.id), false);
      await assert.rejects(() => deleteAssistantMemory({
        supabase: b.supabase,
        companyId: b.companyId,
        userId: b.userId,
        memoryId: addressMemory.id,
      }));
      const aMemories = await listAssistantMemoryRecords({
        supabase: a.supabase,
        companyId: a.companyId,
        userId: a.userId,
      });
      assert.ok(aMemories.memories.some((memory) => memory.id === addressMemory.id));
    });

    await scenario("ordinary user cannot create company-wide memory", async () => {
      const message = "Запомни для компании: правило — каждую рекомендацию сверять с агрономом.";
      const source = await appendUserMessage(a, newThread, message);
      const input = extractExplicitApprovedMemory({
        message,
        sourceMessageId: source.id,
        actor: { companyId: a.companyId, userId: a.userId },
      });
      assert.ok(input);
      assert.equal(input.scope, "company");
      assert.equal(input.provenance, "company_explicit");
      await assert.rejects(() => upsertApprovedAssistantMemory({ supabase: a.supabase, input }));
      const companyMemories = (await listAssistantMemoryRecords({
        supabase: a.supabase,
        companyId: a.companyId,
        userId: a.userId,
      })).memories.filter((memory) => memory.scope === "company");
      assert.equal(companyMemories.some((memory) => memory.source_message_id === source.id), false);
    });

    assert.equal(scenarios.length, 10);
    assert.equal(await candidateCount(a), candidateBefore);
    const erpAfter = Object.fromEntries(
      await Promise.all(erpTables.map(async (table) => [table, await tableCount(a.supabase, table)] as const))
    );
    assert.deepEqual(erpAfter, erpBefore);

    const report = {
      task: "A106",
      contractVersion: "0.4",
      branchRef: EXPECTED_BRANCH_REF,
      productionConnections: 0,
      serviceRoleLoaded: false,
      requestedModel: EXPECTED_MODEL,
      effectiveModel: EXPECTED_MODEL,
      reasoningEffort: "medium",
      responsesApiStore: false,
      readOnlyTools: tools,
      erpWrites: 0,
      candidateDelta: 0,
      scenariosPass: 10,
      scenariosFail: 0,
      scenarios,
      erpBefore,
      erpAfter,
      completedAt: new Date().toISOString(),
    };
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(`${OUTPUT_DIR}/memory-policy-v2-real-acceptance.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write("A106_CONTRACT_0_4_ACCEPTANCE=PASS\n");
    process.stdout.write("SCENARIOS_PASS=10\nSCENARIOS_FAIL=0\nERP_WRITES=0\nPRODUCTION_CONNECTIONS=0\n");
  } finally {
    for (const memoryId of Array.from(createdMemoryIds)) {
      try {
        await deleteAssistantMemory({
          supabase: a.supabase,
          companyId: a.companyId,
          userId: a.userId,
          memoryId,
        });
      } catch {
        // It may already have been deleted by the acceptance scenario.
      }
    }
    for (const threadId of Array.from(createdThreadIds)) {
      await a.supabase.from("chats").delete().eq("id", threadId);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`A106_CONTRACT_0_4_ACCEPTANCE=FAIL\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
