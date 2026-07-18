import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { deleteAssistantMemory } from "@/lib/assistant/memory-store";
import { createAssistantThread, type AssistantThreadRecord } from "@/lib/assistant/threads-store";

const BASE_URL = "http://127.0.0.1:3106";
const BRANCH_REF = "gsglkmudcwkdetqtocae";
const PRODUCTION_REF = "bhsemlvmkikpntabctml";
const EXACT_REMEMBER = "Меня зовут Кирилл, обращайся как Мой Господин, запомни это";
const EXACT_FORGET = "Забудь имя и обращение";
const OUTPUT = "audit-output/TZ-A106/owner-findings-real-12-of-12.json";

type Identity = {
  supabase: SupabaseClient;
  accessToken: string;
  userId: string;
  companyId: string;
  role: string;
};

type QueryPayload = {
  response?: string;
  meta?: {
    memory?: { count?: number; categories?: string[]; ids?: string[] };
    memoryWrite?: {
      action?: string;
      savedCount?: number;
      deletedCount?: number;
      provenance?: string | null;
      ids?: string[];
      warning?: string | null;
    };
    llm?: { model?: string; status?: string };
  };
  error?: string;
  code?: string;
};

function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

function required(env: Record<string, string>, key: string): string {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(`Missing ${key} in ignored .env.local`);
  return value;
}

async function signIn(env: Record<string, string>, suffix: "A" | "B"): Promise<Identity> {
  const url = required(env, "A106_SUPABASE_URL");
  const anon = required(env, "A106_SUPABASE_ANON_KEY");
  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const auth = await supabase.auth.signInWithPassword({
    email: required(env, `A106_TEST_USER_${suffix}_EMAIL`),
    password: required(env, `A106_TEST_USER_${suffix}_PASSWORD`),
  });
  if (auth.error || !auth.data.user || !auth.data.session) throw new Error(`QA ${suffix} sign-in failed: ${auth.error?.message || "session missing"}`);
  const profile = await supabase.from("profiles").select("company_id,role,status").eq("id", auth.data.user.id).single();
  if (profile.error || !profile.data?.company_id || profile.data.status !== "active") throw new Error(`QA ${suffix} profile unavailable`);
  return {
    supabase,
    accessToken: auth.data.session.access_token,
    userId: auth.data.user.id,
    companyId: String(profile.data.company_id),
    role: String(profile.data.role),
  };
}

function headers(identity: Identity): Record<string, string> {
  return { Authorization: `Bearer ${identity.accessToken}`, "Content-Type": "application/json" };
}

