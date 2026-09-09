import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

type Row = Record<string, any>;
type Role = "service_role" | "authenticated" | "anon";
const migrations = [
  "supabase/migrations/20260908232606_field_boundary_revision_v1.sql",
  "supabase/migrations/20260909073000_fields_map_atomic_import_v2.sql",
  "supabase/migrations/20260909211431_field_map_independent_contours_v3.sql",
] as const;
const id = (family: number, sequence: number) => `${family}0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
const ids = {
  company: id(1, 1), foreignCompany: id(1, 2), admin: id(2, 1), inactive: id(2, 2), agronomist: id(2, 3),
  legacy: id(4, 1), imported: id(4, 2), foreignImport: id(4, 3), allUnlinked: id(4, 4),
};
const polygon = (index: number) => ({ type: "Polygon", coordinates: [[
  [69 + index / 1000, 54], [69 + index / 1000 + 0.0005, 54],
  [69 + index / 1000 + 0.0005, 54.0005], [69 + index / 1000, 54.0005], [69 + index / 1000, 54],
]] });
const complexGeometry = {
  type: "MultiPolygon", coordinates: [
    [
      [[69, 54], [69.01, 54], [69.01, 54.01], [69, 54.01], [69, 54]],
      [[69.002, 54.002], [69.002, 54.003], [69.003, 54.003], [69.003, 54.002], [69.002, 54.002]],
    ],
    [[[69.02, 54.02], [69.021, 54.02], [69.021, 54.021], [69.02, 54.02]]],
  ],
};
const sources = Array.from({ length: 130 }, (_, index) => ({
  polygon_id: `source-${index + 1}`, polygon_name: index === 0 ? `Контур ${"Я".repeat(220)}` : `Исходный контур ${index + 1}`,
  field_id: index < 18 ? id(3, index + 1) : null,
  final_field_id: index < 18 ? id(3, index + 1) : null,
  geometry: index === 18 ? complexGeometry : polygon(index),
  area_ha: index + 1,
}));
const resolved = sources.map((source) => ({
  polygon_id: source.polygon_id, field_id: source.field_id,
  geometry_geojson: source.geometry, area_from_kml_ha: source.area_ha,
}));

let passed = 0;
const check = async (name: string, run: () => void | Promise<void>) => {
  await run(); passed += 1; console.log(`PASS ${name}`);
};
const query = async (db: PGlite, sql: string, args: unknown[] = []): Promise<Row[]> => (await db.query(sql, args)).rows as Row[];
const value = async <T = any>(db: PGlite, sql: string, args: unknown[] = []): Promise<T> => Object.values((await query(db, sql, args))[0] ?? {})[0] as T;
const asRole = async <T>(db: PGlite, role: Role, run: () => Promise<T>): Promise<T> => {
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec("reset role"); }
};
const expectError = async (run: () => Promise<unknown>, pattern: RegExp) => {
  let failure: unknown;
  try { await run(); } catch (error) { failure = error; }
  assert.ok(failure, `Expected ${pattern} but SQL succeeded`);
  assert.match(failure instanceof Error ? failure.message : String(failure), pattern);
};
const snapshot = (db: PGlite, company = ids.company) => asRole(db, "service_role", () => value<Row>(db, "select public.get_field_map_snapshot_v1($1::uuid)", [company]));
const fingerprint = (db: PGlite, company = ids.company) => value<string>(db, `select md5(jsonb_build_object(
  'fields',(select coalesce(jsonb_agg(to_jsonb(f) order by id),'[]') from public.fields f where company_id=$1::uuid),
  'geometries',(select coalesce(jsonb_agg(to_jsonb(g) order by id),'[]') from public.field_geometries g where company_id=$1::uuid),
  'imports',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from public.field_map_imports i where company_id=$1::uuid),
  'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.audit_log a where company_id=$1::uuid)
)::text)`, [company]);
const activeCount = (db: PGlite) => value<number>(db, "select count(*)::int from public.field_geometries where company_id=$1::uuid and is_active", [ids.company]);
const geometry = async (db: PGlite, geometryId: string) => (await query(db, "select * from public.field_geometries where id=$1::uuid", [geometryId]))[0];

async function bootstrap(db: PGlite) {
  // Minimal legacy schema fixture copied from qa-fields-map-migrations-pglite.ts.
  // Only the preexisting schema is simulated; the three migrations run verbatim.
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.companies(id uuid primary key,name text not null);
    create table public.profiles(id uuid primary key,company_id uuid references public.companies(id),role text not null,status text not null);
    create table public.fields(id uuid primary key,company_id uuid not null references public.companies(id) on delete cascade,
      name text not null,area numeric(10,2) not null check(area>0),notes text,archived boolean not null default false);
    create table public.field_map_imports(id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete cascade,source_file_name text not null,source_kml_text text,
      status text not null default 'draft' check(status in('draft','imported','archived','failed')),
      total_polygons integer not null default 0,matched_polygons integer not null default 0,unmatched_polygons integer not null default 0,
      error_count integer not null default 0,preview_payload jsonb not null default '{}',imported_at timestamptz,
      imported_by uuid references public.profiles(id) on delete set null,is_active boolean not null default false,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table public.field_geometries(id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete cascade,
      field_id uuid not null references public.fields(id) on delete cascade,import_id uuid references public.field_map_imports(id) on delete set null,
      source_file_name text,geometry_geojson jsonb not null,area_from_kml_ha numeric(14,4),imported_at timestamptz not null default now(),
      imported_by uuid references public.profiles(id) on delete set null,is_active boolean not null default true,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create unique index idx_field_geometries_active_per_field on public.field_geometries(company_id,field_id) where is_active=true;
    create table public.audit_log(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
      who uuid references public.profiles(id),when_at timestamptz not null default now(),entity_type text not null,entity_id text not null,
      action text not null,old_values jsonb,new_values jsonb,reason text);
    alter table public.field_map_imports enable row level security;
    alter table public.field_geometries enable row level security;
    create policy "Users can view company field map imports" on public.field_map_imports for select to authenticated using(true);
    create policy "Users can insert company field map imports" on public.field_map_imports for insert to authenticated with check(true);
    create policy "Users can update company field map imports" on public.field_map_imports for update to authenticated using(true) with check(true);
    create policy "Users can delete company field map imports" on public.field_map_imports for delete to authenticated using(true);
    create policy "Users can view company field geometries" on public.field_geometries for select to authenticated using(true);
    create policy "Users can insert company field geometries" on public.field_geometries for insert to authenticated with check(true);
    create policy "Users can update company field geometries" on public.field_geometries for update to authenticated using(true) with check(true);
    create policy "Users can delete company field geometries" on public.field_geometries for delete to authenticated using(true);
    grant usage on schema public to anon,authenticated,service_role;
    grant select,insert,update,delete on public.field_map_imports,public.field_geometries to public,anon,authenticated;
  `);
  await db.query("insert into public.companies values($1::uuid,'Local A'),($2::uuid,'Local B')", [ids.company, ids.foreignCompany]);
  await db.query(`insert into public.profiles values($1::uuid,$4::uuid,'global_admin','active'),
    ($2::uuid,$4::uuid,'global_admin','inactive'),($3::uuid,$4::uuid,'agronomist','active')`, [ids.admin, ids.inactive, ids.agronomist, ids.company]);
  for (let index = 1; index <= 21; index += 1) {
    await db.query("insert into public.fields(id,company_id,name,area,archived) values($1::uuid,$2::uuid,$3,10,$4)",
      [id(3,index),ids.company,`Business field ${index}`,index === 21]);
  }
  await db.query("insert into public.fields(id,company_id,name,area) values($1::uuid,$2::uuid,'Foreign field',10)", [id(3,101),ids.foreignCompany]);
  for (const fixture of [
    { id: ids.legacy, company: ids.company, status: "imported", active: true, polygons: sources },
    { id: ids.imported, company: ids.company, status: "draft", active: false, polygons: sources },
    { id: ids.foreignImport, company: ids.foreignCompany, status: "imported", active: true, polygons: [] },
    { id: ids.allUnlinked, company: ids.company, status: "draft", active: false, polygons: sources.slice(18,20) },
  ]) {
    await db.query(`insert into public.field_map_imports(id,company_id,source_file_name,source_kml_text,status,is_active,
      total_polygons,matched_polygons,unmatched_polygons,preview_payload)
      values($1::uuid,$2::uuid,'source.kml','<kml>immutable-source-fixture</kml>',$3,$4,$5,$6,$7,$8::jsonb)`,
    [fixture.id,fixture.company,fixture.status,fixture.active,fixture.polygons.length,fixture.id === ids.legacy ? 18 : 0,
      fixture.id === ids.legacy ? 112 : fixture.polygons.length,JSON.stringify({polygons:fixture.polygons})]);
  }
  for (let index = 0; index < 18; index += 1) {
    await db.query(`insert into public.field_geometries(id,company_id,field_id,import_id,source_file_name,geometry_geojson,area_from_kml_ha)
      values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'source.kml',$5::jsonb,$6)`,
    [id(5,index+1),ids.company,id(3,index+1),ids.legacy,JSON.stringify(sources[index].geometry),index+1]);
  }
  await db.query(`insert into public.field_geometries(id,company_id,field_id,import_id,source_file_name,geometry_geojson,area_from_kml_ha)
    values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'foreign.kml',$5::jsonb,10)`,
  [id(5,101),ids.foreignCompany,id(3,101),ids.foreignImport,JSON.stringify(polygon(200))]);
}

