import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Entirely in-memory. Does not load .env, contact Supabase or apply shared migrations.
const db = new PGlite();
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const company = uuid(1), otherCompany = uuid(2), admin = uuid(10), warehouse = uuid(11), inactive = uuid(12), globalAdmin = uuid(13), outsider = uuid(14), nullRole = uuid(15);
const product = uuid(20), otherProduct = uuid(21), second = uuid(22), third = uuid(23), machine = uuid(30), equipment = uuid(31), transport = uuid(32);
let checks = 0;
async function check(name: string, run: () => Promise<void>) { await run(); checks++; console.log(`PASS ${name}`); }
async function scalar<T = any>(sql: string, params: unknown[] = []): Promise<T> { const r = await db.query(sql, params); return Object.values(r.rows[0] as object)[0] as T; }
async function fail(run: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(run, (error: any) => { assert.match(String(error.message),pattern); return true; });
}
async function asActor<T>(actor: string | null, run: () => Promise<T>, role = "authenticated") {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor || ""]);
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec("reset role"); }
}
const metadata = (extra: Record<string,unknown> = {}) => ({ category: "part", part_number: "00012-A/7", barcode: "000009876543", internal_code: null,
  specifications: "Размер: 30 × 62 × 16 мм", accounting_unit_note: "Одна штука",
  applicability: [{ model_kind: "machine", model_id: machine, node: "Ступица", status: "confirmed", source: "Каталог производителя, страница 4", restrictions: "Серия A" }], ...extra });
const save = (p = product, revision = 0, data = metadata(), c = company) => scalar("select public.mtm_catalog_save_v1($1,$2,$3,$4::jsonb)",[c,p,revision,JSON.stringify(data)]);
const list = (c = company, barcode = "", search = "", offset = 0, limit = 25) => scalar("select public.mtm_catalog_list_v1($1,$2,$3,$4,$5)",[c,offset,limit,search,barcode]);
const options = (kind = "products", c = company, search = "", offset = 0, limit = 25) => scalar("select public.mtm_catalog_options_v1($1,$2,$3,$4,$5)",[c,kind,offset,limit,search]);

