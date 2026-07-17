import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import fixture from "./fixtures/assistant-qa-reference-baseline.json";

const BRANCH_REF = "gsglkmudcwkdetqtocae";
const PRODUCTION_REF = String(fixture.productionRef);
const COMPANY_A = String(fixture.users.a.companyId);
const COMPANY_B = String(fixture.users.b.companyId);
const MOJIBAKE = /(?:Ã|Â|Ð|Ñ|�|Рџ|Р РµР¶)/u;

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  assert(value, `${name} is required`);
  return value;
}

function assertSafeTarget(previewUrl: string, supabaseUrl: string) {
  const app = new URL(previewUrl);
  const database = new URL(supabaseUrl);
  assert(
    app.hostname === "localhost" || app.hostname === "127.0.0.1" || app.hostname.endsWith(".vercel.app"),
    "CORE_PREVIEW_URL must target localhost or a Vercel preview"
  );
  assert(!app.hostname.includes("agri-manager-eight"), "Production app URL is forbidden");
  assert.equal(database.hostname, `${BRANCH_REF}.supabase.co`, "Exact Assistant QA Supabase branch is required");
  assert(!supabaseUrl.includes(PRODUCTION_REF), "Production Supabase ref is forbidden");
}

function assertCleanPayload(label: string, value: unknown) {
  const text = JSON.stringify(value);
  assert(!text.includes("Supabase service credentials are not configured"), `${label}: service credential error`);
  assert(!MOJIBAKE.test(text), `${label}: mojibake detected`);
}

async function requestJson(params: {
  previewUrl: string;
  path: string;
  token: string;
  expectedStatus?: number;
}) {
  const response = await fetch(new URL(params.path, params.previewUrl), {
    method: "GET",
    headers: { Authorization: `Bearer ${params.token}` },
    redirect: "manual",
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.status, params.expectedStatus ?? 200, `${params.path}: ${response.status} ${JSON.stringify(payload)}`);
  assertCleanPayload(params.path, payload);
  return payload as Record<string, any>;
}

async function getAccessToken(supabaseUrl: string, publishableKey: string): Promise<string> {
  const suppliedToken = String(process.env.CORE_PREVIEW_ACCESS_TOKEN || "").trim();
  if (suppliedToken) return suppliedToken;

  const email = requiredEnv("CORE_PREVIEW_QA_EMAIL");
  const password = requiredEnv("CORE_PREVIEW_QA_PASSWORD");
  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  assert(data.session?.access_token, "QA password login did not return an access token");
  return data.session.access_token;
}

async function main() {
  const previewUrl = requiredEnv("CORE_PREVIEW_URL");
  const supabaseUrl = requiredEnv("CORE_PREVIEW_SUPABASE_URL");
  const publishableKey = requiredEnv("CORE_PREVIEW_SUPABASE_PUBLISHABLE_KEY");
  assertSafeTarget(previewUrl, supabaseUrl);

  const token = await getAccessToken(supabaseUrl, publishableKey);
  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError) throw userError;
  assert.equal(userData.user?.id, fixture.users.a.id, "Smoke must run as QA User A");

  const crop = await requestJson({
    previewUrl,
    token,
    path: `/api/crop-structure/bootstrap?companyId=${encodeURIComponent(COMPANY_A)}`,
  });
  assert.equal(crop.companyId, COMPANY_A);
  assert.equal(crop.cropStructure?.length, 9, "Crop structure must contain 9 rows");

  const warehouses = await requestJson({
    previewUrl,
    token,
    path: `/api/warehouses?companyId=${encodeURIComponent(COMPANY_A)}`,
  });
  assert.equal(warehouses.warehouses?.length, 2, "Warehouse page must contain 2 warehouses");

  const balances = await requestJson({
    previewUrl,
    token,
    path: `/api/warehouses/balances?companyId=${encodeURIComponent(COMPANY_A)}&language=ru`,
  });
  const balanceRows = Array.isArray(balances.balances)
    ? (balances.balances as Array<Record<string, unknown>>)
    : [];
  const totals = balanceRows.reduce((acc: Record<string, number>, row) => {
    const key = `${String(row.product_name)}|${String(row.unit)}`;
    acc[key] = (acc[key] || 0) + Number(row.quantity || 0);
    return acc;
  }, {});
  assert.equal(totals["Аммиачная селитра|kg"], 1550);
  assert.equal(totals["Curamin Foliar|l"], 520);
  assert.equal(totals["Phomazin|l"], 200);

  const { data: operations, error: operationsError } = await userClient
    .from("operations")
    .select("id,company_id")
    .eq("company_id", COMPANY_A)
    .eq("archived", false)
    .order("created_at", { ascending: true });
  if (operationsError) throw operationsError;
  assert.equal(operations?.length, 5, "Operations page must load 5 operations");
  assert(operations?.[0]?.id, "An operation is required for the detail-card smoke");

  const operationDetails = await requestJson({
    previewUrl,
    token,
    path: `/api/operations/${encodeURIComponent(String(operations[0].id))}/lines?companyId=${encodeURIComponent(COMPANY_A)}`,
  });
  assert(Array.isArray(operationDetails.operation_lines), "Operation detail lines must load as an array");

  const { data: crossCompanyOperations, error: crossCompanyError } = await userClient
    .from("operations")
    .select("id")
    .eq("company_id", COMPANY_B);
  if (crossCompanyError) throw crossCompanyError;
  assert.equal(crossCompanyOperations?.length, 0, "QA User A must not see company B operations");

  await requestJson({
    previewUrl,
    token,
    path: `/api/crop-structure/bootstrap?companyId=${encodeURIComponent(COMPANY_B)}`,
    expectedStatus: 403,
  });
  await requestJson({
    previewUrl,
    token,
    path: `/api/warehouses?companyId=${encodeURIComponent(COMPANY_B)}`,
    expectedStatus: 403,
  });

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        branchRef: BRANCH_REF,
        serviceRoleUsed: false,
        productionConnections: 0,
        erpWrites: 0,
        cropStructureRows: crop.cropStructure.length,
        warehouses: warehouses.warehouses.length,
        balances: totals,
        operations: operations.length,
        operationDetails: "PASS",
        crossCompanyDenied: true,
        mojibake: 0,
        errorBannerPayloads: 0,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
