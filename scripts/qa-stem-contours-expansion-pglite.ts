import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { parseKmlToGeoJson } from "../lib/fields-map/kml-server";
import { validateParsedPolygonsForImport } from "../lib/fields-map/import-validation";
import { buildStemContourExpansionSql } from "./qa-stem-contours-expansion-proposal";

type Row=Record<string,any>;
const root=process.cwd();
const archive="C:/Users/TRAVKIN/Downloads/Границы Полей STEM.zip";
const previewPath="C:/Users/TRAVKIN/Downloads/CodecSaaS/.codex-artifacts/tf2-m09-20260909/http-rehearsal-2026-09-09T17-55-13-143Z/preview.json";
const company="8a0f2c0e-6638-4a31-99a8-cab4237d287d";
const importId="097b2646-4adc-4842-b988-b3603889e271";
const actor="20000000-0000-4000-8000-000000000001";
const zipSha="b5d927b63d16ea15e74cd647c9af4c1e46715b51c77ea58627e9b3d7b5e9aaa6";
const kmlSha="51abda21beb7a0ad276b3ac2ab926e95919f84682f107700e7b302620e619bf2";
const kmlMd5="2ada75e9b094db93ef8cea680be35ace";
const migrations=["supabase/migrations/20260908232606_field_boundary_revision_v1.sql",
  "supabase/migrations/20260909073000_fields_map_atomic_import_v2.sql",
  "supabase/migrations/20260909211431_field_map_independent_contours_v3.sql"];
const hash=(value:string|Buffer,algorithm="sha256")=>createHash(algorithm).update(value).digest("hex");
const query=async(db:PGlite,sql:string,args:unknown[]=[])=>(await db.query(sql,args)).rows as Row[];
const value=async<T=any>(db:PGlite,sql:string,args:unknown[]=[]):Promise<T>=>Object.values((await query(db,sql,args))[0]??{})[0] as T;
const read=(relative:string)=>readFileSync(path.join(root,relative),"utf8");
let passed=0;
async function check(name:string,run:()=>void|Promise<void>){await run();passed+=1;console.log(`PASS ${name}`);}

function readImmutableKml(){
  const before=statSync(archive),zip=readFileSync(archive);
  assert.equal(hash(zip),zipSha,"STEM ZIP fingerprint changed");
  let end=zip.length-22;
  while(end>=Math.max(0,zip.length-65557)&&zip.readUInt32LE(end)!==0x06054b50)end-=1;
  assert.ok(end>=0);assert.equal(zip.readUInt16LE(end+10),1,"one source KML entry required");
  const central=zip.readUInt32LE(end+16);
  assert.equal(zip.readUInt32LE(central),0x02014b50);assert.equal(zip.readUInt16LE(central+10),8);
  const size=zip.readUInt32LE(central+20),local=zip.readUInt32LE(central+42);
  assert.equal(zip.readUInt32LE(local),0x04034b50);
  const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
  const kml=inflateRawSync(zip.subarray(start,start+size)).toString("utf8");
  assert.equal(hash(kml),kmlSha);assert.equal(hash(kml,"md5"),kmlMd5);assert.equal(Buffer.byteLength(kml),3527503);
  const after=statSync(archive);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);
  return{kml,zipBytes:zip.length,mtimeMs:before.mtimeMs};
}

