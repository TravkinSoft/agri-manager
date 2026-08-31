import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const prerequisiteUrl = new URL(
  "../supabase/migrations/20260830223600_tz315_processing_shadow_sync_prerequisite_corrective_v1.sql",
  import.meta.url,
);
const guardUrl = new URL(
  "../supabase/migrations/20260831143000_tz315_yard_storage_processing_guard_v1.sql",
  import.meta.url,
);

const COMPANY = "31543000-0000-4000-8000-000000000001";
const SEASON = "31543000-0000-4000-8000-000000000002";
const LOT = "31543000-0000-4000-8000-000000000003";
const SOURCE = "31543000-0000-4000-8000-000000000004";
const YARD = "31543000-0000-4000-8000-000000000005";
const CLEANER = "31543000-0000-4000-8000-000000000006";
const BATCH = "31543000-0000-4000-8000-000000000007";
const YARD_IN = "31543000-0000-4000-8000-000000000008";
const YARD_OUT = "31543000-0000-4000-8000-000000000009";
const CLEANER_IN = "31543000-0000-4000-8000-00000000000a";
const LEGACY_YARD_OUTPUT = "31543000-0000-4000-8000-00000000000b";
const LEGACY_YARD_TRANSFORMATION = "31543000-0000-4000-8000-00000000000c";

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.tickets(
      id uuid primary key,
      company_id uuid,
      harvest_lot_id uuid,
      is_finalized boolean,
      is_voided boolean,
      status text,
      warehouse_from_id uuid,
      warehouse_to_id uuid,
      net_weight_kg numeric,
      source_physical_state text,
      finalized_at timestamptz,
      harvest_year integer,
      processing_output_role text,
      linked_processing_id uuid
    );
    create table public.harvest_lots(
      id uuid primary key,
      company_id uuid,
      season_id uuid,
      crop_id uuid,
      variety_id uuid,
      reproduction_id uuid,
      composition_hash text
    );
    create table public.ticket_lines(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid,
      created_at timestamptz default now(),
      batch_id text,
      moisture_percent numeric,
      quantity numeric,
      product_id uuid,
      destination_batch_id uuid
    );
    create table public.inventory_batches(
      id uuid primary key default gen_random_uuid(),
      company_id uuid,
      season_id uuid,
      product_id uuid,
      crop_id uuid,
      variety_id uuid,
      reproduction_id uuid,
      source_field_id uuid,
      source_ticket_id uuid,
      harvest_year integer,
      batch_code text,
      status text,
      initial_weight_kg numeric,
      current_weight_kg numeric,
      moisture_percent numeric,
      batch_class text,
      parent_batch_id uuid,
      source_transformation_id uuid,
      origin_type text,
      origin_ref_id uuid,
      warehouse_id uuid,
      received_at timestamptz,
      source_type text,
      composition_snapshot jsonb,
      composition_hash text,
      display_name text,
      is_mixed_harvest boolean,
      physical_state text,
      crop_structure_id uuid
    );
    create table public.batch_transformation_inputs(
      company_id uuid,
      transformation_id uuid,
      batch_id uuid,
      warehouse_from_id uuid,
      input_weight_kg numeric,
      input_quality_json jsonb,
      source_ticket_id uuid,
      source_ticket_line_id uuid,
      node_warehouse_id uuid,
      moisture_percent numeric,
      dry_matter_kg numeric
    );
    create unique index uq_batch_transformation_inputs_ticket_line_v1
      on public.batch_transformation_inputs(source_ticket_line_id)
      where source_ticket_line_id is not null;
    create table public.batch_transformation_outputs(
      company_id uuid,
      transformation_id uuid,
      output_batch_id uuid,
      warehouse_to_id uuid,
      line_type text,
      output_weight_kg numeric,
      output_quality_json jsonb,
      batch_class text,
      source_ticket_id uuid,
      moisture_percent numeric,
      output_role text,
      is_projected_child boolean,
      projected_batch_code text,
      physical_state text
    );
    create unique index uq_batch_transformation_outputs_ticket_v1
      on public.batch_transformation_outputs(source_ticket_id)
      where source_ticket_id is not null;
    create table public.warehouses(
      id uuid primary key,
      company_id uuid,
      place_type text
    );
    create table public.batch_transformations(
      id uuid primary key default gen_random_uuid(),
      company_id uuid,
      node_warehouse_id uuid,
      transformation_type text,
      processing_method text,
      status text,
      shadow_mode boolean,
      shadow_status text,
      quality_state text,
      identity_key text,
      harvest_lot_id uuid,
      source_physical_state text,
      pass_no integer,
      started_at timestamptz,
      created_at timestamptz default now(),
      note text
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid,
      warehouse_id uuid,
      direction text,
      created_at timestamptz default now(),
      product_id uuid,
      variety_id uuid,
      reproduction_id uuid,
      inventory_batch_id uuid,
      batch_id text,
      batch_id_text text,
      batch_class text,
      quantity numeric,
      delta_qty_signed numeric,
      uom text,
      mass_kg numeric,
      unit_source text,
      unit_contract_version integer,
      processing_id uuid
    );
    create table public.harvest_lot_batches(
      company_id uuid,
      harvest_lot_id uuid,
      inventory_batch_id uuid,
      source_ticket_id uuid,
      crop_structure_id uuid,
      assignment_reason text,
      constraint harvest_lot_batches_inventory_batch_id_key unique(inventory_batch_id)
    );
    create function public.recompute_grain_processing_shadow_v1(uuid)
    returns void language plpgsql as $$ begin null; end $$;
    create table public.tz315_guard_sentinel(
      id integer primary key,
      marker text not null
    );
    insert into public.tz315_guard_sentinel values (1, 'unchanged');
    set check_function_bodies = off;
  `);
}

async function scalar<T>(db: PGlite, sql: string): Promise<T> {
  return (await db.query<{ value: T }>(sql)).rows[0].value;
}

async function main() {
  const prerequisite = (await readFile(prerequisiteUrl, "utf8")).replace(/\r\n/g, "\n");
  const guard = await readFile(guardUrl, "utf8");
  let passed = 0;
  const check = async (name: string, run: () => void | Promise<void>) => {
    await run();
    passed += 1;
    console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
  };

  await check("migration is anchored to the exact predecessor hash", () => {
    assert.match(guard, /1f943fc078f4384c6064ea077aa9b643/);
    assert.match(guard, /79964ce51c6eb14f475894c6d26f4c85/);
    assert.match(guard, /TZ315_YARD_STORAGE_GUARD_DEFINITION_DRIFT/);
  });
  await check("ordinary YARD destinations are removed from implicit processing", () => {
    assert.match(guard, /v_destination_type in \(''DRYER'', ''CLEANER''\)/);
    assert.match(guard, /TZ315_YARD_STORAGE_PROCESSING_GUARD_V1/);
  });
  await check("ordinary YARD sources are removed from implicit processing", () => {
    assert.match(guard, /v_source_type in \(''DRYER'', ''CLEANER''\)/);
  });
  await check("migration changes no business rows", () => {
    assert.doesNotMatch(
      guard,
      /\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate|drop\s+(?:table|column))\b/i,
    );
  });
  await check("owner security-definer search-path and ACL are fail-closed", () => {
    assert.match(guard, /v_owner <> 'postgres'/);
    assert.match(guard, /not coalesce\(v_security_definer, false\)/);
    assert.match(guard, /search_path=public, pg_temp/);
    assert.match(guard, /service_role:postgres:EXECUTE:f/);
  });

  const db = new PGlite();
  try {
    await bootstrap(db);
    await db.exec(prerequisite);
    const beforeHash = await scalar<string>(db, `
      select md5(pg_get_functiondef('public.sync_grain_movement_shadow_v1(uuid)'::regprocedure)) value
    `);
    assert.equal(beforeHash, "1f943fc078f4384c6064ea077aa9b643");

    await db.exec(guard);
    const physical = (
      await db.query<{
        oid: number;
        definition: string;
        definition_md5: string;
        owner_name: string;
        security_definer: boolean;
        config: string[];
        acl: string[];
        comment_text: string;
      }>(`
        select
          p.oid,
          pg_get_functiondef(p.oid) definition,
          md5(pg_get_functiondef(p.oid)) definition_md5,
          pg_get_userbyid(p.proowner) owner_name,
          p.prosecdef security_definer,
          p.proconfig config,
          array(
            select format(
              '%s:%s:%s:%s',
              case when acl.grantee=0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
              pg_get_userbyid(acl.grantor), acl.privilege_type, acl.is_grantable
            )
            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
            order by case when acl.grantee=0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
                     pg_get_userbyid(acl.grantor), acl.privilege_type, acl.is_grantable
          ) acl,
          obj_description(p.oid, 'pg_proc') comment_text
        from pg_proc p
        where p.oid='public.sync_grain_movement_shadow_v1(uuid)'::regprocedure
      `)
    ).rows[0];
    await check("physical function contains the YARD storage guard", () => {
      assert.equal(physical.definition_md5, "79964ce51c6eb14f475894c6d26f4c85");
      assert.match(physical.definition, /TZ315_YARD_STORAGE_PROCESSING_GUARD_V1/);
      assert.match(physical.definition, /v_destination_type in \('DRYER', 'CLEANER'\)/);
      assert.match(physical.definition, /v_source_type in \('DRYER', 'CLEANER'\)/);
      assert.doesNotMatch(
        physical.definition,
        /if v_destination_type in \('YARD', 'DRYER', 'CLEANER'\)/,
      );
    });
    await check("physical security metadata and ACL are preserved", () => {
      assert.equal(physical.owner_name, "postgres");
      assert.equal(physical.security_definer, true);
      assert.deepEqual(physical.config, ["search_path=public, pg_temp"]);
      assert.deepEqual(physical.acl, [
        "postgres:postgres:EXECUTE:f",
        "service_role:postgres:EXECUTE:f",
      ]);
    });
    await check("function comment documents ordinary YARD storage semantics", () => {
      assert.match(physical.comment_text, /Ordinary YARD movements remain storage/);
    });

    const beforeReplay = {
      oid: physical.oid,
      definition_md5: physical.definition_md5,
    };
    await db.exec(guard);
    const afterReplay = (
      await db.query<{ oid: number; definition_md5: string }>(`
        select p.oid, md5(pg_get_functiondef(p.oid)) definition_md5
        from pg_proc p
        where p.oid='public.sync_grain_movement_shadow_v1(uuid)'::regprocedure
      `)
    ).rows[0];
    await check("repeat application is byte-stable", () => {
      assert.deepEqual(afterReplay, beforeReplay);
    });

    await db.exec(`
      insert into public.warehouses(id, company_id, place_type) values
        ('${SOURCE}', '${COMPANY}', 'WAREHOUSE'),
        ('${YARD}', '${COMPANY}', 'YARD'),
        ('${CLEANER}', '${COMPANY}', 'CLEANER');
      insert into public.harvest_lots(id, company_id, season_id)
      values ('${LOT}', '${COMPANY}', '${SEASON}');
      insert into public.inventory_batches(
        id, company_id, season_id, batch_code, status, current_weight_kg,
        warehouse_id, crop_structure_id
      ) values (
        '${BATCH}', '${COMPANY}', '${SEASON}', 'TZ315-YARD-GUARD', 'active', 1000,
        '${YARD}', '31543000-0000-4000-8000-00000000000d'
      );
      insert into public.tickets(
        id, company_id, harvest_lot_id, is_finalized, is_voided, status,
        warehouse_from_id, warehouse_to_id, net_weight_kg, source_physical_state,
        finalized_at, harvest_year
      ) values
        ('${YARD_IN}', '${COMPANY}', '${LOT}', true, false, 'finalized',
         '${SOURCE}', '${YARD}', 100, 'SOURCE', now(), 2026),
        ('${YARD_OUT}', '${COMPANY}', '${LOT}', true, false, 'finalized',
         '${YARD}', '${SOURCE}', 100, 'SOURCE', now(), 2026),
        ('${CLEANER_IN}', '${COMPANY}', '${LOT}', true, false, 'finalized',
         '${YARD}', '${CLEANER}', 100, 'SOURCE', now(), 2026);
      insert into public.ticket_lines(ticket_id, batch_id, quantity) values
        ('${YARD_IN}', '${BATCH}', 100),
        ('${YARD_OUT}', '${BATCH}', 100),
        ('${CLEANER_IN}', '${BATCH}', 100);
    `);

    await db.query(`select public.sync_grain_movement_shadow_v1('${YARD_IN}')`);
    await check("harvest receipt into YARD creates no processing graph", async () => {
      assert.equal(
        await scalar<number>(db, `select count(*)::integer value from public.batch_transformations`),
        0,
      );
      assert.equal(
        await scalar<string | null>(db, `select linked_processing_id::text value from public.tickets where id='${YARD_IN}'`),
        null,
      );
    });

    await db.exec(`
      insert into public.batch_transformations(
        id, company_id, node_warehouse_id, transformation_type, processing_method,
        status, shadow_mode, shadow_status, quality_state, identity_key,
        harvest_lot_id, source_physical_state, pass_no, started_at, note
      ) values (
        '${LEGACY_YARD_TRANSFORMATION}', '${COMPANY}', '${YARD}', 'drying',
        'NATURAL_DRYING', 'draft', true, 'ACTIVE', 'READY', 'legacy-yard',
        '${LOT}', 'SOURCE', 1, now(), 'legacy linked YARD fixture'
      );
      update public.tickets
      set linked_processing_id='${LEGACY_YARD_TRANSFORMATION}'
      where id='${YARD_OUT}';
    `);
    await db.query(`select public.sync_grain_movement_shadow_v1('${YARD_OUT}')`);
    await check("auto-linked ordinary movement out of YARD creates no output", async () => {
      assert.equal(
        await scalar<number>(db, `select count(*)::integer value from public.batch_transformation_outputs`),
        0,
      );
      assert.equal(
        await scalar<string | null>(db, `select linked_processing_id::text value from public.tickets where id='${YARD_OUT}'`),
        LEGACY_YARD_TRANSFORMATION,
      );
    });

    await db.query(`select public.sync_grain_movement_shadow_v1('${CLEANER_IN}')`);
    await check("CLEANER destination still creates one canonical processing input", async () => {
      assert.equal(
        await scalar<number>(db, `select count(*)::integer value from public.batch_transformations where processing_method='CLEANING'`),
        1,
      );
      assert.equal(
        await scalar<number>(db, `select count(*)::integer value from public.batch_transformation_inputs where source_ticket_id='${CLEANER_IN}'`),
        1,
      );
      assert.ok(
        await scalar<string | null>(db, `select linked_processing_id::text value from public.tickets where id='${CLEANER_IN}'`),
      );
    });

    await db.exec(`
      update public.tickets
      set is_finalized=false, is_voided=true, status='voided'
      where id='${CLEANER_IN}';
    `);
    await db.query(`select public.sync_grain_movement_shadow_v1('${CLEANER_IN}')`);
    await check("void reconciliation still removes the processing input", async () => {
      assert.equal(
        await scalar<number>(db, `select count(*)::integer value from public.batch_transformation_inputs where source_ticket_id='${CLEANER_IN}'`),
        0,
      );
    });

    await db.exec(`
      insert into public.tickets(
        id, company_id, harvest_lot_id, is_finalized, is_voided, status,
        warehouse_from_id, warehouse_to_id, net_weight_kg, source_physical_state,
        finalized_at, harvest_year, processing_output_role, linked_processing_id
      ) values (
        '${LEGACY_YARD_OUTPUT}', '${COMPANY}', '${LOT}', true, false, 'finalized',
        '${YARD}', '${SOURCE}', 25, 'SOURCE', now(), 2026, 'GRAIN',
        '${LEGACY_YARD_TRANSFORMATION}'
      );
      insert into public.ticket_lines(ticket_id, batch_id, quantity)
      values ('${LEGACY_YARD_OUTPUT}', '${BATCH}', 25);
      insert into public.batch_transformation_outputs(
        company_id, transformation_id, output_batch_id, warehouse_to_id,
        line_type, output_weight_kg, output_quality_json, batch_class,
        source_ticket_id, moisture_percent, output_role, is_projected_child,
        physical_state
      ) values (
        '${COMPANY}', '${LEGACY_YARD_TRANSFORMATION}', '${BATCH}', '${SOURCE}',
        'commodity', 25, '{}'::jsonb, 'commodity', '${LEGACY_YARD_OUTPUT}',
        null, 'GRAIN', false, 'AFTER_DRYING'
      );
    `);
    await db.query(`select public.sync_grain_movement_shadow_v1('${LEGACY_YARD_OUTPUT}')`);
    await check("pre-existing legacy YARD output remains intact without new materialization", async () => {
      assert.equal(
        await scalar<number>(db, `select count(*)::integer value from public.batch_transformation_outputs where source_ticket_id='${LEGACY_YARD_OUTPUT}'`),
        1,
      );
      assert.equal(
        await scalar<number>(db, `select count(*)::integer value from public.batch_transformations where node_warehouse_id='${YARD}'`),
        1,
      );
    });

    await check("sentinel business row is unchanged", async () => {
      assert.equal(
        await scalar<string>(db, `select marker value from public.tz315_guard_sentinel where id=1`),
        "unchanged",
      );
    });
  } finally {
    await db.close();
  }

  const driftDb = new PGlite();
  try {
    await bootstrap(driftDb);
    await driftDb.exec(prerequisite);
    await driftDb.exec(`alter function public.sync_grain_movement_shadow_v1(uuid) security invoker`);
    await assert.rejects(
      driftDb.exec(guard),
      /SECURITY_METADATA_DRIFT/,
      "security metadata drift must fail closed",
    );
    passed += 1;
    console.log(`PASS ${String(passed).padStart(2, "0")} security drift fails closed`);
  } finally {
    await driftDb.close();
  }

  const markedDriftDb = new PGlite();
  try {
    await bootstrap(markedDriftDb);
    await markedDriftDb.exec(prerequisite);
    await markedDriftDb.exec(guard);
    const markedDefinition = await scalar<string>(markedDriftDb, `
      select pg_get_functiondef('public.sync_grain_movement_shadow_v1(uuid)'::regprocedure) value
    `);
    const driftedDefinition = markedDefinition.replace(
      "  if v_destination_type in ('DRYER', 'CLEANER') then",
      "  -- TZ315_MARKED_BODY_DRIFT\n  if v_destination_type in ('DRYER', 'CLEANER') then",
    );
    assert.notEqual(driftedDefinition, markedDefinition);
    await markedDriftDb.exec(driftedDefinition);
    await assert.rejects(
      markedDriftDb.exec(guard),
      /POSTCONDITION_DRIFT/,
      "marked function body drift must fail closed",
    );
    passed += 1;
    console.log(`PASS ${String(passed).padStart(2, "0")} marked body drift fails closed`);
  } finally {
    await markedDriftDb.close();
  }

  const missingDb = new PGlite();
  try {
    await bootstrap(missingDb);
    await assert.rejects(
      missingDb.exec(guard),
      /PREREQUISITE_MISSING/,
      "missing prerequisite must fail closed",
    );
    passed += 1;
    console.log(`PASS ${String(passed).padStart(2, "0")} missing prerequisite fails closed`);
  } finally {
    await missingDb.close();
  }

  console.log(`TZ315 YARD storage processing guard: PASS (${passed}/${passed})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