async function confirm(db: PGlite, overrides: Row = {}) {
  const company = overrides.company ?? ids.company;
  const importId = overrides.importId ?? ids.imported;
  const importRows = overrides.rows ?? resolved;
  const sourceRows = overrides.sources ?? sources;
  const revision = Object.hasOwn(overrides,"revision") ? overrides.revision : (await snapshot(db,company)).revision;
  return asRole(db, overrides.role ?? "service_role", () => value<Row>(db, `select public.${overrides.legacy ? "confirm_field_map_import_v2" : "confirm_field_map_import_v3"}(
    $1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb,$6::int,$7::int,$8::int,$9::jsonb)`,
  [company,importId,overrides.actor ?? ids.admin,JSON.stringify(importRows),JSON.stringify({polygons:sourceRows}),
    overrides.total ?? sourceRows.length,overrides.unmatched ?? sourceRows.length-importRows.filter((item:Row)=>item.field_id).length,
    overrides.errors ?? sourceRows.length-importRows.length,JSON.stringify(revision)]));
}

async function mutate(db: PGlite, action: string, expected: string | null, overrides: Row = {}) {
  return asRole(db,overrides.role ?? "service_role",()=>value<Row>(db,`select public.${overrides.legacy ? "mutate_field_boundary_v1" : "mutate_field_contour_v3"}(
    $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::uuid,$7::jsonb,$8::numeric${overrides.legacy ? "" : ",$9::text"})`,
  [overrides.company ?? ids.company,overrides.actor ?? ids.admin,action,overrides.field ?? null,expected,
    overrides.target ?? null,overrides.geometry ? JSON.stringify(overrides.geometry) : null,overrides.area ?? null,
    ...(overrides.legacy ? [] : [overrides.name ?? null])]));
}

