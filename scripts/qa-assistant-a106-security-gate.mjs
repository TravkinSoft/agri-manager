import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const EXPECTED_BRANCH_REF = "gsglkmudcwkdetqtocae";
const PRODUCTION_REF = "bhsemlvmkikpntabctml";
const OUTPUT_DIR = "audit-output/TZ-A106";

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(`Missing ${key} in ignored .env.local`);
  return value;
}

function client(url, anonKey) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signIn(url, anonKey, email, password) {
  const supabase = client(url, anonKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user || !data.session) {
    throw new Error(`QA sign-in failed: ${error?.message || "session missing"}`);
  }
  return { supabase, userId: data.user.id };
}

function deniedOrZero(result) {
  return Boolean(result.error) || (Array.isArray(result.data) && result.data.length === 0);
}

async function main() {
  const env = parseEnv(await readFile(".env.local", "utf8"));
  const url = required(env, "A106_SUPABASE_URL");
  const anonKey = required(env, "A106_SUPABASE_ANON_KEY");
  assert.equal(required(env, "A106_BRANCH_REF"), EXPECTED_BRANCH_REF);
  assert.equal(url.includes(EXPECTED_BRANCH_REF), true);
  assert.equal(url.includes(PRODUCTION_REF), false);

  const a = await signIn(
    url,
    anonKey,
    required(env, "A106_TEST_USER_A_EMAIL"),
    required(env, "A106_TEST_USER_A_PASSWORD")
  );
  const b = await signIn(
    url,
    anonKey,
    required(env, "A106_TEST_USER_B_EMAIL"),
    required(env, "A106_TEST_USER_B_PASSWORD")
  );

  const profileA = await a.supabase.from("profiles").select("company_id,role,status,is_owner").eq("id", a.userId).single();
  const profileB = await b.supabase.from("profiles").select("company_id,role,status,is_owner").eq("id", b.userId).single();
  assert.equal(profileA.error, null);
  assert.equal(profileB.error, null);
  assert.equal(profileA.data.role, "agronomist");
  assert.equal(profileB.data.role, "agronomist");
  assert.equal(profileA.data.status, "active");
  assert.equal(profileB.data.status, "active");
  assert.equal(profileA.data.is_owner, false);
  assert.equal(profileB.data.is_owner, false);
  assert.notEqual(profileA.data.company_id, profileB.data.company_id);

  const ownChat = await a.supabase
    .from("chats")
    .insert({ user_id: a.userId, company_id: profileA.data.company_id, title: "A106 JWT security gate" })
    .select("id,user_id,company_id")
    .single();
  assert.equal(ownChat.error, null);

  const ownMessage = await a.supabase
    .from("chat_messages")
    .insert({ chat_id: ownChat.data.id, role: "user", content: "A106 security gate message" })
    .select("id,chat_id")
    .single();
  assert.equal(ownMessage.error, null);

  const tests = [];
  async function check(name, operation, predicate) {
    const started = performance.now();
    const result = await operation();
    const pass = predicate(result);
    tests.push({ name, pass, ms: performance.now() - started, detail: result.error ? "DENIED" : `${result.data?.length ?? 1} ROWS` });
    assert.equal(pass, true, name);
  }

  await check(
    "A reads own chat",
    () => a.supabase.from("chats").select("id").eq("id", ownChat.data.id),
    (result) => !result.error && result.data.length === 1
  );
  await check(
    "A reads own message",
    () => a.supabase.from("chat_messages").select("id").eq("id", ownMessage.data.id),
    (result) => !result.error && result.data.length === 1
  );
  await check(
    "B cannot read A chat",
    () => b.supabase.from("chats").select("id").eq("id", ownChat.data.id),
    deniedOrZero
  );
  await check(
    "B cannot read A message",
    () => b.supabase.from("chat_messages").select("id").eq("id", ownMessage.data.id),
    deniedOrZero
  );
  await check(
    "B cannot update A chat",
    () => b.supabase.from("chats").update({ title: "cross-tenant update" }).eq("id", ownChat.data.id).select("id"),
    deniedOrZero
  );
  await check(
    "B cannot insert message into A chat",
    () => b.supabase.from("chat_messages").insert({ chat_id: ownChat.data.id, role: "user", content: "blocked" }).select("id"),
    deniedOrZero
  );
  await check(
    "B cannot spoof A user and company",
    () => b.supabase.from("chats").insert({ user_id: a.userId, company_id: profileA.data.company_id, title: "blocked" }).select("id"),
    deniedOrZero
  );
  await check(
    "A cannot spoof B company",
    () => a.supabase.from("chats").insert({ user_id: a.userId, company_id: profileB.data.company_id, title: "blocked" }).select("id"),
    deniedOrZero
  );

  await mkdir(OUTPUT_DIR, { recursive: true });
  const csv = [
    "scenario,result,detail,latency_ms",
    ...tests.map((test) => `${JSON.stringify(test.name)},${test.pass ? "PASS" : "FAIL"},${test.detail},${test.ms.toFixed(2)}`),
  ].join("\n");
  await writeFile(`${OUTPUT_DIR}/real_jwt_rls_results.csv`, `${csv}\n`, "utf8");
  await writeFile(
    `${OUTPUT_DIR}/chat_policy_audit.md`,
    [
      "# A106 legacy chat policy audit",
      "",
      `- Test branch: ${EXPECTED_BRANCH_REF}`,
      "- Runtime identity: request-scoped JWT, ordinary agronomist users",
      "- Legacy permissive policies: constrained by restrictive owner/company policies",
      `- Real JWT scenarios: ${tests.filter((test) => test.pass).length}/${tests.length} PASS`,
      "- Cross-tenant chat/message reads: DENIED / 0 ROWS",
      "- Cross-tenant update and scope spoofing: DENIED / 0 ROWS",
      "- Production data-plane connections: 0",
    ].join("\n") + "\n",
    "utf8"
  );

  process.stdout.write(
    JSON.stringify({
      gate: "PASS",
      scenarios: tests.length,
      passed: tests.filter((test) => test.pass).length,
      branchRef: EXPECTED_BRANCH_REF,
      productionConnections: 0,
      productionWrites: 0,
      erpMutations: 0,
    }) + "\n"
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
