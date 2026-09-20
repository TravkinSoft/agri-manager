import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const company = '00000000-0000-4000-8000-000000000001';
const foreign = '00000000-0000-4000-8000-000000000002';
let checks = 0;
let sequence = 100;
const uid = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12,'0')}`;
const ok = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const count = async table => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
const create = async (email, metadata = {}, app = {}, splitAuth = false) => {
  const id = uid();
  if (splitAuth) {
    await db.exec('begin');
    try {
      await db.query('insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3,$4)', [id,email,JSON.stringify(metadata),JSON.stringify({provider:'email',providers:['email']})]);
      await db.query('update auth.users set raw_app_meta_data=raw_app_meta_data||$2::jsonb where id=$1', [id,JSON.stringify(app)]);
      await db.exec('commit');
    } catch (error) {
      await db.exec('rollback');
      throw error;
    }
    return id;
  }
  await db.query('insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3,$4)', [id,email,JSON.stringify(metadata),JSON.stringify(app)]);
  return id;
};
async function rejects(operation, code) {
  await assert.rejects(operation, e => e.code === code || e.message.includes(code)); checks++;
}
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table companies(id uuid primary key default gen_random_uuid(), name text not null);
    create table profiles(id uuid primary key, full_name text, email text, role text, company_id uuid references companies(id), is_owner boolean, status text, updated_at timestamptz default now());
    create table auth.users(id uuid primary key, email text unique, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
    insert into companies values('${company}','Астык STEM'),('${foreign}','Other Tenant');
  `);
  const old = readFileSync('supabase/migrations/20260912174500_tf2_accountant_invite_read_only_v1.sql','utf8');
  const trigger = old.match(/create or replace function public\.handle_new_user\(\)[\s\S]*?\$function\$;/i)?.[0];
  assert.ok(trigger);
  await db.exec(trigger);
  await db.exec('create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()');
  // Reproduce an unmarked legacy invite and its failed-Auth cleanup/retry.
  for (let i=0;i<2;i++) {
    const user = await create('legacy@example.test', { role:'accountant', invited_by_company:company });
    const profile=(await db.query('select role,company_id,is_owner from profiles where id=$1',[user])).rows[0];
    ok(profile.role,'company_admin','baseline silently becomes company owner');
    assert.notEqual(profile.company_id,company); checks++;
    await db.query('delete from profiles where id=$1',[user]);
    await db.query('delete from auth.users where id=$1',[user]);
  }
  ok((await db.query("select count(*)::int n from companies where name=$1",["legacy@example.test's Company"])).rows[0].n,2,'baseline leaves duplicate orphan companies');
  await db.query('delete from companies where name=$1',["legacy@example.test's Company"]);
  await db.exec(readFileSync('supabase/migrations/20260920075104_company_creation_identity_guard_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260920075215_company_active_name_unique_v1.sql','utf8'));
  const deferredAuth = process.argv.includes('--deferred-auth');
  if (deferredAuth) {
    await rejects(()=>create('baseline-split@example.test', {role:'director',invited_by_company:company}, {generic_invitation_v1:{state:'provisioning',company_id:company,role:'director',is_owner:false}},true),'AUTH_COMPANY_NAME_REQUIRED');
    await db.exec('begin');
    await db.exec(readFileSync('supabase/migrations/20260920182051_p0_invite_deferred_auth_metadata_v1.sql','utf8'));
    await db.exec('commit');
    ok((await db.query("select tgdeferrable,tginitdeferred from pg_trigger where tgname='on_auth_user_created'")).rows[0],{tgdeferrable:true,tginitdeferred:true},'Auth trigger waits for final metadata');
  }
  for (const name of ['Астык STEM',' Астык STEM ','Астык  STEM','Астык\tSTEM','Астык\u00a0STEM']) {
    await rejects(()=>db.query('insert into companies(name) values($1)',[name]),'23505');
  }
  for (const name of ['OTHER TENANT',' other   tenant ','Other\nTenant']) {
    await rejects(()=>db.query('insert into companies(name) values($1)',[name]),'23505');
  }
  await rejects(()=>db.query('update companies set name=$1 where id=$2',['OTHER TENANT',company]),'23505');
  for (const name of ['', '  ', '\t\n', '\u00a0']) await rejects(()=>db.query('insert into companies(name) values($1)',[name]),'23514');

  const beforeCompanies=await count('companies');
  const beforeUsers=await count('auth.users');
  for (const meta of [{}, {role:'accountant',invited_by_company:company}, {company_name:''}, {company_name:'   '}]) {
    await rejects(()=>create(`blocked-${sequence}@example.test`,meta),'AUTH_COMPANY_NAME_REQUIRED');
  }
  ok(await count('companies'),beforeCompanies,'rejected unmarked signup creates no company');
  ok(await count('auth.users'),beforeUsers,'rejected unmarked signup creates no Auth identity');
  ok(await count('profiles'),0,'rejected signup creates no profile');
  for (const role of ['accountant','director','company_admin','agronomist','legal_operator','specialist','warehouse','warehouse_operator','weighman','fuel_operator','brigadier']) {
    const user=await create(`${role}@example.test`,{role:'global_admin',invited_by_company:foreign},{generic_invitation_v1:{state:'provisioning',company_id:company,role,is_owner:false}},deferredAuth);
    ok((await db.query('select company_id,role,status,is_owner from profiles where id=$1',[user])).rows[0],{company_id:company,role,status:'pending',is_owner:false},'trusted employee invite binds exactly to company');
    ok(await count('companies'),beforeCompanies,'employee invitation never creates a company');
  }
  const traffic=await create('traffic@example.test',{}, {ptc_invitation_v1:{state:'ready',company_id:company,role:'mechanic_operator'}},deferredAuth);
  ok((await db.query('select company_id,role,status,is_owner from profiles where id=$1',[traffic])).rows[0],{company_id:company,role:'mechanic_operator',status:'pending',is_owner:false},'PTC invitation remains compatible');
  ok(await count('companies'),beforeCompanies,'PTC invite creates no company');
  await rejects(()=>create('malformed@example.test',{}, {generic_invitation_v1:'invalid'}),'AUTH_INVITATION_INVALID');
  if (deferredAuth) {
    for (const role of ['fleet_manager','vegetable_brigadier']) {
      const user=await create(`${role}@example.test`,{}, {ptc_invitation_v1:{state:'provisioning',company_id:company,role}},true);
      ok((await db.query('select role,company_id,status from profiles where id=$1',[user])).rows[0],{role,company_id:company,status:'pending'},'split PTC provisioning stays pending in exact tenant');
    }
    await rejects(()=>create('forged@example.test',{role:'director',invited_by_company:foreign,generic_invitation_v1:{role:'director',company_id:foreign}}, {},true),'AUTH_COMPANY_NAME_REQUIRED');
    await rejects(()=>create('privilege@example.test',{}, {generic_invitation_v1:{state:'ready',company_id:company,role:'global_admin',is_owner:false}},true),'AUTH_INVITATION_INVALID');
    await rejects(()=>create('ambiguous@example.test',{}, {generic_invitation_v1:{state:'ready',company_id:company,role:'director',is_owner:false},ptc_invitation_v1:{}},true),'AUTH_INVITATION_AMBIGUOUS');
    ok(await count('companies'),beforeCompanies,'split invitations and rejected forgery create no tenants');
    const existing=(await db.query("select id,role,company_id from profiles where email='director@example.test'")).rows[0];
    await db.query("update auth.users set raw_user_meta_data=$2 where id=$1",[existing.id,JSON.stringify({role:'global_admin',invited_by_company:foreign})]);
    ok((await db.query('select id,role,company_id from profiles where id=$1',[existing.id])).rows[0],existing,'later user metadata edits cannot rebind a profile');
  }

  const owner=await create('owner@example.test',{full_name:'New Owner',company_name:'Deliberate New Company',role:'global_admin',invited_by_company:foreign});
  const profile=(await db.query('select p.role,p.status,p.is_owner,c.name from profiles p join companies c on c.id=p.company_id where p.id=$1',[owner])).rows[0];
  ok(profile,{role:'company_admin',status:'pending',is_owner:true,name:'Deliberate New Company'},'explicit registration still creates only its own company');
  const companiesBeforeDuplicate=await count('companies');
  const usersBeforeDuplicate=await count('auth.users');
  const profilesBeforeDuplicate=await count('profiles');
  await rejects(()=>create('duplicate@example.test',{company_name:' deliberate  new company '}),'23505');
  ok(await count('companies'),companiesBeforeDuplicate,'duplicate registration has no company side effect');
  ok(await count('auth.users'),usersBeforeDuplicate,'duplicate registration has no Auth side effect');
  ok(await count('profiles'),profilesBeforeDuplicate,'duplicate registration has no profile side effect');
  ok((await db.query("select prosecdef,proconfig from pg_proc where oid='public.handle_new_user()'::regprocedure")).rows[0],{prosecdef:true,proconfig:['search_path=""']},'existing trigger definer boundary preserved');
  const archived = uid();
  await db.query('insert into companies(id,name,archived_at) values($1,$2,now())',[archived,'Other Tenant']);
  ok((await db.query('select count(*)::int n from companies where name=$1',['Other Tenant'])).rows[0].n,2,'historical archive can preserve the exact duplicate name');
  ok((await db.query('select count(*)::int n from companies where name=$1 and archived_at is null',['Other Tenant'])).rows[0].n,1,'active company query excludes archived duplicate');
  await rejects(()=>db.query('update companies set archived_at=null where id=$1',[archived]),'23505');
  await rejects(()=>create('archived-invite@example.test',{}, {generic_invitation_v1:{state:'provisioning',company_id:archived,role:'accountant',is_owner:false}}),'AUTH_INVITATION_COMPANY_NOT_FOUND');
  const companiesRoute=readFileSync('app/api/global-admin/companies/route.ts','utf8');
  ok((companiesRoute.match(/\.is\("archived_at", null\)/g)||[]).length,2,'both list and company selection exclude archives');
  for (const route of ['platform-status','company-users']) {
    ok(readFileSync(`app/api/global-admin/${route}/route.ts`,'utf8').includes('.is("archived_at", null)'),true,`${route} excludes archived companies`);
  }
  const provisioningRoute=readFileSync('app/api/global-admin/create-company/route.ts','utf8');
  ok(provisioningRoute.includes('code: "COMPANY_NAME_EXISTS"'),true,'duplicate company gets a clear API conflict');
  ok(provisioningRoute.includes('if (error) return false;'),true,'failed Auth removal prevents company archival');
  ok(provisioningRoute.includes('Uncertain') || provisioningRoute.includes('uncertain Auth outcome'),true,'unknown Auth outcomes remain visible for recovery');
  ok(provisioningRoute.includes('admin.from("companies").delete()'),false,'failed provisioning never deletes immutable ledger parents');
  console.log(JSON.stringify({result:'PASS',checks,productionConnections:0}));
} finally { await db.close(); }
