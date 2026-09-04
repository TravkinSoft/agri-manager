const { PGlite } = require("@electric-sql/pglite");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
async function main() {
  const db = new PGlite();
  let checks = 0;
  const check = (value, msg) => {
    assert.ok(value, msg);
    checks++;
  };
  const reject = async (sql, args, error) => {
    await assert.rejects(db.query(sql, args), new RegExp(error));
    checks++;
  };
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table companies(id uuid primary key);create table profiles(id uuid primary key,company_id uuid,role text,status text);
 create table fields(id uuid primary key,company_id uuid,archived boolean);
 create table reference_vehicles(id uuid primary key,company_id uuid,is_active boolean,archived boolean);
 create table company_people(id uuid primary key,company_id uuid,user_id uuid,full_name text,status text,deleted_at timestamptz);
 grant select on all tables in schema public to service_role;
 grant update on profiles,company_people to service_role;`);
  await db.exec(
    readFileSync(
      join(
        __dirname,
        "../supabase/migrations/20260904103550_ptc_independent_machine_turnover_v1.sql",
      ),
      "utf8",
    ),
  );
  const company = randomUUID(),
    otherCompany = randomUUID(),
    v = randomUUID(),
    legacyV = randomUUID(),
    foreignV = randomUUID();
  await db.query("insert into companies values($1),($2)", [
    company,
    otherCompany,
  ]);
  await db.query(
    "insert into reference_vehicles values($1,$2,true,false),($3,$2,true,false),($4,$5,true,false)",
    [v, company, legacyV, foreignV, otherCompany],
  );
  await db.query("select ptc_configure_v1($1,true,null,$2)", [
    company,
    [v, legacyV],
  ]);
  await db.query("select ptc_configure_v1($1,true,null,$2)", [
    otherCompany,
    [foreignV],
  ]);
  const actor = async (
    role,
    status = "active",
    personStatus = "active",
    personCompany = company,
    duplicate = false,
  ) => {
    const id = randomUUID();
    await db.query("insert into profiles values($1,$2,$3,$4)", [
      id,
      company,
      role,
      status,
    ]);
    if (personStatus)
      await db.query("insert into company_people values($1,$2,$3,$4,$5,null)", [
        randomUUID(),
        personCompany,
        id,
        "Test " + role,
        personStatus,
      ]);
    if (duplicate)
      await db.query("insert into company_people values($1,$2,$3,$4,$5,null)", [
        randomUUID(),
        personCompany,
        id,
        "Duplicate",
        "active",
      ]);
    return id;
  };
  const harvester = await actor("mechanic_operator"),
    receiver = await actor("vegetable_brigadier");
  const invalids = [
    await actor("agronomist"),
    await actor("global_admin"),
    await actor("mechanic_operator", "pending"),
    await actor("vegetable_brigadier", "inactive"),
    await actor(null),
  ];
  const missing = await actor("mechanic_operator", "active", null),
    inactivePerson = await actor("mechanic_operator", "active", "inactive"),
    crossPerson = await actor(
      "mechanic_operator",
      "active",
      "active",
      otherCompany,
    ),
    ambiguous = await actor(
      "mechanic_operator",
      "active",
      "active",
      company,
      true,
    );
  // Create one legacy event, then ensure the additive switch neither rewrites nor deletes it.
  const hp = (
    await db.query("select id from company_people where user_id=$1", [
      harvester,
    ])
  ).rows[0].id;
  const access = randomUUID(),
    token = "a".repeat(64);
  await db.query(
    "insert into ptc_access(id,company_id,person_id,role,login,password_hash,created_by) values($1,$2,$3,'harvester','legacy-test',$4,$5)",
    [access, company, hp, "x".repeat(161), harvester],
  );
  await db.query(
    "insert into ptc_sessions(access_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')",
    [access, token],
  );
  await db.query("select ptc_transition_v1($1,$2,0,'loaded',$3)", [
    token,
    legacyV,
    randomUUID(),
  ]);
  const old = (await db.query("select * from ptc_events")).rows[0];
  await db.exec(
    readFileSync(
      join(
        __dirname,
        "../supabase/migrations/20260904112119_ptc_unified_account_auth_v1.sql",
      ),
      "utf8",
    ),
  );
  checks++;
  const kept = (
    await db.query("select * from ptc_events where id=$1", [old.id])
  ).rows[0];
  check(
    kept.actor_user_id === null &&
      kept.access_id === old.access_id &&
      kept.created_at.getTime() === old.created_at.getTime(),
    "legacy history preserved",
  );
  const sql = "select ptc_actor_transition_v1($1,$2,$3,$4,$5) as result";
  const transition = (who, version, target, key = randomUUID(), vehicle = v) =>
    db.query(sql, [who, vehicle, version, target, key]);
  const rejected = (who, version, target, error, vehicle = v) =>
    reject(sql, [who, vehicle, version, target, randomUUID()], error);
  for (const who of invalids)
    await rejected(who, 0, "loaded", "PTC_UNAUTHORIZED");
  await rejected(randomUUID(), 0, "loaded", "PTC_UNAUTHORIZED");
  for (const who of [missing, inactivePerson, crossPerson, ambiguous])
    await rejected(who, 0, "loaded", "PTC_PERSON_LINK_REQUIRED");
  await rejected(harvester, 0, "loaded", "PTC_NOT_ASSIGNED", foreignV);
  await rejected(receiver, 0, "loaded", "PTC_FORBIDDEN_TRANSITION");
  const key = randomUUID();
  const pair = await Promise.all([
    transition(harvester, 0, "loaded", key),
    transition(harvester, 0, "loaded", key),
  ]);
  check(
    pair[0].rows[0].result.replayed === false &&
      pair[1].rows[0].result.replayed === true,
    "double click replays",
  );
  const state = (
    await db.query("select * from ptc_vehicle_states where vehicle_id=$1", [v])
  ).rows[0];
  await transition(harvester, 0, "loaded", key);
  assert.deepEqual(
    (
      await db.query("select * from ptc_vehicle_states where vehicle_id=$1", [
        v,
      ])
    ).rows[0],
    state,
  );
  checks++;
  await rejected(harvester, 0, "loaded", "PTC_VERSION_CONFLICT");
  await reject(sql, [receiver, v, 0, "loaded", key], "PTC_KEY_CONFLICT");
  await reject(sql, [harvester, legacyV, 1, "loaded", key], "PTC_KEY_CONFLICT");
  await rejected(harvester, 1, "unloading", "PTC_FORBIDDEN_TRANSITION");
  await transition(receiver, 1, "unloading");
  await transition(receiver, 2, "empty");
  const finish = (
    await db.query("select * from ptc_vehicle_states where vehicle_id=$1", [v])
  ).rows[0];
  check(
    finish.state === "empty" && finish.cycle === 1 && finish.version === 3,
    "three transitions form one cycle",
  );
  const events = (
    await db.query(
      "select * from ptc_events where vehicle_id=$1 order by expected_version",
      [v],
    )
  ).rows;
  check(
    events.length === 3 &&
      events[0].actor_user_id === harvester &&
      events[1].actor_user_id === receiver &&
      events.every((e) => e.access_id === null),
    "new history uses authoritative profile actors",
  );
  await reject(
    "update ptc_events set actor_name='tampered' where id=$1",
    [old.id],
    "PTC_HISTORY_IMMUTABLE",
  );
  await reject(
    "delete from ptc_events where vehicle_id=$1",
    [v],
    "PTC_HISTORY_IMMUTABLE",
  );
  await db.query("update profiles set company_id=$1 where id=$2", [
    otherCompany,
    harvester,
  ]);
  await rejected(harvester, 3, "loaded", "PTC_PERSON_LINK_REQUIRED");
  await db.query("update profiles set company_id=$1 where id=$2", [
    company,
    harvester,
  ]);
  await db.query("select ptc_configure_v1($1,false,null,$2)", [
    company,
    [v, legacyV],
  ]);
  await rejected(harvester, 3, "loaded", "PTC_DISABLED");
  await db.query("select ptc_configure_v1($1,true,null,$2)", [
    company,
    [v, legacyV],
  ]);
  await db.exec("set role service_role");
  await reject(
    "select ptc_transition_v1($1,$2,0,'loaded',$3)",
    [token, v, randomUUID()],
    "permission denied",
  );
  await reject("select * from ptc_sessions", [], "permission denied");
  await reject(
    "insert into ptc_access(company_id) values($1)",
    [company],
    "permission denied",
  );
  await transition(harvester, 3, "loaded");
  checks++;
  await db.exec("reset role;set role anon");
  await rejected(harvester, 4, "loaded", "permission denied");
  await db.exec("reset role;set role authenticated");
  await rejected(receiver, 4, "unloading", "permission denied");
  await db.exec("reset role");
  check(
    (await db.query("select count(*)::int as n from ptc_events")).rows[0].n ===
      5,
    "only expected history rows remain",
  );
  await db.close();
  console.log(
    "PTC unified Auth PostgreSQL PASS: " +
      checks +
      " assertions; no hosted connection. PGlite serialization is not a multi-connection race proof.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
