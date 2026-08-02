import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAssistantThread, type AssistantThreadRecord } from "@/lib/assistant/threads-store";

const BRANCH_REF = "gsglkmudcwkdetqtocae";
const BRANCH_HOSTNAME = `${BRANCH_REF}.supabase.co`;
const COMPANY_A_ID = "8a0f2c0e-6638-4a31-99a8-cab4237d287d";
const COMPANY_B_ID = "4e65767a-9527-4e7f-afea-ec2426ec0193";
const USER_A_ID = "49a8ee17-7e28-49f5-a674-060ff277aa63";
const BASE_URL = String(process.env.A109_BASE_URL || "http://127.0.0.1:3109").replace(/\/$/, "");
const AUDIT_DIR = "audit-output/TZ-A109";

type Identity = {
  supabase: SupabaseClient;
  accessToken: string;
  userId: string;
  companyId: string;
};

type ToolCall = {
  tool: string;
  ok: boolean;
  rows?: number;
  params?: Record<string, unknown>;
  error?: string;
};

type QueryPayload = {
  response?: string;
  messageIds?: { assistant?: string };
  meta?: {
    llm?: { status?: string };
    readOnlyRuntime?: {
      requestedModel?: string;
      effectiveModel?: string;
      effectiveReasoning?: string;
      runtimeMode?: string;
      openAiEndpoint?: string;
    };
  };
  error?: string;
  code?: string;
};

type Result = {
  scenario: string;
  prompt: string;
  answer: string;
  tools: ToolCall[];
  status: "PASS" | "FAIL";
  failures: string[];
};

