import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type JsonRow = Record<string, unknown>;

export type PilotFixture = {
  version: number;
  marker: string;
  branchRef: string;
  productionRef: string;
  qaUserId: string;
  checkedOn: string;
  manufacturers: JsonRow[];
  formulations: JsonRow[];
  targets: { diseases: JsonRow[]; pests: JsonRow[]; weeds: JsonRow[] };
  products: JsonRow[];
  aliases: JsonRow[];
  sources: JsonRow[];
  componentBaselines: JsonRow[];
  components: JsonRow[];
  componentSources: JsonRow[];
  productComponents: JsonRow[];
  registrations: JsonRow[];
  usageRules: JsonRow[];
  safety: JsonRow[];
};

const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/full-pesticide-card-pilot.json", import.meta.url),
);
const AUDIT_DIR = fileURLToPath(new URL("../../audit-output/TZ-199/", import.meta.url));

export async function loadPilotFixture(): Promise<PilotFixture> {
  return JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as PilotFixture;
}

export function createBranchAdmin(fixture: PilotFixture): SupabaseClient {
  assert.equal(
    process.env.ALLOW_FULL_PESTICIDE_CARD_PILOT,
    "YES",
    "STOP: ALLOW_FULL_PESTICIDE_CARD_PILOT=YES is required",
  );
  const url = process.env.ASSISTANT_QA_SUPABASE_URL?.trim() || process.env.A106_SUPABASE_URL?.trim() || "";
  const serviceKey = process.env.ASSISTANT_QA_SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  assert(url, "STOP: ASSISTANT_QA_SUPABASE_URL or A106_SUPABASE_URL is required");
  assert(serviceKey, "STOP: ASSISTANT_QA_SUPABASE_SERVICE_ROLE_KEY is required");

  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:", "STOP: HTTPS Supabase URL is required");
  assert.equal(
    parsed.hostname,
    `${fixture.branchRef}.supabase.co`,
    `STOP: exact branch ${fixture.branchRef} is required`,
  );
  assert(!url.includes(fixture.productionRef), "STOP: production Supabase URL detected");

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRow)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, comparable(item)]),
    );
  }
  if (typeof value === "number") return Number(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toISOString();
  }
  return value;
}

export async function verifyBranchGuard(client: SupabaseClient, fixture: PilotFixture) {
  const { data, error } = await client
    .from("assistant_glbd_snapshot_meta")
    .select("branch_ref")
    .eq("branch_ref", fixture.branchRef)
    .maybeSingle();
  if (error) throw new Error(`Branch guard failed: ${error.message}`);
  assert.equal(data?.branch_ref, fixture.branchRef, "STOP: branch metadata does not match the fixture");
}

export async function ensureExactRow(
  client: SupabaseClient,
  table: string,
  row: JsonRow,
): Promise<"created" | "existing"> {
  const idField = Object.prototype.hasOwnProperty.call(row, "id") ? "id" : "product_id";
  const id = String(row[idField]);
  const fields = Object.keys(row);
  const { data, error } = await client
    .from(table)
    .select(fields.join(","))
    .eq(idField, id)
    .maybeSingle();
  if (error) throw new Error(`${table} preflight failed: ${error.message}`);

  if (data) {
    for (const field of fields) {
      assert.deepEqual(
        comparable((data as unknown as JsonRow)[field]),
        comparable(row[field]),
        `STOP: ${table}.${id}.${field} differs from the canonical pilot fixture`,
      );
    }
    return "existing";
  }

  const { error: insertError } = await client.from(table).insert(row);
  if (insertError) throw new Error(`${table} insert failed: ${insertError.message}`);
  return "created";
}

