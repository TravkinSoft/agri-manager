import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  STORAGE_PLACE_TYPES,
  isHarvestDestinationPlace,
} from "@/lib/warehouse/warehouse-scope";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read(
  "supabase/migrations/20260823151709_tz299_warehouses_place_type_contract_v1.sql",
);
const resourcesRoute = read("app/api/weighbridge/resources/route.ts");
const ticketsRoute = read("app/api/weighbridge/tickets/route.ts");
const activeHarvestRoute = read("app/api/weighbridge/active-harvests/route.ts");
const processingMigration = read(
  "supabase/migrations/20260822172443_tz297_live_processing_lifecycle_v1.sql",
);

let checks = 0;
const check = (name: string, run: () => void) => {
  run();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
};

const main = async () => {
  check("migration is additive only", () => {
    assert.doesNotMatch(
      migration,
      /\b(?:drop|rename|truncate|delete\s+from|update\s+public\.warehouses|insert\s+into)\b/i,
    );
  });

  check("canonical place_type column is idempotent and defaults to WAREHOUSE", () => {
    assert.match(
      migration,
      /add column if not exists place_type text not null default 'WAREHOUSE'/i,
    );
  });

  check("canonical place_type check contains exactly four values", () => {
    assert.deepEqual([...STORAGE_PLACE_TYPES], ["WAREHOUSE", "YARD", "DRYER", "CLEANER"]);
    assert.match(
      migration,
      /check \(place_type in \('WAREHOUSE', 'YARD', 'DRYER', 'CLEANER'\)\)/i,
    );
  });

  check("resources request the canonical warehouse column", () => {
    assert.match(resourcesRoute, /warehouse_type,place_type/);
    assert.match(resourcesRoute, /placeType: String\(row\.place_type \|\| "WAREHOUSE"\)/);
  });

  check("resources preserve partial loading and expose a stable diagnostic code", () => {
    assert.match(resourcesRoute, /Promise\.allSettled/);
    assert.match(resourcesRoute, /WB_RESOURCES_DESTINATIONS/);
    assert.match(resourcesRoute, /databaseCode: result\.value\.error\.code/);
    assert.match(resourcesRoute, /databaseMessage: result\.value\.error\.message/);
    assert.match(resourcesRoute, /resourceErrors/);
  });

  check("ticket destination validation reads place_type", () => {
    assert.match(ticketsRoute, /warehouse_type,place_type,archived,is_archived/);
    assert.match(
      ticketsRoute,
      /isHarvestDestinationPlace\(destinationWarehouse\.warehouse_type, destinationWarehouse\.place_type\)/,
    );
  });

  check("active harvest validation reads place_type", () => {
    assert.match(activeHarvestRoute, /warehouse_type,place_type,archived/);
    assert.match(
      activeHarvestRoute,
      /isHarvestDestinationPlace\(warehouseRes\.data\.warehouse_type, warehouseRes\.data\.place_type\)/,
    );
  });

  check("processing lifecycle reads the same physical place type", () => {
    assert.match(processingMigration, /select w\.place_type into v_destination_type/);
    assert.match(processingMigration, /'YARD', 'DRYER', 'CLEANER'/);
  });

  check("harvest destination taxonomy accepts storage and processing places", () => {
    assert.equal(isHarvestDestinationPlace("grain", "WAREHOUSE"), true);
    assert.equal(isHarvestDestinationPlace("agrochemical", "YARD"), true);
    assert.equal(isHarvestDestinationPlace("agrochemical", "DRYER"), true);
    assert.equal(isHarvestDestinationPlace("agrochemical", "CLEANER"), true);
  });

  const db = new PGlite();
  await db.exec(`
    create schema if not exists public;
    create table public.warehouses(
      id integer primary key,
      company_id integer,
      name text not null,
      warehouse_type text,
      archived boolean default false
    );
    insert into public.warehouses(id, company_id, name, warehouse_type)
    values
      (1, 1, 'Grain', 'grain'),
      (2, 1, 'Seed', 'seed'),
      (3, 1, 'Pesticide', 'pesticide'),
      (4, 1, 'Temporary', 'temporary');
  `);
  await db.exec(migration);
  await db.exec(migration);

  const rows = await db.query<{
    row_count: number;
    defaulted_count: number;
    distinct_values: number;
  }>(`
    select
      count(*)::int as row_count,
      count(*) filter (where place_type = 'WAREHOUSE')::int as defaulted_count,
      count(distinct place_type)::int as distinct_values
    from public.warehouses
  `);
  check("migration preserves rows and initializes only physical place metadata", () => {
    assert.equal(rows.rows[0]?.row_count, 4);
    assert.equal(rows.rows[0]?.defaulted_count, 4);
    assert.equal(rows.rows[0]?.distinct_values, 1);
  });

  const contract = await db.query<{ column_count: number; check_count: number }>(`
    select
      (select count(*)::int from information_schema.columns
       where table_schema = 'public' and table_name = 'warehouses'
         and column_name = 'place_type' and is_nullable = 'NO'
         and column_default = '''WAREHOUSE''::text') as column_count,
      (select count(*)::int from pg_constraint
       where conrelid = 'public.warehouses'::regclass
         and conname = 'warehouses_place_type_check') as check_count
  `);
  check("schema contract survives an idempotent second apply", () => {
    assert.equal(contract.rows[0]?.column_count, 1);
    assert.equal(contract.rows[0]?.check_count, 1);
  });

  assert.equal(checks, 11);
  console.log(`WB_RESOURCES_DESTINATIONS_SCHEMA_CONTRACT PASS: ${checks}/11`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
