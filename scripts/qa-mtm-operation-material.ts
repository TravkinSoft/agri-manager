import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { inferMaterialTypeByProductType, toStorageMaterialType } from "../lib/operations/operation-engine";

// Real unchanged v1/v12 creators, receipt functions and actor guard on synthetic
// tables. Proves the shared creator's CHECK/request integration, not browser E2E,
// the whole E1 target/trigger stack, stock posting or multi-session scheduling.
const db = new PGlite();
const id = (n: number) => `31000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const company=id(1), foreign=id(2), actor=id(3), keeper=id(4), outsider=id(5), field=id(6), part=id(7), fertilizer=id(8);
let checks=0;
async function check(name:string, run:()=>Promise<void>){await run();checks++;console.log(`PASS ${name}`);}
async function scalar<T=any>(sql:string,args:unknown[]=[]):Promise<T>{const r=await db.query(sql,args);return Object.values(r.rows[0] as object)[0] as T;}
async function reject(run:()=>Promise<unknown>, pattern:RegExp){await assert.rejects(run,(e:any)=>{assert.match(String(e.message),pattern);return true;});}
function extract(source:string, name:string){
  const start=source.indexOf(`create or replace function public.${name}(`);
  const body=source.indexOf('as $$',start),end=source.indexOf('$$;',body+5);
  assert.ok(start>=0&&body>start&&end>body,name);return source.slice(start,end+3);
}
const snapshots=async()=>scalar(`select jsonb_build_object(
  'products',(select jsonb_agg(to_jsonb(x) order by id) from products x),
  'operations',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from operations x),
  'materials',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from operation_materials x),
  'requests',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from warehouse_issue_requests x),
  'items',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from warehouse_issue_request_items x),
  'receipts',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from operation_mutation_receipts x),
  'ledger',(select jsonb_agg(to_jsonb(x) order by id) from stock_ledger_entries x),
  'inventory',(select jsonb_agg(to_jsonb(x) order by id) from inventory_transactions x),
  'warehouses',(select jsonb_agg(to_jsonb(x) order by id) from warehouses x))`);
const material=(product=part,kind='other',unit='pcs',quantity=6)=>({product_id:product,material_type:kind,unit,planned_quantity:quantity});
async function create(materials=[material()],key='mtm-other',fingerprint='mtm-other-v1',who=actor,c=company){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);
  await db.exec('set role authenticated');
  try{return await scalar(`select public.create_operation_plan_atomic_v12($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'{}',$6,$7)`,[
    c,who,JSON.stringify({field_id:field,operation_type:'Обслуживание',operation_type_slug:'service_operation',operation_category_slug:'service_operation',date:'2026-10-31',responsible_user_id:actor}),
    JSON.stringify([{field_id:field,planned_area_ha:1}]),JSON.stringify(materials),key,fingerprint]);}
  finally{await db.exec('reset role');}
}
async function main(){
  await check('material selection uses other; existing agro/fuel mappings remain unchanged',async()=>{
    for(const value of ['material',' MATERIAL ']) assert.equal(inferMaterialTypeByProductType(value),'other');
    assert.equal(toStorageMaterialType(inferMaterialTypeByProductType('material')),'other');
    for(const [value,expected] of [['seed','seed'],['fertilizer','fertilizer'],['pesticide','pesticide'],['additive','adjuvant'],['growth_regulator','pesticide'],['fuel','fuel'],['organic','organic'],['unknown','fertilizer']]) assert.equal(inferMaterialTypeByProductType(value),expected);
  });
  await db.exec(await readFile('scripts/fixtures/mtm-operation-material-schema.sql','utf8'));
  // The old CHECK comes from the real migration, not a rewritten test substitute.
  await db.exec(await readFile('supabase/migrations/20260608120000_operations_v2_final_engine.sql','utf8'));
  const father=(await readFile('supabase/migrations/20260802020130_father_pilot_schema_v1.sql','utf8')).replace(/\r\n/g,'\n');
  for(const name of ['assert_operation_mutation_actor_v1','operation_mutation_receipt_begin_v1','operation_mutation_receipt_finish_v1','create_operation_plan_atomic_v1','create_operation_plan_atomic_v12']) await db.exec(extract(father,name));
  const seed=(await readFile('supabase/migrations/20260803125025_seed_planting_material_lifecycle_v1.sql','utf8')).replace(/\r\n/g,'\n');
  const patchStart=seed.indexOf('do $patch_create_operation$');
  const patchEnd=seed.indexOf('$patch_create_operation$;',patchStart+4);
  assert.ok(patchStart>=0&&patchEnd>patchStart);
  // Apply the existing migration's actual v1 identity-column extension too.
  await db.exec(seed.slice(patchStart,patchEnd+'$patch_create_operation$;'.length));
  await db.exec(`revoke all on all tables in schema public from authenticated;
    revoke all on function public.assert_operation_mutation_actor_v1(uuid,uuid,text[]) from public;
    revoke all on function public.operation_mutation_receipt_begin_v1(uuid,text,text,text) from public;
    revoke all on function public.operation_mutation_receipt_finish_v1(uuid,text,uuid,text,text,uuid,jsonb) from public;
    revoke all on function public.create_operation_plan_atomic_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,text) from public;
    revoke all on function public.create_operation_plan_atomic_v12(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,text) from public;
    grant execute on function public.create_operation_plan_atomic_v12(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,text) to authenticated;`);
  await db.query('insert into companies values($1),($2)',[company,foreign]);
  for(const [a,c,r] of [[actor,company,'company_admin'],[keeper,company,'warehouse_operator'],[outsider,foreign,'company_admin']]) await db.query("insert into profiles values($1,$2,$3,'active')",[a,c,r]);
  await db.query('insert into fields values($1,$2)',[field,company]);
  await db.query("insert into products values($1,$2,'material','pcs',false),($3,$2,'fertilizer','kg',false)",[part,company,fertilizer]);
  await db.query('insert into stock_ledger_entries values($1,10)',[id(20)]);
  await db.query('insert into inventory_transactions values($1,10)',[id(21)]);
  await db.query("insert into warehouses values($1,'Существующий синтетический склад')",[id(22)]);
  const draft=await readFile('docs/project-live/schema-drafts/mtm-operation-material-other-v1.sql','utf8');
  const oldDefinition=await scalar<string>("select pg_get_constraintdef(oid) from pg_constraint where conrelid='operation_materials'::regclass and conname='operation_materials_material_type_check'");
  const before=await snapshots();
  await check('old CHECK reproduces creator failure; operation/request/receipt all roll back',async()=>{
    await reject(()=>create(),/operation_materials_material_type_check/);assert.deepEqual(await snapshots(),before);
  });
  const defsBefore=await scalar("select jsonb_agg(jsonb_build_array(proname,pg_get_functiondef(oid),proacl) order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in ('assert_operation_mutation_actor_v1','create_operation_plan_atomic_v1','create_operation_plan_atomic_v12','operation_mutation_receipt_begin_v1','operation_mutation_receipt_finish_v1')");
  await check('draft changes only finite CHECK; data and creator/actor/receipt functions unchanged',async()=>{
    await db.exec(draft);assert.deepEqual(await snapshots(),before);
    assert.deepEqual(await scalar("select jsonb_agg(jsonb_build_array(proname,pg_get_functiondef(oid),proacl) order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in ('assert_operation_mutation_actor_v1','create_operation_plan_atomic_v1','create_operation_plan_atomic_v12','operation_mutation_receipt_begin_v1','operation_mutation_receipt_finish_v1')"),defsBefore);
    assert.equal(await scalar("select to_regclass('pg_temp.mtm_other_constraint_probe')"),null);
    assert.equal(await scalar('show lock_timeout'),'0');
  });
  let created:any;
  await check('actual v12/v1 creates one linked request with other pcs and fertilizer kg',async()=>{
    created=await create([material(),material(fertilizer,'fertilizer','kg',1.25)]);
    assert.equal(created.material_request.created,true);assert.equal(created.material_logistics.warehouse_request_rows,2);
    const rows=await scalar<any[]>("select jsonb_agg(jsonb_build_object('product_id',i.product_id,'category',i.product_category,'kind',i.material_kind,'unit',i.unit,'qty',i.required_quantity,'product_type',p.type,'operation_id',r.operation_id,'request_id',r.id) order by i.product_id) from warehouse_issue_request_items i join warehouse_issue_requests r on r.id=i.request_id join products p on p.id=i.product_id");
    assert.equal(rows.length,2);assert.ok(rows.every(x=>x.operation_id===created.operation.id&&x.request_id===created.material_request.request_id));
    assert.deepEqual(rows.map(({category,kind,unit,qty,product_type})=>({category,kind,unit,qty,product_type})),[
      {category:'other',kind:'other',unit:'pcs',qty:6,product_type:'material'},
      {category:'fertilizer',kind:'fertilizer',unit:'kg',qty:1.25,product_type:'fertilizer'}]);
    const after=await snapshots();for(const key of ['products','ledger','inventory','warehouses']) assert.deepEqual(after[key],before[key]);
  });
  await check('replay creates no duplicate; same key with changed fingerprint is rejected',async()=>{
    const snapshot=await snapshots();const replay=await create([material(),material(fertilizer,'fertilizer','kg',1.25)]);
    assert.equal(replay.operation.id,created.operation.id);assert.equal(replay.idempotent_replay,true);assert.deepEqual(await snapshots(),snapshot);
    await reject(()=>create([material()],undefined,'changed'),/different payload/);assert.deepEqual(await snapshots(),snapshot);
  });
  await check('zero quantity and foreign/warehouse actors retain atomic rejection',async()=>{
    const snapshot=await snapshots();await reject(()=>create([material(part,'other','pcs',0)],'zero','zero'),/positive planned quantity/);
    await reject(()=>create([material()],'foreign','foreign',outsider),/target company/);
    await reject(()=>create([material()],'keeper','keeper',keeper),/Actor role/);assert.deepEqual(await snapshots(),snapshot);
  });
  await check('all nine prior kinds remain accepted; material and unsupported kinds remain rejected',async()=>{
    for(const kind of ['seed','fertilizer','pesticide','adjuvant','ph_corrector','defoamer','biological','fuel','organic']) {
      await db.query('insert into operation_materials(material_type) values($1)',[kind]);
    }
    for(const kind of ['material','water','invalid','', 'OTHER']) await reject(()=>db.query('insert into operation_materials(material_type) values($1)',[kind]),/material_type_check/);
    await reject(()=>db.query('insert into operation_materials(material_type) values(null)'),/not-null/);
  });
  await check('reapplying draft keeps populated rows and constraint identity',async()=>{
    const snapshot=await snapshots(), oid=await scalar("select oid from pg_constraint where conrelid='operation_materials'::regclass and conname='operation_materials_material_type_check'");
    await db.exec(draft);assert.deepEqual(await snapshots(),snapshot);
    assert.equal(await scalar("select oid from pg_constraint where conrelid='operation_materials'::regclass and conname='operation_materials_material_type_check'"),oid);
  });
  await check('unexpected constraint is refused and preserved, with no data change',async()=>{
    await db.exec("alter table operation_materials drop constraint operation_materials_material_type_check, add constraint operation_materials_material_type_check check(material_type <> 'forbidden')");
    const snapshot=await snapshots(),def=await scalar("select pg_get_constraintdef(oid) from pg_constraint where conrelid='operation_materials'::regclass and conname='operation_materials_material_type_check'");
    try{await reject(()=>db.exec(draft),/MTM_OTHER_PRECONDITION/);}finally{await db.exec('rollback');}
    assert.deepEqual(await snapshots(),snapshot);assert.equal(await scalar("select pg_get_constraintdef(oid) from pg_constraint where conrelid='operation_materials'::regclass and conname='operation_materials_material_type_check'"),def);
  });
  await check('missing CHECK is not silently invented',async()=>{
    await db.exec('alter table operation_materials drop constraint operation_materials_material_type_check');
    try{await reject(()=>db.exec(draft),/MTM_OTHER_PRECONDITION/);}finally{await db.exec('rollback');}
    assert.equal(await scalar("select count(*)::int from pg_constraint where conrelid='operation_materials'::regclass and conname='operation_materials_material_type_check'"),0);
  });
  assert.ok(oldDefinition.includes("'organic'"));
  console.log(`MTM operation material: ${checks}/${checks} PASS. Synthetic PGlite + actual shared creators. NOT full E1/browser/remote proof.`);
}
main().finally(()=>db.close()).catch(error=>{console.error(error);process.exitCode=1;});
