const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const sql = readFileSync('supabase/migrations/20260919203841_p0_shift_report_preview_v2.sql', 'utf8');
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
 await db.exec(`
 alter table weighbridge_shifts add column manual_correction_count int;
 alter table tickets add column driver_id uuid,add column vehicle_id uuid,add column warehouse_from_id uuid,add column warehouse_to_id uuid,
   add column audit_json jsonb,add column finalized_at timestamptz,add column tare_weight_kg numeric,add column manual_correction_reason text,add column correction_of_ticket_id uuid;
 alter table ticket_lines add column variety_name_snapshot text,add column reproduction_name_snapshot text;
 create table company_people(id uuid,company_id uuid,full_name text);
 create table reference_vehicles(id uuid,company_id uuid,name text,plate_number text,license_plate text);
 create table warehouses(id uuid,company_id uuid,name text);
 create table companies(id uuid,name text);
 insert into companies values('${company}','Test company');
 insert into company_people values('${actor}','${company}','Test operator');
 `);
 await db.exec(sql);
 return db;
}
async function close(db, token, operator=actor) {
 return (await db.query('select close_weighbridge_shift_snapshot_v2($1,$2,$3,$4,$5) result',[company,shift,actor,operator,token])).rows[0].result;
}

async function preview(db, companyId=company) {
 return (await db.query('select preview_weighbridge_shift_snapshot_v2($1,$2) result',[companyId,shift])).rows[0].result;
}
const business = value => { const {capturedAt,closedAt,...rest}=value; return rest; };
(async()=>{
 const db=await setup();
 const initial=await preview(db);
 assert.equal(initial.potatoPeriodResultKg,646690);
 assert.equal(initial.closedTicketCount,2);
 assert.equal(initial.harvestReceiptCount,1);
 assert.equal(initial.impurityTripCount,1);
 assert.equal(initial.tickets.length,2);
 assert.equal(initial.reportVersion,2);
 assert.deepEqual(business(await preview(db)),business(initial));
 await assert.rejects(()=>preview(db,actor),/Смена не найдена/);
 await assert.rejects(()=>close(db,initial.reviewToken,company),/Весовщик сменился/);
 await db.exec(`update tickets set status='active',is_finalized=false where id='${receipt}'`);
 assert.equal((await preview(db)).openTicketCount,1);
 await assert.rejects(()=>close(db,initial.reviewToken),/Сначала закройте талоны/);
 await db.exec(`update tickets set status='finalized',is_finalized=false where id='${receipt}'`);
 assert.equal((await preview(db)).openTicketCount,1);
 await assert.rejects(()=>close(db,initial.reviewToken),/Сначала закройте талоны/);
 await db.exec(`update tickets set status='finalized',is_finalized=true,local_sync_status='pending' where id='${receipt}'`);
 await assert.rejects(()=>close(db,initial.reviewToken),/несинхронизированные/);
 await db.exec(`update tickets set local_sync_status='synced',net_weight_kg=net_weight_kg+10 where id='${receipt}'`);
 await assert.rejects(()=>close(db,initial.reviewToken),/SHIFT_PREVIEW_CHANGED/);
 assert.equal((await db.query('select status from weighbridge_shifts')).rows[0].status,'open');
 await db.exec(`update tickets set net_weight_kg=net_weight_kg-10 where id='${receipt}'`);
 const checked=await preview(db);
 const before=JSON.stringify((await db.query('select * from tickets order by id')).rows);
 const closed=await close(db,checked.reviewToken);
 assert.equal(closed.status,'closed');
 assert.equal(closed.summary_json.potatoPeriodResultKg,646690);
 assert.deepEqual(business(closed.summary_json),business(checked));
 assert.equal(JSON.stringify((await db.query('select * from tickets order by id')).rows),before);
 await db.exec(`update tickets set net_weight_kg=1 where id='${receipt}'`);
 assert.deepEqual((await close(db,checked.reviewToken)),closed);
 assert.deepEqual(await preview(db),closed.summary_json);
 await db.close();
 const unknown=await setup();
 await unknown.exec(`delete from ticket_lines where ticket_id='${removal}'`);
 assert.equal((await preview(unknown)).potatoPeriodResultKg,null);
 await assert.rejects(async()=>close(unknown,(await preview(unknown)).reviewToken),/Не определена культура/);
 await unknown.close();
 const many=await setup();
 await many.exec(`delete from ticket_lines; delete from tickets;
 insert into tickets(id,company_id,shift_id,ticket_no,op_type,status,is_finalized,is_voided,net_weight_kg,accepted_weight_kg,created_at)
 select gen_random_uuid(),'${company}','${shift}','RECEIPT-'||n,'harvest_incoming','finalized',true,false,case when n=75 then 37070 else 10000 end,case when n=75 then 37070 else 10000 end,now() from generate_series(1,75)n;
 insert into tickets(id,company_id,shift_id,ticket_no,op_type,status,is_finalized,is_voided,net_weight_kg,created_at)
 select gen_random_uuid(),'${company}','${shift}','SOIL-'||n,'weighbridge_impurities','finalized',true,false,case when n=27 then 380 else 5000 end,now() from generate_series(1,27)n;
 insert into ticket_lines(id,ticket_id,crop_id) select gen_random_uuid(),id,'${potato}' from tickets;`);
 const paper=await preview(many);
 assert.equal(paper.harvestReceiptCount,75); assert.equal(paper.potatoReceiptCount,75);
 assert.equal(paper.impurityTripCount,27); assert.equal(paper.closedTicketCount,102);
 assert.equal(paper.potatoPeriodImpurityTripCount,27);
 assert.equal(paper.potatoNetKg,777070); assert.equal(paper.potatoPeriodImpuritiesKg,130380); assert.equal(paper.potatoPeriodResultKg,646690);
 assert.deepEqual(paper.operations.map(x=>x.trips).sort((a,b)=>a-b),[27,75]);
 await many.exec(`insert into tickets(id,company_id,shift_id,ticket_no,op_type,status,is_finalized,is_voided,net_weight_kg,created_at)
 select gen_random_uuid(),'${company}','${shift}','VOID-'||n,'harvest_incoming','voided',false,true,10000,now() from generate_series(1,1100)n;`);
 const paged=await preview(many);
 assert.equal(paged.ticketCount,1202);assert.equal(paged.tickets.length,1202);assert.equal(paged.voidedTicketCount,1100);assert.equal(paged.potatoPeriodResultKg,646690);
 assert.notEqual(paged.reviewToken,paper.reviewToken);
 await assert.rejects(()=>close(many,paper.reviewToken),/SHIFT_PREVIEW_CHANGED/);
 await many.close();
 console.log('PASS: shared preview/save report; immutable replay; stale confirmation; 75 receipts + 27 removals = 102, 646690 kg; no pagination truncation; auth/operator/open/sync/unknown guards; no ticket mutations.');
})().catch(error=>{console.error(error);process.exitCode=1;});
