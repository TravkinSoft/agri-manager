const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const base = readFileSync('scripts/qa-p0-shift-report-preview.cjs', 'utf8');
// Reuse the real v2 report fixture without running its independent tests.
const fixture = vm.runInNewContext(base.slice(0, base.indexOf('(async()=>{')) + '\n({setup,company,shift,actor,potato,receipt,removal,preview,close})', { require, console });
const sql = readFileSync('supabase/migrations/20260922020836_weighbridge_impurity_adjustments_v1.sql', 'utf8');
const id = n => `70000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const { company, shift, actor, potato, receipt, removal } = fixture;
const warehouse=id(1), plot=id(2), field=id(3), product=id(4), batch1=id(5), batch2=id(6), key=id(7), receipt2=id(8), oldReceipt=id(9), oldRemoval=id(10), oldPlot=id(11);
async function setup() {
  const db=await fixture.setup();
  await db.exec(`
    alter table companies add primary key(id),add column operational_day_start_hour integer default 7;
    alter table warehouses add primary key(id),add column archived boolean default false,add column is_archived boolean default false;
    alter table fields add primary key(id);
    alter table crops add primary key(id);
    create table profiles(id uuid primary key,role text,status text default 'active');
    create table crop_structure(id uuid primary key,company_id uuid,field_id uuid,crop_id uuid,variety_id uuid,reproduction_id uuid,area numeric);
    create table inventory_batches(id uuid primary key,company_id uuid,crop_structure_id uuid,warehouse_id uuid,source_ticket_id uuid,parent_batch_id uuid,
      crop_id uuid,product_id uuid,variety_id uuid,reproduction_id uuid,batch_class text,current_weight_kg numeric,current_quantity numeric,is_mixed_harvest boolean default false,updated_at timestamptz);
    create table stock_ledger_entries(id uuid primary key default gen_random_uuid(),company_id uuid,product_id uuid,warehouse_id uuid,direction text,quantity numeric,uom text,delta_qty_signed numeric,
      reason_type text,reason_ref_id uuid,inventory_batch_id uuid,batch_id text,batch_id_text text,batch_class text,crop_id uuid,variety_id uuid,reproduction_id uuid,mass_kg numeric,
      unit_source text,unit_contract_version smallint,created_by uuid,notes text);
    create table weighbridge_shared_impurity_groups(id uuid primary key,company_id uuid,ticket_id uuid,source_warehouse_id uuid,state text);
    create table weighbridge_shared_impurity_members(id uuid primary key,company_id uuid,group_id uuid,crop_structure_id uuid,allocated_impurity_kg numeric);
    create table weighbridge_shared_impurity_source_batches(id uuid primary key,company_id uuid,group_id uuid,inventory_batch_id uuid);
    insert into profiles(id,role) values('${actor}','global_admin');
    insert into warehouses(id,company_id,name) values('${warehouse}','${company}','Test warehouse');
    insert into fields values('${field}','${company}','Test field');
    insert into crop_structure values('${plot}','${company}','${field}','${potato}',null,null,24),('${oldPlot}','${company}','${field}','${potato}',null,null,54);
    update tickets set net_weight_kg=200000,accepted_weight_kg=200000,field_id='${field}',crop_structure_allocation_id='${plot}',warehouse_to_id='${warehouse}' where id='${receipt}';
    update tickets set net_weight_kg=92380,warehouse_from_id='${warehouse}' where id='${removal}';
    insert into tickets(id,company_id,shift_id,ticket_no,op_type,status,is_finalized,is_voided,net_weight_kg,accepted_weight_kg,created_at,field_id,crop_structure_allocation_id,warehouse_to_id,warehouse_from_id) values
      ('${receipt2}','${company}','${shift}','NEW-2','harvest_incoming','finalized',true,false,141010,141010,now(),'${field}','${plot}','${warehouse}',null),
      ('${oldReceipt}','${company}','${shift}','OLD','harvest_incoming','finalized',true,false,728720,728720,now(),'${field}','${oldPlot}','${warehouse}',null),
      ('${oldRemoval}','${company}','${shift}','OLD-SOIL','weighbridge_impurities','finalized',true,false,151620,151620,now(),null,null,null,'${warehouse}');
    insert into ticket_lines(id,ticket_id,crop_id) select gen_random_uuid(),id,'${potato}' from tickets where id not in ('${receipt}','${removal}');
    update tickets set finalized_at='2026-09-19T20:05:56Z';
    insert into weighbridge_shared_impurity_groups values('${id(20)}','${company}','${removal}','${warehouse}','finalized'),('${id(21)}','${company}','${oldRemoval}','${warehouse}','finalized');
    insert into weighbridge_shared_impurity_members values('${id(22)}','${company}','${id(20)}','${plot}',92380),('${id(23)}','${company}','${id(21)}','${oldPlot}',151620);
    insert into inventory_batches(id,company_id,crop_structure_id,warehouse_id,source_ticket_id,crop_id,product_id,batch_class,current_weight_kg) values
      ('${batch1}','${company}','${plot}','${warehouse}','${receipt}','${potato}','${product}','commodity',125000),
      ('${batch2}','${company}','${plot}','${warehouse}','${receipt2}','${potato}','${product}','commodity',123630);
    insert into stock_ledger_entries(company_id,product_id,warehouse_id,delta_qty_signed,inventory_batch_id,uom,batch_class) values
      ('${company}','${product}','${warehouse}',125000,'${batch1}','kg','commodity'),('${company}','${product}','${warehouse}',123630,'${batch2}','kg','commodity');
  `);
  await db.exec(sql);
  return db;
}
async function post(db, override={}) {
 const preview=await fixture.preview(db);
 const args={company,shift,warehouse,plot,confirmed:112380,actor,key,token:preview.reviewToken,reason:'Owner confirmed total soil 112380; physical trip details unavailable',evidence:{ownerConfirmed:true},...override};
 return (await db.query('select post_weighbridge_impurity_adjustment_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) result',
  [args.company,args.shift,args.warehouse,args.plot,args.confirmed,args.actor,args.key,args.token,args.reason,JSON.stringify(args.evidence)])).rows[0].result;
}
(async()=>{
 const db=await setup();
 const before=await fixture.preview(db);
 assert.equal(before.potatoPeriodResultKg,825730);
 const tickets=JSON.stringify((await db.query('select * from tickets order by id')).rows);
 await assert.rejects(()=>post(db,{actor:id(99)}),/ACTOR_FORBIDDEN/);
 await assert.rejects(()=>post(db,{token:'stale'}),/SHIFT_PREVIEW_CHANGED/);
 await assert.rejects(()=>post(db,{evidence:{}}),/EVIDENCE_REQUIRED/);
 await assert.rejects(()=>post(db,{confirmed:90000}),/POSITIVE_KG_REQUIRED/);
 await assert.rejects(()=>post(db,{confirmed:999999}),/INSUFFICIENT_STOCK/);
 await assert.rejects(()=>post(db,{warehouse:id(99)}),/WAREHOUSE_UNAVAILABLE/);
 await db.exec(`create function reject_second() returns trigger language plpgsql as $$ begin if new.reason_type='weighbridge_impurity_adjustment_out' and new.inventory_batch_id='${batch2}' then raise exception 'INJECTED'; end if; return new; end $$;
 create trigger reject_second before insert on stock_ledger_entries for each row execute function reject_second();`);
 await assert.rejects(()=>post(db),/INJECTED/);
 assert.equal((await db.query('select count(*)::int n from weighbridge_impurity_adjustments')).rows[0].n,0);
 assert.equal((await db.query('select sum(delta_qty_signed)::float kg from stock_ledger_entries')).rows[0].kg,248630);
 assert.equal((await db.query('select sum(current_weight_kg)::float kg from inventory_batches')).rows[0].kg,248630);
 await db.exec('drop trigger reject_second on stock_ledger_entries');
 const doc=await post(db);
 assert.equal(Number(doc.quantity_kg),20000); assert.equal(Number(doc.recorded_impurity_kg),92380);
 assert.equal(Date.parse(doc.accounting_at),Date.parse('2026-09-19T20:05:56Z'));
 assert.equal(doc.allocations.reduce((sum,row)=>sum+Math.round(row.quantityKg*1000),0),20000000);
 assert.equal((await db.query('select sum(delta_qty_signed)::float kg from stock_ledger_entries')).rows[0].kg,228630);
 assert.equal((await db.query('select sum(current_weight_kg)::float kg from inventory_batches')).rows[0].kg,228630);
 const report=await fixture.preview(db);
 assert.equal(report.potatoPeriodResultKg,805730); assert.equal(report.potatoPeriodImpuritiesKg,264000);
 assert.equal(report.impurityTripCount,2); assert.equal(report.ticketCount,5);
 assert.equal(report.impurityAdjustmentCount,1); assert.equal(report.impurityAdjustmentKg,20000);
 assert.equal(report.periodPlots.find(row=>row.cropStructureId===plot).resultKg,228630);
 assert.equal(report.periodPlots.find(row=>row.cropStructureId===oldPlot).resultKg,577100);
 assert.equal(report.potatoNetKg,before.potatoNetKg); assert.equal(report.netTotalKg,before.netTotalKg);
 assert.equal(report.tickets.length,before.tickets.length);
 assert.equal(JSON.stringify((await db.query('select * from tickets order by id')).rows),tickets);
 assert.deepEqual(await post(db),doc);
 await assert.rejects(()=>post(db,{confirmed:112381}),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(()=>post(db,{key:id(77)}),/SCOPE_ALREADY_RECONCILED/);
 await assert.rejects(()=>fixture.close(db,before.reviewToken),/SHIFT_PREVIEW_CHANGED/);
 const closed=await fixture.close(db,report.reviewToken);
 assert.equal(closed.summary_json.potatoPeriodResultKg,805730);
 assert.deepEqual(await fixture.preview(db),closed.summary_json);
 assert.deepEqual(await post(db),doc); // replay after close is still read-only
 await assert.rejects(()=>post(db,{key:id(78)}),/SHIFT_NOT_OPEN/);
 assert.equal((await db.query("select has_table_privilege('authenticated','weighbridge_impurity_adjustments','SELECT') allowed")).rows[0].allowed,false);
 assert.equal((await db.query("select has_function_privilege('anon','post_weighbridge_impurity_adjustment_v1(uuid,uuid,uuid,uuid,numeric,uuid,uuid,text,text,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
 await db.close();
 console.log('PASS: 825730 -> 805730, exact source stock 248630 -> 228630; no fake tickets/trips; proportional grams; rollback on partial failure; idempotent replay; scope/company/actor/evidence guards; fresh preview token; frozen closure; anon/authenticated denied.');
})().catch(error=>{console.error(error);process.exit(1);});
