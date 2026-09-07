import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let checks = 0;

function equal(actual: unknown, expected: unknown, message?: string) {
  assert.deepEqual(actual, expected, message);
  checks += 1;
}

async function rejects(call: () => Promise<unknown>, expected: RegExp) {
  await assert.rejects(call, expected);
  checks += 1;
}

async function main() {
  const db = new PGlite();

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;

    create table companies(id uuid primary key);
    create table profiles(
      id uuid primary key,
      company_id uuid,
      role text,
      status text,
      full_name text
    );
    create table fields(id uuid primary key, company_id uuid, archived boolean);
    create table reference_vehicles(
      id uuid primary key,
      company_id uuid,
      is_active boolean,
      archived boolean,
      status text default 'in_trip'
    );
    create table company_people(
      id uuid primary key,
      company_id uuid,
      user_id uuid,
      full_name text,
      status text,
      deleted_at timestamptz
    );

    grant select on all tables in schema public to service_role;
    grant update on profiles, company_people, reference_vehicles to service_role;
  `);

  for (const file of [
    "20260904103550_ptc_independent_machine_turnover_v1.sql",
    "20260904112119_ptc_unified_account_auth_v1.sql",
    "20260905041243_fleet_vehicle_repair_v1.sql",
    "20260905103242_ptc_vehicle_line_actions_v1.sql",
    "20260906221526_ptc_fleet_manager_only_mutations.sql",
    "20260907085500_ptc_weighman_handoff_v1.sql",
    "20260907103717_ptc_last_vehicle_combine_shifts_v1.sql",
    "20260907143454_ptc_combine_breakdown_status_v1.sql",
  ]) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }

  const companyA = randomUUID();
  const companyB = randomUUID();
  const companyDisabled = randomUUID();
  const vehicleA = randomUUID();
  const vehicleB = randomUUID();
  const vehicleDisabled = randomUUID();

  for (const company of [companyA, companyB, companyDisabled]) {
    await db.query("insert into companies(id) values($1)", [company]);
  }
  await db.query(
    `insert into reference_vehicles(id, company_id, is_active, archived)
     values($1, $4, true, false), ($2, $5, true, false), ($3, $6, true, false)`,
    [vehicleA, vehicleB, vehicleDisabled, companyA, companyB, companyDisabled],
  );
  await db.query("select ptc_configure_v1($1, true, null, $2)", [companyA, [vehicleA]]);
  await db.query("select ptc_configure_v1($1, true, null, $2)", [companyB, [vehicleB]]);
  await db.query("select ptc_configure_v1($1, false, null, $2)", [companyDisabled, [vehicleDisabled]]);

  async function createActor(options: {
    company: string;
    role?: string;
    status?: string;
    links?: number;
    name: string;
  }) {
    const id = randomUUID();
    const personIds: string[] = [];
    await db.query(
      `insert into profiles(id, company_id, role, status, full_name)
       values($1, $2, $3, $4, $5)`,
      [
        id,
        options.company,
        options.role ?? "mechanic_operator",
        options.status ?? "active",
        options.name,
      ],
    );
    for (let index = 0; index < (options.links ?? 1); index += 1) {
      const personId = randomUUID();
      personIds.push(personId);
      await db.query(
        `insert into company_people(id, company_id, user_id, full_name, status, deleted_at)
         values($1, $2, $3, $4, 'active', null)`,
        [personId, options.company, id, `${options.name}${index ? ` ${index + 1}` : ""}`],
      );
    }
    return { id, personIds };
  }

  const harvesterA = await createActor({ company: companyA, name: "Комбайнёр без смены" });
  const harvesterWithShift = await createActor({ company: companyA, name: "Комбайнёр со сменой" });
  const harvesterB = await createActor({ company: companyB, name: "Комбайнёр Б" });
  const disabledHarvester = await createActor({ company: companyDisabled, name: "Комбайнёр выключенного потока" });
  const wrongRole = await createActor({ company: companyA, role: "weighman", name: "Весовщик" });
  const inactiveHarvester = await createActor({ company: companyA, status: "inactive", name: "Неактивный комбайнёр" });
  const unlinkedHarvester = await createActor({ company: companyA, links: 0, name: "Комбайнёр без сотрудника" });
  const multiplyLinkedHarvester = await createActor({ company: companyA, links: 2, name: "Комбайнёр с дублем" });
  const overlappingHarvester = await createActor({ company: companyA, name: "Комбайнёр overlap-smoke" });

  const openShiftId = randomUUID();
  await db.query(
    `insert into ptc_combine_shifts(
       id, company_id, operator_user_id, operator_person_id, operator_name
     ) values($1, $2, $3, $4, $5)`,
    [
      openShiftId,
      companyA,
      harvesterWithShift.id,
      harvesterWithShift.personIds[0],
      "Комбайнёр со сменой",
    ],
  );

  async function coreFingerprint() {
    const table = async (name: string, order: string) =>
      (await db.query(`select * from public.${name} order by ${order}`)).rows;
    return {
      flows: await table("ptc_flows", "company_id"),
      vehicleStates: await table("ptc_vehicle_states", "company_id, vehicle_id"),
      trafficEvents: await table("ptc_events", "company_id, created_at, id"),
      repairs: await table("fleet_vehicle_repairs", "company_id, vehicle_id"),
      lastMarkers: await table("ptc_last_vehicle_markers", "company_id"),
      lastMarkerEvents: await table("ptc_last_vehicle_events", "company_id, created_at, id"),
      shifts: await table("ptc_combine_shifts", "company_id, opened_at, id"),
      shiftEvents: await table("ptc_combine_shift_events", "company_id, created_at, id"),
    };
  }

  const coreBefore = await coreFingerprint();
  const migration = readFileSync(
    "supabase/migrations/20260907143454_ptc_combine_breakdown_status_v1.sql",
    "utf8",
  );
  assert.doesNotMatch(migration, /\b(?:create|alter|drop)\s+(?:table\s+)?realtime\b/i);
  checks += 1;
  assert.doesNotMatch(migration, /alter\s+publication/i);
  checks += 1;
  assert.doesNotMatch(
    migration,
    /(?:insert\s+into|update|delete\s+from)\s+public\.(?:ptc_vehicle_states|ptc_events|fleet_vehicle_repairs|ptc_last_vehicle_markers|ptc_combine_shifts)\b/i,
  );
  checks += 1;

  await db.exec("set role service_role");

  const setStatus = async (
    actor: string,
    isBroken: boolean,
    expectedVersion: number,
    key = randomUUID(),
  ) =>
    (
      await db.query<{ value: Record<string, unknown> }>(
        "select ptc_set_combine_breakdown_v1($1, $2, $3, $4) value",
        [actor, isBroken, expectedVersion, key],
      )
    ).rows[0].value;

  const firstKey = randomUUID();
  const broken = await setStatus(harvesterA.id, true, 0, firstKey);
  equal(
    {
      ok: broken.ok,
      replayed: broken.replayed,
      operatorUserId: broken.operatorUserId,
      operatorPersonId: broken.operatorPersonId,
      operatorName: broken.operatorName,
      isBroken: broken.isBroken,
      version: broken.version,
      shiftId: broken.shiftId,
    },
    {
      ok: true,
      replayed: false,
      operatorUserId: harvesterA.id,
      operatorPersonId: harvesterA.personIds[0],
      operatorName: "Комбайнёр без смены",
      isBroken: true,
      version: 1,
      shiftId: null,
    },
    "breakdown must work without an open shift",
  );

  equal(
    (
      await db.query(
        `select company_id::text, operator_user_id::text, operator_person_id::text,
                operator_name, is_broken, version
         from ptc_combine_operator_statuses
         where company_id = $1 and operator_user_id = $2`,
        [companyA, harvesterA.id],
      )
    ).rows,
    [
      {
        company_id: companyA,
        operator_user_id: harvesterA.id,
        operator_person_id: harvesterA.personIds[0],
        operator_name: "Комбайнёр без смены",
        is_broken: true,
        version: 1,
      },
    ],
  );

  const replay = await setStatus(harvesterA.id, true, 0, firstKey);
  equal(replay.replayed, true);
  equal(replay.eventId, broken.eventId);
  equal(
    (
      await db.query<{ count: number }>(
        "select count(*)::int count from ptc_combine_operator_status_events where company_id=$1",
        [companyA],
      )
    ).rows[0].count,
    1,
    "an idempotent replay must not append an event",
  );

  await rejects(
    () => setStatus(harvesterA.id, false, 1, firstKey),
    /PTC_KEY_CONFLICT/,
  );
  await rejects(
    () => setStatus(harvesterA.id, false, 0),
    /PTC_COMBINE_STATUS_VERSION_CONFLICT/,
  );
  await rejects(
    () => setStatus(harvesterA.id, true, 1),
    /PTC_COMBINE_STATUS_NO_CHANGE/,
  );

  const recovered = await setStatus(harvesterA.id, false, 1);
  equal(
    { isBroken: recovered.isBroken, version: recovered.version, replayed: recovered.replayed },
    { isBroken: false, version: 2, replayed: false },
  );
  const brokenAgain = await setStatus(harvesterA.id, true, 2);
  equal(
    { isBroken: brokenAgain.isBroken, version: brokenAgain.version },
    { isBroken: true, version: 3 },
  );

  // Both calls are started before either is awaited. PGlite exposes one
  // in-process database facade, so this is deliberately an overlap smoke and
  // is not claimed as proof of true independent PostgreSQL sessions.
  const overlapKeys = [randomUUID(), randomUUID()];
  const differentKeyOverlap = await Promise.allSettled([
    setStatus(overlappingHarvester.id, true, 0, overlapKeys[0]),
    setStatus(overlappingHarvester.id, true, 0, overlapKeys[1]),
  ]);
  const differentKeyFulfilled = differentKeyOverlap
    .map((result, index) => ({ result, index }))
    .filter(
      (entry): entry is { result: PromiseFulfilledResult<Record<string, unknown>>; index: number } =>
        entry.result.status === "fulfilled",
    );
  const differentKeyRejected = differentKeyOverlap.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  equal(differentKeyFulfilled.length, 1, "only one version-0 overlap may commit");
  equal(differentKeyRejected.length, 1, "the competing version-0 overlap must fail");
  assert.match(
    String(differentKeyRejected[0].reason),
    /PTC_COMBINE_STATUS_VERSION_CONFLICT/,
  );
  checks += 1;
  equal(
    {
      isBroken: differentKeyFulfilled[0].result.value.isBroken,
      version: differentKeyFulfilled[0].result.value.version,
    },
    { isBroken: true, version: 1 },
  );

  const winningOverlapKey = overlapKeys[differentKeyFulfilled[0].index];
  const sameKeyOverlap = await Promise.allSettled([
    setStatus(overlappingHarvester.id, true, 0, winningOverlapKey),
    setStatus(overlappingHarvester.id, false, 1, winningOverlapKey),
  ]);
  const sameKeyFulfilled = sameKeyOverlap.filter(
    (result): result is PromiseFulfilledResult<Record<string, unknown>> =>
      result.status === "fulfilled",
  );
  const sameKeyRejected = sameKeyOverlap.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  equal(sameKeyFulfilled.length, 1, "the exact same-key call must replay");
  equal(sameKeyFulfilled[0].value.replayed, true);
  equal(sameKeyRejected.length, 1, "a different command with the same key must conflict");
  assert.match(String(sameKeyRejected[0].reason), /PTC_KEY_CONFLICT/);
  checks += 1;

  const withShift = await setStatus(harvesterWithShift.id, true, 0);
  equal(withShift.shiftId, openShiftId, "an open shift may be captured as event context");
  equal(
    (
      await db.query<{ shift_id: string | null }>(
        "select shift_id::text from ptc_combine_operator_status_events where id=$1",
        [withShift.eventId],
      )
    ).rows,
    [{ shift_id: openShiftId }],
  );

  // Idempotency keys are tenant-scoped. Reusing the same UUID in another
  // company is valid and cannot address or mutate the first company's row.
  const tenantB = await setStatus(harvesterB.id, true, 0, firstKey);
  equal(
    { operatorUserId: tenantB.operatorUserId, isBroken: tenantB.isBroken, version: tenantB.version },
    { operatorUserId: harvesterB.id, isBroken: true, version: 1 },
  );
  equal(
    (
      await db.query(
        `select company_id::text, operator_user_id::text
         from ptc_combine_operator_statuses
         order by company_id, operator_user_id`,
      )
    ).rows,
    [
      { company_id: companyA, operator_user_id: harvesterA.id },
      { company_id: companyA, operator_user_id: harvesterWithShift.id },
      { company_id: companyA, operator_user_id: overlappingHarvester.id },
      { company_id: companyB, operator_user_id: harvesterB.id },
    ].sort((left, right) =>
      `${left.company_id}:${left.operator_user_id}`.localeCompare(
        `${right.company_id}:${right.operator_user_id}`,
      ),
    ),
  );

  await rejects(
    () => setStatus(wrongRole.id, true, 0),
    /PTC_COMBINE_STATUS_FORBIDDEN/,
  );
  await rejects(
    () => setStatus(inactiveHarvester.id, true, 0),
    /PTC_COMBINE_STATUS_FORBIDDEN/,
  );
  await rejects(
    () => setStatus(unlinkedHarvester.id, true, 0),
    /PTC_PERSON_LINK_REQUIRED/,
  );
  await rejects(
    () => setStatus(multiplyLinkedHarvester.id, true, 0),
    /PTC_PERSON_LINK_REQUIRED/,
  );
  await rejects(
    () => setStatus(disabledHarvester.id, true, 0),
    /PTC_DISABLED/,
  );

  equal(
    (
      await db.query<{ count: number }>(
        "select count(*)::int count from ptc_combine_operator_statuses",
      )
    ).rows[0].count,
    4,
    "denied actors must not create current-state rows",
  );
  equal(
    (
      await db.query<{ count: number }>(
        "select count(*)::int count from ptc_combine_operator_status_events",
      )
    ).rows[0].count,
    6,
    "only committed state changes may append history",
  );

  await rejects(
    () => db.query("delete from ptc_combine_operator_statuses where company_id=$1", [companyB]),
    /permission denied/i,
  );
  await rejects(
    () => db.query("update ptc_combine_operator_status_events set operator_name='tampered'"),
    /permission denied/i,
  );
  await rejects(
    () => db.query("delete from ptc_combine_operator_status_events"),
    /permission denied/i,
  );

  await db.exec("reset role");

  for (const role of ["anon", "authenticated"]) {
    equal(
      (
        await db.query<{ allowed: boolean }>(
          `select has_function_privilege(
             $1, 'ptc_set_combine_breakdown_v1(uuid,boolean,integer,uuid)', 'execute'
           ) allowed`,
          [role],
        )
      ).rows,
      [{ allowed: false }],
    );
    for (const table of [
      "ptc_combine_operator_statuses",
      "ptc_combine_operator_status_events",
    ]) {
      for (const privilege of ["select", "insert", "update", "delete", "truncate"]) {
        equal(
          (
            await db.query<{ allowed: boolean }>(
              "select has_table_privilege($1, $2, $3) allowed",
              [role, table, privilege],
            )
          ).rows,
          [{ allowed: false }],
        );
      }
    }
  }

  equal(
    (
      await db.query<{ allowed: boolean }>(
        `select has_function_privilege(
           'service_role', 'ptc_set_combine_breakdown_v1(uuid,boolean,integer,uuid)', 'execute'
         ) allowed`,
      )
    ).rows,
    [{ allowed: true }],
  );
  for (const table of [
    "ptc_combine_operator_statuses",
    "ptc_combine_operator_status_events",
  ]) {
    equal(
      (
        await db.query<{ rls: boolean }>(
          "select relrowsecurity rls from pg_class where oid=$1::regclass",
          [table],
        )
      ).rows,
      [{ rls: true }],
    );
  }

  const localForeignKeyIndexes = (
    await db.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname = any($1::text[])
       order by indexname`,
      [[
        "ptc_combine_operator_status_person_idx",
        "ptc_combine_operator_status_event_user_idx",
        "ptc_combine_operator_status_event_person_idx",
        "ptc_combine_operator_status_event_shift_idx",
      ]],
    )
  ).rows.map((row) => row.indexname);
  equal(
    localForeignKeyIndexes,
    [
      "ptc_combine_operator_status_event_person_idx",
      "ptc_combine_operator_status_event_shift_idx",
      "ptc_combine_operator_status_event_user_idx",
      "ptc_combine_operator_status_person_idx",
    ],
    "every requested local foreign-key index must exist",
  );

  await db.exec("set role authenticated");
  await rejects(
    () => db.query("select ptc_set_combine_breakdown_v1($1, true, 0, $2)", [harvesterA.id, randomUUID()]),
    /permission denied/i,
  );
  await rejects(
    () => db.query("select * from ptc_combine_operator_statuses"),
    /permission denied/i,
  );
  await db.exec("reset role");

  // The trigger remains a second line of defence for privileged/owner writes.
  await rejects(
    () => db.query("update ptc_combine_operator_status_events set operator_name='tampered'"),
    /PTC_HISTORY_IMMUTABLE/,
  );
  await rejects(
    () => db.query("delete from ptc_combine_operator_status_events"),
    /PTC_HISTORY_IMMUTABLE/,
  );

  equal(await coreFingerprint(), coreBefore, "combine status must not mutate established PTC state");

  await db.close();
  console.log(
    `PTC combine breakdown V1 PASS: ${checks} checks; real PostgreSQL transactions, ACL, tenant isolation, idempotency and core-state preservation; no hosted writes.`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