async function readSelectedQaEnv(): Promise<Record<string, string>> {
  const allowed = new Set([
    "A106_SUPABASE_URL",
    "A106_SUPABASE_ANON_KEY",
    "A106_TEST_USER_A_EMAIL",
    "A106_TEST_USER_A_PASSWORD",
  ]);
  const selected: Record<string, string> = {};
  const lines = createInterface({
    input: createReadStream(".env.local", { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const name = line.slice(0, index).trim();
    if (!allowed.has(name)) continue;
    selected[name] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return selected;
}

function required(env: Record<string, string>, name: string): string {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`Missing ${name} in ignored .env.local`);
  return value;
}

function normalized(value: unknown): string {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
}

function compactIdentity(value: unknown): string {
  return normalized(value).replace(/\s+/g, "");
}

function hasNumber(answer: string, number: number): boolean {
  const digits = String(number).split("").join("[\\s\\u00a0.,]*");
  return new RegExp(`(^|\\D)${digits}(?!\\d)`).test(answer);
}

function assertSafeProcess(): void {
  assert.equal(process.env.A109_BRANCH_REF, BRANCH_REF);
  for (const name of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_ADMIN_KEY",
    "DATABASE_URL",
    "DIRECT_URL",
    "POSTGRES_URL",
    "PGHOST",
    "PGUSER",
    "PGPASSWORD",
  ]) {
    assert.equal(String(process.env[name] || "").trim(), "", `${name} must not be loaded`);
  }
}

async function signIn(env: Record<string, string>): Promise<Identity> {
  const url = required(env, "A106_SUPABASE_URL");
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, BRANCH_HOSTNAME);
  const supabase = createClient(url, required(env, "A106_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const auth = await supabase.auth.signInWithPassword({
    email: required(env, "A106_TEST_USER_A_EMAIL"),
    password: required(env, "A106_TEST_USER_A_PASSWORD"),
  });
  if (auth.error || !auth.data.user || !auth.data.session) {
    throw new Error(`QA User A sign-in failed: ${auth.error?.message || "session missing"}`);
  }
  const profile = await supabase
    .from("profiles")
    .select("company_id,status")
    .eq("id", auth.data.user.id)
    .single();
  if (profile.error || profile.data?.status !== "active") throw new Error("QA User A profile unavailable");
  assert.equal(auth.data.user.id, USER_A_ID);
  assert.equal(profile.data?.company_id, COMPANY_A_ID);
  return {
    supabase,
    accessToken: auth.data.session.access_token,
    userId: auth.data.user.id,
    companyId: String(profile.data.company_id),
  };
}

async function erpSnapshot(identity: Identity): Promise<string> {
  const queries = await Promise.all([
    identity.supabase.from("fields").select("id,name,area,archived").eq("company_id", identity.companyId).order("id"),
    identity.supabase.from("crop_structure").select("id,field_id,crop_id,variety_id,area,archived").eq("company_id", identity.companyId).order("id"),
    identity.supabase.from("operations").select("id,field_id,operation_type,status,work_status,archived").eq("company_id", identity.companyId).order("id"),
    identity.supabase.from("warehouses").select("id,name,archived").eq("company_id", identity.companyId).order("id"),
    identity.supabase.from("stock_ledger_entries").select("id,warehouse_id,product_id,direction,quantity,delta_qty_signed,uom,is_storno").eq("company_id", identity.companyId).order("id"),
  ]);
  for (const query of queries) {
    if (query.error) throw new Error(`ERP snapshot failed: ${query.error.message}`);
  }
  return JSON.stringify(queries.map((query) => query.data || []));
}

async function persistedToolCalls(identity: Identity, messageId: string): Promise<ToolCall[]> {
  const row = await identity.supabase.from("chat_messages").select("metadata").eq("id", messageId).single();
  if (row.error) throw new Error(`Tool trace read failed: ${row.error.message}`);
  const metadata = row.data?.metadata && typeof row.data.metadata === "object"
    ? row.data.metadata as Record<string, unknown>
    : {};
  return Array.isArray(metadata.tool_calls) ? metadata.tool_calls as ToolCall[] : [];
}

async function sendQuery(
  identity: Identity,
  thread: AssistantThreadRecord,
  message: string
): Promise<{ answer: string; tools: ToolCall[]; payload: QueryPayload }> {
  const response = await fetch(`${BASE_URL}/api/assistant/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${identity.accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
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
    signal: AbortSignal.timeout(180_000),
  });
  const payload = await response.json().catch(() => ({})) as QueryPayload;
  if (!response.ok) {
    throw new Error(`Query failed ${response.status}: ${payload.code || "unknown"} ${payload.error || ""}`);
  }
  const messageId = String(payload.messageIds?.assistant || "");
  if (!messageId) throw new Error("Assistant message id missing");
  return {
    answer: String(payload.response || ""),
    tools: await persistedToolCalls(identity, messageId),
    payload,
  };
}

function hasNoFieldFilter(call: ToolCall | undefined): boolean {
  const params = call?.params || {};
  return !params.field_id && !params.field && !params.number && !params.name;
}

async function main(): Promise<void> {
  assertSafeProcess();
  const env = await readSelectedQaEnv();
  const identity = await signIn(env);
  const snapshotBefore = await erpSnapshot(identity);
  const fieldRows = await identity.supabase
    .from("fields")
    .select("name")
    .eq("company_id", identity.companyId)
    .eq("archived", false)
    .order("name");
  if (fieldRows.error) throw new Error(`Field ground truth failed: ${fieldRows.error.message}`);
  const fieldNames = (fieldRows.data || []).map((row) => String(row.name || "")).filter(Boolean);
  assert.equal(fieldNames.length, 8);

  const createdThreadIds: string[] = [];
  const results: Result[] = [];
  let requestedModel: string | null = null;
  let effectiveModel: string | null = null;
  let reasoning: string | null = null;
  const createThread = async (title: string) => {
    const thread = await createAssistantThread({
      supabase: identity.supabase,
      companyId: identity.companyId,
      userId: identity.userId,
      title,
    });
    createdThreadIds.push(thread.id);
    return thread;
  };
  const check = async (
    scenario: string,
    thread: AssistantThreadRecord,
    prompt: string,
    validate: (answer: string, tools: ToolCall[]) => string[]
  ) => {
    const queried = await sendQuery(identity, thread, prompt);
    requestedModel ||= queried.payload.meta?.readOnlyRuntime?.requestedModel || null;
    effectiveModel ||= queried.payload.meta?.readOnlyRuntime?.effectiveModel || null;
    reasoning ||= queried.payload.meta?.readOnlyRuntime?.effectiveReasoning || null;
    const failures = [
      ...(queried.payload.meta?.llm?.status === "ok" || queried.payload.meta?.llm?.status === "not_called"
        ? []
        : [`llm_status=${queried.payload.meta?.llm?.status || "missing"}`]),
      ...validate(queried.answer, queried.tools),
    ];
    results.push({
      scenario,
      prompt,
      answer: queried.answer,
      tools: queried.tools,
      status: failures.length ? "FAIL" : "PASS",
      failures,
    });
    process.stdout.write(`${failures.length ? "FAIL" : "PASS"}: ${scenario}${failures.length ? ` :: ${failures.join("; ")}` : ""}\n`);
  };

  try {
    const chain = await createThread("A109 critical scope chain");
    await check("1/4 explicit Field15", chain, "Что по 15 полю?", (answer, tools) => [
      normalized(answer).includes("15") ? "" : "answer_missing_field_15",
      normalized(answer).includes("заплан") ? "" : "planned_status_missing",
      normalized(answer).includes("выполняется сейчас") || normalized(answer).includes("активная операция") ? "planned_rendered_as_active" : "",
      tools.some((tool) => tool.tool === "get_field_card" && tool.ok) ? "" : "field_card_missing",
      tools.some((tool) => tool.tool === "get_warehouse_stock") ? "unexpected_warehouse_tool" : "",
    ].filter(Boolean));
    await check("2/4 company field count", chain, "Сколько полей в хозяйстве?", (answer, tools) => [
      hasNumber(answer, 8) ? "" : "answer_not_8",
      tools.some((tool) => tool.tool === "get_field_land_bank_summary" && tool.ok) ? "" : "land_bank_tool_missing",
    ].filter(Boolean));
    await check("3/4 list after count", chain, "Какие это поля?", (answer, tools) => {
      const search = tools.find((tool) => tool.tool === "search_fields" && tool.ok);
      return [
        search?.rows === 8 ? "" : `field_rows=${search?.rows ?? 0}`,
        hasNoFieldFilter(search) ? "" : "stale_field_filter",
        fieldNames.every((name) => compactIdentity(answer).includes(compactIdentity(name))) ? "" : "field_names_incomplete",
      ].filter(Boolean);
    });
    await check("4/4 company active operations", chain, "Какие операции идут сейчас?", (answer, tools) => {
      const operations = tools.find((tool) => tool.tool === "get_active_operations_summary" && tool.ok);
      return [
        hasNoFieldFilter(operations) ? "" : "stale_field_filter",
        normalized(answer).includes("28") && normalized(answer).includes("сад южный") ? "" : "company_operations_incomplete",
        /(^|\D)поле\s*15(\D|$)/iu.test(normalized(answer)) ? "planned_field_15_in_active_list" : "",
        operations?.rows === 2 ? "" : `active_operation_rows=${operations?.rows ?? 0}`,
      ].filter(Boolean);
    });

    const followUp = await createThread("A109 explicit follow-up");
    await check("follow-up field selection", followUp, "Что по 15 полю?", (answer) => normalized(answer).includes("15") ? [] : ["answer_missing_field_15"]);
    await check("follow-up crop", followUp, "А культура?", (answer, tools) => [
      normalized(answer).includes("соя") ? "" : "crop_missing",
      tools.some((tool) => tool.tool === "get_field_card" && tool.ok) ? "" : "field_card_missing",
    ].filter(Boolean));
    await check("follow-up area", followUp, "А площадь?", (answer, tools) => [
      hasNumber(answer, 125) ? "" : "area_missing",
      tools.some((tool) => tool.tool === "get_field_card" && tool.ok) ? "" : "field_card_missing",
    ].filter(Boolean));
    await check("follow-up operations", followUp, "А какие там операции?", (answer, tools) => [
      normalized(answer).includes("15") ? "" : "field_15_operation_missing",
      tools.some((tool) => tool.tool === "get_active_operations_summary" && tool.ok) ? "" : "operations_tool_missing",
    ].filter(Boolean));

    for (const variant of ["курмаина", "курамин", "фолиар", "Curamin"]) {
      const productThread = await createThread(`A109 fuzzy ${variant}`);
      await check(`fuzzy product: ${variant}`, productThread, `Сколько ${variant}?`, (answer, tools) => [
        normalized(answer).includes("curamin foliar") ? "" : "canonical_name_missing",
        hasNumber(answer, 520) ? "" : "total_520_missing",
        tools.some((tool) => tool.tool === "get_warehouse_stock" && tool.ok) ? "" : "warehouse_tool_missing",
      ].filter(Boolean));
    }

    const crossCompany = await identity.supabase
      .from("fields")
      .select("id", { count: "exact", head: true })
      .eq("company_id", COMPANY_B_ID);
    assert.equal(crossCompany.error, null);
    assert.equal(crossCompany.count, 0);
    assert.equal(await erpSnapshot(identity), snapshotBefore, "ERP snapshot changed during A109 acceptance");
    assert.equal(requestedModel, "gpt-5.6-terra");
    assert.equal(effectiveModel, "gpt-5.6-terra");
    assert.equal(reasoning, "medium");

    const passed = results.filter((result) => result.status === "PASS").length;
    const failed = results.length - passed;
    const summary = {
      task: "A109",
      status: failed === 0 ? "PASS" : "FAIL",
      branchRef: BRANCH_REF,
      scenariosTotal: results.length,
      scenariosPass: passed,
      scenariosFail: failed,
      criticalChain: results.slice(0, 4).every((result) => result.status === "PASS") ? "4/4 PASS" : "FAIL",
      requestedModel,
      effectiveModel,
      reasoning,
      productionConnections: 0,
      serviceRoleLoaded: false,
      erpWrites: 0,
      crossCompanyLeaks: 0,
      responseStore: false,
      results,
    };
    await mkdir(AUDIT_DIR, { recursive: true });
    await writeFile(`${AUDIT_DIR}/real-acceptance.json`, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ ...summary, results: undefined }, null, 2)}\n`);
    if (failed) process.exitCode = 1;
  } finally {
    for (const id of createdThreadIds) {
      const deleted = await identity.supabase.from("chats").delete().eq("id", id);
      if (deleted.error) process.stderr.write(`A109 cleanup warning: ${deleted.error.message}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`A109_REAL_ACCEPTANCE=FAIL\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
