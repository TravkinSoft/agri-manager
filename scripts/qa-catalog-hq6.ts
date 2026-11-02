import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { isWeighedSupplierProduct } from '../lib/weighbridge/product-rules';

// In-memory synthetic fixture only. Never reads .env, production rows or the accepted package.
const db = new PGlite();
const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1), member=id(2), inactive=id(3), deleted=id(4), other=id(5), company=id(6), old=id(7);
const checks: string[]=[];
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const val=async(sql:string,args:unknown[]=[])=>Object.values((await db.query(sql,args)).rows[0] as object)[0] as any;
async function test(name:string, fn:()=>Promise<void>){await fn();checks.push(name);console.log('PASS',name);}
async function actor(who:string|null,fn:()=>Promise<void>,role='authenticated'){
 await db.query("select set_config('test.actor',$1,false)",[who??'']);await db.exec(`set role ${role}`);
 try{await fn();}finally{await db.exec('reset role');}
}
const fail=async(fn:()=>Promise<unknown>,pattern:RegExp)=>assert.rejects(fn,(e:any)=>{assert.match(e.message,pattern);return true;});
function record(n:number,category='Фильтры',alias=['фильтр','фильтры','filter','filters']){
 const pid=id(1000+n),sid=id(2000+n);
 return {id:pid,research_id:`SYNTHETIC-${n}`,type:'spare_part',name:category,
 category:{id:id(100),code:'TF-PC-08',name_ru:category,aliases:alias,revision:'ru-1'},manufacturer:{id:id(101),key:'Synthetic Maker',name:'Synthetic Maker'},
 identity:{kind:'mpn',mpn:`000${n}-A/7`,designation:null,grade:null,variant:null},gaps:{status:'synthetic',gaps:['not real product']},provenance:{synthetic:true},
 sources:[{id:sid,url:'https://example.com/synthetic-test',title:'Synthetic source',checked_at:'2026-11-02T00:00:00Z',fingerprint:'a'.repeat(64),metadata:{synthetic:true}}],
 claims:[{id:id(3000+n),field_path:'diameter',value:30,unit:'mm',conditions:{temperature:20},source_id:sid,locator:'synthetic row',fingerprint:'b'.repeat(64),checked_at:'2026-11-02T00:00:00Z'}]};
}
const payload=(rs:any[])=>JSON.stringify({records:rs});
const run=(part:number,text:string,hash=digest(text))=>val('select public.catalog_hq6_import_part($1,$2,$3,$4)',[`TF_PARTS_HQ6_4437/part-${String(part).padStart(3,'0')}`,'2',hash,text]);
async function main(){
 await db.exec(await readFile('scripts/fixtures/catalog-hq6-existing-schema.sql','utf8'));
 for(const who of [admin,member,inactive,deleted,other])await db.query('insert into auth.users(id) values($1)',[who]);
 await db.query('insert into companies(id) values($1)',[company]);
 for(const [who,role,status] of [[admin,'global_admin','active'],[member,'company_admin','active'],[inactive,'global_admin','inactive'],[deleted,'global_admin','active'],[other,'specialist','active']])await db.query('insert into profiles values($1,$2,$3,$4)',[who,role,status,company]);
 await db.query('insert into products(id,name,type,user_id,company_id) values($1,$2,$3,$4,$5)',[old,'Synthetic legacy crop','produce',member,company]);
 const before=await val('select md5(to_jsonb(p)::text) from products p where id=$1',[old]);
 await test('enum and schema apply in separate committed transactions',async()=>{
  await db.exec(await readFile('supabase/migrations/20261102010135_catalog_hq6_accounting_mode.sql','utf8'));
  await db.exec('begin;'+await readFile('supabase/migrations/20261102010136_catalog_hq6_schema.sql','utf8')+'commit;');
  await db.exec(await readFile('supabase/migrations/20261102011920_catalog_hq6_search.sql','utf8'));
 });
 // The only old-row change is the new nullable column; fingerprint excludes this column.
 await test('legacy row unchanged by schema extension',async()=>assert.equal(await val("select md5((to_jsonb(p)-'catalog_publication_status')::text) from products p where id=$1",[old]),before));
 await test('schema private usage was not widened',async()=>assert.equal(await val("select has_schema_privilege('authenticated','private','usage')"),false));
 const p1=payload([record(1),record(2)]);let b1='';
 await test('authenticated active admin imports atomically',()=>actor(admin,async()=>{const x=await run(1,p1);b1=x.batch_id;assert.equal(x.inserted,2);}));
 await test('source and claim preserve units and conditions',()=>actor(admin,async()=>{assert.deepEqual(await val('select conditions_jsonb from product_evidence_claims where id=$1',[id(3001)]),{temperature:20});assert.equal(await val('select unit from product_evidence_claims where id=$1',[id(3001)]),'mm');}));
 await test('same package returns unchanged and zero growth',()=>actor(admin,async()=>{const x=await run(1,p1);assert.equal(x.inserted,0);assert.equal(x.status,'unchanged');assert.equal(await val("select count(*) from products where type='spare_part'"),2);}));
 await test('same logical version different digest fails',()=>actor(admin,async()=>{await fail(()=>run(1,payload([record(3)])),/logical_version_digest_conflict/);}));
 await test('tampered bytes fail digest',()=>actor(admin,async()=>{await fail(()=>run(2,payload([record(3)]),'0'.repeat(64)),/payload_digest_mismatch/);}));
 for(const [label,who] of [['other tenant/member',member],['inactive admin',inactive],['missing actor',null],['other specialist',other]] as const){
  await test(label+' cannot read drafts, sources, claims or journal',()=>actor(who,async()=>{
   for(const t of ['product_catalog_details','product_evidence_claims','glbd_import_batches','glbd_import_batch_rows'])assert.equal(await val(`select count(*) from ${t}`),0);
   assert.equal(await val("select count(*) from products where type='spare_part'"),0);assert.equal(await val('select count(*) from glbd_product_sources'),0);
   await fail(()=>run(2,payload([record(3)])),/active_global_admin_required/);
  }));
 }
 await test('anonymous has no catalogue RPC or detail access',()=>actor(null,async()=>{await fail(()=>run(2,payload([record(3)])),/permission denied/);await fail(()=>val('select count(*) from product_catalog_details'),/permission denied/);},'anon'));
 await test('old tenant read and normal write still work',()=>actor(member,async()=>{assert.equal(await val('select name from products where id=$1',[old]),'Synthetic legacy crop');await db.query('update products set name=name where id=$1',[old]);}));
 await test('old types retain old mandatory values and accounting modes',async()=>{
  await fail(()=>db.query('update products set unit=null where id=$1',[old]),/catalog_hq6_shape/);
  await fail(()=>db.query("update products set accounting_mode='catalog_only' where id=$1",[old]),/catalog_hq6_shape/);
 });
 await test('old seed pesticide fertilizer inserts and updates remain valid',async()=>{
  for(const [n,type] of [[80,'seed'],[81,'pesticide'],[82,'fertilizer']] as const){
   await db.query('insert into products(id,name,type,user_id) values($1,$2,$3,$4)',[id(n),`Synthetic old ${type}`,type,member]);
   await db.query('update products set description=$1 where id=$2',['legacy update',id(n)]);
   assert.equal(await val('select unit from products where id=$1',[id(n)]),'kg');
   assert.equal(await val('select catalog_publication_status from products where id=$1',[id(n)]),null);
  }
 });
 await test('direct catalog insert missing details rolls back at commit',()=>actor(admin,async()=>{
  await fail(()=>db.query("insert into products(id,name,type,user_id,unit,base_uom,stock_unit,accounting_mode,is_active,requires_review,metadata_review_required,catalog_publication_status) values($1,'Broken','spare_part',null,null,null,null,'catalog_only',false,true,true,'draft')",[id(9000)]),/catalog_details_integrity/);
 }));
 await test('tenant reassignment and publication forbidden',()=>actor(admin,async()=>{
  await fail(()=>db.query('update products set company_id=$1 where id=$2',[company,id(1001)]),/row-level security|catalog_hq6_shape/);
  await fail(()=>db.query("update products set catalog_publication_status='published',is_active=true,requires_review=false,metadata_review_required=false where id=$1",[id(1001)]),/row-level security/);
 }));
 await test('identity uniqueness rejects new id for existing exact tuple',()=>actor(admin,async()=>{const x=record(3);x.identity.mpn=record(1).identity.mpn;(x.identity as any).grade='metadata not a new identity';await fail(()=>run(3,payload([x])),/catalog_hq6_mpn_identity/);assert.equal(await val("select count(*) from glbd_import_batches where source_package like '%003'"),0);}));
 await test('cross-product source claim FK rejects mismatched evidence',()=>actor(admin,async()=>{await fail(()=>db.query('update product_evidence_claims set source_id=$1 where id=$2',[id(2002),id(3001)]),/foreign key/);}));
 await test('all existing business FK paths reject catalog references even hidden by RLS',()=>actor(member,async()=>{
  const tables:any[]=(await db.query("select event_object_table as t,action_statement as s from information_schema.triggers where trigger_name like 'catalog_hq6_guard_%' and event_manipulation='INSERT' order by event_object_table")).rows;
  // information_schema deliberately filters triggers by privilege; use metadata fixture expected list below.
  const guards=JSON.parse(await readFile('scripts/fixtures/catalog-hq6-business-guards.json','utf8')) as string[][];
  assert.equal(guards.length,22);
  for(const [t,c] of guards){
   if(t==='products'){await fail(()=>db.query('update products set master_product_id=$1 where id=$2',[id(1001),old]),/catalog_only_not_business_product/);continue;}
   await fail(()=>db.query(`insert into ${t}(id,${c}) values($1,$2)`,[id(8000),id(1001)]),/catalog_only_not_business_product/);
  }
 }));
 await test('pre-commit interruption rolls back every row',()=>actor(admin,async()=>{
  await db.exec('begin');await run(4,payload([record(4)]));await db.exec('rollback');
  assert.equal(await val('select count(*) from products where id=$1',[id(1004)]),0);assert.equal(await val("select count(*) from glbd_import_batches where source_package like '%004'"),0);
 }));
 await test('lost post-commit response is recovered by repeat',()=>actor(admin,async()=>{const p=payload([record(4)]);await run(4,p);const x=await run(4,p);assert.equal(x.status,'unchanged');assert.equal(x.inserted,0);}));
 await test('exact MPN and Russian/English synonyms find the same rows',()=>actor(admin,async()=>{
  assert.equal(await val('select count(*) from product_catalog_details where mpn_key=$1',[record(1).identity.mpn]),1);
  for(const q of ['фильтр','фильтры','filter'])assert.equal(await val("select count(*) from product_catalog_details where search_ru @@ plainto_tsquery('russian',$1) or search_simple @@ plainto_tsquery('simple',$1)",[q]),3);
 }));
 await test('later edit blocks repeat and conditional rollback',()=>actor(admin,async()=>{
  await db.query("update products set description='later edit' where id=$1",[id(1001)]);
  await fail(()=>run(1,p1),/post_import_edit_conflict/);
  await fail(()=>val('select catalog_hq6_retire_batch($1)',[b1]),/rollback_edit_conflict/);
 }));
 await test('conditional rollback retires only its batch without deletion',()=>actor(admin,async()=>{
  const b=await val("select id from glbd_import_batches where source_package like '%004'");const x=await val('select catalog_hq6_retire_batch($1)',[b]);assert.equal(x.retired,1);
  assert.equal(await val('select catalog_publication_status from products where id=$1',[id(1004)]),'retired');assert.equal((await val('select catalog_hq6_retire_batch($1)',[b])).retired,0);
 }));
 await test('actor deletion preserves products and provenance',async()=>{
  let b='';await actor(deleted,async()=>{b=(await run(5,payload([record(5)]))).batch_id;});await db.query('delete from auth.users where id=$1',[deleted]);
  assert.equal(await val('select count(*) from products where id=$1',[id(1005)]),1);assert.equal(await val('select actor_user_id from glbd_import_batches where id=$1',[b]),null);
  await actor(deleted,async()=>{await fail(()=>run(6,payload([record(6)])),/active_global_admin_required/);});
 });
 await test('weighbridge rejects all new types even with forged kg descriptor',async()=>{for(const t of ['spare_part','technical_fluid','maintenance_material']){assert.equal(isWeighedSupplierProduct({productType:t,stockUnit:null}),false);assert.equal(isWeighedSupplierProduct({productType:t,stockUnit:'kg'}),false);}assert.equal(isWeighedSupplierProduct({productType:'produce',stockUnit:'kg'}),true);});
 await test('synthetic bounded batch 200 records and repeat',()=>actor(admin,async()=>{
  const p=payload(Array.from({length:200},(_,i)=>record(100+i)));assert.equal((await run(100,p)).inserted,200);assert.equal((await run(100,p)).inserted,0);
 }));
 await test('no orphan claims or missing details',async()=>{assert.equal(await val('select count(*) from product_evidence_claims c left join glbd_product_sources s on s.id=c.source_id and s.product_id=c.product_id where s.id is null'),0);assert.equal(await val("select count(*) from products p left join product_catalog_details d on d.product_id=p.id where p.type='spare_part' and d.product_id is null"),0);});
 await test('search RPC uses exact MPN and stable cursor without duplicates',()=>actor(admin,async()=>{
  const exact:any=(await db.query('select * from catalog_hq6_search($1)',[record(1).identity.mpn])).rows[0];assert.equal(exact.product_id,id(1001));assert.equal(exact.is_exact,true);
  const first:any[]=(await db.query("select * from catalog_hq6_search('',2)")).rows;const last=first.at(-1)!;
  const second:any[]=(await db.query("select * from catalog_hq6_search('',2,$1,$2)",[last.is_exact,last.product_id])).rows;
  assert.equal(new Set([...first,...second].map(x=>x.product_id)).size,4);
 }));
 await test('search RPC discloses no draft counts or snippets to ordinary actor',()=>actor(member,async()=>{assert.equal(await val("select count(*) from catalog_hq6_search('фильтр')"),0);}));
 await writeFile('scripts/output/catalog-hq6-runtime.json',JSON.stringify({checked_at:new Date().toISOString(),engine:await val('select version()'),synthetic_only:true,checks,passed:checks.length,not_run:['independent PostgreSQL connections concurrency','Product authenticated UI E2E','Product import/postflight']},null,2));
 console.log(`RESULT ${checks.length} passed`);await db.close();
}
main().catch(async e=>{console.error(e.message,e.detail??'');await db.close();process.exitCode=1;});