async function state(db: PGlite, action: string, overrides: Row = {}) {
  const company = overrides.company ?? ids.company;
  const importId = overrides.importId ?? ids.imported;
  const revision = Object.hasOwn(overrides,"revision") ? overrides.revision : (await snapshot(db,company)).revision;
  const updated = Object.hasOwn(overrides,"updated") ? overrides.updated : await value(db,"select updated_at::text from public.field_map_imports where id=$1::uuid",[importId]);
  return asRole(db,overrides.role ?? "service_role",()=>value<Row>(db,`select public.${overrides.legacy ? "set_field_map_import_state_v2" : "set_field_map_import_state_v3"}(
    $1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::timestamptz)`,[company,importId,overrides.actor ?? ids.admin,action,JSON.stringify(revision),updated]));
}

async function main() {
  const db = new PGlite();
  const hashes: Row[] = [];
  try {
    await bootstrap(db);
    const original = await query(db,"select id,field_id,import_id,geometry_geojson,area_from_kml_ha from public.field_geometries order by id");
    for (const migration of migrations) {
      const sql = readFileSync(resolve(process.cwd(),migration),"utf8");
      hashes.push({path:migration,sha256:createHash("sha256").update(sql).digest("hex")});
      await db.exec(sql);
    }
    await check("exact migration chain keeps 18 known geometry IDs, links and geometry",async()=>{
      assert.deepEqual(await query(db,"select id,field_id,import_id,geometry_geojson,area_from_kml_ha from public.field_geometries order by id"),original);
      const linked = await query(db,"select id,contour_id,source_polygon_id,source_polygon_name,source_geometry_geojson,source_import_id,display_name,contour_version from public.field_geometries where company_id=$1::uuid order by id",[ids.company]);
      assert.equal(linked.length,18);
      linked.forEach((item,index)=>{
        assert.equal(item.contour_id,item.id); assert.equal(item.contour_version,1);
        assert.equal(item.source_polygon_id,sources[index].polygon_id); assert.equal(item.source_polygon_name,sources[index].polygon_name);
        assert.equal(item.source_import_id,ids.legacy);
        assert.equal(item.display_name,sources[index].polygon_name.slice(0,200)); assert.deepEqual(item.source_geometry_geojson,sources[index].geometry);
      });
      assert.equal(await value(db,"select count(*)::int from public.fields"),22);
    });
    const foreignFingerprint = await fingerprint(db,ids.foreignCompany);
    await check("SQL permissions keep anonymous/authenticated RPC and direct DML denied",async()=>{
      for(const role of ["anon","authenticated"] as const) {
        for(const table of ["field_geometries","field_map_imports"]) {
          for(const privilege of ["INSERT","UPDATE","DELETE"]) assert.equal(await value(db,"select has_table_privilege($1,$2,$3)",[role,`public.${table}`,privilege]),false);
          await expectError(()=>asRole(db,role,()=>db.exec(`delete from public.${table} where false`)),/permission denied/);
        }
        for(const proc of ["get_field_map_snapshot_v1","get_field_map_contours_v3","confirm_field_map_import_v2","confirm_field_map_import_v3","mutate_field_boundary_v1","mutate_field_contour_v3","set_field_map_import_state_v2","set_field_map_import_state_v3"]) {
          assert.equal(await value(db,"select has_function_privilege($1,p.oid,'EXECUTE') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$2",[role,proc]),false,`${role} must not execute ${proc}`);
        }
        await expectError(()=>confirm(db,{role}),/permission denied/);
      }
      assert.equal(await value(db,"select count(*)::int from pg_class where relname in ('field_geometries','field_map_imports') and relrowsecurity"),2);
    });
    await check("global-admin actor gate rejects inactive and non-global actors without changes",async()=>{
      const before=await fingerprint(db);
      for(const actor of [ids.inactive,ids.agronomist,id(2,999)]) {
        await expectError(()=>confirm(db,{actor}),/FIELD_MAP_GLOBAL_ADMIN_REQUIRED/);
        await expectError(()=>mutate(db,"rename",id(5,1),{actor,name:"blocked"}),/FIELD_MAP_GLOBAL_ADMIN_REQUIRED/);
        await expectError(()=>state(db,"deactivate",{actor,importId:ids.legacy}),/FIELD_MAP_GLOBAL_ADMIN_REQUIRED/);
      }
      assert.equal(await fingerprint(db),before);
    });
    await check("130-contour import saves 18 linked and 112 distinct unlinked contours atomically",async()=>{
      const result=await confirm(db);
      assert.equal(result.saved_polygons,130); assert.equal(result.linked_polygons,18); assert.equal(result.unlinked_polygons,112); assert.equal(result.skipped_polygons,0);
      assert.equal(await activeCount(db),130);
      assert.deepEqual(await query(db,"select count(*)::int total,count(field_id)::int linked,count(distinct contour_id)::int contours from public.field_geometries where company_id=$1::uuid and is_active",[ids.company]),[{total:130,linked:18,contours:130}]);
      assert.equal(await value(db,"select count(*)::int from public.fields"),22);
    });
    await check("legacy activation wrapper preserves all null links rather than DISTINCT ON(null)",async()=>{
      await state(db,"deactivate",{legacy:true}); assert.equal(await activeCount(db),0);
      await state(db,"activate",{legacy:true}); assert.equal(await activeCount(db),130);
    });
    let current=(await query(db,"select * from public.field_geometries where import_id=$1::uuid and source_polygon_id='source-19' and is_active",[ids.imported]))[0];
    const sourceIdentity={contour_id:current.contour_id,source_polygon_id:current.source_polygon_id,source_polygon_name:current.source_polygon_name,source_geometry_geojson:current.source_geometry_geojson,source_import_id:current.source_import_id,import_id:current.import_id};
    await check("rename creates a new CAS version without altering source identity",async()=>{
      const old=current;
      const result=await mutate(db,"rename",old.id,{name:"  Собственное название  "});
      current=await geometry(db,result.geometry_id);
      assert.notEqual(current.id,old.id); assert.equal(current.contour_version,old.contour_version+1);
      assert.equal(current.display_name,"Собственное название"); assert.equal(current.field_id,null);
      assert.equal((await geometry(db,old.id)).is_active,false); assert.equal(await activeCount(db),130);
      for(const key of Object.keys(sourceIdentity)) assert.deepEqual(current[key],sourceIdentity[key as keyof typeof sourceIdentity]);
    });
    await check("stale rename and invalid names roll back geometry and audit",async()=>{
      const before=await fingerprint(db);
      const originalId=await value<string>(db,"select id from public.field_geometries where contour_id=$1::uuid and contour_version=1",[current.contour_id]);
      await expectError(()=>mutate(db,"rename",originalId,{name:"stale"}),/FIELD_BOUNDARY_CAS_FAILED/);
      for(const name of [null," ","X".repeat(201)]) await expectError(()=>mutate(db,"rename",current.id,{name}),/FIELD_BOUNDARY_NAME_INVALID/);
      assert.equal(await fingerprint(db),before);
    });
    await check("unlinked contour links to an existing empty field",async()=>{
      const result=await mutate(db,"relink",current.id,{target:id(3,19)});
      current=await geometry(db,result.geometry_id); assert.equal(current.field_id,id(3,19)); assert.equal(await activeCount(db),130);
    });
    await check("cross-company, occupied and archived fields reject without audit",async()=>{
      const before=await fingerprint(db);
      for(const target of [id(3,101),id(3,21),id(3,999),null]) await expectError(()=>mutate(db,"relink",current.id,{target}),/FIELD_BOUNDARY_FIELD_SCOPE_MISMATCH/);
      await expectError(()=>mutate(db,"relink",current.id,{target:id(3,1)}),/FIELD_BOUNDARY_TARGET_OCCUPIED/);
      await expectError(()=>mutate(db,"rename",current.id,{company:ids.foreignCompany,name:"bad"}),/FIELD_BOUNDARY_SOURCE_NOT_FOUND/);
      await expectError(()=>mutate(db,"rename",current.id,{field:id(3,18),name:"bad"}),/FIELD_BOUNDARY_CAS_FAILED/);
      assert.equal(await fingerprint(db),before);
    });
    await check("legacy unlink wrapper detaches but retains visibility and contour identity",async()=>{
      const result=await mutate(db,"unlink",current.id,{legacy:true,field:id(3,19)});
      current=await geometry(db,result.geometry_id);
      assert.equal(current.field_id,null); assert.equal(current.is_active,true); assert.equal(current.deleted_at,null); assert.equal(await activeCount(db),130);
      assert.equal(current.contour_id,sourceIdentity.contour_id);
    });
    await check("MultiPolygon replacement keeps immutable original parts, holes and source name",async()=>{
      const replacement=JSON.parse(JSON.stringify(complexGeometry));
      replacement.coordinates[0][1][1][1]=54.0028;
      const result=await mutate(db,"replace",current.id,{geometry:replacement,area:18.5});
      current=await geometry(db,result.geometry_id);
      assert.deepEqual(current.geometry_geojson,replacement); assert.deepEqual(current.source_geometry_geojson,complexGeometry);
      assert.equal(current.geometry_geojson.coordinates.length,2); assert.equal(current.geometry_geojson.coordinates[0].length,2);
      assert.equal(current.source_polygon_name,sourceIdentity.source_polygon_name); assert.equal(current.display_name,"Собственное название");
      assert.equal(current.import_id,ids.imported);
    });
    let tombstone:string;
    await check("delete is an audited tombstone, not physical removal",async()=>{
      const result=await mutate(db,"delete",current.id); tombstone=result.geometry_id;
      current=await geometry(db,tombstone);
      assert.ok(current.deleted_at); assert.equal(current.is_active,false); assert.equal(await activeCount(db),129);
      const list=await asRole(db,"service_role",()=>value<Row[]>(db,"select public.get_field_map_contours_v3($1::uuid)",[ids.company]));
      assert.equal(list.length,130); assert.equal(list.filter(item=>item.deleted_at).length,1);
      assert.equal(list.find(item=>item.id===tombstone)?.source_geometry_geojson,undefined);
    });
    await check("activation uses latest tombstone and never resurrects old geometry",async()=>{
      await state(db,"deactivate");
      await expectError(()=>mutate(db,"restore",current.id),/FIELD_BOUNDARY_CAS_FAILED/);
      await state(db,"activate");
      assert.equal(await activeCount(db),129);
      assert.equal(await value(db,"select count(*)::int from public.field_geometries where contour_id=$1::uuid and is_active",[current.contour_id]),0);
    });
    await check("restore succeeds once with fresh tombstone CAS and keeps detached state",async()=>{
      const old=current.id;
      const result=await mutate(db,"restore",old); current=await geometry(db,result.geometry_id);
      assert.equal(current.field_id,null); assert.equal(current.deleted_at,null); assert.equal(current.is_active,true); assert.equal(await activeCount(db),130);
      const before=await fingerprint(db);
      await expectError(()=>mutate(db,"restore",old),/FIELD_BOUNDARY_CAS_FAILED/);
      await expectError(()=>mutate(db,"restore",current.id),/FIELD_BOUNDARY_CAS_FAILED/);
      assert.equal(await fingerprint(db),before);
    });
    await check("two-tab mutation invalidates import state revision and target timestamp",async()=>{
      const revision=(await snapshot(db)).revision;
      current=await geometry(db,(await mutate(db,"rename",current.id,{name:"Новая версия"})).geometry_id);
      const before=await fingerprint(db);
      await expectError(()=>state(db,"deactivate",{revision}),/FIELD_MAP_STATE_STALE/);
      await expectError(()=>state(db,"deactivate",{updated:"2000-01-01T00:00:00Z"}),/FIELD_MAP_STATE_STALE/);
      assert.equal(await fingerprint(db),before);
    });
    await check("manual field contour creates source once and preserves its initial geometry",async()=>{
      const result=await mutate(db,"replace",null,{field:id(3,20),geometry:polygon(150),area:10});
      let manual=await geometry(db,result.geometry_id);
      assert.equal(manual.import_id,null); assert.equal(manual.contour_version,1); assert.deepEqual(manual.source_geometry_geojson,polygon(150));
      manual=await geometry(db,(await mutate(db,"replace",manual.id,{field:id(3,20),geometry:polygon(151),area:11})).geometry_id);
      assert.deepEqual(manual.source_geometry_geojson,polygon(150)); assert.deepEqual(manual.geometry_geojson,polygon(151));
      await state(db,"deactivate"); assert.equal(await activeCount(db),0);
      await state(db,"activate"); assert.equal(await activeCount(db),130);
    });
    await check("all-unlinked import via legacy confirm wrapper saves both null field rows",async()=>{
      const result=await confirm(db,{legacy:true,importId:ids.allUnlinked,rows:resolved.slice(18,20),sources:sources.slice(18,20)});
      assert.equal(result.saved_polygons,2); assert.equal(result.linked_polygons,0); assert.equal(result.unlinked_polygons,2);
      assert.equal(await activeCount(db),2);
      await state(db,"deactivate",{importId:ids.allUnlinked}); await state(db,"activate",{importId:ids.allUnlinked,legacy:true}); assert.equal(await activeCount(db),2);
      await state(db,"activate"); assert.equal(await activeCount(db),130);
    });
    let draftCounter=10;
    const newDraft=async()=>{
      const importId=id(4,++draftCounter);
      await db.query("insert into public.field_map_imports(id,company_id,source_file_name,preview_payload) values($1::uuid,$2::uuid,'invalid-fixture.kml',$3::jsonb)",[importId,ids.company,JSON.stringify({polygons:sources})]);
      return importId;
    };
    await check("invalid source, duplicates, scope, counts and stale confirm fully roll back",async()=>{
      const cases:Array<{input:Row;error:RegExp}>=[
        {input:{rows:[resolved[0],resolved[0]]},error:/FIELD_MAP_DUPLICATE_POLYGON/},
        {input:{rows:[resolved[0],{...resolved[1],field_id:resolved[0].field_id}]},error:/FIELD_MAP_DUPLICATE_FIELD/},
        {input:{rows:[{...resolved[0],geometry_geojson:polygon(999)}]},error:/FIELD_MAP_SOURCE_MISMATCH/},
        {input:{rows:[{...resolved[0],polygon_id:"forged-source"}]},error:/FIELD_MAP_SOURCE_MISMATCH/},
        {input:{rows:[{...resolved[0],field_id:id(3,101)}]},error:/FIELD_MAP_FIELD_SCOPE_MISMATCH/},
        {input:{rows:[{...resolved[0],field_id:id(3,21)}]},error:/FIELD_MAP_FIELD_SCOPE_MISMATCH/},
        {input:{rows:[{...resolved[0],area_from_kml_ha:-1}]},error:/FIELD_MAP_RESOLVED_ROW_INVALID/},
        {input:{rows:[]},error:/FIELD_MAP_RESOLVED_ROWS_REQUIRED/},
        {input:{total:129},error:/FIELD_MAP_IMPORT_COUNTS_INVALID/},
        {input:{unmatched:0},error:/FIELD_MAP_IMPORT_COUNTS_INVALID/},
        {input:{errors:1},error:/FIELD_MAP_IMPORT_COUNTS_INVALID/},
        {input:{revision:{}},error:/FIELD_MAP_PREVIEW_STALE/},
      ];
      for(const scenario of cases){
        const importId=await newDraft(); const before=await fingerprint(db);
        await expectError(()=>confirm(db,{importId,...scenario.input}),scenario.error);
        assert.equal(await fingerprint(db),before);
      }
      const before=await fingerprint(db);
      await expectError(()=>confirm(db),/FIELD_MAP_IMPORT_NOT_DRAFT/);
      await expectError(()=>confirm(db,{company:ids.foreignCompany}),/FIELD_MAP_IMPORT_NOT_FOUND/);
      assert.equal(await fingerprint(db),before);
    });
    await check("inactive archive leaves current snapshot untouched; archived import cannot reactivate",async()=>{
      const before=await activeCount(db);
      await state(db,"archive",{importId:ids.allUnlinked}); assert.equal(await activeCount(db),before);
      const after=await fingerprint(db);
      await expectError(()=>state(db,"activate",{importId:ids.allUnlinked}),/FIELD_MAP_IMPORT_NOT_ACTIVATABLE/);
      assert.equal(await fingerprint(db),after);
    });
    await check("business-field hard delete detaches contours and preserves every source/history row",async()=>{
      const before=await fingerprint(db);
      await db.exec("begin");
      try {
        const linkedRows=await query(db,"select id,source_polygon_id,source_polygon_name,source_geometry_geojson,source_import_id from public.field_geometries where field_id=$1::uuid order by id",[id(3,18)]);
        assert.ok(linkedRows.length>=2);
        const total=await value(db,"select count(*)::int from public.field_geometries");
        await db.query("delete from public.fields where id=$1::uuid",[id(3,18)]);
        assert.equal(await value(db,"select count(*)::int from public.field_geometries"),total);
        for(const source of linkedRows){
          const remaining=await geometry(db,source.id);
          assert.ok(remaining,"field deletion must not cascade-delete a contour version"); assert.equal(remaining.field_id,null);
          for(const key of Object.keys(source)) assert.deepEqual(remaining[key],source[key]);
        }
        assert.equal(await activeCount(db),130);
      } finally { await db.exec("rollback"); }
      assert.equal(await fingerprint(db),before);
    });
    await check("import hard delete preserves immutable source UUID, name, geometry and contour history",async()=>{
      const before=await fingerprint(db);
      await db.exec("begin");
      try {
        const sourceRows=await query(db,"select id,contour_id,source_import_id,source_polygon_id,source_polygon_name,source_geometry_geojson from public.field_geometries where import_id=$1::uuid order by id",[ids.imported]);
        assert.ok(sourceRows.length>130);
        const total=await value(db,"select count(*)::int from public.field_geometries");
        await db.query("delete from public.field_map_imports where id=$1::uuid",[ids.imported]);
        assert.equal(await value(db,"select count(*)::int from public.field_geometries"),total);
        for(const source of sourceRows){
          const remaining=await geometry(db,source.id);
          assert.ok(remaining); assert.equal(remaining.import_id,null); assert.equal(remaining.source_import_id,ids.imported);
          for(const key of Object.keys(source)) assert.deepEqual(remaining[key],source[key]);
        }
        assert.equal(await activeCount(db),130);
      } finally { await db.exec("rollback"); }
      assert.equal(await fingerprint(db),before);
    });
    await check("successful mutations have company-scoped audit and never touch business fields or another tenant",async()=>{
      assert.equal(await fingerprint(db,ids.foreignCompany),foreignFingerprint);
      assert.equal(await value(db,"select count(*)::int from public.fields"),22);
      assert.equal(await value(db,"select count(*)::int from public.audit_log where company_id<>$1::uuid or who<>$2::uuid",[ids.company,ids.admin]),0);
      const actions=(await query(db,"select distinct action from public.audit_log")).map(item=>item.action);
      for(const action of ["confirm_atomic_v3","contour_rename_atomic_v3","contour_relink_atomic_v3","contour_unlink_atomic_v3","contour_replace_atomic_v3","contour_delete_atomic_v3","contour_restore_atomic_v3","state_activate_atomic_v3","state_deactivate_atomic_v3","state_archive_atomic_v3"]) assert.ok(actions.includes(action),action);
      const history=await query(db,"select source_polygon_id,source_polygon_name,source_geometry_geojson,source_import_id,import_id from public.field_geometries where contour_id=$1::uuid",[sourceIdentity.contour_id]);
      assert.ok(history.length>=8);
      for(const item of history) for(const key of ["source_polygon_id","source_polygon_name","source_geometry_geojson","source_import_id","import_id"]) assert.deepEqual(item[key],sourceIdentity[key as keyof typeof sourceIdentity]);
      assert.equal(await value(db,"select source_kml_text from public.field_map_imports where id=$1::uuid",[ids.imported]),"<kml>immutable-source-fixture</kml>");
    });
    console.log(JSON.stringify({suite:"fields-map independent contours v3 PGlite",passed,failed:0,migrations:hashes,note:"All migration files executed verbatim. Local schema/role fixtures only; no remote access."},null,2));
  } finally { await db.close(); }
}
void main().catch(error=>{console.error(error instanceof Error ? error.message : error); process.exitCode=1;});
