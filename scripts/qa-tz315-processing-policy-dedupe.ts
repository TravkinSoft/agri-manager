import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const aclMigrationUrl = new URL(
  "../supabase/migrations/20260830223144_tz315_processing_acl_corrective_v1.sql",
  import.meta.url,
);
const dedupeMigrationUrl = new URL(
  "../supabase/migrations/20260830223814_tz315_processing_select_policy_dedupe_v1.sql",
  import.meta.url,
);

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

const LEGACY_POLICIES = new Map<string, string>([
  ["stock_ledger_entries", "Users can view company stock ledger entries"],
  ["batch_transformation_losses", "batch_transformation_losses_read_v1"],
  ["batch_processing_events", "batch_processing_events_read_v1"],
  ["processing_documents", "Users can view company processing documents"],
]);

const COMPANY = "31520000-0000-4000-8000-000000000001";

async function rows(db: PGlite, sql: string) {
  return (await db.query<Record<string, any>>(sql)).rows;
}

async function scalar(db: PGlite, sql: string) {
  return (await rows(db, sql))[0]?.value;
}

async function bootstrap(db: PGlite, aclMigration: string) {
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
      grant all privileges on table public.${table}
        to public, anon, authenticated, service_role;
    `).join("\n")}

    ${Array.from(LEGACY_POLICIES.entries()).map(([table, policy]) => `
      create policy "${policy}"
        on public.${table}
        for select
        to authenticated
        using (company_id = public.get_user_company_id());
    `).join("\n")}

    create or replace function public.confirm_processing_document(uuid, uuid)
    returns uuid
    language sql
    security definer
    set search_path = public
    as $$ select $1 $$;
    grant execute on function public.confirm_processing_document(uuid, uuid)
      to public, anon, authenticated, service_role;

    insert into public.stock_ledger_entries(marker) values ('business-row');
  `);

  await db.exec(aclMigration);
}

async function policySnapshot(db: PGlite) {
  return rows(db, `
    select c.relname table_name,
      p.polname,
      p.polpermissive,
      p.polcmd,
      pg_get_expr(p.polqual, p.polrelid, true) using_expr,
      pg_get_expr(p.polwithcheck, p.polrelid, true) with_check_expr
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[${TARGETS.map((table) => `'${table}'`).join(",")}])
      and p.polcmd in ('r', '*')
      and (
        0::oid = any(p.polroles)
        or (select oid from pg_roles where rolname = 'authenticated') = any(p.polroles)
      )
    order by c.relname, p.polname
  `);
}

async function main() {
  const [aclMigration, dedupeMigration] = await Promise.all([
    readFile(aclMigrationUrl, "utf8"),
    readFile(dedupeMigrationUrl, "utf8"),
  ]);

  assert.match(dedupeMigration, /Pass 1: validate[\s\S]*Pass 2:/i);
  assert.match(dedupeMigration, /polqual::text = canonical\.polqual::text/i);
  assert.match(dedupeMigration, /refuses non-equivalent policies/i);
  assert.doesNotMatch(dedupeMigration, /\b(insert|update|delete|truncate)\s+(?:from\s+|into\s+)?public\./i);

  const db = new PGlite();
  await bootstrap(db, aclMigration);

  const beforePolicies = await policySnapshot(db);
  assert.equal(beforePolicies.length, TARGETS.length + LEGACY_POLICIES.size);
  for (const [table, legacyPolicy] of LEGACY_POLICIES) {
    assert.equal(
      beforePolicies.filter((row) => row.table_name === table).length,
      2,
      `${table} must start with the physical-QA duplicate shape`,
    );
    assert.ok(beforePolicies.some((row) => row.table_name === table && row.polname === legacyPolicy));
    assert.ok(beforePolicies.some((row) => row.table_name === table && row.polname === `tz315_${table}_read_v1`));
  }

  const tableContractBefore = await rows(db, `
    select c.relname table_name,
      pg_get_userbyid(c.relowner) owner,
      c.relrowsecurity,
      c.relforcerowsecurity,
      has_table_privilege('authenticated', c.oid, 'SELECT') authenticated_select,
      has_table_privilege('authenticated', c.oid, 'INSERT') authenticated_insert,
      has_table_privilege('service_role', c.oid, 'INSERT') service_insert
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[${TARGETS.map((table) => `'${table}'`).join(",")}])
    order by c.relname
  `);
  const businessRowsBefore = Number(await scalar(db, "select count(*)::int value from public.stock_ledger_entries"));

  await db.exec(dedupeMigration);
  const afterPolicies = await policySnapshot(db);
  assert.equal(afterPolicies.length, TARGETS.length);
  for (const table of TARGETS) {
    const policies = afterPolicies.filter((row) => row.table_name === table);
    assert.equal(policies.length, 1, `${table} must have one authenticated SELECT policy`);
    assert.equal(
      policies[0].polname,
      LEGACY_POLICIES.get(table) ?? `tz315_${table}_read_v1`,
    );
    assert.equal(policies[0].polpermissive, true);
    assert.equal(policies[0].polcmd, "r");
    assert.equal(policies[0].using_expr, "company_id = get_user_company_id()");
    assert.equal(policies[0].with_check_expr, null);
  }

  const tableContractAfter = await rows(db, `
    select c.relname table_name,
      pg_get_userbyid(c.relowner) owner,
      c.relrowsecurity,
      c.relforcerowsecurity,
      has_table_privilege('authenticated', c.oid, 'SELECT') authenticated_select,
      has_table_privilege('authenticated', c.oid, 'INSERT') authenticated_insert,
      has_table_privilege('service_role', c.oid, 'INSERT') service_insert
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[${TARGETS.map((table) => `'${table}'`).join(",")}])
    order by c.relname
  `);
  assert.deepEqual(tableContractAfter, tableContractBefore);
  assert.equal(
    Number(await scalar(db, "select count(*)::int value from public.stock_ledger_entries")),
    businessRowsBefore,
  );

  await db.exec(dedupeMigration);
  assert.deepEqual(await policySnapshot(db), afterPolicies, "second apply must be a no-op");
  await db.close();

  const driftDb = new PGlite();
  await bootstrap(driftDb, aclMigration);
  await driftDb.exec(`
    alter policy tz315_processing_documents_read_v1
      on public.processing_documents
      using (
        company_id = public.get_user_company_id()
        and marker is not null
      )
  `);

  const driftBefore = await policySnapshot(driftDb);
  await assert.rejects(
    () => driftDb.exec(dedupeMigration),
    /canonical policy drift|refuses non-equivalent policies/i,
  );
  assert.deepEqual(
    await policySnapshot(driftDb),
    driftBefore,
    "fail-closed validation must not remove any earlier-table policy",
  );
  await driftDb.close();

  console.log("TZ315 PROCESSING SELECT POLICY DEDUPE: PASS");
  console.log(JSON.stringify({
    migration: fileURLToPath(dedupeMigrationUrl),
    target_tables: TARGETS.length,
    duplicate_policies_before: LEGACY_POLICIES.size,
    authenticated_select_policies_after: TARGETS.length,
    owner_rls_grants: "UNCHANGED",
    business_rows: "UNCHANGED",
    repeat_safe: true,
    non_equivalent_policy: "FAIL_CLOSED",
  }, null, 2));
}

main().catch((error) => {
  console.error("TZ315 PROCESSING SELECT POLICY DEDUPE: FAIL");
  console.error(error);
  process.exitCode = 1;
});
