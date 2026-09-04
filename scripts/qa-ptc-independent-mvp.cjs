/* Local, isolated PostgreSQL gate. Never connects to hosted Supabase. */
const { PGlite } = require("@electric-sql/pglite");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

async function main() {
  const db = new PGlite();
  let checks = 0;
  const check = (value, message) => {
    assert.ok(value, message);
    checks++;
  };
  const rejects = async (sql, params, message) => {
    await assert.rejects(db.query(sql, params), new RegExp(message));
    checks++;
  };
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table companies(id uuid primary key);
    create table profiles(id uuid primary key);
    create table fields(id uuid primary key, company_id uuid, archived boolean);
    create table reference_vehicles(id uuid primary key, company_id uuid, is_active boolean, archived boolean);
    create table company_people(id uuid primary key, company_id uuid, full_name text, status text, deleted_at timestamptz);
    grant select on all tables in schema public to service_role;
  `);
  const migration = readFileSync(
    join(
      __dirname,
      "../supabase/migrations/20260904103550_ptc_independent_machine_turnover_v1.sql",
    ),
    "utf8",
  );
  await db.exec(migration);
  checks++;
  const c = randomUUID(),
    other = randomUUID(),
    v = randomUUID(),
    v2 = randomUUID(),
    foreignV = randomUUID();
  const field = randomUUID(),
    field2 = randomUUID(),
    foreignField = randomUUID(),
    p = randomUUID(),
    r = randomUUID(),
    foreignP = randomUUID(),
    admin = randomUUID();
  await db.query("insert into companies values ($1),($2)", [c, other]);
  await db.query("insert into profiles values ($1)", [admin]);
  await db.query(
    "insert into fields values ($1,$2,false),($3,$2,false),($4,$5,false)",
    [field, c, field2, foreignField, other],
  );
  await db.query(
    "insert into reference_vehicles values ($1,$2,true,false),($3,$2,true,false),($4,$5,true,false)",
    [v, c, v2, foreignV, other],
  );
  await db.query(
    "insert into company_people values ($1,$2,'Test harvester','active',null),($3,$2,'Test receiver','active',null),($4,$5,'Other company','active',null)",
    [p, c, r, foreignP, other],
  );
  const configure = (enabled, f = field, vehicles = [v, v2]) =>
    db.query("select ptc_configure_v1($1,$2,$3,$4)", [c, enabled, f, vehicles]);
  await configure(true);
  await rejects(
    "select ptc_configure_v1($1,true,$2,$3)",
    [c, foreignField, [v]],
    "PTC_COMPANY_MISMATCH",
  );
  await rejects(
    "select ptc_configure_v1($1,true,$2,$3)",
    [c, field, [foreignV]],
    "PTC_COMPANY_MISMATCH",
  );
  await rejects(
    "insert into ptc_access(company_id,person_id,role,login,password_hash,created_by) values($1,$2,'harvester','ptc-foreign',$3,$4)",
    [c, foreignP, "x".repeat(161), admin],
    "PTC_COMPANY_MISMATCH",
  );
  const grant = async (person, role, login, hash) => {
    const result = await db.query(
      "insert into ptc_access(company_id,person_id,role,login,password_hash,created_by) values($1,$2,$3,$4,$5,$6) returning id",
      [c, person, role, login, "x".repeat(161), admin],
    );
    const id = result.rows[0].id;
    await db.query(
      "insert into ptc_sessions(access_id,token_hash,expires_at) values($1,$2,now()+interval '12 hours')",
      [id, hash],
    );
    return id;
  };
  const ht = "a".repeat(64),
    rt = "b".repeat(64);
  const ha = await grant(p, "harvester", "ptc-harvester", ht);
  await grant(r, "receiver", "ptc-receiver", rt);
  const transitionSql = "select ptc_transition_v1($1,$2,$3,$4,$5) as result";
  const transition = (
    token,
    version,
    target,
    key = randomUUID(),
    vehicle = v,
  ) => db.query(transitionSql, [token, vehicle, version, target, key]);
  const rejectTransition = (token, version, target, message, vehicle = v) =>
    rejects(
      transitionSql,
      [token, vehicle, version, target, randomUUID()],
      message,
    );
  await rejectTransition(rt, 0, "loaded", "PTC_FORBIDDEN_TRANSITION");
  await rejectTransition(ht, 0, "unloading", "PTC_FORBIDDEN_TRANSITION");
  await rejectTransition(ht, 0, "loaded", "PTC_NOT_ASSIGNED", foreignV);
  const key = randomUUID();
  const first = await transition(ht, 0, "loaded", key);
  const before = (
    await db.query("select * from ptc_vehicle_states where vehicle_id=$1", [v])
  ).rows[0];
  const replay = await transition(ht, 0, "loaded", key);
  const after = (
    await db.query("select * from ptc_vehicle_states where vehicle_id=$1", [v])
  ).rows[0];
  check(
    first.rows[0].result.replayed === false &&
      replay.rows[0].result.replayed === true,
    "same command replays",
  );
  assert.deepEqual(before, after);
  checks++;
  check(
    after.cycle === 1 && after.version === 1 && after.state === "loaded",
    "load creates exactly one cycle",
  );
  await rejectTransition(ht, 0, "loaded", "PTC_VERSION_CONFLICT");
  await rejects(transitionSql, [ht, v2, 0, "loaded", key], "PTC_KEY_CONFLICT");
  await rejects(
    "select ptc_configure_v1($1,true,$2,$3)",
    [c, field, [v2]],
    "PTC_ACTIVE_VEHICLE",
  );
  await rejects(
    "select ptc_configure_v1($1,true,$2,$3)",
    [c, field2, [v, v2]],
    "PTC_ACTIVE_FIELD",
  );
  await configure(false);
  await rejectTransition(rt, 1, "unloading", "PTC_DISABLED");
  await configure(true);
  const preserved = (
    await db.query("select * from ptc_vehicle_states where vehicle_id=$1", [v])
  ).rows[0];
  assert.deepEqual(after, preserved);
  checks++;
  await rejectTransition(ht, 1, "unloading", "PTC_FORBIDDEN_TRANSITION");
  await transition(rt, 1, "unloading");
  await rejectTransition(ht, 2, "empty", "PTC_FORBIDDEN_TRANSITION");
  await transition(rt, 2, "empty");
  const end = (
    await db.query("select * from ptc_vehicle_states where vehicle_id=$1", [v])
  ).rows[0];
  check(
    end.cycle === 1 && end.version === 3 && end.state === "empty",
    "whole cycle has three transitions",
  );
  const history = (
    await db.query("select * from ptc_events where vehicle_id=$1", [v])
  ).rows;
  check(
    history.length === 3 && history.every((e) => e.field_id === field),
    "events retain field snapshot",
  );
  await rejects(
    "delete from ptc_events where vehicle_id=$1",
    [v],
    "PTC_HISTORY_IMMUTABLE",
  );
  await rejects(
    "update ptc_events set actor_name='changed' where vehicle_id=$1",
    [v],
    "PTC_HISTORY_IMMUTABLE",
  );
  await configure(true, field2, [v2]);
  await rejectTransition(ht, 3, "loaded", "PTC_NOT_ASSIGNED");
  await configure(true, field2);
  const readded = (
    await db.query("select * from ptc_vehicle_states where vehicle_id=$1", [v])
  ).rows[0];
  check(
    readded.version === 3 &&
      readded.cycle === 1 &&
      readded.since.getTime() === end.since.getTime(),
    "reassignment preserves state/cycle/time",
  );
  await transition(ht, 3, "loaded");
  check(
    (
      await db.query(
        "select cycle from ptc_vehicle_states where vehicle_id=$1",
        [v],
      )
    ).rows[0].cycle === 2,
    "next cycle increments once",
  );
  await db.query("update company_people set status='inactive' where id=$1", [
    p,
  ]);
  await rejectTransition(ht, 4, "loaded", "PTC_UNAUTHORIZED");
  await db.query("update company_people set status='active' where id=$1", [p]);
  await db.query("update ptc_access set revoked_at=now() where id=$1", [ha]);
  await rejectTransition(ht, 4, "loaded", "PTC_UNAUTHORIZED");
  await db.query(
    "update ptc_sessions set expires_at=now()-interval '1 second' where token_hash=$1",
    [rt],
  );
  await rejectTransition(rt, 4, "unloading", "PTC_UNAUTHORIZED");
  for (let i = 1; i <= 3; i++)
    check(
      (
        await db.query(
          "select ptc_take_login_attempt_v1('test-account',2) as ok",
        )
      ).rows[0].ok ===
        i <= 2,
      "persistent limit attempt " + i,
    );
  await db.exec("set role anon");
  await rejects("select * from ptc_access", [], "permission denied");
  await rejects(
    "select ptc_configure_v1($1,true,null,$2)",
    [c, [v]],
    "permission denied",
  );
  await db.exec("reset role; set role authenticated");
  await rejects(
    transitionSql,
    [ht, v, 4, "loaded", randomUUID()],
    "permission denied",
  );
  await db.exec("reset role; set role service_role");
  check(
    (await db.query("select count(*)::int as n from ptc_events")).rows[0].n ===
      4,
    "service read model sees canonical events",
  );
  await rejects("delete from ptc_events", [], "permission denied");
  await db.exec("reset role");
  check(
    !/weighbridge|ticket_id|gross|tare|inventory|ledger/i.test(migration),
    "independent schema has no weighing dependencies",
  );
  await db.close();
  console.log(
    `PTC isolated PostgreSQL gate PASS: ${checks} assertions. No hosted database accessed.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
