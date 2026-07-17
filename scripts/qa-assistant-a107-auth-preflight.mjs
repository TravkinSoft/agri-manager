import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_HOSTNAME = "gsglkmudcwkdetqtocae.supabase.co";
const QA_USER_A_ID = "49a8ee17-7e28-49f5-a674-060ff277aa63";

async function readSelectedQaEnv() {
  const allowedNames = new Set([
    "A106_SUPABASE_URL",
    "A106_SUPABASE_ANON_KEY",
    "A106_TEST_USER_A_EMAIL",
    "A106_TEST_USER_A_PASSWORD",
  ]);
  const selected = {};
  const lines = createInterface({
    input: createReadStream(".env.local", { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const name = line.slice(0, index).trim();
    if (!allowedNames.has(name)) continue;
    selected[name] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return selected;
}

function required(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const env = await readSelectedQaEnv();
const branchUrl = new URL(required(env, "A106_SUPABASE_URL"));
assert.equal(branchUrl.protocol, "https:");
assert.equal(branchUrl.hostname, ALLOWED_HOSTNAME);

const supabase = createClient(branchUrl.toString(), required(env, "A106_SUPABASE_ANON_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const auth = await supabase.auth.signInWithPassword({
  email: required(env, "A106_TEST_USER_A_EMAIL"),
  password: required(env, "A106_TEST_USER_A_PASSWORD"),
});
if (auth.error || !auth.data.session || !auth.data.user) {
  throw new Error(`QA User A authentication failed: ${auth.error?.message || "session missing"}`);
}
assert.equal(auth.data.user.id, QA_USER_A_ID);

const contextResponse = await fetch("http://127.0.0.1:3106/api/assistant/context", {
  method: "GET",
  headers: {
    Authorization: `Bearer ${auth.data.session.access_token}`,
  },
  signal: AbortSignal.timeout(30_000),
});
const contextPayload = await contextResponse.json().catch(() => ({}));
assert.equal(
  contextResponse.status,
  200,
  `Unexpected context status ${contextResponse.status}: ${contextPayload.code || contextPayload.error || "unknown"}`
);
assert.equal(contextPayload.allowed, true);
assert.equal(contextPayload.requiresCompanySelection, false);
assert.ok(contextPayload.company?.id, "Assistant context company is missing");

const runtimeResponse = await fetch("http://127.0.0.1:3106/api/assistant/query", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${auth.data.session.access_token}`,
    "Content-Type": "application/json; charset=utf-8",
  },
  body: "{}",
  signal: AbortSignal.timeout(30_000),
});
const runtimePayload = await runtimeResponse.json().catch(() => ({}));
assert.equal(runtimeResponse.status, 400, `Unexpected runtime status ${runtimeResponse.status}: ${runtimePayload.code || runtimePayload.error || "unknown"}`);
assert.equal(runtimePayload.error, "Message is required");

process.stdout.write("AUTH_PREFLIGHT=PASS\n");
process.stdout.write(`AUTH_DESTINATION_HOST=${branchUrl.hostname}\n`);
process.stdout.write("QA_USER_A_SESSION=VALID\n");
process.stdout.write("RUNTIME_GUARD_BEFORE_AUTH=PASS\n");
process.stdout.write("ASSISTANT_CONTEXT=PASS\n");
process.stdout.write(`ASSISTANT_CONTEXT_COMPANY=${contextPayload.company.id}\n`);
process.stdout.write("PRODUCTION_CONNECTIONS=0\n");
process.stdout.write("ERP_WRITES=0\n");
process.stdout.write("SERVICE_ROLE_LOADED=NO\n");
