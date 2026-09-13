import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const COMPANY = "71300000-0000-4000-8000-000000000001";
const ACTOR = "71300000-0000-4000-8000-000000000002";
const VEHICLE = "71300000-0000-4000-8000-000000000003";
const DRIVER = "71300000-0000-4000-8000-000000000004";
const PRODUCT = "71300000-0000-4000-8000-000000000005";
const CREATE_1 = "71300000-0000-4000-8000-000000000011";
const CREATE_ROLLBACK = "71300000-0000-4000-8000-000000000012";
const CREATE_2 = "71300000-0000-4000-8000-000000000013";

const migrationUrl = new URL(
  "../supabase/migrations/20260913152900_weighbridge_ticket_integrity_v1.sql",
  import.meta.url,
);

async function expectError(run: () => Promise<unknown>, pattern: RegExp) {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, `Expected database error ${pattern}`);
  assert.match(thrown.message, pattern);
}

async function scalar<T = unknown>(db: PGlite, sql: string, params: unknown[] = []) {
  const result = await db.query(sql, params);
  return Object.values((result.rows[0] || {}) as Record<string, unknown>)[0] as T;
}

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create or replace function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create table public.tickets(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      ticket_no text not null,
      ticket_type text not null,
      op_type text not null,
      status text not null default 'draft',
      direction text not null,
      source_kind text not null,
      destination_kind text not null,
      vehicle_id uuid,
      driver_id uuid,
      created_by uuid not null,
      audit_json jsonb,
      is_finalized boolean not null default false,
      is_voided boolean not null default false,
      voided_by uuid,
      voided_at timestamptz,
      void_reason text,
      weigh_method text not null default 'double_weighing',
      stored_tare_used boolean not null default false,
      requires_review boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.ticket_lines(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid not null references public.tickets(id) on delete cascade,
      company_id uuid not null,
      product_id uuid not null,
      quantity numeric not null check (quantity >= 0),
      uom text not null default 'kg',
      composition_snapshot jsonb not null default '[]'::jsonb,
      is_mixed_harvest boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.ticket_weighings(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid not null references public.tickets(id) on delete cascade,
      company_id uuid not null,
      weighing_no integer not null check (weighing_no in (1, 2)),
      measured_weight_kg numeric not null check (measured_weight_kg > 0),
      measured_at timestamptz not null default now(),
      device_source text not null default 'manual',
      unique(ticket_id, weighing_no)
    );
    create table public.reference_machines(
      id uuid primary key,
      company_id uuid not null,
      status text,
      is_active boolean not null default true,
      archived boolean not null default false
    );
    create table public.reference_vehicles(
      id uuid primary key,
      company_id uuid not null,
      source_machine_id uuid references public.reference_machines(id),
      status text,
      is_active boolean not null default true,
      archived boolean not null default false
    );
    create or replace function public.void_ticket_with_storno_v2(
      p_ticket_id uuid,
      p_actor_user_id uuid,
      p_reason text
    ) returns uuid language plpgsql security definer set search_path = pg_catalog, public
    as $$
    begin
      update public.tickets
      set status = 'voided', is_voided = true, voided_by = p_actor_user_id,
          voided_at = now(), void_reason = p_reason, updated_at = now()
      where id = p_ticket_id and not is_voided;
      if not found then raise exception 'Ticket cannot be voided'; end if;
      return p_ticket_id;
    end;
    $$;
    insert into public.reference_vehicles(id,company_id,status)
    values ('${VEHICLE}','${COMPANY}','free');
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
}

const ticketJson = (key: string) => ({
  id: key,
  company_id: COMPANY,
  created_by: ACTOR,
  ticket_no: `WB-${key.slice(-4)}`,
  ticket_type: "double_weighing",
  op_type: "harvest_incoming",
  status: "active",
  direction: "incoming",
  source_kind: "field",
  destination_kind: "warehouse",
  vehicle_id: VEHICLE,
  driver_id: DRIVER,
  audit_json: {},
});

async function atomicCreate(
  db: PGlite,
  key: string,
  fingerprint: string,
  quantity = 100,
) {
  return scalar<Record<string, unknown>>(
    db,
    `select public.create_weighbridge_ticket_atomic_v1(
      $1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::jsonb,$7::jsonb
    )`,
    [
      COMPANY,
      ACTOR,
      key,
      fingerprint,
      JSON.stringify(ticketJson(key)),
      JSON.stringify([{ product_id: PRODUCT, quantity, uom: "kg" }]),
      JSON.stringify([{ weighing_no: 1, measured_weight_kg: 120, device_source: "manual" }]),
    ],
  );
}

async function checkDatabaseContract() {
  const db = new PGlite();
  await bootstrap(db);

  const created = await atomicCreate(db, CREATE_1, "fingerprint-1");
  assert.equal(created.ok, true);
  assert.equal(created.idempotent_replay, false);
  assert.equal(await scalar<number>(db, `select count(*)::int from public.tickets where id='${CREATE_1}'`), 1);
  assert.equal(await scalar<number>(db, `select count(*)::int from public.ticket_lines where ticket_id='${CREATE_1}'`), 1);
  assert.equal(await scalar<number>(db, `select count(*)::int from public.ticket_weighings where ticket_id='${CREATE_1}'`), 1);
  assert.equal(await scalar<string>(db, `select status from public.reference_vehicles where id='${VEHICLE}'`), "in_trip");

  const replay = await atomicCreate(db, CREATE_1, "fingerprint-1");
  assert.equal(replay.idempotent_replay, true);
  assert.equal(await scalar<number>(db, `select count(*)::int from public.tickets where id='${CREATE_1}'`), 1);
  await expectError(() => atomicCreate(db, CREATE_1, "different"), /WEIGHBRIDGE_IDEMPOTENCY_PAYLOAD_MISMATCH/);

  await db.exec(`
    select set_config('request.jwt.claim.sub','${ACTOR}',false);
    select public.void_weighbridge_ticket_for_session_v1('${CREATE_1}','qa void');
  `);
  assert.equal(await scalar<boolean>(db, `select is_voided from public.tickets where id='${CREATE_1}'`), true);
  assert.equal(await scalar<string>(db, `select status from public.reference_vehicles where id='${VEHICLE}'`), "free");

  await expectError(() => atomicCreate(db, CREATE_ROLLBACK, "fingerprint-rollback", -1), /ticket_lines_quantity_check/);
  assert.equal(await scalar<number>(db, `select count(*)::int from public.tickets where id='${CREATE_ROLLBACK}'`), 0);
  assert.equal(await scalar<string>(db, `select status from public.reference_vehicles where id='${VEHICLE}'`), "free");

  await atomicCreate(db, CREATE_2, "fingerprint-2");
  await db.exec(`alter table public.reference_vehicles add constraint qa_release_failure check (status <> 'free')`);
  await expectError(
    () => db.exec(`select public.void_weighbridge_ticket_for_session_v1('${CREATE_2}','must rollback')`),
    /qa_release_failure/,
  );
  assert.equal(await scalar<boolean>(db, `select is_voided from public.tickets where id='${CREATE_2}'`), false);
  assert.equal(await scalar<string>(db, `select status from public.reference_vehicles where id='${VEHICLE}'`), "in_trip");

  await db.close();
}

async function checkApplicationContract() {
  const ticketRoute = await readFile(new URL("../app/api/weighbridge/tickets/route.ts", import.meta.url), "utf8");
  const voidRoute = await readFile(new URL("../app/api/weighbridge/tickets/[id]/void/route.ts", import.meta.url), "utf8");
  const resourcesRoute = await readFile(new URL("../app/api/weighbridge/resources/route.ts", import.meta.url), "utf8");
  const operatorRoute = await readFile(new URL("../app/api/weighbridge/operator-session/route.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../lib/services/weighbridge.ts", import.meta.url), "utf8");
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(ticketRoute, /if \(!rawIdempotencyKey\)[\s\S]*Idempotency-Key is required/);
  assert.match(ticketRoute, /serviceClient\.rpc\([\s\S]*create_weighbridge_ticket_atomic_v1/);
  assert.doesNotMatch(ticketRoute, /\.from\("tickets"\)\s*\.insert\(/);
  assert.doesNotMatch(ticketRoute, /cleanupCreatedTicket/);
  assert.match(service, /"Idempotency-Key": idempotencyKey \|\| crypto\.randomUUID\(\)/);

  assert.match(voidRoute, /void_weighbridge_ticket_for_session_v1/);
  assert.doesNotMatch(voidRoute, /\.from\("reference_vehicles"\)/);
  assert.match(migration, /void_ticket_with_storno_v2[\s\S]*update public\.reference_vehicles/);

  assert.match(resourcesRoute, /source_machine_id,primary_responsible_personnel_id/);
  assert.match(resourcesRoute, /machinePersonnelById\.get\(String\(row\.id\)\) \|\| null/);
  assert.match(resourcesRoute, /\[\.\.\.vehicleRows, \.\.\.machineRows\]\.forEach/);
  assert.match(operatorRoute, /machineProjectionIds/);
  assert.match(operatorRoute, /initialMachineProjections/);
  assert.match(operatorRoute, /\[\.\.\.vehicleRows, \.\.\.machineRows\]\.forEach/);
}

checkDatabaseContract()
  .then(checkApplicationContract)
  .then(() => {
    console.log("Weighbridge integrity remediation V1 PASS: atomic create, atomic void, PTC assignments");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