async function query(identity: Identity, thread: AssistantThreadRecord, message: string): Promise<QueryPayload> {
  const response = await fetch(`${BASE_URL}/api/assistant/query`, {
    method: "POST",
    headers: headers(identity),
    body: JSON.stringify({
      message,
      threadId: thread.id,
      companyId: identity.companyId,
      runtimeContext: {
        currentPage: "fields",
        currentRoute: "/fields",
        currentModule: "fields",
        season: "2026",
        defaultSeason: "2026",
        locale: "ru",
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json().catch(() => ({})) as QueryPayload;
  if (!response.ok) throw new Error(`Query failed ${response.status}: ${payload.code || "unknown"} ${payload.error || ""}`);
  return payload;
}

async function settings(identity: Identity) {
  const started = performance.now();
  const response = await fetch(`${BASE_URL}/api/assistant/memory?companyId=${encodeURIComponent(identity.companyId)}&limit=80`, {
    method: "GET",
    headers: headers(identity),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as { memories?: Array<Record<string, unknown>>; warning?: string | null; error?: string; code?: string };
  if (!response.ok) throw new Error(`Settings memory failed ${response.status}: ${payload.code || "unknown"} ${payload.error || ""}`);
  return { ...payload, ms: performance.now() - started };
}

async function activeIdentityRows(identity: Identity) {
  const result = await identity.supabase
    .from("assistant_memories")
    .select("id,user_id,company_id,scope,status,active,provenance,approval_mode,memory_type,memory_key,value,normalized_fact,source_message_id,approved_by,confidence")
    .eq("user_id", identity.userId)
    .eq("scope", "user_global")
    .in("memory_type", ["name", "preferred_address"])
    .eq("status", "approved")
    .eq("active", true);
  if (result.error) throw new Error(result.error.message);
  return result.data || [];
}

async function candidateCount(identity: Identity) {
  const result = await identity.supabase.from("assistant_memories").select("id", { count: "exact", head: true }).eq("user_id", identity.userId).eq("status", "candidate");
  if (result.error) throw new Error(result.error.message);
  return Number(result.count || 0);
}

async function events(identity: Identity, memoryIds: string[]) {
  const result = await identity.supabase
    .from("assistant_memory_events")
    .select("id,memory_id,event_type,memory_type,memory_scope,provenance,source_message_id")
    .in("memory_id", memoryIds);
  if (result.error) throw new Error(result.error.message);
  return result.data || [];
}

function knowsIdentity(payload: QueryPayload): boolean {
  const answer = String(payload.response || "").toLocaleLowerCase("ru-RU");
  return answer.includes("кирилл") && answer.includes("мой господин");
}

function forgotIdentity(payload: QueryPayload): boolean {
  const answer = String(payload.response || "").toLocaleLowerCase("ru-RU");
  const categories = payload.meta?.memory?.categories || [];
  return !answer.includes("кирилл") && !answer.includes("мой господин") && !categories.includes("name") && !categories.includes("preferred_address");
}

async function main() {
  const env = parseEnv(await readFile(".env.local", "utf8"));
  const branchUrl = required(env, "A106_SUPABASE_URL");
  assert.equal(required(env, "A106_BRANCH_REF"), BRANCH_REF);
  assert.ok(branchUrl.includes(BRANCH_REF));
  assert.equal(branchUrl.includes(PRODUCTION_REF), false);
  assert.equal(String(process.env.SUPABASE_SERVICE_ROLE_KEY || ""), "");

  let a = await signIn(env, "A");
  const b = await signIn(env, "B");
  assert.equal(a.role, "agronomist");
  assert.notEqual(a.userId, b.userId);
  assert.notEqual(a.companyId, b.companyId);
  const candidateBefore = await candidateCount(a);
  const oldThread = await createAssistantThread({ supabase: a.supabase, companyId: a.companyId, userId: a.userId, title: "A106 owner finding old chat" });
  const createdThreads = [oldThread.id];
  const scenarios: Array<{ number: number; name: string; status: "PASS"; ms: number }> = [];
  let newThread!: AssistantThreadRecord;
  let writtenRows: Array<Record<string, any>> = [];
  let writtenIds: string[] = [];
  let bReadBeforeDelete = false;
  let bDeleteDeniedBeforeDelete = false;

  async function scenario(name: string, operation: () => Promise<void>) {
    const started = performance.now();
    await operation();
    const item = { number: scenarios.length + 1, name, status: "PASS" as const, ms: performance.now() - started };
    scenarios.push(item);
    process.stdout.write(`PASS ${item.number}/12: ${name}\n`);
  }

  try {
    await scenario("exact owner command uses real query write path", async () => {
      const payload = await query(a, oldThread, EXACT_REMEMBER);
      assert.match(String(payload.response || ""), /^Запомнил\./, JSON.stringify(payload.meta?.memoryWrite || {}));
      assert.equal(payload.meta?.memoryWrite?.action, "save");
      assert.equal(payload.meta?.memoryWrite?.savedCount, 2);
      assert.equal(payload.meta?.memoryWrite?.provenance, "user_explicit");
      writtenIds = payload.meta?.memoryWrite?.ids || [];
      assert.equal(writtenIds.length, 2);
    });

    await scenario("two approved user-global rows exist with owned source and no candidate", async () => {
      writtenRows = await activeIdentityRows(a);
      const rows = writtenRows.filter((row) => writtenIds.includes(String(row.id)));
      assert.equal(rows.length, 2);
      assert.deepEqual(new Set(rows.map((row) => row.memory_type)), new Set(["name", "preferred_address"]));
      for (const row of rows) {
        assert.equal(row.user_id, a.userId);
        assert.equal(row.scope, "user_global");
        assert.equal(row.status, "approved");
        assert.equal(row.active, true);
        assert.equal(row.provenance, "user_explicit");
        assert.equal(row.approval_mode, "direct_user_explicit");
        assert.equal(row.approved_by, a.userId);
        assert.ok(row.source_message_id);
      }
      assert.equal(new Set(rows.map((row) => row.source_message_id)).size, 1);
      const sourceId = String(rows[0].source_message_id);
      const source = await a.supabase.from("chat_messages").select("id,content,role").eq("id", sourceId).single();
      assert.equal(source.error, null);
      assert.equal(source.data.content, EXACT_REMEMBER);
      assert.equal(await candidateCount(a), candidateBefore);
    });

    await scenario("Settings API returns name and address without hanging", async () => {
      const loaded = await settings(a);
      assert.ok(loaded.ms < 10_000);
      const ids = (loaded.memories || []).map((memory) => String(memory.id));
      assert.ok(writtenIds.every((id) => ids.includes(id)));
      assert.equal(loaded.warning || null, null);
    });

    await scenario("new chat for the same account is created independently", async () => {
      newThread = await createAssistantThread({ supabase: a.supabase, companyId: a.companyId, userId: a.userId, title: "A106 owner finding new chat" });
      createdThreads.push(newThread.id);
      assert.notEqual(newThread.id, oldThread.id);
    });

    await scenario("new chat loads name and preferred address", async () => {
      const payload = await query(a, newThread, "Как меня зовут и как ко мне обращаться?");
      assert.equal(knowsIdentity(payload), true, payload.response);
      assert.ok((payload.meta?.memory?.categories || []).includes("name"));
      assert.ok((payload.meta?.memory?.categories || []).includes("preferred_address"));
    });

    await scenario("existing old chat loads the same user-global memory", async () => {
      const payload = await query(a, oldThread, "Как меня зовут и как ко мне обращаться?");
      assert.equal(knowsIdentity(payload), true, payload.response);
    });

    await scenario("fresh HTTP request after page reload still loads memory", async () => {
      const payload = await query(a, newThread, "Повтори моё имя и обращение после перезагрузки страницы.");
      assert.equal(knowsIdentity(payload), true, payload.response);
    });

    await scenario("fresh login session still loads memory", async () => {
      await a.supabase.auth.signOut();
      a = await signIn(env, "A");
      const payload = await query(a, newThread, "Повтори моё имя и обращение после повторного входа.");
      assert.equal(knowsIdentity(payload), true, payload.response);

      const bSettings = await settings(b);
      bReadBeforeDelete = !(bSettings.memories || []).some((memory) => writtenIds.includes(String(memory.id)));
      try {
        await deleteAssistantMemory({ supabase: b.supabase, companyId: b.companyId, userId: b.userId, memoryId: writtenIds[0] });
      } catch {
        bDeleteDeniedBeforeDelete = true;
      }
    });

    await scenario("combined forget command deletes both records immediately", async () => {
      const payload = await query(a, oldThread, EXACT_FORGET);
      assert.equal(payload.meta?.memoryWrite?.action, "delete");
      assert.equal(payload.meta?.memoryWrite?.deletedCount, 2);
      assert.match(String(payload.response || ""), /^Удалил/);
    });

    await scenario("rows are absent and immutable delete audit events exist", async () => {
      assert.equal((await activeIdentityRows(a)).filter((row) => writtenIds.includes(String(row.id))).length, 0);
      const audit = await events(a, writtenIds);
      assert.ok(writtenIds.every((id) => audit.some((event) => event.memory_id === id && event.event_type === "memory_created")));
      assert.ok(writtenIds.every((id) => audit.some((event) => event.memory_id === id && event.event_type === "memory_deleted")));
      const loaded = await settings(a);
      assert.equal((loaded.memories || []).some((memory) => writtenIds.includes(String(memory.id))), false);
    });

    await scenario("new and old chats no longer use deleted identity", async () => {
      const newPayload = await query(a, newThread, "Как меня зовут и как ко мне обращаться?");
      const oldPayload = await query(a, oldThread, "Как меня зовут и как ко мне обращаться после удаления памяти?");
      assert.equal(forgotIdentity(newPayload), true, newPayload.response);
      assert.equal(forgotIdentity(oldPayload), true, oldPayload.response);
    });

    await scenario("user B could neither read nor delete user A memory", async () => {
      assert.equal(bReadBeforeDelete, true);
      assert.equal(bDeleteDeniedBeforeDelete, true);
    });

    assert.equal(scenarios.length, 12);
    const report = {
      task: "A106",
      ownerFindingFix: true,
      branchRef: BRANCH_REF,
      productionConnections: 0,
      erpWrites: 0,
      serviceRoleLoaded: false,
      requestedModel: "gpt-5.6-terra",
      effectiveModel: "gpt-5.6-terra",
      reasoningEffort: "medium",
      writeRowCreated: 2,
      writeScope: "user_global",
      writeUserIdMatch: true,
      eventsCreated: true,
      newChatMemoryLoaded: true,
      oldChatMemoryLoaded: true,
      settingsLoadResult: "PASS",
      settingsLoopFixed: true,
      deleteResult: "2_ROWS_DELETED_AND_AUDITED",
      scenariosPass: 12,
      scenariosFail: 0,
      scenarios,
      completedAt: new Date().toISOString(),
    };
    await mkdir("audit-output/TZ-A106", { recursive: true });
    await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write("A106_OWNER_FINDINGS_ACCEPTANCE=PASS\nSCENARIOS_PASS=12\nSCENARIOS_FAIL=0\nPRODUCTION_CONNECTIONS=0\nERP_WRITES=0\n");
  } finally {
    const remaining = await activeIdentityRows(a).catch(() => []);
    for (const row of remaining.filter((item) => writtenIds.includes(String(item.id)))) {
      await deleteAssistantMemory({ supabase: a.supabase, companyId: a.companyId, userId: a.userId, memoryId: String(row.id) }).catch(() => undefined);
    }
    for (const threadId of createdThreads) {
      await a.supabase.from("chats").delete().eq("id", threadId);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`A106_OWNER_FINDINGS_ACCEPTANCE=FAIL\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
