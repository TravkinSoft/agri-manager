import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { createAssistantThread } from "@/lib/assistant/threads-store";

const BRANCH_REF = "gsglkmudcwkdetqtocae";
const BRANCH_HOSTNAME = `${BRANCH_REF}.supabase.co`;
const USER_A_ID = "49a8ee17-7e28-49f5-a674-060ff277aa63";
const BASE_URL = "http://127.0.0.1:3106";

async function readSelectedQaEnv(): Promise<Record<string, string>> {
  const allowedNames = new Set([
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
    if (!allowedNames.has(name)) continue;
    selected[name] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return selected;
}

function required(env: Record<string, string>, name: string): string {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`Missing ${name} in ignored .env.local`);
  return value;
}

function safeProductIdentity(row: Record<string, unknown>): Record<string, unknown> {
  const safeKeys = Object.keys(row).filter((key) =>
    /^(id|company_id|name|name_ru|name_kz|name_en|trade_name|canonical_name|slug|aliases|alias|synonyms|unit|base_uom|default_unit|stock_unit|archived|is_active)$/i.test(key)
  );
  return Object.fromEntries(safeKeys.map((key) => [key, row[key]]));
}

function normalized(value: unknown): string {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[.,!?;:()"'`]+/g, " ")
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
}

function includesNumber(answer: string, value: number): boolean {
  const digits = String(value).split("").join("[\\s\\u00a0.,]*");
  return new RegExp(`(^|\\D)${digits}(?!\\d)`).test(answer);
}

async function main() {
  const env = await readSelectedQaEnv();
  const branchUrl = new URL(required(env, "A106_SUPABASE_URL"));
  assert.equal(branchUrl.protocol, "https:");
  assert.equal(branchUrl.hostname, BRANCH_HOSTNAME);
  const supabase = createClient(branchUrl.toString(), required(env, "A106_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const auth = await supabase.auth.signInWithPassword({
    email: required(env, "A106_TEST_USER_A_EMAIL"),
    password: required(env, "A106_TEST_USER_A_PASSWORD"),
  });
  if (auth.error || !auth.data.user || !auth.data.session) {
    throw new Error(`QA User A sign-in failed: ${auth.error?.message || "session missing"}`);
  }
  assert.equal(auth.data.user.id, USER_A_ID);
  const profile = await supabase.from("profiles").select("company_id,status").eq("id", USER_A_ID).single();
  if (profile.error || !profile.data?.company_id || profile.data.status !== "active") {
    throw new Error(`QA User A profile unavailable: ${profile.error?.message || "inactive"}`);
  }

  const balances = await supabase
    .from("v_stock_balance_identity")
    .select("warehouse_id,product_id,quantity")
    .eq("company_id", profile.data.company_id)
    .gt("quantity", 0)
    .limit(500);
  if (balances.error) throw new Error(`Stock identity audit failed: ${balances.error.message}`);
  const productIds = Array.from(new Set((balances.data || []).map((row) => String(row.product_id || "")).filter(Boolean)));
  const products = productIds.length
    ? await supabase.from("products").select("*").in("id", productIds)
    : { data: [], error: null };
  if (products.error) throw new Error(`Product alias audit failed: ${products.error.message}`);

  const warehouses = await supabase
    .from("warehouses")
    .select("id,name,archived")
    .eq("company_id", profile.data.company_id)
    .eq("archived", false)
    .order("name");
  if (warehouses.error) throw new Error(`Warehouse audit failed: ${warehouses.error.message}`);

  const fields = await supabase
    .from("fields")
    .select("id,name,area,archived")
    .eq("company_id", profile.data.company_id)
    .eq("archived", false)
    .order("name");
  if (fields.error) throw new Error(`Field audit failed: ${fields.error.message}`);
  const season = await supabase
    .from("seasons")
    .select("id,year")
    .eq("company_id", profile.data.company_id)
    .eq("year", 2026)
    .limit(1)
    .maybeSingle();
  if (season.error || !season.data?.id) throw new Error(`Season 2026 audit failed: ${season.error?.message || "missing"}`);
  const allocations = await supabase
    .from("crop_structure")
    .select("field_id,crop_id,variety_id,area,archived")
    .eq("company_id", profile.data.company_id)
    .eq("season_id", season.data.id)
    .eq("archived", false);
  if (allocations.error) throw new Error(`Crop structure audit failed: ${allocations.error.message}`);
  const cropIds = Array.from(new Set((allocations.data || []).map((row) => String(row.crop_id || "")).filter(Boolean)));
  const varietyIds = Array.from(new Set((allocations.data || []).map((row) => String(row.variety_id || "")).filter(Boolean)));
  const crops = cropIds.length
    ? await supabase.from("crops").select("id,name,name_ru").in("id", cropIds)
    : { data: [], error: null };
  const varieties = varietyIds.length
    ? await supabase.from("varieties").select("id,name,name_ru").in("id", varietyIds)
    : { data: [], error: null };
  if (crops.error) throw new Error(`Crop lookup audit failed: ${crops.error.message}`);
  if (varieties.error) throw new Error(`Variety lookup audit failed: ${varieties.error.message}`);
  const cropNames = new Map((crops.data || []).map((row) => [String(row.id), String(row.name_ru || row.name || row.id)]));
  const varietyNames = new Map((varieties.data || []).map((row) => [String(row.id), String(row.name_ru || row.name || row.id)]));

  const erpSnapshot = JSON.stringify({
    warehouses: warehouses.data || [],
    fields: fields.data || [],
    allocations: allocations.data || [],
    balances: balances.data || [],
    products: products.data || [],
  });

  process.stdout.write(`SUPABASE_BRANCH_REF=${BRANCH_REF}\n`);
  process.stdout.write("SERVICE_ROLE_LOADED=NO\n");
  process.stdout.write("PRODUCTION_CONNECTIONS=0\n");
  process.stdout.write(`WAREHOUSE_ROWS=${JSON.stringify(warehouses.data || [])}\n`);
  const safeProducts = (products.data || []).map((row) => safeProductIdentity(row as Record<string, unknown>));
  const curaminRows = safeProducts.filter((row) => JSON.stringify(row).toLocaleLowerCase("ru-RU").includes("curamin"));
  const localizedAliasPresent = curaminRows.some((row) => /курамин|фолиар/iu.test(String(row.name_ru || "")));
  process.stdout.write(`STOCK_PRODUCT_ROWS=${JSON.stringify(safeProducts)}\n`);
  process.stdout.write(`CURAMIN_ROWS=${JSON.stringify(curaminRows)}\n`);
  process.stdout.write(`CURAMIN_RU_ALIAS_PRESENT=${localizedAliasPresent ? "YES" : "NO"}\n`);

  assert.equal(warehouses.data?.length, 2);
  assert.equal(fields.data?.length, 8);
  const createdThreadIds: string[] = [];
  const runAssistantScenario = async (label: string, prompt: string) => {
    const thread = await createAssistantThread({
      supabase,
      companyId: String(profile.data.company_id),
      userId: USER_A_ID,
      title: `A107 owner ${label}`,
    });
    createdThreadIds.push(thread.id);
    const response = await fetch(`${BASE_URL}/api/assistant/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.data.session.access_token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        message: prompt,
        threadId: thread.id,
        companyId: profile.data.company_id,
        runtimeContext: {
          currentPage: "warehouses",
          currentRoute: "/warehouses",
          currentModule: "warehouses",
          season: "2026",
          defaultSeason: "2026",
          locale: "ru",
        },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await response.json().catch(() => ({})) as any;
    assert.equal(response.status, 200, `${label}: ${payload.code || payload.error || response.status}`);
    assert.equal(payload.meta?.llm?.status, "ok", `${label}: LLM status ${payload.meta?.llm?.status}`);
    assert.equal(payload.meta?.readOnlyRuntime?.effectiveModel, "gpt-5.6-terra");
    assert.equal(payload.meta?.readOnlyRuntime?.effectiveReasoning, "medium");
    const answer = String(payload.response || "");
    const assistantMessageId = String(payload.messageIds?.assistant || "");
    assert.ok(assistantMessageId, `${label}: assistant message id missing`);
    const trace = await supabase.from("chat_messages").select("metadata").eq("id", assistantMessageId).single();
    if (trace.error) throw new Error(`${label}: trace unavailable: ${trace.error.message}`);
    const metadata = trace.data?.metadata && typeof trace.data.metadata === "object" ? trace.data.metadata as Record<string, unknown> : {};
    const tools = Array.isArray(metadata.tool_calls) ? metadata.tool_calls as Array<Record<string, unknown>> : [];
    assert.equal(tools.length, 1, `${label}: expected one tool, got ${tools.length}`);
    assert.equal(tools[0]?.tool, label === "fields" ? "search_fields" : "get_warehouse_stock");
    assert.equal(tools[0]?.ok, true, `${label}: tool failed`);
    process.stdout.write(`ANSWER_${label.toUpperCase()}=${answer.replace(/\s+/g, " ").trim()}\n`);
    return { answer, tool: tools[0] };
  };

  try {
    const warehouseAnswer = await runAssistantScenario("warehouses", "Сколько складов у нас?");
    assert(includesNumber(warehouseAnswer.answer, 2));
    assert(normalized(warehouseAnswer.answer).includes(normalized("Основной склад")));
    assert(normalized(warehouseAnswer.answer).includes(normalized("Полевой склад")));
    assert.equal(Number(warehouseAnswer.tool.rows), 2);

    const variants = ["Curamin Foliar", "Curamin", "Курамин", "Фолиар", "курамин фолиар"];
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      const result = await runAssistantScenario(`product_${index + 1}`, variant);
      assert(includesNumber(result.answer, 520), `${variant}: total 520 missing`);
      assert(includesNumber(result.answer, 480), `${variant}: main warehouse 480 missing`);
      assert(includesNumber(result.answer, 40), `${variant}: field warehouse 40 missing`);
      assert(normalized(result.answer).includes(normalized("Основной склад")), `${variant}: main warehouse missing`);
      assert(normalized(result.answer).includes(normalized("Полевой склад")), `${variant}: field warehouse missing`);
      assert(/(?:^|\s|\d)л(?:\s|[.,;:)]|$)/iu.test(result.answer), `${variant}: litre unit missing`);
      assert.equal(Number(result.tool.rows), 2, `${variant}: expected two stock rows`);
    }

    const fieldAnswer = await runAssistantScenario("fields", "Какие поля есть?");
    assert.equal(Number(fieldAnswer.tool.rows), 8);
    const fieldText = normalized(fieldAnswer.answer);
    for (const field of fields.data || []) {
      assert(fieldText.includes(normalized(field.name)), `Field name missing: ${field.name}`);
      assert(includesNumber(fieldAnswer.answer, Number(field.area || 0)), `Field area missing: ${field.name}`);
      const fieldAllocations = (allocations.data || []).filter((row) => String(row.field_id) === String(field.id));
      for (const allocation of fieldAllocations) {
        const cropName = cropNames.get(String(allocation.crop_id));
        const varietyName = allocation.variety_id ? varietyNames.get(String(allocation.variety_id)) : null;
        if (cropName) assert(fieldText.includes(normalized(cropName)), `Crop missing for ${field.name}: ${cropName}`);
        if (varietyName) assert(fieldText.includes(normalized(varietyName)), `Variety missing for ${field.name}: ${varietyName}`);
      }
    }

    const balancesAfter = await supabase
      .from("v_stock_balance_identity")
      .select("warehouse_id,product_id,quantity")
      .eq("company_id", profile.data.company_id)
      .gt("quantity", 0)
      .limit(500);
    if (balancesAfter.error) throw new Error(`Post-test stock audit failed: ${balancesAfter.error.message}`);
    const afterSnapshot = JSON.stringify({
      warehouses: (await supabase.from("warehouses").select("id,name,archived").eq("company_id", profile.data.company_id).eq("archived", false).order("name")).data || [],
      fields: (await supabase.from("fields").select("id,name,area,archived").eq("company_id", profile.data.company_id).eq("archived", false).order("name")).data || [],
      allocations: (await supabase.from("crop_structure").select("field_id,crop_id,variety_id,area,archived").eq("company_id", profile.data.company_id).eq("season_id", season.data.id).eq("archived", false)).data || [],
      balances: balancesAfter.data || [],
      products: productIds.length ? (await supabase.from("products").select("*").in("id", productIds)).data || [] : [],
    });
    assert.equal(afterSnapshot, erpSnapshot, "ERP snapshot changed during owner finding regression");
    process.stdout.write("OWNER_FINDING_SCENARIOS=7/7 PASS\n");
    process.stdout.write("ERP_WRITES=0\n");
  } finally {
    for (const threadId of createdThreadIds) {
      await supabase.from("chats").delete().eq("id", threadId);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