async function main() {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create schema private;
    revoke all on schema private from public, anon, authenticated;
    create function private.unrelated_guard_probe() returns boolean language sql security definer as $$ select true $$;
    grant execute on function private.unrelated_guard_probe() to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create table public.companies(id uuid primary key);
    create table public.profiles(id uuid primary key,company_id uuid,role text,status text);
    create table public.global_admin_company_contexts(user_id uuid primary key,company_id uuid);
    create table public.global_admin_impersonation_contexts(admin_user_id uuid primary key,impersonated_profile_id uuid,impersonated_company_id uuid);
    create table public.products(id uuid primary key,company_id uuid,name text,type text,base_uom text,pack_uom text,units_per_pack numeric,archived boolean,is_active boolean);
    create table public.agricultural_machine_models(id uuid primary key,full_name text,is_active boolean,archived boolean);
    create table public.equipment_models(id uuid primary key,full_name text,name text,is_active boolean,archived boolean);
    create table public.transport_models(id uuid primary key,full_name text,is_active boolean,archived boolean);
  `);
  await db.query("insert into companies values($1),($2)",[company,otherCompany]);
  for (const [id,role,status,c] of [[admin,"company_admin","active",company],[warehouse,"warehouse_operator","active",company],[inactive,"company_admin","inactive",company],[globalAdmin,"global_admin","active",company],[outsider,"specialist","active",company],[nullRole,null,"active",company]]) {
    await db.query("insert into profiles values($1,$2,$3,$4)",[id,c,role,status]);
  }
  for (const [id,c,name] of [[product,company,"Подшипник"],[otherProduct,otherCompany,"Чужая деталь"],[second,company,"Перчатки размер L"],[third,null,"Масло 10W40"]]) {
    await db.query("insert into products values($1,$2,$3,'material','pcs',null,null,false,true)",[id,c,name]);
  }
  await db.query("insert into agricultural_machine_models values($1,'Трактор проверенный',true,false)",[machine]);
  await db.query("insert into equipment_models values($1,'Культиватор проверенный','Культиватор',true,false)",[equipment]);
  await db.query("insert into transport_models values($1,'Грузовик проверенный',true,false)",[transport]);
  await db.exec(await readFile("docs/project-live/schema-drafts/mtm-catalog-v1.sql","utf8"));

  await check("dedicated MTM schema keeps shared private ACL closed while public RPC works", async () => {
    assert.equal(await scalar("select has_schema_privilege('authenticated','private','USAGE')"),false);
    assert.equal(await scalar("select has_schema_privilege('authenticated','mtm_private','USAGE')"),true);
    assert.equal(await scalar("select has_schema_privilege('anon','mtm_private','USAGE')"),false);
    await asActor(admin,async()=>{
      await fail(()=>scalar("select private.unrelated_guard_probe()"),/permission denied for schema private/);
      assert.equal((await list()).total,0);
    });
  });
  await check("anonymous RPC and direct private save denied", async () => {
    await asActor(null,()=>fail(()=>save(),/permission denied/),"anon");
    await asActor(null,()=>fail(()=>scalar("select mtm_private.mtm_catalog_save_v1($1,$2,0,$3)",[company,product,JSON.stringify(metadata())]),/permission denied/),"anon");
  });
  await check("create metadata over existing product, preserve identifiers and model name", async () => {
    const saved = await asActor(admin,()=>save());
    assert.equal(saved.revision,1); assert.equal(saved.part_number,"00012-A/7"); assert.equal(saved.barcode,"000009876543");
    assert.equal(saved.product.id,product); assert.equal(saved.applicability[0].model_name,"Трактор проверенный");
    assert.equal(saved.updated_by,admin);
  });
  await check("exact scan found and unknown honest, no writes on read", async () => {
    const before = await scalar("select count(*)::int from mtm_catalog_history");
    await asActor(warehouse, async () => { assert.equal((await list(company,"000009876543")).total,1); assert.equal((await list(company,"9876543")).total,0); assert.equal((await list(company,"unknown")).total,0); await list(company,"000009876543"); });
    assert.equal(await scalar("select count(*)::int from mtm_catalog_history"),before);
  });
  await check("warehouse reads but cannot save, direct table DML impossible", async () => {
    await asActor(warehouse, async () => {
      assert.equal((await list()).total,1);
      await fail(()=>save(product,1),/MTM_FORBIDDEN/);
      for (const sql of ["update mtm_catalog set revision=99", "delete from mtm_catalog", "insert into mtm_catalog_history select * from mtm_catalog_history", "delete from mtm_catalog_history", "truncate mtm_catalog_history"]) await fail(()=>db.exec(sql),/permission denied/);
    });
    assert.equal(await scalar("select revision from mtm_catalog"),1);
  });
  await check("even company admin cannot bypass RPC via table writes", async () => {
    await asActor(admin,()=>fail(()=>db.exec("update mtm_catalog set barcode='injected'"),/permission denied/));
  });
  await check("inactive, null-role and unrelated role rejected", async () => {
    for (const actor of [inactive,outsider,nullRole]) await asActor(actor, async () => { await fail(()=>list(),/MTM_FORBIDDEN/); await fail(()=>save(product,1),/MTM_FORBIDDEN/); });
  });
  await check("every operational read role can read but cannot edit", async () => {
    for (const [index,role] of Array.from(["warehouse","mechanic_operator","fleet_manager","agronomist","director","accountant"].entries())) {
      const actor=uuid(100+index);
      await db.query("insert into profiles values($1,$2,$3,'active')",[actor,company,role]);
      await asActor(actor,async()=>{assert.equal((await list()).total,1);await fail(()=>save(product,1),/MTM_FORBIDDEN/);});
    }
  });
  await check("cross-company RPC denied, RLS hides rows", async () => {
    await asActor(admin, async () => { await fail(()=>list(otherCompany),/MTM_FORBIDDEN/); await fail(()=>save(otherProduct,0,metadata(),otherCompany),/MTM_FORBIDDEN/); });
    await db.query("update profiles set company_id=$1 where id=$2",[otherCompany,warehouse]);
    await asActor(warehouse, async () => assert.equal(await scalar("select count(*)::int from mtm_catalog"),0));
    await db.query("update profiles set company_id=$1 where id=$2",[company,warehouse]);
  });
  await check("foreign product cannot attach to current company", async () => { await asActor(admin,()=>fail(()=>save(otherProduct),/MTM_PRODUCT_UNAVAILABLE/)); });
  await check("direct RPC validates JSON, nulls and numeric identifiers", async () => {
    for (const value of [metadata({part_number:123}),metadata({barcode:123}),metadata({category:null}),metadata({specifications:""}),metadata({accounting_unit_note:""}),metadata({applicability:null}),metadata({extra:"spoof"}),metadata({barcode:"a\nb"})]) {
      await asActor(admin,()=>fail(()=>save(product,1,value),/MTM_INVALID/));
    }
  });
  await check("missing manufacturer number allowed, distinct specifications retained", async () => {
    const saved = await asActor(admin,()=>save(second,0,metadata({ category:"ppe",part_number:null,barcode:null,internal_code:"GLOVE-L",specifications:"Размер L; материал нитрил",accounting_unit_note:"1 шт в карточке означает одну пару",applicability:[] })));
    assert.equal(saved.part_number,null); assert.equal(saved.specifications,"Размер L; материал нитрил"); assert.equal(saved.applicability.length,0);
  });
  await check("duplicate barcode rejects whole save and audit", async () => {
    const before = await scalar("select count(*)::int from mtm_catalog_history");
    await asActor(admin,()=>fail(()=>save(second,1),/MTM_BARCODE_CONFLICT/));
    assert.equal(await scalar("select count(*)::int from mtm_catalog_history"),before);
    assert.equal(await scalar("select revision from mtm_catalog where product_id=$1",[second]),1);
  });
  await check("unknown/wrong catalog/archived model and missing source rejected", async () => {
    const original = metadata().applicability[0];
    for (const entry of [{...original,source:null},{...original,model_id:uuid(999)},{...original,model_kind:"equipment"},{...original,model_id:"bad-id"},{...original,model_name:"invented"}]) {
      await asActor(admin,()=>fail(()=>save(product,1,metadata({applicability:[entry]})),/MTM_(INVALID|MODEL_UNAVAILABLE)/));
    }
    await db.query("update agricultural_machine_models set archived=true where id=$1",[machine]);
    await asActor(admin,()=>fail(()=>save(product,1),/MTM_MODEL_UNAVAILABLE/));
    await db.query("update agricultural_machine_models set archived=false where id=$1",[machine]);
  });
  await check("pending status remains pending; three existing model catalogs", async () => {
    const value = metadata({applicability:[{...metadata().applicability[0],status:"pending",source:null},
      {model_kind:"equipment",model_id:equipment,node:"Рама",status:"confirmed",source:"Инструкция",restrictions:null},
      {model_kind:"transport",model_id:transport,node:"Колесо",status:"rejected",source:"Проверка несовпадения",restrictions:null}]});
    const saved = await asActor(admin,()=>save(product,1,value));
    assert.equal(saved.revision,2); assert.equal(saved.applicability[0].status,"pending"); assert.equal(saved.applicability[2].model_name,"Грузовик проверенный");
  });
  await check("stale revision cannot overwrite or create audit row", async () => {
    const before = await scalar("select count(*)::int from mtm_catalog_history");
    await asActor(admin,()=>fail(()=>save(product,1),/MTM_REVISION_CONFLICT/));
    assert.equal(await scalar("select count(*)::int from mtm_catalog_history"),before);
    assert.equal(await scalar("select revision from mtm_catalog where product_id=$1",[product]),2);
  });
  await check("competing same-revision requests: one succeeds, one conflicts", async () => {
    // PGlite queues statements on one connection; this proves the revision contract,
    // not simultaneous multi-connection PostgreSQL lock scheduling.
    const result = await asActor(admin,()=>Promise.allSettled([save(product,2),save(product,2)]));
    assert.equal(result.filter(r=>r.status==="fulfilled").length,1); assert.equal(result.filter(r=>r.status==="rejected").length,1);
    assert.equal(await scalar("select revision from mtm_catalog where product_id=$1",[product]),3);
  });
  await check("history is complete and immutable to callers", async () => {
    const history = await db.query("select revision,actor_id,previous_value,new_value,changed_at from mtm_catalog_history where product_id=$1 order by revision",[product]);
    assert.equal(history.rows.length,3); assert.equal((history.rows[0] as any).previous_value,null);
    assert.equal((history.rows[1] as any).previous_value.revision,1); assert.equal((history.rows[1] as any).new_value.revision,2);
    assert.ok((history.rows[1] as any).changed_at); assert.equal((history.rows[1] as any).actor_id,admin);
  });
  await check("pagination total truthful and product options tenant-scoped", async () => {
    await asActor(admin,async()=>{ const page=await list(company,"","",0,1); assert.equal(page.items.length,1);assert.equal(page.total,2); assert.equal((await list(company,"","",1,1)).items.length,1);
      const opts=await options(); assert.equal(opts.total,1); assert.ok(!opts.items.some((i:any)=>[otherProduct,product,second].includes(i.id))); assert.equal(opts.items[0].id,third);
      for (const kind of ["machine","equipment","transport"]) assert.equal((await options(kind)).total,1);
      await fail(()=>list(company,"","",0,101),/MTM_INVALID_PAGE/);
    });
  });
  await check("archived product disappears after registration; save denied", async () => {
    await db.query("update products set archived=true where id=$1",[product]);
    await asActor(admin,async()=>{assert.equal((await list(company,"000009876543")).total,0);await fail(()=>save(product,3),/MTM_PRODUCT_UNAVAILABLE/);});
    await db.query("update products set archived=false where id=$1",[product]);
  });
  await check("global admin requires context, direct RPC cannot bypass selected company", async () => {
    await asActor(globalAdmin,async()=>{ await fail(()=>list(),/MTM_FORBIDDEN/); await fail(()=>save(otherProduct,0,metadata(),otherCompany),/MTM_FORBIDDEN/); });
    await db.query("insert into global_admin_company_contexts values($1,$2)",[globalAdmin,company]);
    await asActor(globalAdmin,async()=>{ assert.equal((await list()).total,2); await fail(()=>list(otherCompany),/MTM_FORBIDDEN/); await fail(()=>save(otherProduct,0,metadata(),otherCompany),/MTM_FORBIDDEN/); });
    await db.query("update global_admin_company_contexts set company_id=$1 where user_id=$2",[otherCompany,globalAdmin]);
    const saved=await asActor(globalAdmin,()=>save(otherProduct,0,metadata(),otherCompany));assert.equal(saved.company_id,otherCompany);
    await asActor(globalAdmin,async()=>assert.equal((await list(otherCompany)).total,1));
  });
  await check("impersonation cannot fall back to global admin rights via direct RPC", async () => {
    await db.query("insert into global_admin_impersonation_contexts values($1,$2,$3)",[globalAdmin,warehouse,otherCompany]);
    await asActor(globalAdmin,async()=>{await fail(()=>list(otherCompany),/MTM_FORBIDDEN/);await fail(()=>save(otherProduct,1,metadata(),otherCompany),/MTM_FORBIDDEN/);assert.equal(await scalar("select count(*)::int from mtm_catalog"),0);});
    await db.query("delete from global_admin_impersonation_contexts where admin_user_id=$1",[globalAdmin]);
  });
  await check("barcode matching is exact and case-sensitive", async () => {
    await asActor(admin,()=>save(third,0,metadata({category:"lubricant",barcode:"AbC001",applicability:[]})));
    await asActor(admin,async()=>{assert.equal((await list(company,"AbC001")).total,1);assert.equal((await list(company,"abc001")).total,0);});
  });
  await check("catalog creation does not change products or create inventory", async()=>{
    assert.equal(await scalar("select count(*)::int from products"),4);
    assert.equal(await scalar("select base_uom from products where id=$1",[product]),"pcs");
    assert.equal(await scalar("select count(*)::int from pg_tables where schemaname='public' and tablename like '%stock%'"),0);
  });
  console.log(`MTM SQL: ${checks}/${checks} PASS (isolated PGlite fixtures only)`);
}
main().finally(()=>db.close()).catch(error=>{ console.error(error);process.exitCode=1; });
