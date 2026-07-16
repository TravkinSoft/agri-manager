import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createAssistantThread } from "@/lib/assistant/threads-store";
import { hasLeadingAssistantGreeting } from "@/lib/assistant/v2/greeting-policy";

const BASE_URL = "http://127.0.0.1:3106";
const BRANCH_REF = "gsglkmudcwkdetqtocae";
const PRODUCTION_REF = "bhsemlvmkikpntabctml";
const OUTPUT = "audit-output/TZ-A106/greeting-policy-real-4-of-4.json";

type GreetingMeta = {
  priorMessageCount?: number;
  currentMessageIsGreeting?: boolean;
  greetingAllowed?: boolean;
  repeatedGreetingRemoved?: boolean;
};

type QueryPayload = {
  response?: string;
  meta?: { greetingPolicy?: GreetingMeta; llm?: { status?: string } };
  code?: string;
  error?: string;
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

async function query(params: { token: string; companyId: string; threadId: string; message: string }): Promise<QueryPayload> {
  const response = await fetch(`${BASE_URL}/api/assistant/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: params.message,
      threadId: params.threadId,
      companyId: params.companyId,
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
  assert.equal(payload.meta?.llm?.status, "ok");
  return payload;
}

async function main() {
  const env = parseEnv(await readFile(".env.local", "utf8"));
  const branchUrl = required(env, "A106_SUPABASE_URL");
  assert.equal(required(env, "A106_BRANCH_REF"), BRANCH_REF);
  assert.ok(branchUrl.includes(BRANCH_REF));
  assert.equal(branchUrl.includes(PRODUCTION_REF), false);
  assert.equal(String(process.env.SUPABASE_SERVICE_ROLE_KEY || ""), "");

  const supabase = createClient(branchUrl, required(env, "A106_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const auth = await supabase.auth.signInWithPassword({
    email: required(env, "A106_TEST_USER_A_EMAIL"),
    password: required(env, "A106_TEST_USER_A_PASSWORD"),
  });
  if (auth.error || !auth.data.user || !auth.data.session) throw new Error(`QA A sign-in failed: ${auth.error?.message || "session missing"}`);
  const profile = await supabase.from("profiles").select("company_id,status").eq("id", auth.data.user.id).single();
  if (profile.error || !profile.data?.company_id || profile.data.status !== "active") throw new Error("QA A profile unavailable");

  const identity = {
    token: auth.data.session.access_token,
    userId: auth.data.user.id,
    companyId: String(profile.data.company_id),
  };
  const first = await createAssistantThread({ supabase, companyId: identity.companyId, userId: identity.userId, title: "A106 greeting regression A" });
  const second = await createAssistantThread({ supabase, companyId: identity.companyId, userId: identity.userId, title: "A106 greeting regression B" });
  const createdThreads = [first.id, second.id];
  const scenarios: Array<{ number: number; name: string; status: "PASS" }> = [];

  async function scenario(name: string, operation: () => Promise<void>) {
    await operation();
    const item = { number: scenarios.length + 1, name, status: "PASS" as const };
    scenarios.push(item);
    console.log(`PASS ${item.number}/4: ${name}`);
  }

  try {
    await scenario("Привет -> greeting exists", async () => {
      const payload = await query({ ...identity, threadId: first.id, message: "Привет" });
      assert.equal(payload.meta?.greetingPolicy?.greetingAllowed, true);
      assert.equal(hasLeadingAssistantGreeting(payload.response || ""), true);
    });

    await scenario("Что ты умеешь? -> no repeated greeting", async () => {
      const payload = await query({ ...identity, threadId: first.id, message: "Что ты умеешь?" });
      assert.equal(payload.meta?.greetingPolicy?.greetingAllowed, false);
      assert.equal(hasLeadingAssistantGreeting(payload.response || ""), false);
    });

    await scenario("Какие данные компании? -> no repeated greeting", async () => {
      const payload = await query({ ...identity, threadId: first.id, message: "Какие данные компании?" });
      assert.equal(payload.meta?.greetingPolicy?.greetingAllowed, false);
      assert.equal(hasLeadingAssistantGreeting(payload.response || ""), false);
    });

    await scenario("new chat -> greeting is allowed again", async () => {
      const payload = await query({ ...identity, threadId: second.id, message: "Привет" });
      assert.equal(payload.meta?.greetingPolicy?.priorMessageCount, 0);
      assert.equal(payload.meta?.greetingPolicy?.greetingAllowed, true);
      assert.equal(hasLeadingAssistantGreeting(payload.response || ""), true);
    });

    await mkdir("audit-output/TZ-A106", { recursive: true });
    await writeFile(OUTPUT, `${JSON.stringify({
      task: "A106",
      branchRef: BRANCH_REF,
      productionConnections: 0,
      erpWrites: 0,
      serviceRoleLoaded: false,
      openAiMode: "REAL",
      scenariosPass: scenarios.length,
      scenariosFail: 0,
      scenarios,
      completedAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
    console.log("A106_REAL_GREETING_ACCEPTANCE=PASS");
    console.log(`SCENARIOS_PASS=${scenarios.length}`);
    console.log("SCENARIOS_FAIL=0");
    console.log("PRODUCTION_CONNECTIONS=0");
    console.log("ERP_WRITES=0");
  } finally {
    for (const threadId of createdThreads) {
      await supabase.from("chats").delete().eq("id", threadId);
    }
  }
}

main().catch((error) => {
  console.error(`A106_REAL_GREETING_ACCEPTANCE=FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
