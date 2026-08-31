import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260830223144_tz315_processing_acl_corrective_v1.sql",
  import.meta.url,
);
const processingRouteUrl = new URL("../app/api/processing/transformations/route.ts", import.meta.url);
const atomicCreateMigrationUrl = new URL(
  "../supabase/migrations/20260831102520_tz315_processing_create_atomic_v1.sql",
  import.meta.url,
);
const finalizeRouteUrl = new URL("../app/api/weighbridge/tickets/[id]/finalize/route.ts", import.meta.url);
const ledgerRouteUrl = new URL("../app/api/warehouses/transactions/_ledger.ts", import.meta.url);

const TARGETS = [
  "stock_ledger_entries",
  "inventory_batches",
  "batch_transformations",
  "batch_transformation_inputs",
  "batch_transformation_outputs",
  "batch_transformation_losses",
  "batch_processing_events",
  "processing_documents",
] as const;

const COMPANY = "31510000-0000-4000-8000-000000000001";
const FOREIGN_COMPANY = "31510000-0000-4000-8000-000000000002";

async function rows(db: PGlite, sql: string) {
  return (await db.query<Record<string, any>>(sql)).rows;
}

async function scalar(db: PGlite, sql: string) {
  return (await rows(db, sql))[0]?.value;
}

async function asRole<T>(db: PGlite, role: string, action: () => Promise<T>) {
  await db.exec(`set role ${role}`);
  try {
    return await action();
  } finally {
    await db.exec("reset role");
  }
}

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;

    create function public.get_user_company_id()
    returns uuid
    language sql
    stable
    as $$ select '${COMPANY}'::uuid $$;

    ${TARGETS.map((table) => `
      create table public.${table}(
        id uuid primary key default gen_random_uuid(),
        company_id uuid not null default '${COMPANY}'::uuid,
        marker text
      );
      alter table public.${table} enable row level security;
      create policy legacy_${table}_rw
        on public.${table}
        for all
        to authenticated
        using (company_id = public.get_user_company_id())
        with check (company_id = public.get_user_company_id());
      grant all privileges on table public.${table} to public, anon, authenticated, service_role;
    `).join("\n")}

    create or replace function public.confirm_processing_document(uuid, uuid)
    returns uuid
    language sql
    security definer
    set search_path = public
    as $$ select $1 $$;
    grant execute on function public.confirm_processing_document(uuid, uuid)
      to public, anon, authenticated, service_role;

    create or replace function public.tz315_acl_canonical_probe_v1(p_company_id uuid)
    returns uuid
    language plpgsql
    security definer
    set search_path = pg_catalog, public
    as $$
    declare
      v_id uuid;
    begin
      if p_company_id is distinct from current_setting('app.company_id', true)::uuid then
        raise exception 'FOREIGN_COMPANY_BLOCKED' using errcode = '42501';
      end if;
      insert into public.stock_ledger_entries(company_id, marker)
      values (p_company_id, 'canonical-rpc')
      returning id into v_id;
      return v_id;
    end;
    $$;
    revoke all on function public.tz315_acl_canonical_probe_v1(uuid) from public, anon;
    grant execute on function public.tz315_acl_canonical_probe_v1(uuid) to authenticated;
  `);
}

async function assertDirectDmlDenied(db: PGlite, role: "anon" | "authenticated", table: string) {
  const statements = [
    `insert into public.${table}(company_id, marker) values ('${COMPANY}', 'forged')`,
    `update public.${table} set marker = 'forged'`,
    `delete from public.${table}`,
    `truncate table public.${table}`,
  ];
  for (const statement of statements) {
    await assert.rejects(
      () => asRole(db, role, () => db.exec(statement)),
      new RegExp(`permission denied for table ${table}`, "i"),
    );
  }
}

async function main() {
  const [migration, atomicCreateMigration, processingRoute, finalizeRoute, ledgerRoute] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(atomicCreateMigrationUrl, "utf8"),
    readFile(processingRouteUrl, "utf8"),
    readFile(finalizeRouteUrl, "utf8"),
    readFile(ledgerRouteUrl, "utf8"),
  ]);

  for (const table of TARGETS) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger[\s\S]*from authenticated/i);
  assert.match(migration, /grant select[\s\S]*to authenticated, service_role/i);
  assert.match(migration, /grant insert, update, delete[\s\S]*to service_role/i);
  assert.match(migration, /p\.polcmd in \('\*', 'a', 'w', 'd'\)/i);
  assert.match(migration, /alter function public\.confirm_processing_document\(uuid, uuid\)[\s\S]*search_path = pg_catalog, public/i);
  assert.match(migration, /revoke all on function public\.confirm_processing_document\(uuid, uuid\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.confirm_processing_document\(uuid, uuid\)[\s\S]*to service_role/i);

  const processingPost = processingRoute.slice(processingRoute.indexOf("export async function POST"));
  assert.match(processingPost, /resolveWeighbridgeSession[\s\S]*allowedRoles: WEIGHBRIDGE_WRITE_ROLES/i);
  assert.match(processingPost, /supabase\.rpc\("create_processing_transformation_atomic_v1"/i);
  assert.match(processingPost, /p_actor_user_id: actor\.id[\s\S]*p_company_id: companyId/i);
  assert.doesNotMatch(processingPost, /getServiceClient|mutationClient|cleanup/i);
  assert.doesNotMatch(
    processingPost,
    /\.from\("(?:batch_transformations|batch_transformation_inputs|batch_transformation_outputs|tickets)"\)[\s\S]*?\.(?:insert|update|delete)\(/i,
  );
  assert.match(atomicCreateMigration, /perform private\.tz315_lock_company_season_write_gate_v1\(/i);
  assert.match(atomicCreateMigration, /revoke all on function public\.create_processing_transformation_atomic_v1[\s\S]*from public, anon, service_role/i);
  assert.match(atomicCreateMigration, /grant execute on function public\.create_processing_transformation_atomic_v1[\s\S]*to authenticated/i);

  assert.match(finalizeRoute, /resolveWeighbridgeSession[\s\S]*WEIGHBRIDGE_WRITE_ROLES/i);
  assert.match(finalizeRoute, /const mutationClient = getServiceClient\(\)[\s\S]*\.from\("inventory_batches"\)[\s\S]*\.eq\("company_id", companyId\)[\s\S]*\.eq\("source_ticket_id", ticketId\)/i);
  assert.doesNotMatch(finalizeRoute, /supabase[\s\S]{0,100}\.from\("inventory_batches"\)[\s\S]{0,100}\.update\(/i);

  assert.match(ledgerRoute, /rpc\("post_inventory_transaction_to_ledger"/i);
  assert.doesNotMatch(ledgerRoute, /\.from\("stock_ledger_entries"\)[\s\S]*\.insert\(/i);
  assert.doesNotMatch(ledgerRoute, /fallback/i);

  const db = new PGlite();
  await bootstrap(db);
  const functionOwnerBefore = await scalar(db, `
    select pg_get_userbyid(p.proowner) value
    from pg_proc p
    where p.oid = 'public.confirm_processing_document(uuid,uuid)'::regprocedure
  `);

  await db.exec(migration);
  await db.exec(migration);

  const privilegeMatrix = await rows(db, `
    select role_name, table_name,
      has_table_privilege(role_name, format('public.%I', table_name), 'SELECT') can_select,
      has_table_privilege(role_name, format('public.%I', table_name), 'INSERT') can_insert,
      has_table_privilege(role_name, format('public.%I', table_name), 'UPDATE') can_update,
      has_table_privilege(role_name, format('public.%I', table_name), 'DELETE') can_delete,
      has_table_privilege(role_name, format('public.%I', table_name), 'TRUNCATE') can_truncate,
      has_table_privilege(role_name, format('public.%I', table_name), 'REFERENCES') can_references,
      has_table_privilege(role_name, format('public.%I', table_name), 'TRIGGER') can_trigger
    from unnest(array['anon','authenticated','service_role']) role_name
    cross join unnest(array[${TARGETS.map((table) => `'${table}'`).join(",")}]) table_name
    order by role_name, table_name
  `);
  assert.equal(privilegeMatrix.length, TARGETS.length * 3);
  for (const row of privilegeMatrix) {
    if (row.role_name === "anon") {
      assert.deepEqual(
        [row.can_select, row.can_insert, row.can_update, row.can_delete, row.can_truncate, row.can_references, row.can_trigger],
        [false, false, false, false, false, false, false],
      );
    } else if (row.role_name === "authenticated") {
      assert.deepEqual(
        [row.can_select, row.can_insert, row.can_update, row.can_delete, row.can_truncate, row.can_references, row.can_trigger],
        [true, false, false, false, false, false, false],
      );
    } else {
      assert.deepEqual(
        [row.can_select, row.can_insert, row.can_update, row.can_delete, row.can_truncate, row.can_references, row.can_trigger],
        [true, true, true, true, false, false, false],
      );
    }
  }

  for (const table of TARGETS) {
    await assertDirectDmlDenied(db, "anon", table);
    await assertDirectDmlDenied(db, "authenticated", table);
  }

  await asRole(db, "service_role", async () => {
    await db.exec(`insert into public.batch_transformations(company_id, marker) values ('${COMPANY}', 'server')`);
    await db.exec("update public.batch_transformations set marker = 'server-updated'");
    await db.exec("delete from public.batch_transformations where marker = 'server-updated'");
  });

  await db.exec(`select set_config('app.company_id', '${COMPANY}', false)`);
  const rpcId = await asRole(db, "authenticated", () => scalar(db, `
    select public.tz315_acl_canonical_probe_v1('${COMPANY}') value
  `));
  assert.ok(rpcId);
  assert.equal(
    Number(await scalar(db, "select count(*) value from public.stock_ledger_entries where marker='canonical-rpc'")),
    1,
  );
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(`select public.tz315_acl_canonical_probe_v1('${FOREIGN_COMPANY}')`)),
    /FOREIGN_COMPANY_BLOCKED/i,
  );

  const mutationPolicies = await scalar(db, `
    select count(*)::int value
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[${TARGETS.map((table) => `'${table}'`).join(",")}])
      and p.polcmd in ('*','a','w','d')
      and (0::oid = any(p.polroles) or (select oid from pg_roles where rolname='authenticated') = any(p.polroles))
  `);
  assert.equal(Number(mutationPolicies), 0);

  const readPolicyCount = await scalar(db, `
    select count(*)::int value
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[${TARGETS.map((table) => `'${table}'`).join(",")}])
      and p.polcmd = 'r'
      and p.polname like 'tz315_%_read_v1'
  `);
  assert.equal(Number(readPolicyCount), TARGETS.length);

  const functionContract = (await rows(db, `
    select pg_get_userbyid(p.proowner) owner,
      p.prosecdef security_definer,
      p.proconfig,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') authenticated_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE') service_execute
    from pg_proc p
    where p.oid = 'public.confirm_processing_document(uuid,uuid)'::regprocedure
  `))[0];
  assert.equal(functionContract.owner, functionOwnerBefore);
  assert.equal(functionContract.security_definer, true);
  assert.deepEqual(functionContract.proconfig, ["search_path=pg_catalog, public"]);
  assert.equal(functionContract.anon_execute, false);
  assert.equal(functionContract.authenticated_execute, false);
  assert.equal(functionContract.service_execute, true);

  assert.equal(
    await scalar(db, "select has_table_privilege(current_user, 'public.stock_ledger_entries', 'TRUNCATE') value"),
    true,
    "table owner privileges must remain intact",
  );

  console.log("TZ315 PROCESSING ACL CORRECTIVE: PASS");
  console.log(JSON.stringify({
    migration: fileURLToPath(migrationUrl),
    direct_anon_dml: "BLOCKED",
    direct_authenticated_dml: "BLOCKED",
    authenticated_select: "PRESERVED",
    service_role_dml: "SELECT_INSERT_UPDATE_DELETE",
    service_role_ddl_like_rights: "BLOCKED",
    owner_rights: "PRESERVED",
    canonical_rpc_same_company: "PASS",
    canonical_rpc_foreign_company: "BLOCKED",
    latent_mutation_policies: 0,
    repeat_safe: true,
  }, null, 2));
  await db.close();
}

main().catch((error) => {
  console.error("TZ315 PROCESSING ACL CORRECTIVE: FAIL");
  console.error(error);
  process.exitCode = 1;
});
