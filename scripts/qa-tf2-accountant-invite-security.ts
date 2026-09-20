import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { assertProfileActivationReady } from "../lib/auth/ptc-invitations";

const migrationPath = "supabase/migrations/20260912174500_tf2_accountant_invite_read_only_v1.sql";
const routePath = "app/api/invite-user/route.ts";
const createCompanyRoutePath = "app/api/global-admin/create-company/route.ts";
const completeSignupPath = "app/api/auth/complete-signup/route.ts";
const userActionPath = "app/api/users/[id]/route.ts";
const legacyEdgeFunctionPath = "supabase/functions/invite-user/index.ts";
const company = "00000000-0000-4000-8000-000000000001";
const foreignCompany = "00000000-0000-4000-8000-000000000002";
const actor = "00000000-0000-4000-8000-000000000003";
const accountant = "00000000-0000-4000-8000-000000000004";
const foreignUser = "00000000-0000-4000-8000-000000000005";
const profilelessUser = "00000000-0000-4000-8000-000000000006";
const specialist = "00000000-0000-4000-8000-000000000007";
const director = "00000000-0000-4000-8000-000000000008";
const retryUser = "00000000-0000-4000-8000-000000000009";
const directSignup = "00000000-0000-4000-8000-000000000010";
const trafficUser = "00000000-0000-4000-8000-000000000011";
const secondAccountant = "00000000-0000-4000-8000-000000000013";
let checks = 0;

function ok(value: unknown, message?: string) {
  assert.ok(value, message);
  checks += 1;
}

async function rejectsSql(run: () => Promise<unknown>, code: string) {
  await assert.rejects(run, (error: Error) => error.message.includes(code));
  checks += 1;
}

