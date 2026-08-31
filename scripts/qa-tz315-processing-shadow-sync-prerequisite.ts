import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260830223600_tz315_processing_shadow_sync_prerequisite_corrective_v1.sql",
  import.meta.url,
);

async function bootstrapPhysicalPrerequisites(db: PGlite) {
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
      id uuid primary key,
      ticket_id uuid,
      created_at timestamptz,
      batch_id text,
      moisture_percent numeric,
      quantity numeric,
      product_id uuid,
      destination_batch_id uuid
    );
    create table public.inventory_batches(
      id uuid primary key,
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
      id uuid primary key,
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
      created_at timestamptz,
      note text
    );
    create table public.stock_ledger_entries(
      id uuid primary key,
      ticket_id uuid,
      warehouse_id uuid,
      direction text,
      created_at timestamptz,
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
    returns void
    language plpgsql
    as $$ begin null; end $$;
    create table public.tz315_migration_sentinel(
      id integer primary key,
      marker text not null
    );
    insert into public.tz315_migration_sentinel(id, marker)
    values (1, 'unchanged');
    set check_function_bodies = off;
  `);
}

async function assertSentinelUnchanged(db: PGlite) {
  const sentinel = (
    await db.query<{ id: number; marker: string }>(`
      select id, marker from public.tz315_migration_sentinel order by id
    `)
  ).rows;
  assert.deepEqual(sentinel, [{ id: 1, marker: "unchanged" }]);
}

async function main() {
  const migration = await readFile(migrationUrl, "utf8");
  const canonicalBody = migration.match(
    /as \$function_body\$([\s\S]*?)\n\$function_body\$;/,
  )?.[1];

  assert.ok(canonicalBody, "canonical function body is embedded in the corrective migration");
  assert.equal(
    createHash("sha256").update(canonicalBody).digest("hex"),
    "7d31bc871b6302944450edec74aa6022e1b8a8e7e1c910a9736c14e713190c96",
    "embedded function body must remain byte-for-byte equal to the canonical TZ281 body",
  );
  assert.match(
    migration,
    /if pg_catalog\.to_regprocedure\('public\.sync_grain_movement_shadow_v1\(uuid\)'\) is null then[\s\S]*?execute \$create_sql\$/i,
  );
  assert.doesNotMatch(
    migration,
    /create\s+or\s+replace\s+function\s+public\.sync_grain_movement_shadow_v1/i,
    "an existing function must never be replaced",
  );
  assert.match(migration, /1f943fc078f4384c6064ea077aa9b643/);
  assert.match(migration, /v_owner <> 'postgres'/);
  assert.match(migration, /not v_security_definer/);
  assert.match(
    migration,
    /v_config is distinct from array\['search_path=public, pg_temp'\]::text\[\]/,
  );
  assert.match(migration, /postgres:postgres:EXECUTE:f/);
  assert.match(migration, /service_role:postgres:EXECUTE:f/);
  assert.match(
    migration,
    /revoke all on function public\.sync_grain_movement_shadow_v1\(uuid\)[\s\S]*?from public, anon, authenticated, service_role;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.sync_grain_movement_shadow_v1\(uuid\) to service_role;/i,
  );
  for (const table of [
    "tickets",
    "harvest_lots",
    "ticket_lines",
    "inventory_batches",
    "batch_transformation_inputs",
    "batch_transformation_outputs",
    "warehouses",
    "batch_transformations",
    "stock_ledger_entries",
    "harvest_lot_batches",
  ]) {
    assert.match(migration, new RegExp(`\\('${table}','`));
  }
  assert.match(migration, /recompute_grain_processing_shadow_v1\(uuid\)/);
  assert.match(migration, /uq_batch_transformation_inputs_ticket_line_v1/);
  assert.match(migration, /source_ticket_line_idisnotnull/);
  assert.match(migration, /uq_batch_transformation_outputs_ticket_v1/);
  assert.match(migration, /source_ticket_idisnotnull/);
  assert.match(migration, /harvest_lot_batches_inventory_batch_id_key/);

  const db = new PGlite();
  try {
    await bootstrapPhysicalPrerequisites(db);
    await db.exec(migration);

    const created = (
      await db.query<{
        definition_md5: string;
        owner_name: string;
        security_definer: boolean;
        config: string[];
        acl: string[];
        comment_text: string;
      }>(`
        select
          md5(pg_get_functiondef(p.oid)) as definition_md5,
          pg_get_userbyid(p.proowner) as owner_name,
          p.prosecdef as security_definer,
          p.proconfig as config,
          array(
            select format(
              '%s:%s:%s:%s',
              case when acl.grantee = 0 then 'PUBLIC'
                   else pg_get_userbyid(acl.grantee) end,
              pg_get_userbyid(acl.grantor),
              acl.privilege_type,
              acl.is_grantable
            )
            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
            order by case when acl.grantee = 0 then 'PUBLIC'
                          else pg_get_userbyid(acl.grantee) end,
                     pg_get_userbyid(acl.grantor),
                     acl.privilege_type,
                     acl.is_grantable
          ) as acl,
          obj_description(p.oid, 'pg_proc') as comment_text
        from pg_proc p
        where p.oid = 'public.sync_grain_movement_shadow_v1(uuid)'::regprocedure
      `)
    ).rows[0];

    assert.deepEqual(created, {
      definition_md5: "1f943fc078f4384c6064ea077aa9b643",
      owner_name: "postgres",
      security_definer: true,
      config: ["search_path=public, pg_temp"],
      acl: [
        "postgres:postgres:EXECUTE:f",
        "service_role:postgres:EXECUTE:f",
      ],
      comment_text:
        "TZ281 automatic processing pass with one consolidated inbound ledger row per physical output batch.",
    });

    const beforeReplay = (
      await db.query<{ oid: number; definition_md5: string }>(`
        select p.oid, md5(pg_get_functiondef(p.oid)) as definition_md5
        from pg_proc p
        where p.oid = 'public.sync_grain_movement_shadow_v1(uuid)'::regprocedure
      `)
    ).rows[0];

    await db.exec(migration);

    const afterReplay = (
      await db.query<{ oid: number; definition_md5: string }>(`
        select p.oid, md5(pg_get_functiondef(p.oid)) as definition_md5
        from pg_proc p
        where p.oid = 'public.sync_grain_movement_shadow_v1(uuid)'::regprocedure
      `)
    ).rows[0];

    assert.deepEqual(afterReplay, beforeReplay, "repeat replay leaves the exact function intact");
    await assertSentinelUnchanged(db);

    await db.exec(`
      alter function public.sync_grain_movement_shadow_v1(uuid) security invoker;
    `);

    await assert.rejects(
      db.exec(migration),
      /definition drift|SECURITY DEFINER/i,
      "an existing drifted function must fail closed",
    );

    const remainedInvoker = (
      await db.query<{ security_definer: boolean }>(`
        select p.prosecdef as security_definer
        from pg_proc p
        where p.oid = 'public.sync_grain_movement_shadow_v1(uuid)'::regprocedure
      `)
    ).rows[0]?.security_definer;
    assert.equal(remainedInvoker, false, "fail-closed verification does not overwrite drift");
  } finally {
    await db.close();
  }

  const badDb = new PGlite();
  try {
    await bootstrapPhysicalPrerequisites(badDb);
    await badDb.exec(`alter table public.tickets drop column net_weight_kg`);
    await assert.rejects(
      badDb.exec(migration),
      /missing runtime columns:.*net_weight_kg/i,
      "a missing runtime column must fail before function creation",
    );
    await badDb.exec(`alter table public.tickets add column net_weight_kg numeric`);
    await badDb.exec(`
      drop index public.uq_batch_transformation_inputs_ticket_line_v1;
      create unique index uq_batch_transformation_inputs_ticket_line_v1
        on public.batch_transformation_inputs(source_ticket_line_id)
        where source_ticket_line_id is null;
    `);
    await assert.rejects(
      badDb.exec(migration),
      /index drift: public\.uq_batch_transformation_inputs_ticket_line_v1/i,
      "a non-inferable partial unique index must fail before function creation",
    );
    const absentAfterPreflightFailures = (
      await badDb.query<{ present: boolean }>(`
        select to_regprocedure('public.sync_grain_movement_shadow_v1(uuid)') is not null as present
      `)
    ).rows[0]?.present;
    assert.equal(absentAfterPreflightFailures, false);
    await assertSentinelUnchanged(badDb);
  } finally {
    await badDb.close();
  }

  console.log("TZ315 processing shadow sync prerequisite regression: PASS (18/18)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
