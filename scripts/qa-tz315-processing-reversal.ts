import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260830175841_tz315_processing_reversal_reconcile_v1.sql",
  import.meta.url,
);
const privilegeMigrationUrl = new URL(
  "../supabase/migrations/20260830191313_tz315_processing_reversal_privilege_corrective_v1.sql",
  import.meta.url,
);

type Row = Record<string, unknown>;
const rows = async (db: PGlite, sql: string) => (await db.query(sql)).rows as Row[];
const scalar = async (db: PGlite, sql: string) => Object.values((await rows(db, sql))[0] ?? {})[0];

const COMPANY = "31500000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "31500000-0000-4000-8000-000000000002";
const SEASON = "31500000-0000-4000-8000-000000000011";
const OTHER_SEASON = "31500000-0000-4000-8000-000000000012";
const ACTOR = "31500000-0000-4000-8000-000000000021";
const OTHER_ACTOR = "31500000-0000-4000-8000-000000000022";
const WAREHOUSE = "31500000-0000-4000-8000-000000000031";
const PRODUCT = "31500000-0000-4000-8000-000000000041";

type OutputSeed = { ticket: string; batch: string; quantity: number };
type CaseSeed = {
  transformation: string;
  sourceBatch: string;
  transformationType: "cleaning" | "drying";
  inputQuantity: number;
  lossQuantity: number;
  lossType: "dust" | "spillage" | "moisture_loss";
  postsLossLedger: boolean;
  outputs: OutputSeed[];
};

const CLEANING: CaseSeed = {
  transformation: "31500000-0000-4000-8000-000000000101",
  sourceBatch: "31500000-0000-4000-8000-000000000102",
  transformationType: "cleaning",
  inputQuantity: 100,
  lossQuantity: 10,
  lossType: "dust",
  postsLossLedger: true,
  outputs: [
    {
      ticket: "31500000-0000-4000-8000-000000000103",
      batch: "31500000-0000-4000-8000-000000000104",
      quantity: 70,
    },
    {
      ticket: "31500000-0000-4000-8000-000000000105",
      batch: "31500000-0000-4000-8000-000000000106",
      quantity: 20,
    },
  ],
};

const DRYING: CaseSeed = {
  transformation: "31500000-0000-4000-8000-000000000201",
  sourceBatch: "31500000-0000-4000-8000-000000000202",
  transformationType: "drying",
  inputQuantity: 50,
  lossQuantity: 5,
  lossType: "moisture_loss",
  postsLossLedger: false,
  outputs: [
    {
      ticket: "31500000-0000-4000-8000-000000000203",
      batch: "31500000-0000-4000-8000-000000000204",
      quantity: 45,
    },
  ],
};

const DOWNSTREAM: CaseSeed = {
  transformation: "31500000-0000-4000-8000-000000000301",
  sourceBatch: "31500000-0000-4000-8000-000000000302",
  transformationType: "cleaning",
  inputQuantity: 100,
  lossQuantity: 20,
  lossType: "spillage",
  postsLossLedger: true,
  outputs: [
    {
      ticket: "31500000-0000-4000-8000-000000000303",
      batch: "31500000-0000-4000-8000-000000000304",
      quantity: 80,
    },
  ],
};