export async function ensureExactTransition(
  client: SupabaseClient,
  table: string,
  baseline: JsonRow,
  target: JsonRow,
): Promise<"updated" | "existing"> {
  const id = String(target.id);
  assert.equal(id, String(baseline.id));
  const fields = Array.from(new Set([...Object.keys(baseline), ...Object.keys(target)]));
  const { data, error } = await client.from(table).select(fields.join(",")).eq("id", id).maybeSingle();
  if (error) throw new Error(`${table} transition preflight failed: ${error.message}`);
  assert(data, `STOP: transition source ${table}.${id} does not exist`);

  const row = data as unknown as JsonRow;
  const matches = (expected: JsonRow) => Object.entries(expected).every(
    ([field, value]) => JSON.stringify(comparable(row[field])) === JSON.stringify(comparable(value)),
  );
  if (matches(target)) return "existing";
  assert(matches(baseline), `STOP: ${table}.${id} matches neither baseline nor target`);

  const changes = Object.fromEntries(Object.entries(target).filter(([field]) => field !== "id"));
  const { error: updateError } = await client.from(table).update(changes).eq("id", id);
  if (updateError) throw new Error(`${table} transition failed: ${updateError.message}`);
  return "updated";
}

export async function restoreExactTransition(
  client: SupabaseClient,
  table: string,
  baseline: JsonRow,
  target: JsonRow,
): Promise<"restored" | "baseline"> {
  const id = String(target.id);
  const fields = Array.from(new Set([...Object.keys(baseline), ...Object.keys(target)]));
  const { data, error } = await client.from(table).select(fields.join(",")).eq("id", id).maybeSingle();
  if (error) throw new Error(`${table} restore preflight failed: ${error.message}`);
  assert(data, `STOP: transition target ${table}.${id} does not exist`);
  const row = data as unknown as JsonRow;
  const matches = (expected: JsonRow) => Object.entries(expected).every(
    ([field, value]) => JSON.stringify(comparable(row[field])) === JSON.stringify(comparable(value)),
  );
  if (matches(baseline)) return "baseline";
  assert(matches(target), `STOP: ${table}.${id} matches neither target nor baseline during cleanup`);
  const changes = Object.fromEntries(Object.entries(baseline).filter(([field]) => field !== "id"));
  const { error: updateError } = await client.from(table).update(changes).eq("id", id);
  if (updateError) throw new Error(`${table} restore failed: ${updateError.message}`);
  return "restored";
}

export async function deleteExactRows(
  client: SupabaseClient,
  table: string,
  rows: JsonRow[],
): Promise<number> {
  if (!rows.length) return 0;
  const idField = Object.prototype.hasOwnProperty.call(rows[0], "id") ? "id" : "product_id";
  const existingIds: string[] = [];

  for (const row of rows) {
    const id = String(row[idField]);
    const fields = Object.keys(row);
    const { data, error } = await client
      .from(table)
      .select(fields.join(","))
      .eq(idField, id)
      .maybeSingle();
    if (error) throw new Error(`${table} cleanup preflight failed: ${error.message}`);
    if (!data) continue;
    for (const field of fields) {
      assert.deepEqual(
        comparable((data as unknown as JsonRow)[field]),
        comparable(row[field]),
        `STOP: cleanup refuses non-fixture ${table}.${id}.${field}`,
      );
    }
    existingIds.push(id);
  }

  if (!existingIds.length) return 0;
  const { data, error } = await client.from(table).delete().in(idField, existingIds).select(idField);
  if (error) throw new Error(`${table} cleanup failed: ${error.message}`);
  return data?.length || 0;
}

export async function writePilotAudit(name: string, value: unknown) {
  await mkdir(AUDIT_DIR, { recursive: true });
  await writeFile(`${AUDIT_DIR}${name}`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function fixtureTableRows(fixture: PilotFixture) {
  return [
    ["agrochem_manufacturers", fixture.manufacturers],
    ["agrochem_formulations", fixture.formulations],
    ["diseases", fixture.targets.diseases],
    ["pests", fixture.targets.pests],
    ["weeds", fixture.targets.weeds],
    ["products", fixture.products],
    ["global_product_aliases", fixture.aliases],
    ["glbd_component_sources", fixture.componentSources],
    ["glbd_product_components", fixture.productComponents],
    ["glbd_product_sources", fixture.sources],
    ["glbd_product_registrations", fixture.registrations],
    ["glbd_product_usage_rules", fixture.usageRules],
    ["glbd_product_assistant_safety", fixture.safety],
  ] as Array<[string, JsonRow[]]>;
}
