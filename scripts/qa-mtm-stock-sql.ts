import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Real SQL functions from this checkout on synthetic in-memory tables. No .env,
// remote database, server, migration history or business data. PGlite uses one
// connection: queued contenders prove contracts, not PostgreSQL lock scheduling.
const db = new PGlite();
const uuid=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const company=uuid(1),otherCompany=uuid(2),admin=uuid(10),keeper=uuid(11),inactive=uuid(12),globalAdmin=uuid(13),mechanic=uuid(14),otherKeeper=uuid(15);
const warehouse=uuid(20),foreignWarehouse=uuid(21),fuelWarehouse=uuid(22),grainWarehouse=uuid(23),archivedWarehouse=uuid(24);
const part=uuid(30),oil=uuid(31),mass=uuid(32),unregistered=uuid(33),foreignPart=uuid(34),employee=uuid(40),foreignEmployee=uuid(41),machine=uuid(50),equipment=uuid(51),vehicle=uuid(52),task=uuid(60);
let checks=0,request=100;
async function check(name:string,run:()=>Promise<void>){await run();checks++;console.log(`PASS ${name}`);}
async function scalar<T=any>(sql:string,params:unknown[]=[]):Promise<T>{const result=await db.query(sql,params);return Object.values(result.rows[0] as object)[0] as T;}
async function fail(run:()=>Promise<unknown>,pattern:RegExp){await assert.rejects(run,(error:any)=>{assert.match(String(error.message),pattern);return true;});}
async function asActor<T>(actor:string|null,run:()=>Promise<T>,role="authenticated"){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||""]);await db.exec(`set role ${role}`);try{return await run();}finally{await db.exec("reset role");}}
function extract(source:string,signature:string,delimiter="$$"){const start=source.indexOf(`create or replace function ${signature}`);assert.ok(start>=0,signature);const body=source.indexOf(`as ${delimiter}`,start);assert.ok(body>=0);const end=source.indexOf(`${delimiter};`,body+delimiter.length+3);assert.ok(end>=0);return source.slice(start,end+delimiter.length+1);}
const payload=(kind="receipt",quantity="10",extra:Record<string,unknown>={})=>({kind,warehouse_id:warehouse,product_id:part,quantity,uom:"pcs",purpose:"Документ МТМ №1",recipient_id:null,asset_kind:null,asset_id:null,task_id:null,original_issue_id:null,...extra});
const post=(data=payload(),id=uuid(++request),c=company)=>scalar("select public.mtm_post_operation_v1($1,$2,$3::jsonb)",[c,id,JSON.stringify(data)]);
const list=(c=company,w:string|null=warehouse,below=false,offset=0,limit=25)=>scalar("select public.mtm_stock_list_v1($1,$2,'',$3,$4,$5)",[c,w,below,offset,limit]);
const history=(p:string|null=part,c=company)=>scalar("select public.mtm_operations_list_v1($1,$2,$3,0,25)",[c,warehouse,p]);
const minimum=(qty="3",revision=0,p=part,w=warehouse,c=company)=>scalar("select public.mtm_set_minimum_v1($1,$2,$3,$4,$5)",[c,w,p,qty,revision]);
async function physical(p=part,w=warehouse){return scalar("select coalesce(sum(delta_qty_signed),0)::text from stock_ledger_entries where company_id=$1 and warehouse_id=$2 and product_id=$3 and uom=(select base_uom from products where id=$3) and batch_class='material' and unit_contract_version=2",[company,w,p]);}
async function legacyWrite(quantity:string,direction="out",p=part,batch:string|null=null){return scalar("insert into stock_ledger_entries(company_id,warehouse_id,product_id,direction,quantity,uom,delta_qty_signed,reason_type,batch_class,unit_contract_version,mass_kg,batch_id_text) values($1,$2,$3,$4::ledger_direction,$5::numeric,(select base_uom from products where id=$3),case when $4='out' then -$5::numeric else $5::numeric end,'legacy_test_writer','material',2,case when (select base_uom from products where id=$3)='kg' then $5::numeric end,$6) returning id",[company,warehouse,p,direction,quantity,batch]);}

