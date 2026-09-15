import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260916003440_p0_shared_impurity_finalize_tail_latency_v6.sql",
);
const finalizeRoutePath = join(
  process.cwd(),
  "app",
  "api",
  "weighbridge",
  "tickets",
  "[id]",
  "finalize",
  "route.ts",
);

const ID = {
  group: "66000000-0000-4000-8000-000000000001",
  company: "66000000-0000-4000-8000-000000000002",
  warehouse: "66000000-0000-4000-8000-000000000003",
  sourceA: "66000000-0000-4000-8000-000000000004",
  sourceB: "66000000-0000-4000-8000-000000000005",
  sourceC: "66000000-0000-4000-8000-000000000006",
  batchA: "66000000-0000-4000-8000-000000000007",
  batchB: "66000000-0000-4000-8000-000000000008",
  batchC: "66000000-0000-4000-8000-000000000009",
  ticket: "66000000-0000-4000-8000-000000000010",
} as const;

const scalar = async <T>(db: PGlite, sql: string) =>
  Object.values((await db.query(sql)).rows[0] as Record<string, unknown>)[0] as T;

async function main() {
  const db = new PGlite();
  try {
    const finalizeRoute = await readFile(finalizeRoutePath, "utf8");
    assert.match(finalizeRoute, /AMBIGUOUS_SHARED_IMPURITY_ERROR/);
    assert.match(finalizeRoute, /isCanonicallyFinalizedTicket\(recoveredTicket/);
    assert.match(finalizeRoute, /recovered_after_rpc_error:\s*true/);
    assert.match(finalizeRoute, /refresh_required:\s*refreshRequired/);
    assert.match(finalizeRoute, /shared_impurity_finalize_timeout/);

    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;

      create table public.weighbridge_shared_impurity_source_batches (
        id uuid primary key,
        group_id uuid not null,
        company_id uuid not null,
        warehouse_id uuid not null,
        inventory_batch_id uuid not null
      );
      create index weighbridge_shared_impurity_source_batches_group_idx
        on public.weighbridge_shared_impurity_source_batches(group_id);

      create table public.stock_ledger_entries (
        id bigint generated always as identity primary key,
        company_id uuid not null,
        warehouse_id uuid not null,
        inventory_batch_id uuid,
        batch_id_text text,
        batch_id text,
        delta_qty_signed numeric not null
      );
      create index idx_stock_ledger_company_wh_batch_v4
        on public.stock_ledger_entries(company_id, warehouse_id, inventory_batch_id)
        where inventory_batch_id is not null;

      create or replace function private.finalize_weighbridge_shared_impurity_pool_ticket_v1(
        p_ticket_id uuid,
        p_session_token text,
        p_tare_weight_kg numeric,
        p_tare_variance_confirmed boolean,
        p_idempotency_key uuid
      ) returns jsonb
      language plpgsql
      as $function$
      declare
        v_pool record;
      begin
        if exists (
          select 1
          from public.weighbridge_shared_impurity_source_batches source
          where source.group_id = v_pool.id
            and pg_catalog.abs(coalesce((
              select pg_catalog.sum(entry.delta_qty_signed)
              from public.stock_ledger_entries entry
              where entry.company_id = source.company_id
                and entry.warehouse_id = source.warehouse_id
                and coalesce(
                  entry.inventory_batch_id::text,
                  nullif(pg_catalog.btrim(entry.batch_id_text), ''),
                  nullif(pg_catalog.btrim(entry.batch_id), '')
                ) = source.inventory_batch_id::text
            ), 0)) > 0.001
        ) then
          raise exception 'SHARED_IMPURITY_SOURCE_NOT_ZERO'
            using errcode = '23514';
        end if;
        return '{}'::jsonb;
      end
      $function$;

      create or replace function private.settle_shared_impurity_members_v2(p_group_id uuid)
      returns jsonb
      language plpgsql
      as $function$
      declare
        v_group record;
      begin
        if exists (
          select 1
          from public.weighbridge_shared_impurity_source_batches source
          where source.group_id = v_group.id
            and source.company_id = v_group.company_id
            and pg_catalog.abs(coalesce((
              select pg_catalog.sum(entry.delta_qty_signed)
              from public.stock_ledger_entries entry
              where entry.company_id = source.company_id
                and entry.warehouse_id = source.warehouse_id
                and coalesce(
                  entry.inventory_batch_id::text,
                  nullif(pg_catalog.btrim(entry.batch_id_text), ''),
                  nullif(pg_catalog.btrim(entry.batch_id), '')
                ) = source.inventory_batch_id::text
            ), 0)) > 0.001
        ) then
          raise exception 'SHARED_IMPURITY_V2_SOURCE_NOT_ZERO'
            using errcode = '23514';
        end if;
        return '{}'::jsonb;
      end
      $function$;

      create or replace function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
        p_ticket_id uuid,
        p_session_token text,
        p_tare_weight_kg numeric,
        p_tare_variance_confirmed boolean,
        p_idempotency_key uuid
      ) returns jsonb language sql as $$ select '{}'::jsonb $$;
    `.replace(/^ {6}/gm, ""));

    const migration = await readFile(migrationPath, "utf8");
    await db.exec(migration);

    const finalizeDefinition = await scalar<string>(db, `
      select pg_get_functiondef(
        'private.finalize_weighbridge_shared_impurity_pool_ticket_v1(uuid,text,numeric,boolean,uuid)'::regprocedure
      )
    `);
    const settlementDefinition = await scalar<string>(db, `
      select pg_get_functiondef('private.settle_shared_impurity_members_v2(uuid)'::regprocedure)
    `);
    assert.match(finalizeDefinition, /shared_impurity_sources_have_nonzero_balance_v1/);
    assert.match(settlementDefinition, /shared_impurity_sources_have_nonzero_balance_v1/);
    assert.doesNotMatch(finalizeDefinition, /coalesce\(\s*entry\.inventory_batch_id::text/i);
    assert.doesNotMatch(settlementDefinition, /coalesce\(\s*entry\.inventory_batch_id::text/i);

    await db.exec(`
      insert into public.weighbridge_shared_impurity_source_batches(
        id, group_id, company_id, warehouse_id, inventory_batch_id
      ) values
        ('${ID.sourceA}', '${ID.group}', '${ID.company}', '${ID.warehouse}', '${ID.batchA}'),
        ('${ID.sourceB}', '${ID.group}', '${ID.company}', '${ID.warehouse}', '${ID.batchB}'),
        ('${ID.sourceC}', '${ID.group}', '${ID.company}', '${ID.warehouse}', '${ID.batchC}');

      insert into public.stock_ledger_entries(
        company_id, warehouse_id, inventory_batch_id, batch_id_text, batch_id, delta_qty_signed
      ) values
        ('${ID.company}', '${ID.warehouse}', '${ID.batchA}', null, null, 10),
        ('${ID.company}', '${ID.warehouse}', null, '  ${ID.batchB}  ', null, 20),
        ('${ID.company}', '${ID.warehouse}', null, '   ', '  ${ID.batchC}  ', 30);
    `);
    assert.equal(await scalar<boolean>(db, `
      select private.shared_impurity_sources_have_nonzero_balance_v1(
        '${ID.group}'::uuid,
        '${ID.company}'::uuid
      )
    `), true);

    await db.exec(`
      insert into public.stock_ledger_entries(
        company_id, warehouse_id, inventory_batch_id, batch_id_text, batch_id, delta_qty_signed
      ) values
        ('${ID.company}', '${ID.warehouse}', '${ID.batchA}', null, null, -10),
        ('${ID.company}', '${ID.warehouse}', null, '${ID.batchB}', null, -20),
        ('${ID.company}', '${ID.warehouse}', null, null, '${ID.batchC}', -30);
    `);
    assert.equal(await scalar<boolean>(db, `
      select private.shared_impurity_sources_have_nonzero_balance_v1(
        '${ID.group}'::uuid,
        '${ID.company}'::uuid
      )
    `), false);

    const grants = await db.query(`
      select has_function_privilege('anon', 'private.shared_impurity_sources_have_nonzero_balance_v1(uuid,uuid)', 'execute') as anon,
             has_function_privilege('authenticated', 'private.shared_impurity_sources_have_nonzero_balance_v1(uuid,uuid)', 'execute') as authenticated,
             has_function_privilege('service_role', 'private.shared_impurity_sources_have_nonzero_balance_v1(uuid,uuid)', 'execute') as service_role
    `);
    assert.deepEqual(grants.rows[0], { anon: false, authenticated: false, service_role: false });

    console.log("P0 SHARED IMPURITY TAIL LATENCY PASS");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("P0 SHARED IMPURITY TAIL LATENCY FAIL");
  console.error(error);
  process.exitCode = 1;
});
