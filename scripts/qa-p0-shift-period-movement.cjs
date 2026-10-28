const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const sql = readFileSync('supabase/migrations/20260919201141_p0_shift_period_movement_v1.sql', 'utf8');
const company='10000000-0000-0000-0000-000000000001';
const shift='20000000-0000-0000-0000-000000000001';
const actor='30000000-0000-0000-0000-000000000001';
const potato='40000000-0000-0000-0000-000000000001';
const receipt='50000000-0000-0000-0000-000000000001';
const removal='50000000-0000-0000-0000-000000000002';
async function setup() {
 const db=new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create table weighbridge_shifts(id uuid primary key,company_id uuid,status text,operator_person_id uuid,opened_at timestamptz,closed_at timestamptz,closed_by uuid,closed_by_person_id uuid,close_reason text,summary_json jsonb,ticket_count int,closed_ticket_count int,voided_ticket_count int,gross_total_kg numeric,net_total_kg numeric,unresolved_ticket_count int,unsynced_count int);
 create table tickets(id uuid primary key,company_id uuid,shift_id uuid,ticket_no text,op_type text,status text,is_finalized bool,is_voided bool,replacement_ticket_id uuid,net_weight_kg numeric,gross_weight_kg numeric,accepted_weight_kg numeric,field_id uuid,crop_structure_allocation_id uuid,created_at timestamptz,local_sync_status text);
 create table ticket_lines(id uuid,ticket_id uuid,crop_id uuid);
 create table crops(id uuid,name_ru text,name text,name_kz text,name_en text);
 create table fields(id uuid,company_id uuid,name text);
 create function harvest_impurities_by_receipt_v1(uuid) returns jsonb language sql as 'select ''{"${receipt}":78442.656}''::jsonb';
 insert into weighbridge_shifts(id,company_id,status,operator_person_id,opened_at) values('${shift}','${company}','open','${actor}','2026-09-19T02:00Z');
 insert into crops(id,name_ru) values('${potato}','Картофель');
 insert into tickets(id,company_id,shift_id,ticket_no,op_type,status,is_finalized,is_voided,net_weight_kg,accepted_weight_kg,created_at) values
 ('${receipt}','${company}','${shift}','RECEIPT','harvest_incoming','finalized',true,false,777070,777070,now()),
 ('${removal}','${company}','${shift}','SOIL','weighbridge_impurities','finalized',true,false,130380,103140,now());
 insert into ticket_lines select gen_random_uuid(),id,'${potato}' from tickets;
 `);
 await db.exec(sql);
 return db;
}
async function close(db, operator=actor) {
 return (await db.query('select close_weighbridge_shift_snapshot_v1($1,$2,$3,$4) result',[company,shift,actor,operator])).rows[0].result;
}
(async()=>{
 const db=await setup();
 await assert.rejects(()=>close(db,company),/Весовщик сменился/);
 await db.exec(`update tickets set status='active',is_finalized=false where id='${receipt}'`);
 await assert.rejects(()=>close(db),/Сначала закройте талоны/);
 await db.exec(`update tickets set status='finalized',is_finalized=true,local_sync_status='pending' where id='${receipt}'`);
 await assert.rejects(()=>close(db),/несинхронизированные/);
 await db.exec(`update tickets set local_sync_status='synced'`);
 const before=JSON.stringify((await db.query('select * from tickets order by id')).rows);
 const closed=await close(db);
 assert.equal(closed.status,'closed');
 assert.equal(closed.summary_json.potatoPeriodResultKg,646690);
 assert.equal(closed.summary_json.potatoPeriodImpuritiesKg,130380);
 assert.equal(closed.summary_json.potatoNetKg,777070);
 assert.equal(closed.summary_json.potatoCleanKg,698627.344);
 assert.equal(closed.summary_json.periodAccountingBasis,'receipt_net_minus_period_removals_v1');
 assert.equal(JSON.stringify((await db.query('select * from tickets order by id')).rows),before);
 await db.exec(`update tickets set net_weight_kg=1 where id='${receipt}'`);
 assert.deepEqual(await close(db),closed); // replay cannot rewrite saved report
 await db.close();
 const unknown=await setup();
 await unknown.exec(`delete from ticket_lines where ticket_id='${removal}'`);
 const u=await close(unknown);
 assert.equal(u.summary_json.potatoPeriodResultKg,null);
 assert.equal(u.summary_json.potatoPeriodUnresolvedCount,1);
 await unknown.close();
 const carrot=await setup();
 await carrot.exec(`insert into crops(id,name_ru) values('${company}','Морковь'); update ticket_lines set crop_id='${company}' where ticket_id='${removal}'`);
 assert.equal((await close(carrot)).summary_json.potatoPeriodResultKg,777070);
 await carrot.close();
 console.log('PASS: actual shift closure SQL saves 646690 atomically; no ticket writes; immutable replay; operator, open-ticket and sync guards; unknown crop and carrot isolation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