async function main(){
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create schema private;
    revoke all on schema private from public, anon, authenticated;
    create function private.unrelated_guard_probe() returns boolean language sql security definer as $$ select true $$;
    grant execute on function private.unrelated_guard_probe() to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create table companies(id uuid primary key);
    create table profiles(id uuid primary key,company_id uuid,role text,status text,full_name text);
    create table global_admin_company_contexts(user_id uuid primary key,company_id uuid);
    create table global_admin_impersonation_contexts(admin_user_id uuid primary key,impersonated_profile_id uuid,impersonated_company_id uuid);
    create table products(id uuid primary key,company_id uuid,name text,type text not null,product_type text,unit text,base_uom text,pack_uom text,units_per_pack numeric,archived boolean,is_active boolean,is_seed_material boolean default false,master_product_id uuid,created_at timestamptz default now(),
      constraint products_type_check check(type in ('produce','seed','fertilizer','pesticide')),
      constraint products_product_type_check check(product_type is null or product_type in ('pesticide','fertilizer','additive','growth_regulator','adjuvant')));
    create table agricultural_machine_models(id uuid primary key,full_name text,is_active boolean,archived boolean);
    create table equipment_models(id uuid primary key,full_name text,name text,is_active boolean,archived boolean);
    create table transport_models(id uuid primary key,full_name text,is_active boolean,archived boolean);
    create table warehouses(id uuid primary key,company_id uuid,name text,warehouse_type text,place_type text,archived boolean,is_archived boolean);
    create table company_people(id uuid primary key,company_id uuid,full_name text,user_id uuid,status text,deleted_at timestamptz);
    create table reference_machines(id uuid primary key,company_id uuid,name text,archived boolean,is_active boolean);
    create table reference_equipment(id uuid primary key,company_id uuid,name text,archived boolean);
    create table reference_vehicles(id uuid primary key,company_id uuid,name text,archived boolean,is_active boolean);
    create table operations(id uuid primary key,company_id uuid,operation_type text,status text,archived boolean);
    create table warehouse_inventory_documents(id uuid primary key,company_id uuid,warehouse_id uuid,status text);
    create table warehouse_issue_requests(id uuid primary key,company_id uuid,source_warehouse_id uuid,status text,warehouse_request_status text);
    create table warehouse_issue_request_items(id uuid primary key,company_id uuid,request_id uuid,product_id uuid,actual_product_id uuid,prepared_quantity numeric,issued_quantity numeric,prepared_unit text,issued_unit text,unit text);
    create table warehouse_issue_request_item_allocations(id uuid primary key,company_id uuid,request_id uuid,request_item_id uuid,warehouse_id uuid,prepared_quantity numeric,issued_quantity numeric,batch_class text,batch_id uuid,batch_id_text text);
    create type ledger_direction as enum('in','out');
    create table inventory_transactions(id uuid primary key,company_id uuid,warehouse_id uuid,product_id uuid,quantity numeric not null check(quantity>0),transaction_type text,date date,notes text,user_id uuid,
      movement_type text,status text,source_warehouse_id uuid,destination_warehouse_id uuid,operation_datetime timestamptz,responsible_user_id uuid,confirmed_at timestamptz,created_at timestamptz default now(),
      quantity_input numeric(14,3),input_uom text,base_quantity_kg numeric(14,3),base_quantity numeric(18,6),base_uom text,mass_kg numeric(18,6),batch_class text,unit_source text,unit_contract_version smallint,
      density_kg_per_l numeric,density_unit text,density_source text,density_verification_status text,density_verified_at timestamptz,inventory_batch_id uuid,warehouse_issue_allocation_id uuid);
    create table stock_ledger_entries(id uuid primary key default gen_random_uuid(),company_id uuid,product_id uuid,warehouse_id uuid,direction ledger_direction,quantity numeric(14,3) not null check(quantity>0),uom text,delta_qty_signed numeric(14,3),reason_type text,reason_ref_id uuid,occurred_at timestamptz default now(),created_at timestamptz default now(),created_by uuid,notes text,batch_class text,mass_kg numeric,
      density_kg_per_l numeric,density_unit text,density_source text,density_verification_status text,density_verified_at timestamptz,unit_source text,unit_contract_version smallint,inventory_batch_id uuid,warehouse_issue_allocation_id uuid,ticket_id uuid,processing_id uuid,storno_of_entry_id uuid,batch_id text,batch_id_text text);
    create table ticket_lines(id uuid primary key,ticket_id uuid,product_id uuid,unit_contract_version smallint,uom text,batch_class text,created_at timestamptz,mass_kg numeric,density_kg_per_l numeric,density_unit text,density_source text,density_verification_status text,density_verified_at timestamptz);
    -- Synthetic session projection only. Real downstream gate, posting, unit,
    -- balance and reservation functions are extracted unchanged below.
    create function public.resolve_actor_context_from_session_v1() returns table(profile_id uuid,company_id uuid,context_company_id uuid,role text,status text,impersonated_profile_id uuid,impersonated_company_id uuid,impersonated_role text,impersonated_status text) language sql stable as $$
      select p.id,p.company_id,c.company_id,p.role,p.status,i.impersonated_profile_id,i.impersonated_company_id,null::text,null::text from public.profiles p left join public.global_admin_company_contexts c on c.user_id=p.id left join public.global_admin_impersonation_contexts i on i.admin_user_id=p.id where p.id=auth.uid()
    $$;
  `);
  await db.exec(await readFile('docs/project-live/schema-drafts/mtm-product-types-v1.sql','utf8'));
  await db.query("insert into companies values($1),($2)",[company,otherCompany]);
  for(const [id,role,status,c] of [[admin,"company_admin","active",company],[keeper,"warehouse_operator","active",company],[inactive,"warehouse","inactive",company],[globalAdmin,"global_admin","active",company],[mechanic,"mechanic_operator","active",company],[otherKeeper,"warehouse","active",otherCompany]]) await db.query("insert into profiles values($1,$2,$3,$4,'Test actor')",[id,c,role,status]);
  for(const [id,c,name,type,uom] of [[part,company,"Перчатки L","material","pcs"],[oil,company,"Масло","fuel","l"],[mass,company,"Смазка","material","kg"],[unregistered,company,"Не МТМ","material","pcs"],[foreignPart,otherCompany,"Чужая деталь","material","pcs"]]) await db.query("insert into products(id,company_id,name,type,product_type,unit,base_uom,archived,is_active) values($1,$2,$3,$4,null,$5,$5,false,true)",[id,c,name,type,uom]);
  for(const [id,c,name,type,archived] of [[warehouse,company,"МТМ","universal",false],[foreignWarehouse,otherCompany,"Чужой","universal",false],[fuelWarehouse,company,"ГСМ","fuel",false],[grainWarehouse,company,"Зерно","grain",false],[archivedWarehouse,company,"Старый","universal",true]]) await db.query("insert into warehouses values($1,$2,$3,$4,'WAREHOUSE',$5,$5)",[id,c,name,type,archived]);
  await db.query("insert into company_people values($1,$2,'Сотрудник без аккаунта',null,'active',null),($3,$4,'Чужой сотрудник',null,'active',null)",[employee,company,foreignEmployee,otherCompany]);
  await db.query("insert into reference_machines values($1,$2,'Трактор',false,true)",[machine,company]);
  await db.query("insert into reference_equipment values($1,$2,'Агрегат',false)",[equipment,company]);
  await db.query("insert into reference_vehicles values($1,$2,'Машина',false,true)",[vehicle,company]);
  await db.query("insert into operations values($1,$2,'Обслуживание','planned',false)",[task,company]);
  const unitSql=(await readFile('supabase/migrations/20260713183038_warehouse_canonical_units_v2.sql','utf8')).replace(/\r\n/g,'\n');
  for(const name of ['public.canonical_stock_uom(','public.validate_stock_quantity_contract(','public.enforce_stock_ledger_contract_v2()']) await db.exec(extract(unitSql,name));
  await db.exec('create trigger trg_enforce_stock_ledger_contract_v2 before insert on stock_ledger_entries for each row execute function public.enforce_stock_ledger_contract_v2()');
  const viewsStart=unitSql.indexOf('create or replace view public.v_stock_movements_canonical as');
  const viewsEnd=unitSql.indexOf('drop view if exists public.v_stock_balance_identity',viewsStart);
  await db.exec(unitSql.slice(viewsStart,viewsEnd));
  const transferSql=(await readFile('supabase/migrations/20260721151313_warehouse_v11_inventory_transfers.sql','utf8')).replace(/\r\n/g,'\n');
  for(const name of ['public.warehouse_canonical_product_id_v1(','public.warehouse_reserved_quantity_v1(']) await db.exec(extract(transferSql,name));
  const father=(await readFile('supabase/migrations/20260802020130_father_pilot_schema_v1.sql','utf8')).replace(/\r\n/g,'\n');
  await db.exec(extract(father.slice(father.lastIndexOf('create or replace function public.prevent_warehouse_movement_during_inventory_v1()')),'public.prevent_warehouse_movement_during_inventory_v1()'));
  await db.exec('create trigger trg_prevent_warehouse_movement_during_inventory_v1 before insert on stock_ledger_entries for each row execute function public.prevent_warehouse_movement_during_inventory_v1()');
  const gates=(await readFile('supabase/migrations/20260831102443_tz315_universal_processing_concurrency_gate_v1.sql','utf8')).replace(/\r\n/g,'\n');
  for(const name of ['private.tz315_lock_company_season_write_gate_v1(','private.resolve_processing_gate_session_actor_v1()','private.assert_processing_gate_actor_v1(','private.acquire_nonprocessing_company_gate_v1(']) await db.exec(extract(gates,name,'$function$'));
  const seed=(await readFile('supabase/migrations/20260803125025_seed_planting_material_lifecycle_v1.sql','utf8')).replace(/\r\n/g,'\n');
  await db.exec(extract(seed,'public.post_inventory_transaction_to_ledger('));
  await db.exec(await readFile('docs/project-live/schema-drafts/mtm-catalog-v1.sql','utf8'));
  await db.exec(await readFile('docs/project-live/schema-drafts/mtm-stock-v1.sql','utf8'));
  for(const p of [part,oil,mass]) await asActor(admin,()=>scalar('select public.mtm_catalog_save_v1($1,$2,0,$3::jsonb)',[company,p,JSON.stringify({category:p===part?'ppe':'lubricant',part_number:null,barcode:null,internal_code:null,specifications:'Размер и свойства заданы',accounting_unit_note:p===part?'Одна пара':'Основная единица',applicability:[]})]));

  let issued:any,received:any;
  await check('MTM public RPC works without reopening shared private schema',async()=>{
    assert.equal(await scalar("select has_schema_privilege('authenticated','private','USAGE')"),false);
    assert.equal(await scalar("select has_schema_privilege('authenticated','mtm_private','USAGE')"),true);
    assert.equal(await scalar("select has_schema_privilege('anon','mtm_private','USAGE')"),false);
    await asActor(keeper,async()=>{
      await fail(()=>scalar('select private.unrelated_guard_probe()'),/permission denied for schema private/);
      assert.equal((await history()).total,0);
      assert.ok((await list()).items.length>0);
    });
  });
  await check('receipt → issue → linked return uses actual existing posting function and canonical ledger',async()=>{
    received=await asActor(keeper,()=>post());
    assert.equal(received.quantity,'10.000');assert.ok(received.ledger_entry_id);assert.ok(received.inventory_transaction_id);
    issued=await asActor(keeper,()=>post(payload('issue','4',{recipient_id:employee,asset_kind:'machine',asset_id:machine,task_id:task})));
    const returned=await asActor(keeper,()=>post(payload('return','1',{original_issue_id:issued.id})));
    assert.equal(returned.original_issue_id,issued.id);assert.equal(returned.recipient_id,employee);assert.equal(returned.asset_id,machine);assert.equal(returned.task_id,task);
    assert.equal(returned.recipient_name,'Сотрудник без аккаунта');assert.equal(returned.asset_name,'Трактор');assert.equal(returned.task_name,'Обслуживание');assert.equal(returned.created_by_name,'Test actor');
    assert.equal(await physical(),'7.000');assert.equal(await scalar('select count(*)::int from inventory_transactions'),3);assert.equal(await scalar('select count(*)::int from stock_ledger_entries'),3);
    assert.equal((await asActor(keeper,()=>history())).items.find((x:any)=>x.id===issued.id).remaining_returnable,'3.000');
  });
  await check('idempotent replay does not create another movement; payload and actor conflicts rejected',async()=>{
    const id=uuid(++request),body=payload('receipt','2');const first=await asActor(keeper,()=>post(body,id));const before=await scalar('select count(*)::int from stock_ledger_entries');
    const second=await asActor(keeper,()=>post(body,id));assert.equal(second.id,first.id);assert.equal(second.ledger_entry_id,first.ledger_entry_id);assert.equal(await scalar('select count(*)::int from stock_ledger_entries'),before);
    await asActor(keeper,()=>fail(()=>post(payload('receipt','3'),id),/IDEMPOTENCY_CONFLICT/));
    await db.query('insert into global_admin_company_contexts values($1,$2)',[globalAdmin,company]);
    await asActor(globalAdmin,()=>fail(()=>post(body,id),/IDEMPOTENCY_CONFLICT/));
  });
  await check('insufficient stock and excess return roll back inventory, ledger and operation together',async()=>{
    const before=await scalar('select count(*)::int from inventory_transactions');
    await asActor(keeper,()=>fail(()=>post(payload('issue','100')),/INSUFFICIENT_STOCK/));
    await asActor(keeper,()=>fail(()=>post(payload('return','4',{original_issue_id:issued.id})),/RETURN_EXCEEDED/));
    await asActor(keeper,()=>fail(()=>post(payload('return','1',{original_issue_id:received.id})),/RETURN_SOURCE_INVALID/));
    assert.equal(await scalar('select count(*)::int from inventory_transactions'),before);assert.equal(await physical(),'9.000');
  });
  await check('general needs and employee without login do not require a machine',async()=>{
    const op=await asActor(keeper,()=>post(payload('issue','1',{recipient_id:employee,purpose:'Перчатки сотруднику'})));assert.equal(op.asset_id,null);assert.equal(op.recipient_id,employee);
    const general=await asActor(keeper,()=>post(payload('issue','1',{purpose:'Общие нужды мастерской'})));assert.equal(general.asset_id,null);assert.equal(general.recipient_id,null);
  });
  await check('catalog readers and company admin cannot post or manage minimums',async()=>{
    for(const actor of [admin,mechanic,inactive,otherKeeper]) await asActor(actor,async()=>{await fail(()=>post(),/FORBIDDEN/);await fail(()=>minimum(),/FORBIDDEN/);});
    await asActor(null,()=>fail(()=>post(),/permission denied/),'anon');
    assert.equal((await asActor(mechanic,()=>list())).can_write,false);
  });
  await check('tenant isolation, foreign references, incompatible and archived warehouses',async()=>{
    await asActor(keeper,async()=>{
      await fail(()=>list(otherCompany),/FORBIDDEN/);
      await fail(()=>post(payload('receipt','1',{warehouse_id:foreignWarehouse})),/WAREHOUSE_UNAVAILABLE/);
      await fail(()=>post(payload('receipt','1',{product_id:foreignPart})),/PRODUCT_UNAVAILABLE/);
      for(const w of [grainWarehouse,archivedWarehouse,fuelWarehouse]) await fail(()=>post(payload('receipt','1',{warehouse_id:w})),/WAREHOUSE_UNAVAILABLE/);
      await fail(()=>post(payload('issue','1',{recipient_id:foreignEmployee})),/RECIPIENT_UNAVAILABLE/);
      await fail(()=>post(payload('issue','1',{asset_kind:'machine',asset_id:uuid(999)})),/ASSET_UNAVAILABLE/);
      await fail(()=>post(payload('issue','1',{task_id:uuid(999)})),/TASK_UNAVAILABLE/);
    });
    await asActor(otherKeeper,async()=>{assert.equal(await scalar('select count(*)::int from mtm_stock_operations'),0);assert.equal(await scalar('select count(*)::int from mtm_stock_minimums'),0);});
  });
  await check('quantity precision, units, positive values and unregistered products fail closed',async()=>{
    await asActor(keeper,async()=>{
      for(const quantity of ['0','-1','1.0001','1000000000','NaN','1e3',1,'01','0.5']) await fail(()=>post(payload('receipt',quantity as string)),/INVALID/);
      await fail(()=>post(payload('receipt','1',{uom:'kg'})),/UNIT_MISMATCH/);
      await fail(()=>post(payload('receipt','1',{product_id:unregistered})),/PRODUCT_UNAVAILABLE/);
      await fail(()=>post(payload('receipt','1',{purpose:''})),/INVALID/);
      await fail(()=>post(payload('issue','1',{asset_kind:'machine',asset_id:null})),/INVALID/);
    });
    await asActor(keeper,()=>post(payload('receipt','1.125',{product_id:oil,uom:'l',warehouse_id:fuelWarehouse})));
    await asActor(keeper,()=>post(payload('receipt','2.005',{product_id:mass,uom:'kg'})));
    assert.equal(await physical(mass),'2.005');assert.equal(await scalar('select mass_kg::text from inventory_transactions where product_id=$1',[mass]),'2.005000');
    assert.equal(await scalar('select mass_kg from inventory_transactions where product_id=$1',[oil]),null);
  });
  await check('minimums are optimistic, audited, and below-minimum uses available stock',async()=>{
    const first=await asActor(keeper,()=>minimum('8'));assert.equal(first.minimum_revision,1);
    assert.equal((await asActor(keeper,()=>list(company,warehouse,true))).items[0].product_id,part);
    await asActor(keeper,()=>fail(()=>minimum('9',0),/REVISION_CONFLICT/));
    const next=await asActor(keeper,()=>minimum('0',1));assert.equal(next.minimum_quantity,'0');assert.equal(next.minimum_revision,2);
    assert.equal(await scalar('select count(*)::int from mtm_stock_minimum_history'),2);
    await asActor(keeper,()=>fail(()=>minimum('1.5',2),/INVALID_QUANTITY/));
  });
  await check('existing reservations are excluded and own reserved issue remains possible through legacy writer',async()=>{
    const r=uuid(700),i=uuid(701);
    await db.query("insert into warehouse_issue_requests values($1,$2,$3,'ready','ready')",[r,company,warehouse]);
    await db.query("insert into warehouse_issue_request_items values($1,$2,$3,$4,null,6,0,'pcs',null,'pcs')",[i,company,r,part]);
    const row=(await asActor(keeper,()=>list())).items.find((x:any)=>x.product_id===part);assert.equal(row.balance,'7.000');assert.equal(row.reserved,'6');assert.equal(row.available,'1.000');
    await asActor(keeper,()=>fail(()=>post(payload('issue','2')),/INSUFFICIENT_STOCK/));
    // Consuming two units exceeds unreserved=1 but is a legal own-reserve
    // writer operation; generic physical guard must not subtract that reserve.
    await legacyWrite('2');assert.equal(await physical(),'5.000');
    await db.query('update warehouse_issue_request_items set issued_quantity=2 where id=$1',[i]);
    await db.query('delete from warehouse_issue_request_items where id=$1',[i]);await db.query('delete from warehouse_issue_requests where id=$1',[r]);
    await legacyWrite('1','in');
  });
  await check('all three active inventory states block new MTM receipts and issues',async()=>{
    for(const status of ['in_progress','awaiting_approval','rejected']){
      await db.query('insert into warehouse_inventory_documents values($1,$2,$3,$4)',[uuid(800),company,warehouse,status]);
      await asActor(keeper,()=>fail(()=>post(),/INVENTORY_BLOCKED/));await asActor(keeper,()=>fail(()=>post(payload('issue','1')),/INVENTORY_BLOCKED/));
      await fail(()=>legacyWrite('1'),/инвентаризация/);await db.exec('delete from warehouse_inventory_documents');
    }
  });
  await check('ledger guard applies to non-MTM writer for registered products; other goods untouched',async()=>{
    await fail(()=>legacyWrite('99'),/INSUFFICIENT_STOCK/);await legacyWrite('2');assert.equal(await physical(),'4.000');
    await legacyWrite('1','out',unregistered);assert.equal(await physical(unregistered),'-1.000');
  });
  await check('queued competing requests cannot overspend or over-return (not multi-connection E2E)',async()=>{
    const results=await asActor(keeper,()=>Promise.allSettled([post(payload('issue','3')),post(payload('issue','3'))]));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(await physical(),'1.000');
    const returns=await asActor(keeper,()=>Promise.allSettled([post(payload('return','2',{original_issue_id:issued.id})),post(payload('return','2',{original_issue_id:issued.id}))]));assert.equal(returns.filter(x=>x.status==='fulfilled').length,1);
  });
  await check('inactive recipient/asset/task fail; archived product linked return preserves issue context',async()=>{
    await db.query("update company_people set status='inactive' where id=$1",[employee]);await asActor(keeper,()=>fail(()=>post(payload('issue','1',{recipient_id:employee})),/RECIPIENT_UNAVAILABLE/));
    await db.query('update reference_machines set archived=true where id=$1',[machine]);await asActor(keeper,()=>fail(()=>post(payload('issue','1',{asset_kind:'machine',asset_id:machine})),/ASSET_UNAVAILABLE/));
    await db.query('update operations set archived=true where id=$1',[task]);await asActor(keeper,()=>fail(()=>post(payload('issue','1',{task_id:task})),/TASK_UNAVAILABLE/));
    await db.query('update products set archived=true where id=$1',[part]);await asActor(keeper,()=>fail(()=>post(payload('receipt','1')),/PRODUCT_UNAVAILABLE/));await asActor(keeper,()=>fail(()=>post(payload('issue','1')),/PRODUCT_UNAVAILABLE/));
    const returned=await asActor(keeper,()=>post(payload('return','1',{original_issue_id:issued.id})));assert.equal(returned.asset_id,machine);assert.equal(returned.recipient_id,employee);
    assert.equal((await asActor(keeper,()=>list())).items.find((x:any)=>x.product_id===part).product_archived,true);
    await db.query('update products set archived=false where id=$1',[part]);
  });
  await check('legacy or mixed identity is visible and blocks new issue, never added to canonical stock',async()=>{
    await db.exec('alter table stock_ledger_entries disable trigger all');
    await db.query("insert into stock_ledger_entries(company_id,warehouse_id,product_id,direction,quantity,uom,delta_qty_signed,reason_type,batch_class,unit_contract_version) values($1,$2,$3,'in',100,'pcs',100,'historical','material',null)",[company,warehouse,part]);
    await db.exec('alter table stock_ledger_entries enable trigger all');
    const row=(await asActor(keeper,()=>list())).items.find((x:any)=>x.product_id===part);assert.equal(row.stock_blocked,true);assert.equal(row.balance,'4.000');
    await asActor(keeper,()=>fail(()=>post(payload('issue','1')),/STOCK_IDENTITY_CONFLICT/));
    await db.exec("delete from stock_ledger_entries where reason_type='historical'");
  });
  await check('direct new table mutations denied to all users, immutable operation/audit retained',async()=>{
    for(const actor of [keeper,admin,globalAdmin]) await asActor(actor,async()=>{
      for(const table of ['mtm_stock_operations','mtm_stock_minimums','mtm_stock_minimum_history']) for(const sql of [`delete from ${table}`,`truncate ${table}`]) await fail(()=>db.exec(sql),/permission denied/);
      await fail(()=>db.exec("update mtm_stock_operations set purpose='tamper'"),/permission denied/);
    });
  });
  await check('global admin company context and impersonation cannot bypass MTM SQL rights',async()=>{
    await db.query('update global_admin_company_contexts set company_id=$1 where user_id=$2',[otherCompany,globalAdmin]);await asActor(globalAdmin,()=>fail(()=>post(),/FORBIDDEN/));
    await db.query('update global_admin_company_contexts set company_id=$1 where user_id=$2',[company,globalAdmin]);
    await db.query('insert into global_admin_impersonation_contexts values($1,$2,$3)',[globalAdmin,keeper,company]);await asActor(globalAdmin,()=>fail(()=>post(),/FORBIDDEN/));
    await db.exec('delete from global_admin_impersonation_contexts');
  });
  await check('options are tenant scoped, employee directory independent of accounts, pagination truthful',async()=>{
    await db.query("update company_people set status='active' where id=$1",[employee]);
    await asActor(keeper,async()=>{
      const people=await scalar('select public.mtm_stock_options_v1($1,\'employee\',\'\',0,25)',[company]);assert.equal(people.total,1);assert.equal(people.items[0].id,employee);assert.ok(people.items[0].name);
      const first=await list(company,warehouse,false,0,1),second=await list(company,warehouse,false,1,1);assert.equal(first.total,3);assert.equal(first.items.length,1);assert.equal(second.items.length,1);assert.notEqual(first.items[0].product_id,second.items[0].product_id);
      await fail(()=>list(company,warehouse,false,0,101),/INVALID_PAGE/);
    });
  });
  await check('missing real posting function gives SQL failure and no false successful document',async()=>{
    const before=await scalar('select count(*)::int from inventory_transactions');await db.exec('alter function public.post_inventory_transaction_to_ledger(uuid) rename to test_unavailable_posting');
    await asActor(keeper,()=>fail(()=>post(),/does not exist/));assert.equal(await scalar('select count(*)::int from inventory_transactions'),before);
    await db.exec('alter function public.test_unavailable_posting(uuid) rename to post_inventory_transaction_to_ledger');
  });
  await check('unsupported transaction isolation fails closed in both RPC and shared ledger guard',async()=>{
    await asActor(keeper,async()=>{await db.exec('begin isolation level repeatable read');await fail(()=>post(),/UNSUPPORTED_ISOLATION/);await db.exec('rollback');});
    await db.exec('begin isolation level repeatable read');await fail(()=>legacyWrite('1'),/UNSUPPORTED_ISOLATION/);await db.exec('rollback');
  });
  await check('non-finite quantities cannot contaminate ledger through legacy writers',async()=>{
    const before=await physical();await fail(()=>legacyWrite('NaN','in'),/INVALID_LEDGER_QUANTITY/);
    await fail(()=>legacyWrite('Infinity','in'),/numeric field overflow|INVALID_LEDGER_QUANTITY/);assert.equal(await physical(),before);
  });
  await check('canonical product aliases are explicit blocked state instead of independent stock',async()=>{
    const alias=uuid(900);
    await db.query("insert into products(id,company_id,name,type,product_type,unit,base_uom,archived,is_active,master_product_id) values($1,$2,'Связанный товар','material',null,'pcs','pcs',false,true,$3)",[alias,company,part]);
    assert.equal((await asActor(keeper,()=>list())).items.find((x:any)=>x.product_id===part).stock_blocked,true);
    await asActor(keeper,()=>fail(()=>post(),/STOCK_IDENTITY_CONFLICT/));await db.query('delete from products where id=$1',[alias]);
  });
  await check('partial issues preserve item/allocation reserve without double counting and release on close',async()=>{
    const r=uuid(910),i=uuid(911),a=uuid(912);
    await db.query("insert into warehouse_issue_requests values($1,$2,$3,'partially_issued','issued')",[r,company,warehouse]);
    await db.query("insert into warehouse_issue_request_items values($1,$2,$3,$4,null,4,2,'pcs',null,'pcs')",[i,company,r,part]);
    await db.query("insert into warehouse_issue_request_item_allocations values($1,$2,$3,$4,$5,5,1,'material',null,null)",[a,company,r,i,warehouse]);
    assert.equal(await scalar('select public.warehouse_reserved_quantity_v1($1,$2,$3,\'pcs\')::text',[company,warehouse,part]),'0');
    const row=(await asActor(keeper,()=>list())).items.find((x:any)=>x.product_id===part);assert.equal(row.reserved,'4');assert.equal(row.available,'0.000');
    await asActor(keeper,()=>fail(()=>post(payload('issue','1')),/INSUFFICIENT_STOCK/));
    await db.query("update warehouse_issue_requests set status='closed',warehouse_request_status='closed' where id=$1",[r]);assert.equal((await asActor(keeper,()=>list())).items.find((x:any)=>x.product_id===part).reserved,'0');
    await db.query('delete from warehouse_issue_request_item_allocations where id=$1',[a]);await db.query('delete from warehouse_issue_request_items where id=$1',[i]);await db.query('delete from warehouse_issue_requests where id=$1',[r]);
  });
  await check('named batch stock blocks unassigned MTM issue; legacy guard cannot borrow from another batch',async()=>{
    await legacyWrite('2','in',oil,'lot-A');await legacyWrite('5','in',oil);
    const row=(await asActor(keeper,()=>list())).items.find((x:any)=>x.product_id===oil);assert.equal(row.balance,'7.000');assert.equal(row.stock_blocked,true);
    await asActor(keeper,()=>fail(()=>post(payload('issue','1',{product_id:oil,uom:'l'})),/STOCK_IDENTITY_CONFLICT/));
    await fail(()=>legacyWrite('3','out',oil,'lot-A'),/INSUFFICIENT_STOCK/);await fail(()=>legacyWrite('6','out',oil),/INSUFFICIENT_STOCK/);
    await legacyWrite('1','out',oil,'lot-A');assert.equal(await physical(oil),'6.000');
  });
  await check('new writer locks current unassigned allocation identity before inventory lock',async()=>{
    const draft=await readFile('docs/project-live/schema-drafts/mtm-stock-v1.sql','utf8');
    const writer=draft.slice(draft.indexOf('create function mtm_private.mtm_post_operation_v1'));
    const six=writer.indexOf("concat_ws(':',p_company_id::text,warehouse_id::text,product_id::text,uom,'material','__unassigned__')");
    const inventory=writer.indexOf("warehouse_id::text||':inventory'");assert.ok(six>=0&&six<inventory);
    assert.match(father,/v_stock\.uom,\s*v_stock\.batch_class,\s*coalesce\(v_stock\.batch_id_text, '__unassigned__'\)/);
  });
  await check('batch identity does not guess UUID fallback or let empty text shadow a named lot',async()=>{
    for(const [text,old,inventory] of [[null,null,uuid(950)],['','lot-A',null],['lot-A','lot-B',null]]){
      await fail(()=>scalar("insert into stock_ledger_entries(company_id,warehouse_id,product_id,direction,quantity,uom,delta_qty_signed,reason_type,batch_class,unit_contract_version,batch_id_text,batch_id,inventory_batch_id) values($1,$2,$3,'in',1,'pcs',1,'identity_test','material',2,$4,$5,$6) returning id",[company,warehouse,part,text,old,inventory]),/STOCK_IDENTITY_CONFLICT/);
    }
    await db.exec('alter table stock_ledger_entries disable trigger all');
    await db.query("insert into stock_ledger_entries(company_id,warehouse_id,product_id,direction,quantity,uom,delta_qty_signed,reason_type,batch_class,unit_contract_version,batch_id_text,batch_id) values($1,$2,$3,'in',1,'pcs',1,'shadowed_fixture','material',2,'','old-lot')",[company,warehouse,part]);
    await db.exec('alter table stock_ledger_entries enable trigger all');
    assert.equal((await asActor(keeper,()=>list())).items.find((x:any)=>x.product_id===part).stock_blocked,true);
    await asActor(keeper,()=>fail(()=>post(payload('issue','1')),/STOCK_IDENTITY_CONFLICT/));
    await db.exec("delete from stock_ledger_entries where reason_type='shadowed_fixture'");
  });
  await check('per-item reservation maximum handles repeated products with opposite representation gaps',async()=>{
    const r=uuid(960),i1=uuid(961),i2=uuid(962),a=uuid(963);
    await db.query("insert into warehouse_issue_requests values($1,$2,$3,'partially_issued','issued')",[r,company,warehouse]);
    await db.query("insert into warehouse_issue_request_items values($1,$3,$4,$5,null,2,0,'pcs',null,'pcs'),($2,$3,$4,$5,null,4,4,'pcs',null,'pcs')",[i1,i2,company,r,part]);
    await db.query("insert into warehouse_issue_request_item_allocations values($1,$2,$3,$4,$5,4,0,'material',null,null)",[a,company,r,i2,warehouse]);
    const row=(await asActor(keeper,()=>list())).items.find((x:any)=>x.product_id===part);assert.equal(row.reserved,'6');assert.equal(row.available,'-2.000');
    await asActor(keeper,()=>fail(()=>post(payload('issue','1')),/INSUFFICIENT_STOCK/));
    await db.query('delete from warehouse_issue_request_item_allocations where id=$1',[a]);await db.query('delete from warehouse_issue_request_items where request_id=$1',[r]);await db.query('delete from warehouse_issue_requests where id=$1',[r]);
  });
  console.log(`MTM stock SQL: ${checks}/${checks} PASS. Real existing posting/unit/balance/reservation SQL; synthetic fixtures; PGlite single connection only.`);
}
main().finally(()=>db.close()).catch(error=>{console.error(error.message, error.where || '',error.internalQuery || '');process.exitCode=1;});
