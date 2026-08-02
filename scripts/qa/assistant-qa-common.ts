import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type JsonRecord = Record<string, unknown>;

export interface QaFixture extends JsonRecord {
  version: number;
  marker: string;
  branchRef: string;
  productionRef: string;
  users: Record<string, { id: string; companyId: string }>;
  companies: Record<string, { name: string }>;
  crops: Record<string, { id: string; name: string }>;
  variety: { id: string; name: string; nameEn: string };
  reproduction: { id: string; name: string; nameRu: string; code: string };
  manufacturers: Array<{ id: string; name: string }>;
  products: Array<Record<string, string | null>>;
  aliases: Array<{ id: string; productKey: string; alias: string }>;
  dataset: Record<string, unknown>;
}

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const AUDIT_DIR = fileURLToPath(new URL("../../audit-output/TZ-176/", import.meta.url));
export const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/assistant-qa-reference-baseline.json", import.meta.url),
);

export async function loadFixture(): Promise<QaFixture> {
  return JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as QaFixture;
}

export function assertBranchOnlyEnv(fixture: QaFixture) {
  assert.equal(
    process.env.ALLOW_ASSISTANT_QA_SEED,
    "YES",
    "STOP: ALLOW_ASSISTANT_QA_SEED=YES is required",
  );

  const url = process.env.ASSISTANT_QA_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.ASSISTANT_QA_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(url, "STOP: ASSISTANT_QA_SUPABASE_URL is required");
  assert(serviceKey, "STOP: ASSISTANT_QA_SUPABASE_SERVICE_ROLE_KEY is required");

  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:", "STOP: Supabase URL must use HTTPS");
  assert.equal(
    parsed.hostname,
    `${fixture.branchRef}.supabase.co`,
    `STOP: exact branch ref ${fixture.branchRef} is required`,
  );
  assert(
    !url.includes(fixture.productionRef) && !serviceKey.includes(fixture.productionRef),
    "STOP: production ref detected",
  );

  return { url, serviceKey };
}

export function createBranchAdmin(fixture: QaFixture): SupabaseClient {
  const { url, serviceKey } = assertBranchOnlyEnv(fixture);
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, comparable(item)]),
    );
  }
  if (typeof value === "number") return Number(value);
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return new Date(value).toISOString();
  }
  return value;
}

export async function ensureExactRow(
  client: SupabaseClient,
  table: string,
  row: JsonRecord,
  fields = Object.keys(row),
): Promise<"created" | "existing"> {
  const id = String(row.id);
  const { data: existing, error: readError } = await client
    .from(table)
    .select(fields.join(","))
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Error(`${table} read failed: ${readError.message}`);

  if (existing) {
    for (const field of fields) {
      assert.deepEqual(
        comparable((existing as unknown as JsonRecord)[field]),
        comparable(row[field]),
        `STOP: ${table}.${id}.${field} differs from the canonical fixture`,
      );
    }
    return "existing";
  }

  const { error: insertError } = await client.from(table).insert(row);
  if (insertError) throw new Error(`${table} insert failed: ${insertError.message}`);
  return "created";
}

export async function requireExactRow(
  client: SupabaseClient,
  table: string,
  id: string,
  expected: JsonRecord,
) {
  const fields = Object.keys(expected);
  const { data, error } = await client
    .from(table)
    .select(fields.join(","))
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`${table} verification failed: ${error.message}`);
  assert(data, `STOP: required ${table}.${id} does not exist`);
  for (const field of fields) {
    assert.deepEqual(
      comparable((data as unknown as JsonRecord)[field]),
      comparable(expected[field]),
      `STOP: ${table}.${id}.${field} is not canonical`,
    );
  }
  return data as unknown as JsonRecord;
}

export async function requireExactRowIfExists(
  client: SupabaseClient,
  table: string,
  id: string,
  expected: JsonRecord,
) {
  const fields = Object.keys(expected);
  const { data, error } = await client
    .from(table)
    .select(fields.join(","))
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`${table} verification failed: ${error.message}`);
  if (!data) return false;
  for (const field of fields) {
    assert.deepEqual(
      comparable((data as unknown as JsonRecord)[field]),
      comparable(expected[field]),
      `STOP: ${table}.${id}.${field} is not fixture-owned`,
    );
  }
  return true;
}

export async function deleteIds(
  client: SupabaseClient,
  table: string,
  ids: string[],
) {
  if (ids.length === 0) return 0;
  const { data, error } = await client.from(table).delete().in("id", ids).select("id");
  if (error) throw new Error(`${table} cleanup failed: ${error.message}`);
  return data?.length ?? 0;
}

export async function writeAuditJson(name: string, value: unknown) {
  await mkdir(AUDIT_DIR, { recursive: true });
  await writeFile(`${AUDIT_DIR}${name}`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeAuditText(name: string, value: string) {
  await mkdir(AUDIT_DIR, { recursive: true });
  await writeFile(`${AUDIT_DIR}${name}`, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

export function normalizedAlias(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

export function indexByKey<T extends { key: string }>(rows: T[]) {
  return Object.fromEntries(rows.map((row) => [row.key, row])) as Record<string, T>;
}

export function asArray<T>(value: unknown): T[] {
  assert(Array.isArray(value));
  return value as T[];
}

export function asString(value: unknown) {
  assert.equal(typeof value, "string");
  return value;
}