async function bootstrap(db:PGlite,kml:string,rows:Row[]){
  // Local minimal pre-TF2 schema. Nothing is connected to Supabase or Product.
  await db.exec(`
    create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create table public.companies(id uuid primary key,name text not null);
    create table public.profiles(id uuid primary key,company_id uuid references public.companies(id),role text not null,status text not null);
    create table public.fields(id uuid primary key,company_id uuid not null references public.companies(id) on delete cascade,
      name text not null,area numeric(10,2) not null check(area>0),notes text,archived boolean not null default false);
    create table public.field_map_imports(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
      source_file_name text not null,source_kml_text text,status text not null default 'draft' check(status in('draft','imported','archived','failed')),
      total_polygons integer not null default 0,matched_polygons integer not null default 0,unmatched_polygons integer not null default 0,
      error_count integer not null default 0,preview_payload jsonb not null default '{}',imported_at timestamptz,imported_by uuid references public.profiles(id) on delete set null,
      is_active boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table public.field_geometries(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
      field_id uuid not null references public.fields(id) on delete cascade,import_id uuid references public.field_map_imports(id) on delete set null,
      source_file_name text,geometry_geojson jsonb not null,area_from_kml_ha numeric(14,4),imported_at timestamptz not null default now(),
      imported_by uuid references public.profiles(id) on delete set null,is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create unique index idx_field_geometries_active_per_field on public.field_geometries(company_id,field_id) where is_active;
    create table public.audit_log(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),who uuid references public.profiles(id),
      when_at timestamptz not null default now(),entity_type text not null,entity_id text not null,action text not null,old_values jsonb,new_values jsonb,reason text);
    alter table public.field_map_imports enable row level security;alter table public.field_geometries enable row level security;
    grant usage on schema public to anon,authenticated,service_role;
    grant select,insert,update,delete on public.field_map_imports,public.field_geometries to public,anon,authenticated;
  `);
  await db.query("insert into public.companies values($1::uuid,'STEM Local QA Fixture')",[company]);
  await db.query("insert into public.profiles values($1::uuid,$2::uuid,'global_admin','active')",[actor,company]);
  const linked=rows.filter(row=>row.match_status==="matched");assert.equal(linked.length,18);
  assert.equal(new Set(linked.map(row=>row.field_id)).size,18);
  for(const source of linked)await db.query("insert into public.fields(id,company_id,name,area,notes) values($1::uuid,$2::uuid,$3,$4,'Synthetic business fixture; actual preview ID only')",
    [source.field_id,company,source.field_display_name||source.polygon_name,source.area_ha]);
  const finalized=rows.map(row=>({...row,final_field_id:row.match_status==="matched"?row.field_id:null,
    final_status:row.match_status==="matched"?"saved":"skipped",final_reason:row.match_status==="matched"?null:"field_not_resolved"}));
  await db.query(`insert into public.field_map_imports(id,company_id,source_file_name,source_kml_text,status,total_polygons,matched_polygons,unmatched_polygons,error_count,
    preview_payload,imported_at,imported_by,is_active,created_at,updated_at)
    values($1::uuid,$2::uuid,'Границы Полей STEM.kml',$3,'imported',130,18,112,112,$4::jsonb,'2026-09-09T18:00:00Z',$5::uuid,true,'2026-09-09T18:00:00Z','2026-09-09T18:00:00Z')`,
    [importId,company,kml,JSON.stringify({polygons:finalized,map_revision:{},unresolved_polygons:rows.filter(row=>row.match_status!=="matched").map(row=>row.polygon_name)}),actor]);
  for(let index=0;index<linked.length;index+=1){
    const source=linked[index],geometryId=`50000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`;
    await db.query(`insert into public.field_geometries(id,company_id,field_id,import_id,source_file_name,geometry_geojson,area_from_kml_ha,imported_by,
      imported_at,created_at,updated_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'Границы Полей STEM.kml',$5::jsonb,$6,$7::uuid,
      '2026-09-09T18:00:00Z','2026-09-09T18:00:00Z','2026-09-09T18:00:00Z')`,
      [geometryId,company,source.field_id,importId,JSON.stringify(source.geometry),source.area_ha,actor]);
  }
}

async function fingerprint(db:PGlite){return value<string>(db,`select md5(jsonb_build_object(
  'fields',(select jsonb_agg(to_jsonb(f) order by id) from public.fields f),
  'imports',(select jsonb_agg(to_jsonb(i) order by id) from public.field_map_imports i),
  'geometry',(select jsonb_agg(to_jsonb(g) order by id) from public.field_geometries g),
  'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.audit_log a))::text)`);}
async function executeRejected(db:PGlite,sql:string,expected:RegExp){
  const before=await fingerprint(db);let failed:unknown;
  try{await db.exec(sql);}catch(error){failed=error;await db.exec("rollback");}
  assert.ok(failed,`Expected SQL to fail with ${expected}`);
  assert.match(failed instanceof Error?failed.message:String(failed),expected);
  assert.equal(await fingerprint(db),before,"failed proposal must roll back every table and audit");
}

