const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  let checks = 0;
  const a = '10000000-0000-4000-8000-000000000001';
  const b = '10000000-0000-4000-8000-000000000002';
  const admin = '20000000-0000-4000-8000-000000000001';
  const person = '30000000-0000-4000-8000-000000000001';
  const user = '40000000-0000-4000-8000-000000000001';
  const otherUser = '40000000-0000-4000-8000-000000000002';
  async function rejects(sql, text) {
    await assert.rejects(db.exec(sql), e => e.message.includes(text)); checks++;
  }
  const bind = (overrides = {}) => {
    const p = { actor: admin, user, company: a, role: 'mechanic_operator', name: 'Existing Mechanic', person, fresh: true, create: false, ...overrides };
    const quote = value => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
    return `select public.ptc_bind_invited_profile_v1(${quote(p.actor)},${quote(p.user)},${quote(p.company)},${quote(p.role)},${quote(p.name)},'ptc-fixture@example.test',${quote(p.person)},${p.create},${p.fresh});`;
  };
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table companies(id uuid primary key);
      create table profiles(id uuid primary key, company_id uuid references companies(id),role text,status text,full_name text,email text,is_owner boolean,
        constraint valid_role check(role in ('global_admin','company_admin','agronomist','director','legal_operator','specialist','warehouse','warehouse_operator','weighman','fuel_operator','brigadier')));
      create table company_people(id uuid primary key default gen_random_uuid(),company_id uuid references companies(id),user_id uuid references profiles(id),
        full_name text,role_type text,position text,status text,deleted_at timestamptz,created_by_user_id uuid,updated_by_user_id uuid);
      insert into companies values('${a}'),('${b}');
      insert into profiles(id,company_id,role,status) values('${admin}','${a}','company_admin','active');
      insert into company_people(id,company_id,full_name,role_type,status) values('${person}','${a}','Existing Mechanic','mechanic_operator','active');
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260904112201_ptc_company_account_roles_v1.sql'), 'utf8'));
    await db.exec(bind());
    let result = await db.query(`select p.role,p.status,c.user_id,c.role_type from profiles p join company_people c on c.user_id=p.id where p.id='${user}'`);
    assert.deepEqual(result.rows[0], {role:'mechanic_operator',status:'pending',user_id:user,role_type:'mechanic_operator'}); checks++;
    await db.exec(bind({fresh:false})); checks++;
    result = await db.query('select count(*)::int n from company_people'); assert.equal(result.rows[0].n,1); checks++;
    await rejects(bind({user:otherUser}), 'PTC_PERSON_ALREADY_LINKED');
    await rejects(bind({company:b}), 'PTC_INVITE_FORBIDDEN');
    await rejects(bind({role:'company_admin'}), 'PTC_INVALID_INVITATION');
    await rejects(bind({user:otherUser,person:null,create:false}), 'PTC_PERSON_REQUIRED');
    await rejects(bind({user:otherUser,person:null,create:true}), 'PTC_SELECT_EXISTING_PERSON');
    await db.exec(`update profiles set status='active' where id='${user}'`);
    await rejects(bind({fresh:false}), 'PTC_EXISTING_ACCOUNT_CONFLICT');
    await db.exec(bind({user:otherUser,person:null,create:true,name:'New Receiver',role:'vegetable_brigadier'}));
    result = await db.query(`select p.role,p.status,c.role_type,c.position from profiles p join company_people c on c.user_id=p.id where p.id='${otherUser}'`);
    assert.deepEqual(result.rows[0], {role:'vegetable_brigadier',status:'pending',role_type:'manager',position:'Бригадир овощной'}); checks++;
    result = await db.query("select has_function_privilege('authenticated','public.ptc_bind_invited_profile_v1(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean)','EXECUTE') allowed");
    assert.equal(result.rows[0].allowed,false); checks++;
    result = await db.query("select has_function_privilege('anon','public.ptc_bind_invited_profile_v1(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean)','EXECUTE') allowed");
    assert.equal(result.rows[0].allowed,false); checks++;
    await db.exec(`update profiles set status='inactive' where id='${admin}'`);
    await rejects(bind({fresh:false}), 'PTC_INVITE_FORBIDDEN');
    console.log(`PTC company invite SQL PASS: ${checks} checks (local isolated PostgreSQL, not live email delivery)`);
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode=1; });
