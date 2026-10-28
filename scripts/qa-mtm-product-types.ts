import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Isolated PostgreSQL engine only: no environment files, network or shared DB.
const db = new PGlite();
let checks = 0;
async function check(name: string, run: () => Promise<void>) {
  await run(); checks++; console.log(`PASS ${name}`);
}
async function scalar<T = any>(sql: string, parameters: unknown[] = []): Promise<T> {
  const result = await db.query(sql, parameters);
  return Object.values(result.rows[0] as object)[0] as T;
}
async function reject(run: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(run, (error: any) => { assert.match(String(error.message), pattern); return true; });
}
function extract(source: string, signature: string) {
  const start = source.indexOf(`create or replace function ${signature}`);
  assert.ok(start >= 0, signature);
  const body = source.indexOf("as $$", start), end = source.indexOf("$$;", body + 5);
  assert.ok(body >= 0 && end > body);
  return source.slice(start, end + 3);
}
const oldCheck = "check(type in ('produce','seed','fertilizer','pesticide'))";
const constraintDefinition = (name = "products_type_check") => scalar<string>(
  "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.products'::regclass and conname=$1", [name]);
const rows = () => scalar("select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from products p");
const insert = (type: string | null, unit = "kg", productType: string | null = null) => scalar<string>(
  "insert into products(type,product_type,unit,base_uom) values($1,$2,$3,$3) returning id", [type, productType, unit]);
const validate = (id: string, unit: string, batchClass = "material", mass: number | null = unit === "kg" ? 2 : null) =>
  db.query("select public.validate_stock_quantity_contract($1,2,$2,$3,$4)", [id, unit, batchClass, mass]);

async function main() {
  await db.exec(`create table products(
    id uuid primary key default gen_random_uuid(), type text not null, product_type text,
    unit text, base_uom text not null, is_seed_material boolean default false,
    constraint products_type_check ${oldCheck},
    constraint products_product_type_check check(product_type is null or product_type in ('pesticide','fertilizer','additive','growth_regulator','adjuvant'))
  );`);
  const contract = (await readFile("supabase/migrations/20260713183038_warehouse_canonical_units_v2.sql", "utf8")).replace(/\r\n/g, "\n");
  for (const name of ["public.canonical_stock_uom(", "public.validate_stock_quantity_contract("]) await db.exec(extract(contract, name));
  const draft = await readFile("docs/project-live/schema-drafts/mtm-product-types-v1.sql", "utf8");
  const originalDefinition = await constraintDefinition();
  const agroDefinition = await constraintDefinition("products_product_type_check");
  const functionBefore = await scalar("select pg_get_functiondef('public.validate_stock_quantity_contract(uuid,numeric,text,text,numeric,numeric,text,text,text,timestamptz)'::regprocedure)");
  const oldIds = new Map<string, string>();

  await check("original real CHECK accepts the four old types and rejects MTM", async () => {
    for (const type of ["produce", "seed", "fertilizer", "pesticide"]) oldIds.set(type, await insert(type));
    for (const type of ["material", "fuel", "other", "additive", "", "FUEL"]) await reject(() => insert(type), /products_type_check/);
    await reject(() => insert(null), /not-null/);
  });
  const beforeRows = await rows();
  async function rejectedMigration() {
    try { await reject(() => db.exec(draft), /MTM_PRODUCTS_TYPE_CHECK_MISMATCH/); }
    finally { await db.exec("rollback"); }
  }
  await check("unexpected source constraint is rejected without rewriting it or data", async () => {
    await db.exec("alter table products drop constraint products_type_check, add constraint products_type_check check(type in ('produce','seed','fertilizer','pesticide','other'))");
    const changed = await constraintDefinition();
    await rejectedMigration();
    assert.equal(await constraintDefinition(), changed); assert.deepEqual(await rows(), beforeRows);
    await db.exec(`alter table products drop constraint products_type_check, add constraint products_type_check ${oldCheck}`);
  });
  await check("missing source constraint is rejected instead of silently installed", async () => {
    await db.exec("alter table products drop constraint products_type_check");
    await rejectedMigration();
    assert.equal(await scalar("select count(*)::int from pg_constraint where conrelid='public.products'::regclass and conname='products_type_check'"), 0);
    await db.exec(`alter table products add constraint products_type_check ${oldCheck}`);
  });
  await check("migration changes only the intended CHECK and preserves existing rows", async () => {
    assert.equal(await constraintDefinition(), originalDefinition);
    await db.exec(draft);
    assert.deepEqual(await rows(), beforeRows);
    assert.equal(await constraintDefinition("products_product_type_check"), agroDefinition);
    assert.equal(await scalar("select pg_get_functiondef('public.validate_stock_quantity_contract(uuid,numeric,text,text,numeric,numeric,text,text,text,timestamptz)'::regprocedure)"), functionBefore);
    assert.equal(await scalar("select to_regclass('pg_temp.mtm_product_type_preflight')"), null);
    assert.equal(await scalar("show lock_timeout"), "0");
  });
  await check("new material/fuel with NULL agro type pass canonical kg/l/pcs validation", async () => {
    for (const type of ["material", "fuel"]) for (const unit of ["kg", "l", "pcs"]) {
      const id = await insert(type, unit);
      await validate(id, unit);
      await reject(() => validate(id, unit, "commodity"), /Material cannot be stored as commodity/);
      await reject(() => validate(id, unit === "kg" ? "l" : "kg"), /Movement unit does not match/);
      if (unit === "kg") await reject(() => validate(id, unit, "material", 1), /Kilogram quantity and mass must match/);
      if (unit === "l") await reject(() => validate(id, unit, "material", 1), /Verified density evidence/);
      if (unit === "pcs") await reject(() => validate(id, unit, "material", 1), /Piece quantity cannot silently become mass/);
    }
  });
  await check("old accepted types still work; unrelated values and agro type widening stay rejected", async () => {
    for (const type of ["produce", "seed", "fertilizer", "pesticide"]) await insert(type);
    for (const type of ["other", "additive", "crop", "", "FUEL", "material "]) await reject(() => insert(type), /products_type_check/);
    await reject(() => insert(null), /not-null/);
    for (const type of ["material", "fuel"]) await reject(() => insert(type, "kg", type), /products_product_type_check/);
    await validate(oldIds.get("produce")!, "kg", "commodity");
    await validate(oldIds.get("seed")!, "kg", "seed");
    await reject(() => validate(oldIds.get("seed")!, "kg", "material"), /Seed material cannot be stored/);
    await validate(oldIds.get("fertilizer")!, "kg"); await validate(oldIds.get("pesticide")!, "kg");
  });
  await check("already changed constraint is not blindly replaced on another application", async () => {
    const changed = await constraintDefinition(), snapshot = await rows();
    await rejectedMigration();
    assert.equal(await constraintDefinition(), changed); assert.deepEqual(await rows(), snapshot);
  });
  console.log(`MTM product types: ${checks}/${checks} PASS. Isolated PGlite; actual canonical quantity functions; no shared database.`);
}
main().finally(() => db.close()).catch(error => { console.error(error); process.exitCode = 1; });