async function main(){
  const source=readImmutableKml();
  const previewBytes=readFileSync(previewPath);const previewStat=statSync(previewPath);
  const preview=JSON.parse(previewBytes.toString("utf8"));const rows:Row[]=preview.matches;
  await check("actual immutable ZIP and preview contain the same 130 complete validated source geometries",()=>{
    const parsed=parseKmlToGeoJson(source.kml);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.features.length,130);assert.equal(rows.length,130);
    const validation=validateParsedPolygonsForImport(parsed.features);
    if(!validation.ok)throw new Error(validation.error);
    const byId=new Map(validation.polygons.map(row=>[row.id,row]));
    for(const row of rows){const expected=byId.get(row.polygon_id);assert.ok(expected);assert.equal(row.polygon_name,expected.name);assert.deepEqual(row.geometry,expected.geometry);assert.equal(row.area_ha,expected.area_ha);}
    assert.equal(validation.positionCount,73212);
  });
  const db=new PGlite();
  const migrationHashes:Row[]=[];
  try{
    await bootstrap(db,source.kml,rows);
    for(const file of migrations){const sql=read(file);await db.exec(sql);migrationHashes.push({file,sha256:hash(sql)});}
    const preflightSql=read("scripts/qa-stem-contours-expansion-preflight.sql");
    const preflight=await value<Row>(db,preflightSql);
    const input={actorId:actor,revisionMd5:preflight.revision_md5,geometryMd5:preflight.geometry_md5,
      previewMd5:preflight.preview_md5,fieldsMd5:preflight.fields_md5,targetUpdatedAt:preflight.target_updated_at};
    await check("exact preflight reads post-migration fingerprints, 18 existing links and source hashes",()=>{
      assert.equal(preflight.company_id,company);assert.equal(preflight.import_id,importId);
      assert.equal(preflight.source_bytes,3527503);assert.equal(preflight.source_md5,kmlMd5);assert.equal(preflight.source_sha256,kmlSha);
      assert.equal(preflight.preview_count,130);assert.deepEqual(preflight.counts,{total:18,active:18,linked:18,unlinked:0,source_ids:18});
      for(const key of ["revision_md5","geometry_md5","preview_md5","fields_md5"])assert.match(preflight[key],/^[0-9a-f]{32}$/u);
    });
    const proposal=buildStemContourExpansionSql(input);
    await check("each modified expected fingerprint and stale timestamp aborts with zero writes",async()=>{
      const cases=[
        {patch:{revisionMd5:"0".repeat(32)},error:/QA_REVISION_MISMATCH/},
        {patch:{geometryMd5:"0".repeat(32)},error:/QA_GEOMETRY_FINGERPRINT_MISMATCH/},
        {patch:{previewMd5:"0".repeat(32)},error:/QA_IMPORT_CAS_FAILED/},
        {patch:{fieldsMd5:"0".repeat(32)},error:/QA_FIELDS_FINGERPRINT_MISMATCH/},
        {patch:{targetUpdatedAt:"2000-01-01T00:00:00Z"},error:/QA_IMPORT_CAS_FAILED/},
        {patch:{actorId:"20000000-0000-4000-8000-000000000999"},error:/QA_ACTOR_MISMATCH/},
      ];
      for(const scenario of cases)await executeRejected(db,buildStemContourExpansionSql({...input,...scenario.patch}),scenario.error);
    });
    await check("source KML tampering and non-QA company label abort without changes",async()=>{
      await db.query("update public.field_map_imports set source_kml_text=null where id=$1::uuid",[importId]);
      await executeRejected(db,proposal,/QA_SOURCE_FINGERPRINT_MISMATCH/);
      await db.query("update public.field_map_imports set source_kml_text=$1 where id=$2::uuid",[source.kml,importId]);
      await db.query("update public.field_map_imports set source_kml_text=source_kml_text||' ' where id=$1::uuid",[importId]);
      await executeRejected(db,proposal,/QA_SOURCE_FINGERPRINT_MISMATCH/);
      await db.query("update public.field_map_imports set source_kml_text=$1 where id=$2::uuid",[source.kml,importId]);
      await db.query("update public.companies set name='Live Tenant' where id=$1::uuid",[company]);
      await executeRejected(db,proposal,/QA_SCOPE_MISMATCH/);
      await db.query("update public.companies set name='STEM Local QA Fixture' where id=$1::uuid",[company]);
      assert.equal(await value(db,preflightSql).then((result:Row)=>result.geometry_md5),input.geometryMd5);
    });
    const oldRows=await query(db,"select * from public.field_geometries order by id");
    const oldFields=await query(db,"select * from public.fields order by id");
    await check("exact generated proposal adds exactly 112 unlinked contours and preserves old 18 full rows",async()=>{
      await db.exec(proposal);
      const after=await value<Row>(db,preflightSql);
      assert.deepEqual(after.counts,{total:130,active:130,linked:18,unlinked:112,source_ids:130});
      assert.equal(after.fields_md5,input.fieldsMd5);assert.equal(after.source_sha256,kmlSha);assert.equal(after.source_bytes,3527503);
      const retained=await query(db,"select * from public.field_geometries where id=any($1::uuid[]) order by id",[oldRows.map(row=>row.id)]);
      assert.deepEqual(retained,oldRows);assert.deepEqual(await query(db,"select * from public.fields order by id"),oldFields);
      assert.equal(await value(db,"select count(distinct contour_id)::int from public.field_geometries"),130);
      assert.equal(await value(db,"select count(*)::int from public.audit_log"),1);
      assert.equal(await value(db,"select action from public.audit_log"),"expand_all_contours_guarded_v3");
    });
    await check("all 130 source names, parts, holes, immutable geometry and source UUID survive expansion",async()=>{
      const saved=await query(db,"select * from public.field_geometries order by source_polygon_id");
      const expectedById=new Map(rows.map(row=>[row.polygon_id,row]));
      for(const contour of saved){
        const expected=expectedById.get(contour.source_polygon_id);assert.ok(expected);
        assert.deepEqual(contour.geometry_geojson,expected.geometry);assert.deepEqual(contour.source_geometry_geojson,expected.geometry);
        assert.equal(contour.source_polygon_name,expected.polygon_name);assert.equal(contour.display_name,expected.polygon_name.slice(0,200));
        assert.equal(contour.source_import_id,importId);assert.equal(contour.import_id,importId);
        assert.equal(contour.field_id,expected.match_status==="matched"?expected.field_id:null);assert.equal(contour.contour_version,1);
      }
      const payload=await value<Row>(db,"select preview_payload from public.field_map_imports where id=$1::uuid",[importId]);
      assert.equal(payload.polygons.length,130);assert.equal(payload.polygons.filter((row:Row)=>row.final_status==="saved").length,130);
      assert.equal(payload.polygons.filter((row:Row)=>row.final_reason==="saved_unlinked").length,112);assert.deepEqual(payload.unresolved_polygons,[]);
      assert.equal(await value(db,"select error_count from public.field_map_imports where id=$1::uuid",[importId]),0);
    });
    await check("rerun with original fingerprints aborts and never duplicates contours or audit",async()=>{
      await executeRejected(db,proposal,/QA_IMPORT_CAS_FAILED|QA_REVISION_MISMATCH/);
      assert.equal(await value(db,"select count(*)::int from public.field_geometries"),130);assert.equal(await value(db,"select count(*)::int from public.audit_log"),1);
    });
    await check("even regenerated fingerprints cannot bypass the strict existing-18 precondition",async()=>{
      const fresh=await value<Row>(db,preflightSql);
      const attempted=buildStemContourExpansionSql({actorId:actor,revisionMd5:fresh.revision_md5,geometryMd5:fresh.geometry_md5,
        previewMd5:fresh.preview_md5,fieldsMd5:fresh.fields_md5,targetUpdatedAt:fresh.target_updated_at});
      await executeRejected(db,attempted,/QA_EXISTING_18_MISMATCH/);
    });
    await check("source archive and preview evidence files were never modified",()=>{
      assert.equal(hash(readFileSync(archive)),zipSha);assert.equal(statSync(archive).mtimeMs,source.mtimeMs);
      assert.equal(hash(readFileSync(previewPath)),hash(previewBytes));assert.equal(statSync(previewPath).mtimeMs,previewStat.mtimeMs);
    });
    console.log(JSON.stringify({suite:"STEM exact-source guarded expansion PGlite",passed,failed:0,
      source:{zip_sha256:zipSha,kml_sha256:kmlSha,kml_bytes:Buffer.byteLength(source.kml),zip_bytes:source.zipBytes},
      fixture:"Actual 130 preview geometries/names/field IDs; synthetic business records, actor and 18 geometry IDs. Not a live QA snapshot.",
      proposal_sha256:hash(proposal),preflight_sha256:hash(preflightSql),migrations:migrationHashes,
      result:{before:18,inserted:112,after:130,linked:18,unlinked:112,audit:1,preserved_old_full_rows:true},
      remote_calls:0,files_written:0},null,2));
  }finally{await db.close();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