async function main() {
  const route = fs.readFileSync(routePath, "utf8");
  const traffic = route.indexOf("await sendTrafficInvitation({");
  const capability = route.indexOf('await hasGenericInviteBinder(supabaseAdmin)', traffic);
  const create = route.indexOf("await supabaseAdmin.auth.admin.createUser({", traffic);
  const bindIndex = route.indexOf('await supabaseAdmin.rpc("bind_invited_profile_v1"', create);
  const ready = route.indexOf("await supabaseAdmin.auth.admin.updateUserById", bindIndex);
  const recovery = route.indexOf("await supabaseAdmin.auth.resetPasswordForEmail", bindIndex);
  const success = route.indexOf("success: true", recovery);
  ok(traffic >= 0 && traffic < capability && capability < create && create < bindIndex
    && bindIndex < ready && ready < recovery && recovery < success,
  "PTC remains separate; generic flow must capability-check, bind and mark ready before delivery");
  ok(!route.includes("inviteUserByEmail("), "generic flow must not send an invite before DB binding");
  ok(route.includes("email_confirm: false"), "fresh Auth user must remain unconfirmed");
  ok(route.includes('state: "provisioning"') && route.includes('state: "ready"'),
    "generic invitation must move its server marker from provisioning to ready");
  ok((route.match(/is_owner: false/g) ?? []).length >= 2,
    "generic company-user invitation must carry explicit non-owner provenance");
  ok(route.includes("createdAuthUserId === user.id"), "cleanup/fresh proof must use exact request-created id");
  ok(route.includes("auth.admin.deleteUser(createdAuthUserId)"), "failed fresh binding must clean up its Auth user");
  ok((route.match(/"accountant"/g) ?? []).length >= 2, "both administrator target lists include accountant");

  const createCompanyRoute = fs.readFileSync(createCompanyRoutePath, "utf8");
  const companyCapability = createCompanyRoute.indexOf('await hasGenericInviteBinder(admin)');
  const companyInsert = createCompanyRoute.indexOf('.insert({ name })', companyCapability);
  const companyAuthCreate = createCompanyRoute.indexOf("await admin.auth.admin.createUser({", companyInsert);
  const companyBind = createCompanyRoute.indexOf('await admin.rpc("bind_invited_profile_v1"', companyAuthCreate);
  const companyAuthRefresh = createCompanyRoute.indexOf("await admin.auth.admin.getUserById", companyBind);
  const companyOwner = createCompanyRoute.indexOf(".update({ is_owner: true })", companyAuthRefresh);
  const companyReady = createCompanyRoute.indexOf("await admin.auth.admin.updateUserById", companyOwner);
  const companyRecovery = createCompanyRoute.indexOf("await admin.auth.resetPasswordForEmail", companyReady);
  const companySuccess = createCompanyRoute.indexOf("success: true", companyRecovery);
  ok(companyCapability >= 0 && companyCapability < companyInsert
    && companyInsert < companyAuthCreate && companyAuthCreate < companyBind
    && companyBind < companyAuthRefresh && companyAuthRefresh < companyOwner
    && companyOwner < companyReady && companyReady < companyRecovery && companyRecovery < companySuccess,
  "company creation must bind, revalidate, grant ownership and mark ready before delivery");
  ok(!createCompanyRoute.includes("inviteUserByEmail("),
    "company creation must never use markerless Auth invitation creation");
  ok(createCompanyRoute.includes('state: "provisioning"')
    && createCompanyRoute.includes('state: "ready"')
    && createCompanyRoute.includes('p_role: "company_admin"')
    && createCompanyRoute.includes("p_fresh_auth: true")
    && (createCompanyRoute.match(/is_owner: true/g) ?? []).length >= 2,
  "first company administrator must use the exact trusted generic-invite binding");
  ok(createCompanyRoute.includes("preparedMarker.company_id === company.id")
    && createCompanyRoute.includes('preparedMarker.role === "company_admin"')
    && createCompanyRoute.includes("...preparedAppMetadata"),
  "ready transition must re-read and preserve current Auth app metadata");
  const deliveryFailure = createCompanyRoute.indexOf("if (recoveryError)", companyRecovery);
  const deliveryFailureEnd = createCompanyRoute.indexOf("return NextResponse.json({", deliveryFailure);
  ok(deliveryFailure >= 0 && deliveryFailureEnd >= 0
    && !createCompanyRoute.slice(deliveryFailure, deliveryFailureEnd).includes("cleanupFailedProvisioning"),
  "delivery uncertainty must retain the fully prepared company for safe resend");
  ok(createCompanyRoute.includes("cleanup_required: !cleanupComplete")
    && createCompanyRoute.includes("return authCleanupComplete && !error"),
  "pre-ready cleanup failures must be surfaced instead of silently hidden");
  ok(createCompanyRoute.includes("reconcileCompanyProvisioningUser(")
    && createCompanyRoute.includes("isExactCompanyProvisioningUser(")
    && createCompanyRoute.includes("reconciled.emailExists")
    && /reconcileCompanyProvisioningUser\([\s\S]*?company\.id,[\s\S]*?adminEmail,[\s\S]*?invitedUser[\s\S]*?\)/.test(createCompanyRoute),
  "an ambiguous Auth create response must reconcile only its exact company marker");

  const legacyEdgeFunction = fs.readFileSync(legacyEdgeFunctionPath, "utf8");
  ok(legacyEdgeFunction.includes("status: 410"), "legacy invitation endpoint must stay disabled");
  ok(!legacyEdgeFunction.includes("SUPABASE_SERVICE_ROLE_KEY"), "legacy invitation endpoint must not retain service-role access");
  ok(!legacyEdgeFunction.includes("inviteUserByEmail"), "legacy invitation endpoint must not create users");
  const migration = fs.readFileSync(migrationPath, "utf8");
  ok(!migration.includes("new.raw_user_meta_data->>'role'")
    && !migration.includes("new.raw_user_meta_data->>'invited_by_company'"),
  "auth trigger must not authorize from editable user metadata");
  ok(migration.includes("new.raw_app_meta_data") && migration.includes("generic_invitation_v1")
    && migration.includes("ptc_invitation_v1"),
  "auth trigger must use server-controlled invitation markers");
  const completeSignup = fs.readFileSync(completeSignupPath, "utf8");
  const activeReturn = completeSignup.indexOf('if (currentStatus === "active")');
  const activationGuard = completeSignup.indexOf("await assertProfileActivationReady");
  ok(completeSignup.includes('select("id,status,role,company_id,is_owner")')
    && activeReturn >= 0 && activeReturn < activationGuard,
  "pending activation must know owner status while existing active recovery stays compatible");
  const userActionRoute = fs.readFileSync(userActionPath, "utf8");
  const provenanceCall = userActionRoute.indexOf("await ensureGenericInviteProvenance");
  const resendDelivery = userActionRoute.indexOf("await sendRecoveryInvite", provenanceCall);
  ok(provenanceCall >= 0 && provenanceCall < resendDelivery
    && (userActionRoute.match(/await ensureGenericInviteProvenance/g) ?? []).length === 2
    && userActionRoute.includes('[GENERIC_INVITATION_MARKER]: {')
    && userActionRoute.includes('state: "ready"')
    && !userActionRoute.includes("inviteUserByEmail("),
  "resend/setup actions must establish server provenance before issuing a link");
  ok(userActionRoute.includes("normalizeEmail(user.email) !== profileEmail"),
    "resend/setup must prove that the Auth identity owns the pending profile email");
  ok(userActionRoute.includes("const updatedMarker = updatedAppMetadata[GENERIC_INVITATION_MARKER]")
    && userActionRoute.includes("!markerData.user?.id || !markerMatches"),
  "resend/setup must verify the committed ready marker before issuing a link");
  ok(userActionRoute.includes('select("id,full_name,email,role,status,company_id,is_owner")')
    && userActionRoute.includes('&& role === "company_admin"')
    && userActionRoute.includes("&& profile.is_owner !== true"),
  "resend must not promote an incomplete first-company owner provisioning state");
  ok(userActionRoute.includes("(existing as any).is_owner !== (profile.is_owner === true)")
    && userActionRoute.includes("is_owner: profile.is_owner === true"),
  "resend must preserve exact owner intent in server-controlled provenance");

  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create role authenticator;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.companies(id uuid primary key default gen_random_uuid(), name text not null);
    create table public.profiles(
      id uuid primary key,
      company_id uuid,
      role text not null,
      status text not null,
      full_name text,
      email text,
      is_owner boolean not null default false,
      updated_at timestamptz not null default now(),
      constraint valid_role check(role in (
        'global_admin','company_admin','agronomist','director','legal_operator','specialist',
        'warehouse','warehouse_operator','weighman','fuel_operator','brigadier',
        'mechanic_operator','vegetable_brigadier','fleet_manager'
      ))
    );
    create table public.global_admin_company_contexts(user_id uuid primary key, company_id uuid not null);
    create table auth.users(
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      raw_app_meta_data jsonb not null default '{}'::jsonb
    );
    create table public.rls_probe(id int primary key, company_id uuid not null);
    alter table public.rls_probe enable row level security;
    grant select, insert, update, delete on public.rls_probe to authenticated;
    create policy rls_probe_permissive on public.rls_probe for all to authenticated
      using (true) with check (true);
    insert into public.companies values
      ('${company}', 'Own'), ('${foreignCompany}', 'Foreign');
    insert into public.profiles(id,company_id,role,status,full_name,email,is_owner) values
      ('${actor}','${company}','company_admin','active','Admin','admin@example.test',false),
      ('${specialist}','${company}','specialist','active','Specialist','specialist@example.test',false),
      ('${director}','${company}','director','active','Director','director@example.test',false);
  `);

  await db.exec(fs.readFileSync(migrationPath, "utf8"));
  await db.exec(fs.readFileSync("supabase/migrations/20260920075104_company_creation_identity_guard_v1.sql", "utf8"));
  await db.exec(fs.readFileSync("supabase/migrations/20260920075215_company_active_name_unique_v1.sql", "utf8"));

  assert.deepEqual(
    (await db.query("select public.generic_invite_capabilities_v1() as capability")).rows,
    [{ capability: "generic-invite-binder-v1" }]
  );
  checks += 1;

  const policies = await db.query<{ policyname: string }>(`
    select policyname from pg_policies
    where schemaname='public' and tablename='rls_probe'
      and policyname like 'operational_read_only_%_v1'
  `);
  assert.deepEqual(policies.rows.map((row) => row.policyname).sort(), [
    "operational_read_only_delete_v1",
    "operational_read_only_insert_v1",
    "operational_read_only_update_v1",
  ]);
  checks += 1;

  await db.exec(`
    create trigger on_auth_user_created after insert on auth.users
      for each row execute function public.handle_new_user();
    insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values (
      '${accountant}', 'accountant@example.test',
      '{"role":"global_admin","invited_by_company":"${foreignCompany}","full_name":"QA Accountant"}',
      '{"generic_invitation_v1":{"state":"provisioning","company_id":"${company}","role":"accountant","is_owner":false}}'
    );
  `);
  const created = await db.query<{ role: string; status: string; company_id: string }>(
    "select role,status,company_id::text from public.profiles where id=$1",
    [accountant]
  );
  assert.deepEqual(created.rows, [{ role: "accountant", status: "pending", company_id: company }]);
  checks += 1;

  await db.exec(`
    insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values (
      '${directSignup}', 'owner@example.test',
      '{"role":"global_admin","invited_by_company":"${foreignCompany}","full_name":"QA Owner","company_name":"QA Self Signup"}',
      '{}'
    );
    insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values (
      '${trafficUser}', 'traffic@example.test',
      '{"role":"global_admin","invited_by_company":"${foreignCompany}","full_name":"QA Mechanic"}',
      '{"ptc_invitation_v1":{"state":"provisioning","company_id":"${company}","role":"mechanic_operator"}}'
    );
  `);
  const selfSignup = await db.query<{ role: string; status: string; company_id: string; is_owner: boolean; company_name: string }>(`
    select p.role,p.status,p.company_id::text,p.is_owner,c.name as company_name
    from public.profiles p join public.companies c on c.id=p.company_id
    where p.id=$1
  `, [directSignup]);
  assert.deepEqual(selfSignup.rows, [{
    role: "company_admin",
    status: "pending",
    company_id: selfSignup.rows[0]?.company_id,
    is_owner: true,
    company_name: "QA Self Signup",
  }]);
  assert.notEqual(selfSignup.rows[0]?.company_id, foreignCompany);
  checks += 2;
  assert.deepEqual(
    (await db.query("select role,status,company_id::text,is_owner from public.profiles where id=$1", [trafficUser])).rows,
    [{ role: "mechanic_operator", status: "pending", company_id: company, is_owner: false }]
  );
  checks += 1;
  await rejectsSql(
    () => db.exec(`
      insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values (
        '00000000-0000-4000-8000-000000000012', 'malformed@example.test',
        '{"role":"accountant","invited_by_company":"${company}"}',
        '{"generic_invitation_v1":"not-an-object"}'
      )
    `),
    "AUTH_INVITATION_INVALID"
  );

  const bind = (user: string, targetCompany: string, role: string, fresh: boolean) => db.query(
    "select public.bind_invited_profile_v1($1,$2,$3,$4,$5,$6,$7)",
    [actor, user, targetCompany, role, "QA Accountant", `${user}@example.test`, fresh]
  );
  await db.query(
    "select public.bind_invited_profile_v1($1,$2,$3,$4,$5,$6,$7)",
    [actor, accountant, company, "accountant", "QA Accountant", "accountant@example.test", true]
  );
  checks += 1;

  await db.exec(`
    insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values (
      '${secondAccountant}', 'accountant-two@example.test',
      '{"role":"global_admin","invited_by_company":"${foreignCompany}","full_name":"QA Accountant Two"}',
      '{"generic_invitation_v1":{"state":"provisioning","company_id":"${company}","role":"accountant","is_owner":false}}'
    );
  `);
  await db.query(
    "select public.bind_invited_profile_v1($1,$2,$3,$4,$5,$6,true)",
    [actor, secondAccountant, company, "accountant", "QA Accountant Two", "accountant-two@example.test"]
  );
  assert.deepEqual(
    (await db.query(
      "select count(*)::int as count from public.profiles where company_id=$1 and role='accountant'",
      [company]
    )).rows,
    [{ count: 2 }]
  );
  checks += 2;
  await db.exec(`update public.profiles set status='active' where id='${accountant}'`);
  await rejectsSql(
    () => db.query("select public.bind_invited_profile_v1($1,$2,$3,$4,$5,$6,false)",
      [actor, accountant, company, "accountant", "QA Accountant", "accountant@example.test"]),
    "GENERIC_INVITE_EXISTING_ACCOUNT_CONFLICT"
  );

  await db.exec(`
    insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values (
      '${retryUser}', 'retry@example.test',
      '{"role":"accountant","invited_by_company":"${company}","full_name":"Retry"}',
      '{"generic_invitation_v1":{"state":"provisioning","company_id":"${company}","role":"accountant","is_owner":false}}'
    );
  `);
  await db.query(
    "select public.bind_invited_profile_v1($1,$2,$3,$4,$5,$6,false)",
    [actor, retryUser, company, "accountant", "Retry Renamed", "retry@example.test"]
  );
  assert.deepEqual(
    (await db.query("select role,status,company_id::text,full_name from public.profiles where id=$1", [retryUser])).rows,
    [{ role: "accountant", status: "pending", company_id: company, full_name: "Retry Renamed" }]
  );
  checks += 1;

  await db.exec(`
    insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values (
      '${foreignUser}', 'foreign@example.test',
      '{"role":"accountant","invited_by_company":"${foreignCompany}","full_name":"Foreign"}',
      '{"generic_invitation_v1":{"state":"provisioning","company_id":"${foreignCompany}","role":"accountant","is_owner":false}}'
    );
    alter table auth.users disable trigger on_auth_user_created;
    insert into auth.users(id,email,raw_app_meta_data) values (
      '${profilelessUser}', '${profilelessUser}@example.test',
      '{"generic_invitation_v1":{"state":"provisioning","company_id":"${company}","role":"accountant","is_owner":false}}'
    );
    alter table auth.users enable trigger on_auth_user_created;
  `);
  await rejectsSql(
    () => db.query("select public.bind_invited_profile_v1($1,$2,$3,$4,$5,$6,false)",
      [actor, foreignUser, company, "accountant", "Foreign", "foreign@example.test"]),
    "GENERIC_INVITE_AUTH_MISMATCH"
  );
  await rejectsSql(
    () => bind(profilelessUser, company, "accountant", false),
    "GENERIC_INVITE_PROFILE_REQUIRED"
  );
  await rejectsSql(
    () => db.query("select public.bind_invited_profile_v1($1,$2,$3,$4,$5,$6,false)",
      [actor, foreignUser, foreignCompany, "company_admin", "Foreign", "foreign@example.test"]),
    "GENERIC_INVITE_FORBIDDEN"
  );

  const privileges = await db.query<{
    authenticated: boolean;
    service: boolean;
    capability_authenticated: boolean;
    capability_service: boolean;
  }>(`
    select
      has_function_privilege('authenticated','public.bind_invited_profile_v1(uuid,uuid,uuid,text,text,text,boolean)','execute') as authenticated,
      has_function_privilege('service_role','public.bind_invited_profile_v1(uuid,uuid,uuid,text,text,text,boolean)','execute') as service,
      has_function_privilege('authenticated','public.generic_invite_capabilities_v1()','execute') as capability_authenticated,
      has_function_privilege('service_role','public.generic_invite_capabilities_v1()','execute') as capability_service
  `);
  assert.deepEqual(privileges.rows, [{
    authenticated: false,
    service: true,
    capability_authenticated: false,
    capability_service: true,
  }]);
  checks += 1;

  await db.exec(`set request.jwt.claim.sub='${accountant}'`);
  assert.deepEqual((await db.query("select public.is_current_user_operational_read_only_v1() as value")).rows, [{ value: true }]);
  checks += 1;
  assert.deepEqual((await db.query("select public.get_my_company_id()::text as company_id")).rows, [{ company_id: company }]);
  checks += 1;
  assert.deepEqual((await db.query("select public.get_user_company_id()::text as company_id")).rows, [{ company_id: company }]);
  checks += 1;
  await db.exec(`update public.profiles set status='inactive' where id='${accountant}'`);
  assert.deepEqual((await db.query("select public.get_my_company_id()::text as company_id")).rows, [{ company_id: null }]);
  checks += 1;
  assert.deepEqual((await db.query("select public.get_user_company_id()::text as company_id")).rows, [{ company_id: null }]);
  checks += 1;
  assert.deepEqual((await db.query("select public.is_current_user_operational_read_only_v1() as value")).rows, [{ value: true }]);
  checks += 1;
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await db.exec(`set request.method='${method}'`);
    await rejectsSql(
      () => db.query("select public.enforce_operational_read_only_request_v1()"),
      "Operational read-only access cannot modify data"
    );
  }
  await db.exec("set request.method='GET'");
  await db.query("select public.enforce_operational_read_only_request_v1()");
  checks += 1;

  await db.exec(`set request.jwt.claim.sub='${director}'`);
  assert.deepEqual((await db.query("select public.is_current_user_director_v1() as legacy, public.is_current_user_operational_read_only_v1() as guarded")).rows,
    [{ legacy: true, guarded: true }]);
  checks += 1;
  await db.exec(`update public.profiles set status='inactive' where id='${director}'`);
  assert.deepEqual((await db.query("select public.is_current_user_director_v1() as legacy, public.is_current_user_operational_read_only_v1() as guarded")).rows,
    [{ legacy: false, guarded: true }]);
  checks += 1;

  await db.exec(`set role authenticated; set request.jwt.claim.sub='${accountant}'`);
  await assert.rejects(() => db.exec(`insert into public.rls_probe values (1,'${company}')`));
  checks += 1;
  await db.exec(`reset role; set request.jwt.claim.sub='${specialist}'`);
  await db.exec(`set role authenticated; insert into public.rls_probe values (2,'${company}'); reset role`);
  checks += 1;

  const genericProfile = {
    id: accountant,
    company_id: company,
    role: "accountant",
    status: "pending",
    is_owner: false,
  };
  const genericUser = { id: accountant, app_metadata: {}, user_metadata: {} };
  const activationDb = (genericMarker: unknown, extraAppMetadata: Record<string, unknown> = {}) => ({
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: {
              ...genericUser,
              app_metadata: genericMarker === undefined
                ? extraAppMetadata
                : { ...extraAppMetadata, generic_invitation_v1: genericMarker },
            },
          },
          error: null,
        }),
      },
    },
  });

  await assertProfileActivationReady(activationDb({
    state: "ready",
    company_id: company,
    role: "accountant",
    is_owner: false,
  }) as any, genericUser as any, genericProfile);
  checks += 1;

  for (const marker of [
    undefined,
    { state: "provisioning", company_id: company, role: "accountant", is_owner: false },
    { state: "ready", company_id: foreignCompany, role: "accountant", is_owner: false },
    { state: "ready", company_id: company, role: "director", is_owner: false },
    { state: "ready", company_id: company, role: "accountant", is_owner: true },
  ]) {
    await assert.rejects(() => assertProfileActivationReady(
      activationDb(marker) as any,
      genericUser as any,
      genericProfile
    ));
    checks += 1;
  }

  const ownerProfile = {
    ...genericProfile,
    role: "company_admin",
    is_owner: true,
  };

  // Public company signup owns its newly-created company and has no invitation
  // marker. A fresh server read must preserve this legitimate path.
  await assertProfileActivationReady(activationDb(undefined) as any, genericUser as any, ownerProfile);
  checks += 1;

  // A global-admin-created first administrator also becomes owner, but remains
  // blocked until its exact server marker reaches ready.
  await assert.rejects(() => assertProfileActivationReady(
    activationDb({ state: "provisioning", company_id: company, role: "company_admin", is_owner: true }) as any,
    genericUser as any,
    ownerProfile
  ));
  checks += 1;
  await assertProfileActivationReady(
    activationDb({ state: "ready", company_id: company, role: "company_admin", is_owner: true }) as any,
    genericUser as any,
    ownerProfile
  );
  checks += 1;

  await assert.rejects(() => assertProfileActivationReady(
    activationDb(
      { state: "ready", company_id: company, role: "company_admin", is_owner: true },
      { ptc_invitation_v1: { state: "ready", company_id: company, role: "mechanic_operator" } }
    ) as any,
    genericUser as any,
    ownerProfile
  ));
  checks += 1;

  await db.close();
  console.log(`TF2 accountant/invite security PASS: ${checks} checks; in-memory DB only, no hosted writes or email.`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