const FOREIGN: CaseSeed = {
  transformation: "31500000-0000-4000-8000-000000000401",
  sourceBatch: "31500000-0000-4000-8000-000000000402",
  transformationType: "drying",
  inputQuantity: 20,
  lossQuantity: 2,
  lossType: "moisture_loss",
  postsLossLedger: false,
  outputs: [
    {
      ticket: "31500000-0000-4000-8000-000000000403",
      batch: "31500000-0000-4000-8000-000000000404",
      quantity: 18,
    },
  ],
};

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema private;

    create type public.ledger_direction as enum ('in', 'out');

    create table public.companies(id uuid primary key, name text);
    create table public.seasons(id uuid primary key, company_id uuid not null);
    create table public.warehouses(id uuid primary key, company_id uuid not null);
    create table public.processing_nodes(id uuid primary key, company_id uuid not null);
    create table public.profiles(
      id uuid primary key,
      company_id uuid,
      role text not null,
      status text not null default 'active'
    );
    create table public.batch_transformations(
      id uuid primary key,
      company_id uuid not null,
      season_id uuid not null,
      node_warehouse_id uuid not null,
      processing_node_id uuid,
      transformation_type text not null,
      harvest_lot_id uuid,
      source_physical_state text,
      status text not null,
      processing_state text not null,
      closed_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create table public.batch_transformation_inputs(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      transformation_id uuid not null,
      batch_id uuid,
      warehouse_from_id uuid,
      node_warehouse_id uuid
    );
    create table public.batch_transformation_outputs(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      transformation_id uuid not null,
      output_batch_id uuid,
      source_ticket_id uuid,
      warehouse_to_id uuid,
      output_weight_kg numeric,
      output_type text not null default 'main_product'
    );
    create table public.batch_transformation_losses(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      transformation_id uuid not null,
      loss_type text,
      qty_kg numeric
    );
    create table public.inventory_batches(
      id uuid primary key,
      company_id uuid not null,
      season_id uuid,
      warehouse_id uuid not null,
      parent_batch_id uuid,
      source_transformation_id uuid,
      current_quantity numeric not null default 0,
      current_weight_kg numeric not null default 0,
      mass_kg numeric not null default 0
    );
    create table public.tickets(
      id uuid primary key,
      company_id uuid not null,
      status text not null,
      is_finalized boolean not null default false,
      is_voided boolean not null default false,
      batch_id uuid,
      season_id uuid,
      linked_processing_id uuid,
      voided_at timestamptz,
      voided_by uuid,
      void_reason text
    );
    create table public.ticket_lines(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid not null,
      batch_id text,
      destination_batch_id uuid
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      ticket_id uuid,
      processing_id uuid,
      product_id uuid not null,
      warehouse_id uuid not null,
      direction public.ledger_direction not null,
      quantity numeric not null,
      uom text not null default 'kg',
      delta_qty_signed numeric not null,
      reason_type text not null,
      reason_ref_id uuid,
      batch_id text,
      occurred_at timestamptz not null default now(),
      created_by uuid,
      is_storno boolean not null default false,
      storno_of_entry_id uuid,
      notes text,
      variety_id uuid,
      reproduction_id uuid,
      batch_id_text text,
      batch_class text,
      operation_line_id uuid,
      mass_kg numeric,
      density_kg_per_l numeric,
      density_unit text,
      density_source text,
      density_verification_status text,
      density_verified_at timestamptz,
      unit_source text,
      unit_contract_version smallint,
      warehouse_issue_allocation_id uuid,
      crop_id uuid,
      inventory_batch_id uuid,
      created_at timestamptz not null default now()
    );
    create table public.batch_processing_events(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      transformation_id uuid not null,
      event_type text not null,
      actor_type text not null,
      actor_user_id uuid,
      idempotency_key text not null,
      observed_at timestamptz not null,
      payload jsonb not null,
      unique(company_id, transformation_id, event_type, idempotency_key)
    );
    create table public.warehouse_issue_request_item_allocations(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      batch_id uuid,
      prepared_quantity numeric,
      issued_quantity numeric
    );
    create table public.inventory_transactions(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      inventory_batch_id uuid,
      status text
    );

    create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create or replace function public.get_user_company_id() returns uuid language sql stable security definer as
      $$ select company_id from public.profiles where id = auth.uid() $$;
    create or replace function public.tz297_assert_processing_actor_v1(
      p_company_id uuid, p_actor_user_id uuid, p_allowed_roles text[]
    ) returns void language plpgsql as $$
    declare v_profile public.profiles%rowtype;
    begin
      select * into v_profile from public.profiles where id = p_actor_user_id;
      if not found
         or v_profile.company_id is distinct from p_company_id
         or v_profile.status <> 'active'
         or not (v_profile.role = any(p_allowed_roles)) then
        raise exception 'PROCESSING_ACTOR_FORBIDDEN' using errcode = '42501';
      end if;
    end $$;
    create or replace function public.tz297_processing_context_lock_key_v1(
      p_company_id uuid, p_season_id uuid, p_node_warehouse_id uuid,
      p_processing_node_id uuid, p_transformation_type text,
      p_harvest_lot_id uuid, p_source_physical_state text
    ) returns bigint language sql immutable as $$
      select hashtextextended(concat_ws('|', p_company_id, p_season_id,
        p_node_warehouse_id, p_processing_node_id, p_transformation_type,
        p_harvest_lot_id, p_source_physical_state), 0)
    $$;
    create or replace function public.void_ticket_with_storno_v2(
      p_ticket_id uuid, p_actor_user_id uuid, p_reason text
    ) returns jsonb language plpgsql as $$
    begin
      update public.tickets
      set status = 'voided', is_voided = true, voided_at = now(),
          voided_by = p_actor_user_id, void_reason = p_reason
      where id = p_ticket_id;
      return jsonb_build_object('ok', true, 'ticket_id', p_ticket_id);
    end $$;
    create or replace function private.reconcile_warehouse_local_batch_balance_v1(
      p_batch_id uuid
    ) returns jsonb language plpgsql as $$
    declare v_balance numeric;
    begin
      select round(coalesce(sum(sle.delta_qty_signed), 0), 6)
      into v_balance
      from public.inventory_batches b
      left join public.stock_ledger_entries sle
        on sle.company_id = b.company_id
       and sle.warehouse_id = b.warehouse_id
       and coalesce(sle.inventory_batch_id::text, nullif(sle.batch_id_text, ''),
                    nullif(sle.batch_id, '')) = b.id::text
      where b.id = p_batch_id;
      update public.inventory_batches
      set current_quantity = greatest(v_balance, 0),
          current_weight_kg = greatest(v_balance, 0),
          mass_kg = greatest(v_balance, 0)
      where id = p_batch_id;
      return jsonb_build_object('batch_id', p_batch_id, 'balance', v_balance);
    end $$;

    insert into public.companies(id, name) values
      ('${COMPANY}', 'TZ315 QA'), ('${OTHER_COMPANY}', 'TZ315 foreign');
    insert into public.seasons(id, company_id) values
      ('${SEASON}', '${COMPANY}'), ('${OTHER_SEASON}', '${OTHER_COMPANY}');
    insert into public.warehouses(id, company_id) values ('${WAREHOUSE}', '${COMPANY}');
    insert into public.profiles(id, company_id, role, status) values
      ('${ACTOR}', '${COMPANY}', 'company_admin', 'active'),
      ('${OTHER_ACTOR}', '${OTHER_COMPANY}', 'company_admin', 'active');
    grant select on public.profiles to authenticated;
    select set_config('app.uid', '${ACTOR}', false);
  `);
}

async function seedCase(db: PGlite, seed: CaseSeed) {
  const outputTickets = seed.outputs.map((output) => `(
    '${output.ticket}', '${COMPANY}', 'finalized', true, false, '${SEASON}', '${seed.transformation}'
  )`).join(",");
  const outputBatches = seed.outputs.map((output) => `(
    '${output.batch}', '${COMPANY}', '${SEASON}', '${WAREHOUSE}', '${seed.sourceBatch}',
    '${seed.transformation}', ${output.quantity}, ${output.quantity}, ${output.quantity}
  )`).join(",");
  const outputDocuments = seed.outputs.map((output) => `(
    '${COMPANY}', '${seed.transformation}', '${output.batch}', '${output.ticket}',
    '${WAREHOUSE}', ${output.quantity}, 'main_product'
  )`).join(",");
  const outputLedger = seed.outputs.map((output) => `(
    '${COMPANY}', '${output.ticket}', '${seed.transformation}', '${PRODUCT}', '${WAREHOUSE}',
    'in', ${output.quantity}, ${output.quantity}, 'processing_output', '${seed.transformation}',
    '${output.batch}', '${output.batch}', ${output.quantity}
  )`).join(",");
  const lossLedger = seed.postsLossLedger
    ? `,('${COMPANY}', null, '${seed.transformation}', '${PRODUCT}', '${WAREHOUSE}', 'out',
       ${seed.lossQuantity}, -${seed.lossQuantity}, 'processing_loss', '${seed.transformation}',
       null, null, ${seed.lossQuantity})`
    : "";

  await db.exec(`
    insert into public.batch_transformations(
      id, company_id, season_id, node_warehouse_id, transformation_type,
      source_physical_state, status, processing_state, closed_at
    ) values (
      '${seed.transformation}', '${COMPANY}', '${SEASON}', '${WAREHOUSE}',
      '${seed.transformationType}', 'SOURCE', 'completed', 'processing_closed', now()
    );
    insert into public.inventory_batches(
      id, company_id, season_id, warehouse_id, parent_batch_id, source_transformation_id,
      current_quantity, current_weight_kg, mass_kg
    ) values (
      '${seed.sourceBatch}', '${COMPANY}', '${SEASON}', '${WAREHOUSE}', null, null, 0, 0, 0
    ), ${outputBatches};
    insert into public.batch_transformation_inputs(
      company_id, transformation_id, batch_id, warehouse_from_id, node_warehouse_id
    ) values ('${COMPANY}', '${seed.transformation}', '${seed.sourceBatch}', '${WAREHOUSE}', '${WAREHOUSE}');
    insert into public.tickets(
      id, company_id, status, is_finalized, is_voided, season_id, linked_processing_id
    )
    values ${outputTickets};
    insert into public.batch_transformation_outputs(
      company_id, transformation_id, output_batch_id, source_ticket_id,
      warehouse_to_id, output_weight_kg, output_type
    ) values ${outputDocuments};
    insert into public.batch_transformation_losses(
      company_id, transformation_id, loss_type, qty_kg
    ) values ('${COMPANY}', '${seed.transformation}', '${seed.lossType}', ${seed.lossQuantity});

    insert into public.stock_ledger_entries(
      company_id, ticket_id, processing_id, product_id, warehouse_id,
      direction, quantity, delta_qty_signed, reason_type, reason_ref_id,
      inventory_batch_id, batch_id_text, mass_kg
    ) values
      ('${COMPANY}', null, null, '${PRODUCT}', '${WAREHOUSE}', 'in',
       ${seed.inputQuantity}, ${seed.inputQuantity}, 'opening_balance', null,
       '${seed.sourceBatch}', '${seed.sourceBatch}', ${seed.inputQuantity}),
      ('${COMPANY}', null, '${seed.transformation}', '${PRODUCT}', '${WAREHOUSE}', 'out',
       ${seed.inputQuantity}, -${seed.inputQuantity}, 'processing_input', '${seed.transformation}',
       '${seed.sourceBatch}', '${seed.sourceBatch}', ${seed.inputQuantity})
      ${lossLedger},
      ${outputLedger};
  `);
}

async function reverse(
  db: PGlite,
  transformation: string,
  key: string,
  reason = "TZ315 verified reversal",
  actor = ACTOR,
  company = COMPANY,
  season = SEASON,
) {
  return (await rows(db, `select public.reverse_processing_material_balance_v1(
    '${transformation}', '${company}', '${season}', '${actor}',
    '${reason.replaceAll("'", "''")}', '${key}', 'TZ315-PGLITE'
  ) as result`))[0].result as Record<string, unknown>;
}

async function asRole<T>(
  db: PGlite,
  role: "authenticated" | "service_role",
  action: () => Promise<T>,
) {
  await db.exec(`set role ${role}`);
  try {
    return await action();
  } finally {
    await db.exec("reset role");
  }
}

async function assertDirectReceiptDmlDenied(
  db: PGlite,
  role: "authenticated" | "service_role",
) {
  const statements = [
    `insert into public.batch_processing_reversals (
       company_id, season_id, transformation_id, actor_user_id, reason,
       idempotency_key, request_fingerprint, snapshot
     ) values (
       '${COMPANY}', '${SEASON}', gen_random_uuid(), '${ACTOR}', 'forged',
       'forged-${role}', md5('forged-${role}'), '{}'::jsonb
     )`,
    "update public.batch_processing_reversals set reason = reason",
    "delete from public.batch_processing_reversals",
    "truncate table public.batch_processing_reversals",
  ];

  for (const statement of statements) {
    await assert.rejects(
      () => asRole(db, role, () => db.exec(statement)),
      /permission denied for table batch_processing_reversals/i,
    );
  }
}

async function selectedEffect(db: PGlite, transformation: string) {
  return Number(await scalar(db, `
    select round(coalesce(sum(sle.delta_qty_signed), 0), 6)
    from public.stock_ledger_entries sle
    where (sle.processing_id = '${transformation}' and sle.ticket_id is null)
       or sle.ticket_id in (
         select source_ticket_id from public.batch_transformation_outputs
         where transformation_id = '${transformation}' and source_ticket_id is not null
       )
  `));
}

async function main() {
  const migration = await readFile(migrationUrl, "utf8");
  const privilegeMigration = await readFile(privilegeMigrationUrl, "utf8");

  assert.match(migration, /create table if not exists public\.batch_processing_reversals/i);
  assert.match(migration, /create unique index if not exists uq_stock_ledger_storno_target_v1/i);
  assert.match(migration, /storno_processing_reversal/i);
  assert.match(migration, /private\.reconcile_warehouse_local_batch_balance_v1/i);
  assert.match(migration, /PROCESSING_REVERSAL_DOWNSTREAM_DEPENDENCY/i);
  assert.match(migration, /PROCESSING_REVERSAL_IDEMPOTENCY_CONFLICT/i);
  assert.match(migration, /PROCESSING_REVERSAL_RECEIPT_IMMUTABLE/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(?:stock_ledger_entries|inventory_batches|batch_transformations|batch_transformation_inputs|batch_transformation_outputs|batch_transformation_losses)/i);
  assert.doesNotMatch(migration, /truncate\s+(?:table\s+)?public\./i);
  assert.match(privilegeMigration, /revoke all privileges\s+on table public\.batch_processing_reversals\s+from public, anon, authenticated, service_role/i);
  assert.match(privilegeMigration, /grant select\s+on table public\.batch_processing_reversals\s+to authenticated, service_role/i);
  assert.doesNotMatch(privilegeMigration, /\b(?:insert|update|delete|truncate)\b\s+(?:on|into|from|table)?\s*public\.batch_processing_reversals/i);

  const db = new PGlite();
  await bootstrap(db);
  await db.exec(migration);
  await db.exec(privilegeMigration);

  const privilegeMatrix = await rows(db, `
    select role_name,
      has_table_privilege(role_name, 'public.batch_processing_reversals', 'SELECT') as can_select,
      has_table_privilege(role_name, 'public.batch_processing_reversals', 'INSERT') as can_insert,
      has_table_privilege(role_name, 'public.batch_processing_reversals', 'UPDATE') as can_update,
      has_table_privilege(role_name, 'public.batch_processing_reversals', 'DELETE') as can_delete,
      has_table_privilege(role_name, 'public.batch_processing_reversals', 'TRUNCATE') as can_truncate,
      has_table_privilege(role_name, 'public.batch_processing_reversals', 'REFERENCES') as can_references,
      has_table_privilege(role_name, 'public.batch_processing_reversals', 'TRIGGER') as can_trigger
    from (values ('authenticated'), ('service_role')) roles(role_name)
    order by role_name
  `);
  assert.deepEqual(privilegeMatrix, [
    {
      role_name: "authenticated", can_select: true, can_insert: false,
      can_update: false, can_delete: false, can_truncate: false,
      can_references: false, can_trigger: false,
    },
    {
      role_name: "service_role", can_select: true, can_insert: false,
      can_update: false, can_delete: false, can_truncate: false,
      can_references: false, can_trigger: false,
    },
  ]);
  await assertDirectReceiptDmlDenied(db, "authenticated");
  await assertDirectReceiptDmlDenied(db, "service_role");

  await seedCase(db, CLEANING);
  const cleaningResult = await asRole(
    db,
    "authenticated",
    () => reverse(db, CLEANING.transformation, "tz315-cleaning-1"),
  );
  assert.equal(cleaningResult.ok, true);
  assert.equal(cleaningResult.idempotent_replay, false);
  assert.equal(Number(cleaningResult.base_ledger_rows), 4, "input + ticketless loss + two output fractions");
  assert.equal(Number(cleaningResult.storno_created), 4);
  assert.equal(await selectedEffect(db, CLEANING.transformation), 0, "all selected cleaning effects must net to zero");
  assert.equal(Number(await scalar(db, `select current_quantity from public.inventory_batches where id='${CLEANING.sourceBatch}'`)), 100);
  for (const output of CLEANING.outputs) {
    assert.equal(Number(await scalar(db, `select current_quantity from public.inventory_batches where id='${output.batch}'`)), 0);
  }
  assert.equal(Number(await scalar(db, `
    select count(*)
    from public.stock_ledger_entries reversal
    join public.stock_ledger_entries base on base.id = reversal.storno_of_entry_id
    where base.processing_id='${CLEANING.transformation}'
      and base.ticket_id is null
      and base.reason_type='processing_loss'
      and reversal.is_storno
      and reversal.delta_qty_signed = -base.delta_qty_signed
  `)), 1, "ticket_id-null technological loss must be compensated");

  const receiptCount = await asRole(
    db,
    "authenticated",
    () => scalar(db, `select count(*) from public.batch_processing_reversals where transformation_id='${CLEANING.transformation}'`),
  );
  assert.equal(Number(receiptCount), 1, "authenticated caller must read its canonical receipt");

  const cleaningReplay = await asRole(
    db,
    "authenticated",
    () => reverse(db, CLEANING.transformation, "tz315-cleaning-1"),
  );
  assert.equal(cleaningReplay.idempotent_replay, true);
  assert.equal(Number(await scalar(db, `select count(*) from public.stock_ledger_entries where is_storno and processing_id='${CLEANING.transformation}'`)), 4);
  await assert.rejects(
    () => reverse(db, CLEANING.transformation, "tz315-cleaning-1", "different payload"),
    /PROCESSING_REVERSAL_IDEMPOTENCY_CONFLICT/,
  );
  await assert.rejects(
    () => rows(db, `update public.batch_processing_reversals set reason='tamper' where transformation_id='${CLEANING.transformation}'`),
    /PROCESSING_REVERSAL_RECEIPT_IMMUTABLE/,
  );
  await assert.rejects(
    () => rows(db, `update public.batch_transformations set status='completed' where id='${CLEANING.transformation}'`),
    /PROCESSING_REVERSED_STATE_IMMUTABLE/,
  );
  await assert.rejects(
    () => rows(db, `update public.batch_transformation_outputs set output_weight_kg=1 where transformation_id='${CLEANING.transformation}'`),
    /PROCESSING_REVERSED_DOCUMENTS_IMMUTABLE/,
  );
  await assert.rejects(
    () => rows(db, `update public.batch_transformation_outputs set transformation_id='31500000-0000-4000-8000-000000009999' where transformation_id='${CLEANING.transformation}'`),
    /PROCESSING_REVERSED_DOCUMENTS_IMMUTABLE/,
  );
  await assert.rejects(
    () => rows(db, `delete from public.batch_transformation_losses where transformation_id='${CLEANING.transformation}'`),
    /PROCESSING_REVERSED_DOCUMENTS_IMMUTABLE/,
  );

  await seedCase(db, DRYING);
  const dryingResult = await reverse(db, DRYING.transformation, "tz315-drying-1", "verified drying reversal");
  assert.equal(dryingResult.ok, true);
  assert.equal(Number(dryingResult.base_ledger_rows), 2, "input + output; theoretical moisture loss has no ledger effect");
  assert.equal(await selectedEffect(db, DRYING.transformation), 0);
  assert.equal(Number(await scalar(db, `select current_quantity from public.inventory_batches where id='${DRYING.sourceBatch}'`)), 50);
  assert.equal(Number(await scalar(db, `select current_quantity from public.inventory_batches where id='${DRYING.outputs[0].batch}'`)), 0);

  await seedCase(db, DOWNSTREAM);
  await db.exec(`
    update public.inventory_batches
    set current_quantity=70, current_weight_kg=70, mass_kg=70
    where id='${DOWNSTREAM.outputs[0].batch}';
    insert into public.stock_ledger_entries(
      company_id, ticket_id, processing_id, product_id, warehouse_id,
      direction, quantity, delta_qty_signed, reason_type, reason_ref_id,
      inventory_batch_id, batch_id_text, mass_kg
    ) values (
      '${COMPANY}', null, null, '${PRODUCT}', '${WAREHOUSE}', 'out', 10, -10,
      'warehouse_issue', gen_random_uuid(), '${DOWNSTREAM.outputs[0].batch}',
      '${DOWNSTREAM.outputs[0].batch}', 10
    );
  `);
  const beforeBlocked = (await rows(db, `
    select
      (select count(*) from public.stock_ledger_entries where processing_id='${DOWNSTREAM.transformation}') ledger_rows,
      (select current_quantity from public.inventory_batches where id='${DOWNSTREAM.outputs[0].batch}') child_balance,
      (select status from public.batch_transformations where id='${DOWNSTREAM.transformation}') status
  `))[0];
  await assert.rejects(
    () => reverse(db, DOWNSTREAM.transformation, "tz315-downstream-1"),
    /PROCESSING_REVERSAL_DOWNSTREAM_DEPENDENCY/,
  );
  const afterBlocked = (await rows(db, `
    select
      (select count(*) from public.stock_ledger_entries where processing_id='${DOWNSTREAM.transformation}') ledger_rows,
      (select count(*) from public.stock_ledger_entries where is_storno and processing_id='${DOWNSTREAM.transformation}') storno_rows,
      (select count(*) from public.batch_processing_reversals where transformation_id='${DOWNSTREAM.transformation}') receipts,
      (select current_quantity from public.inventory_batches where id='${DOWNSTREAM.outputs[0].batch}') child_balance,
      (select status from public.batch_transformations where id='${DOWNSTREAM.transformation}') status
  `))[0];
  assert.equal(afterBlocked.ledger_rows, beforeBlocked.ledger_rows, "blocked reversal must be atomic");
  assert.equal(Number(afterBlocked.storno_rows), 0);
  assert.equal(Number(afterBlocked.receipts), 0);
  assert.equal(afterBlocked.child_balance, beforeBlocked.child_balance);
  assert.equal(afterBlocked.status, beforeBlocked.status);

  await seedCase(db, FOREIGN);
  await assert.rejects(
    () => reverse(db, FOREIGN.transformation, "tz315-foreign-actor", "foreign actor", OTHER_ACTOR),
    /PROCESSING_(?:FORBIDDEN|ACTOR_FORBIDDEN)/,
  );
  await assert.rejects(
    () => reverse(db, FOREIGN.transformation, "tz315-foreign-company", "foreign company", ACTOR, OTHER_COMPANY, OTHER_SEASON),
    /PROCESSING_(?:FORBIDDEN|COMPANY_FORBIDDEN|NOT_FOUND)/,
  );
  assert.equal(Number(await scalar(db, `select count(*) from public.batch_processing_reversals where transformation_id='${FOREIGN.transformation}'`)), 0);
  assert.equal(Number(await scalar(db, `select count(*) from public.stock_ledger_entries where is_storno and processing_id='${FOREIGN.transformation}'`)), 0);

  const appliedObjects = (await rows(db, `
    select
      to_regclass('public.batch_processing_reversals') is not null as receipt_table,
      to_regprocedure('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)') is not null as reversal_rpc,
      exists(select 1 from pg_indexes where indexname='uq_stock_ledger_storno_target_v1') as unique_storno,
      exists(select 1 from pg_trigger where tgname='trg_batch_processing_reversals_immutable_v1' and not tgisinternal) as receipt_guard,
      exists(select 1 from pg_trigger where tgname='trg_batch_transformations_reversal_state_v1' and not tgisinternal) as state_guard
  `))[0];
  assert.deepEqual(appliedObjects, {
    receipt_table: true,
    reversal_rpc: true,
    unique_storno: true,
    receipt_guard: true,
    state_guard: true,
  });

  console.log("TZ315 PROCESSING REVERSAL: PASS");
  console.log(JSON.stringify({
    cleaning: {
      selected_effect_kg: await selectedEffect(db, CLEANING.transformation),
      source_restored_kg: Number(await scalar(db, `select current_quantity from public.inventory_batches where id='${CLEANING.sourceBatch}'`)),
      output_balances_kg: await Promise.all(CLEANING.outputs.map((output) => scalar(db, `select current_quantity from public.inventory_batches where id='${output.batch}'`))),
      ticketless_loss_compensated: true,
      idempotent_replay: true,
    },
    drying: {
      selected_effect_kg: await selectedEffect(db, DRYING.transformation),
      source_restored_kg: Number(await scalar(db, `select current_quantity from public.inventory_batches where id='${DRYING.sourceBatch}'`)),
      output_balance_kg: Number(await scalar(db, `select current_quantity from public.inventory_batches where id='${DRYING.outputs[0].batch}'`)),
    },
    downstream_partial_spend: "ATOMIC_BLOCK",
    foreign_scope: "BLOCKED",
    immutable_receipt_and_state: "PASS",
    immutable_source_documents: "PASS",
    direct_receipt_dml: "BLOCKED",
    receipt_select: "PASS",
  }, null, 2));

  await db.close();
}

main().catch((error) => {
  console.error("TZ315 PROCESSING REVERSAL: FAIL");
  console.error(error);
  process.exitCode = 1;
});
