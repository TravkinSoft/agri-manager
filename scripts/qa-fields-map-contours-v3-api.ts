import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import * as accessPolicy from "../lib/fields-map/access-policy";
import { validateParsedPolygonsForImport } from "../lib/fields-map/import-validation";
import { contourRings, replaceContourRing } from "../lib/fields-map/contour-editor";
import type { GeoJsonAreaGeometry, GeoJsonMultiPolygon, GeoJsonPosition } from "../lib/types/fields-map";

type Row = Record<string, any>;
const root=process.cwd();
const read=(name:string)=>readFileSync(path.join(root,name),"utf8");
const ids={company:"10000000-0000-4000-8000-000000000001",admin:"20000000-0000-4000-8000-000000000001",
  fieldA:"30000000-0000-4000-8000-000000000001",fieldB:"30000000-0000-4000-8000-000000000002",
  import:"40000000-0000-4000-8000-000000000001",geometry:"50000000-0000-4000-8000-000000000001"};
const full:GeoJsonMultiPolygon={type:"MultiPolygon",coordinates:[
  [
    [[69,54],[69.02,54],[69.02,54.02],[69,54.02],[69,54]],
    [[69.002,54.002],[69.002,54.003],[69.003,54.003],[69.003,54.002],[69.002,54.002]],
    [[69.005,54.005],[69.005,54.007],[69.007,54.007],[69.007,54.005],[69.005,54.005]],
  ],
  [
    [[69.04,54.04],[69.06,54.04],[69.06,54.06],[69.04,54.06],[69.04,54.04]],
    [[69.045,54.045],[69.045,54.047],[69.047,54.047],[69.047,54.045],[69.045,54.045]],
  ],
]};
const square:GeoJsonAreaGeometry={type:"Polygon",coordinates:[[[70,54],[70.01,54],[70.01,54.01],[70,54.01],[70,54]]]};
const source=(polygonId:string,overrides:Row={})=>({polygon_id:polygonId,polygon_name:`Источник ${polygonId}`,geometry:square,
  area_ha:null,match_status:"not_found",match_stage:"unmatched",field_id:null,confidence_score:0,candidates:[],...overrides});
const initialRows=[source("linked",{match_status:"matched",field_id:ids.fieldA}),source("unknown",{geometry:full}),
  source("ambiguous",{match_status:"ambiguous",match_stage:"manual_required",field_id:ids.fieldB,suggested_field_id:ids.fieldB})];

class MockSessionAuthError extends Error {
  status:number;
  constructor(message:string,status=401){super(message);this.status=status;}
}

function load(sourceText:string,dependencies:Record<string,unknown>,env:Record<string,string|undefined>){
  const output=ts.transpileModule(sourceText,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded={exports:{} as Row};
  vm.runInNewContext(output,{module:loaded,exports:loaded.exports,Error,TypeError,SyntaxError,process:{env},require:(name:string)=>{
    if(!Object.prototype.hasOwnProperty.call(dependencies,name)) throw new Error(`Unexpected dependency ${name}; network-capable imports are not allowed in this harness`);
    return dependencies[name];
  }});
  return loaded.exports;
}

function harness(options:Row={}){
  const calls:{table:string;filters:Array<[string,unknown]>}[]=[];
  const rpc:Array<{name:string;args:Row}>=[];
  const actor={id:ids.admin,role:options.role??"global_admin",roleRawKey:options.rawRole??options.role??"global_admin",roleIsLegacyAlias:options.alias??false};
  const preview={map_revision:{fields:[],active_geometries:[],active_import_ids:[],contour_versions:[]},polygons:initialRows,...options.preview};
  const supabase={
    from(table:string){
      const call={table,filters:[] as Array<[string,unknown]>};calls.push(call);
      const response=()=>table==="field_map_imports"
        ? {data:options.missingImport?null:{id:ids.import,status:options.status??"draft",source_file_name:"local.kml",preview_payload:preview},error:null}
        : {data:(options.fields??[ids.fieldA,ids.fieldB]).map((id:string)=>({id})),error:null};
      const chain:any={select(){return chain;},eq(key:string,value:unknown){call.filters.push([key,value]);return chain;},
        maybeSingle(){return Promise.resolve(response());},then(resolveValue:any,rejectValue:any){return Promise.resolve(response()).then(resolveValue,rejectValue);}};
      return chain;
    },
    async rpc(name:string,args:Row){rpc.push({name,args});return{data:{geometry_id:ids.geometry,field_id:args.p_field_id},error:options.rpcError?{message:options.rpcError}:null};},
  };
  const auth={SessionAuthError:MockSessionAuthError,getServerActorFromSession:async()=>{
    if(options.authError)throw new MockSessionAuthError("Session unavailable",401);return actor;
  },resolveCompanyForActor:()=>ids.company};
  const env={FIELD_BOUNDARY_WRITE_V1:options.flag??"1"};
  const access=load(read("lib/fields-map/access.ts"),{"@/lib/auth/server-session":auth,"@/lib/fields-map/access-policy":accessPolicy},env);
  const server=load(read("lib/fields-map/server.ts"),{"next/server":{NextRequest,NextResponse},"@/lib/auth/server-session":auth,
    "@/lib/supabase/service":{getServiceClient:()=>supabase},"@/lib/fields-map/access":access},env);
  const dependencies={"next/server":{NextRequest,NextResponse},"@/lib/fields-map/server":server,
    "@/lib/fields-map/import-validation":{validateParsedPolygonsForImport}};
  const confirm=load(read("app/api/fields-map/import/confirm/route.ts"),dependencies,env).POST;
  const mutate=load(read("app/api/fields-map/boundaries/mutate/route.ts"),dependencies,env).POST;
  const post=async(handler:any,body:unknown)=>{
    const request=new NextRequest("http://local.test/api/fields-map",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const response=await handler(request);
    return{status:response.status,body:await response.json()};
  };
  return{calls,rpc,confirm:(body:unknown={import_id:ids.import})=>post(confirm,body),mutate:(body:unknown)=>post(mutate,body)};
}

let passed=0;
const failures:string[]=[];
async function check(name:string,run:()=>void|Promise<void>){
  try{await run();passed+=1;console.log(`PASS ${name}`);}
  catch(error){const text=`${name}: ${error instanceof Error?error.message:String(error)}`;failures.push(text);console.error(`FAIL ${text}`);}
}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const same=(actual:unknown,expected:unknown)=>assert.deepEqual(clone(actual),clone(expected));

async function main(){
  await check("actual confirm handler retains default unknown and ambiguous contours without inferred field links",async()=>{
    const app=harness();const result=await app.confirm();assert.equal(result.status,200);
    same([result.body.saved_polygons,result.body.linked_polygons,result.body.unlinked_polygons,result.body.skipped_polygons],[3,1,2,0]);
    assert.equal(app.rpc.length,1);assert.equal(app.rpc[0].name,"confirm_field_map_import_v3");
    const args=app.rpc[0].args;
    same(args.p_rows.map((item:Row)=>item.field_id),[ids.fieldA,null,null]);
    same(args.p_rows[1].geometry_geojson,full);
    same([args.p_total_polygons,args.p_unmatched_polygons,args.p_error_count],[3,2,0]);
    assert.equal(args.p_company_id,ids.company);assert.equal(args.p_actor_id,ids.admin);
    assert.ok(args.p_rows.every((item:Row)=>item.area_from_kml_ha>0));
    for(const call of app.calls)assert.ok(call.filters.some(([key,value])=>key==="company_id"&&value===ids.company));
    assert.equal(args.p_preview_payload.polygons[1].final_reason,"saved_unlinked");
  });
  await check("explicit skip and legacy null override exclude only the selected source",async()=>{
    for(const override of [{polygon_id:"linked",field_id:null,action:"skip"},{polygon_id:"linked",field_id:null}]){
      const app=harness();const result=await app.confirm({import_id:ids.import,overrides:[override]});
      assert.equal(result.status,200);same([result.body.saved_polygons,result.body.linked_polygons,result.body.unlinked_polygons,result.body.skipped_polygons],[2,0,2,1]);
      assert.equal(app.rpc[0].args.p_rows.some((item:Row)=>item.polygon_id==="linked"),false);
      assert.equal(app.rpc[0].args.p_preview_payload.polygons[0].final_reason,"explicitly_excluded");
    }
  });
  await check("explicit unlinked overrides an automatic match while explicit link selects an existing field",async()=>{
    const app=harness();const result=await app.confirm({import_id:ids.import,overrides:[
      {polygon_id:"linked",field_id:null,action:"unlinked"},{polygon_id:"ambiguous",field_id:ids.fieldB,action:"link"},
    ]});assert.equal(result.status,200);same(app.rpc[0].args.p_rows.map((item:Row)=>item.field_id),[null,null,ids.fieldB]);
  });
  await check("only unlinked rows can confirm without a business-field fixture",async()=>{
    const app=harness({fields:[],preview:{polygons:[source("a"),source("b")]}});
    const result=await app.confirm();assert.equal(result.status,200);assert.equal(result.body.unlinked_polygons,2);
  });
  await check("stale field references and duplicate linked assignments fail before RPC",async()=>{
    const missing=harness({fields:[ids.fieldB]});assert.equal((await missing.confirm()).status,409);assert.equal(missing.rpc.length,0);
    const duplicate=harness();assert.equal((await duplicate.confirm({import_id:ids.import,overrides:[{polygon_id:"unknown",field_id:ids.fieldA,action:"link"}]})).status,409);assert.equal(duplicate.rpc.length,0);
  });
  await check("unknown/duplicate override IDs and contradictory actions fail before RPC",async()=>{
    const overridesList=[
      [{polygon_id:"missing",field_id:null,action:"unlinked"}],
      [{polygon_id:"unknown",field_id:null,action:"unlinked"},{polygon_id:"unknown",field_id:null,action:"skip"}],
      [{polygon_id:"unknown",field_id:null,action:"link"}],
      [{polygon_id:"unknown",field_id:ids.fieldB,action:"unlinked"}],
      [{polygon_id:"unknown",field_id:ids.fieldB,action:"skip"}],
      [{polygon_id:"unknown",field_id:null,action:"invented"}],
      [{polygon_id:"unknown",field_id:"invalid",action:"link"}],
    ];
    for(const overrides of overridesList){const app=harness();assert.equal((await app.confirm({import_id:ids.import,overrides})).status,400);assert.equal(app.rpc.length,0);}
  });
  await check("all excluded, duplicate source identity and malformed geometry fail before RPC",async()=>{
    const all=harness();assert.equal((await all.confirm({import_id:ids.import,overrides:initialRows.map(item=>({polygon_id:item.polygon_id,field_id:null,action:"skip"}))})).status,400);assert.equal(all.rpc.length,0);
    const duplicate=harness({preview:{polygons:[source("same"),source("same")]}});assert.equal((await duplicate.confirm()).status,400);assert.equal(duplicate.rpc.length,0);
    const invalid=harness({preview:{polygons:[source("bad",{geometry:{type:"Polygon",coordinates:[]}})]}});assert.equal((await invalid.confirm()).status,400);assert.equal(invalid.rpc.length,0);
  });
  await check("draft revision is mandatory; stale CAS maps to conflict; missing v3 schema maps to unavailable",async()=>{
    const noRevision=harness({preview:{map_revision:null}});assert.equal((await noRevision.confirm()).status,409);assert.equal(noRevision.rpc.length,0);
    const stale=harness({rpcError:"FIELD_MAP_PREVIEW_STALE"});assert.equal((await stale.confirm()).status,409);
    const schema=harness({rpcError:"function public.confirm_field_map_import_v3 does not exist"});assert.equal((await schema.confirm()).status,503);
    const notDraft=harness({status:"imported"});assert.equal((await notDraft.confirm()).status,409);assert.equal(notDraft.rpc.length,0);
    const missing=harness({missingImport:true});assert.equal((await missing.confirm()).status,404);
  });
  await check("malformed override containers and entries are rejected instead of silently saving all",async()=>{
    for(const overrides of [{},"skip",[null],[42]]){
      const app=harness();const result=await app.confirm({import_id:ids.import,overrides});
      assert.equal(result.status,400,JSON.stringify({overrides,result}));assert.equal(app.rpc.length,0);
    }
  });
  await check("malformed top-level bodies return client errors without writes",async()=>{
    for(const body of [null,[],"import"]){
      const app=harness();assert.equal((await app.confirm(body)).status,400);assert.equal(app.rpc.length,0);
      assert.equal((await app.mutate(body)).status,400);assert.equal(app.rpc.length,0);
    }
  });
  await check("actual server role and write flag gates remain fail-closed for both routes",async()=>{
    const denied=[{options:{authError:true},status:401},{options:{role:"agronomist"},status:403},
      {options:{role:"company_admin"},status:403},{options:{role:"director"},status:403},
      {options:{alias:true},status:403},{options:{rawRole:"admin"},status:403},{options:{flag:"0"},status:503},{options:{flag:""},status:503}];
    for(const test of denied){
      const app=harness(test.options);assert.equal((await app.confirm()).status,test.status);
      assert.equal((await app.mutate({action:"delete",expected_geometry_id:ids.geometry})).status,test.status);
      assert.equal(app.calls.length,0);assert.equal(app.rpc.length,0);
    }
  });
  await check("rename, delete, restore and unlink accept an independent contour without field_id",async()=>{
    for(const action of ["rename","delete","restore","unlink"]){
      const app=harness();const result=await app.mutate({action,expected_geometry_id:ids.geometry,display_name:"  Новое имя  "});
      assert.equal(result.status,200);assert.equal(app.rpc[0].name,"mutate_field_contour_v3");
      const args=app.rpc[0].args;assert.equal(args.p_field_id,null);assert.equal(args.p_expected_geometry_id,ids.geometry);
      assert.equal(args.p_action,action);assert.equal(args.p_display_name,"Новое имя");assert.equal(args.p_company_id,ids.company);
    }
  });
  await check("mutating existing independent contours requires expected geometry CAS",async()=>{
    for(const action of ["rename","delete","restore","unlink","relink","replace"]){
      for(const expected_geometry_id of [undefined,"bad"]){
        const app=harness();assert.equal((await app.mutate({action,expected_geometry_id,target_field_id:ids.fieldB,display_name:"Name",geometry:full})).status,400);assert.equal(app.rpc.length,0);
      }
    }
  });
  await check("malformed expected CAS never silently turns replacement into creation",async()=>{
    const app=harness();const result=await app.mutate({action:"replace",field_id:ids.fieldB,expected_geometry_id:"bad",geometry:full});
    assert.equal(result.status,400);assert.equal(app.rpc.length,0);
  });
  await check("invalid rename, field scope syntax, target and actions fail before mutation",async()=>{
    const bodies=[{action:"rename",display_name:""},{action:"rename",display_name:"X".repeat(201)},
      {action:"rename",display_name:22},{action:"delete",field_id:"bad"},{action:"relink"},
      {action:"relink",target_field_id:"bad"},{action:"invented"}];
    for(const body of bodies){const app=harness();assert.equal((await app.mutate({expected_geometry_id:ids.geometry,...body})).status,400);assert.equal(app.rpc.length,0);}
  });
  await check("replacement revalidates complete MultiPolygon, preserving all holes and parts",async()=>{
    const app=harness();const result=await app.mutate({action:"replace",expected_geometry_id:ids.geometry,geometry:full});
    assert.equal(result.status,200);same(app.rpc[0].args.p_geometry_geojson,full);assert.ok(app.rpc[0].args.p_area_from_kml_ha>0);
    const manual=harness();assert.equal((await manual.mutate({action:"replace",field_id:ids.fieldB,geometry:square})).status,200);assert.equal(manual.rpc[0].args.p_expected_geometry_id,null);
  });
  await check("server rejects self-intersection/invalid holes and maps SQL CAS/scope errors",async()=>{
    const bad=clone(full);bad.coordinates[0][1]=[[71,54],[71.001,54],[71.001,54.001],[71,54]];
    const app=harness();assert.equal((await app.mutate({action:"replace",expected_geometry_id:ids.geometry,geometry:bad})).status,400);assert.equal(app.rpc.length,0);
    for(const [rpcError,status] of [["FIELD_BOUNDARY_CAS_FAILED",409],["FIELD_BOUNDARY_TARGET_OCCUPIED",409],
      ["FIELD_BOUNDARY_SOURCE_NOT_FOUND",404],["FIELD_BOUNDARY_FIELD_SCOPE_MISMATCH",404],["FIELD_BOUNDARY_NAME_INVALID",400]] as const){
      assert.equal((await harness({rpcError}).mutate({action:"delete",expected_geometry_id:ids.geometry})).status,status);
    }
  });
  await check("ring enumeration covers every part and hole without flattening",()=>{
    const rings=contourRings(full);same(rings.map(item=>[item.part,item.ring]),[[0,0],[0,1],[0,2],[1,0],[1,1]]);
    assert.ok(rings[1].label.includes("отверстие 1"));assert.ok(rings[3].label.includes("Часть 2"));
  });
  await check("editing each ring preserves all other coordinates and does not mutate source",()=>{
    const immutable=JSON.stringify(full);
    for(const target of contourRings(full)){
      const points=target.coordinates.slice(0,-1).map(([lng,lat])=>[lng+0.0001,lat] as GeoJsonPosition);
      const next=replaceContourRing(full,target.part,target.ring,points);
      assert.ok(next);assert.equal(next.type,"MultiPolygon");
      for(const ring of contourRings(next))if(ring.part!==target.part||ring.ring!==target.ring){same(ring.coordinates,contourRings(full).find(item=>item.part===ring.part&&item.ring===ring.ring)!.coordinates);assert.notEqual(ring.coordinates,contourRings(full).find(item=>item.part===ring.part&&item.ring===ring.ring)!.coordinates);}
      const changed=contourRings(next).find(item=>item.part===target.part&&item.ring===target.ring)!;
      same(changed.coordinates.slice(0,-1),points);same(changed.coordinates[0],changed.coordinates[changed.coordinates.length-1]);
      assert.equal(JSON.stringify(full),immutable);
      points[0][0]=0;assert.notEqual(changed.coordinates[0][0],0);
    }
  });
  await check("successive ring edits retain earlier unsaved changes and Polygon stays Polygon",()=>{
    const firstPoints=full.coordinates[0][1].slice(0,-1).map(([lng,lat])=>[lng+0.0001,lat] as GeoJsonPosition);
    const first=replaceContourRing(full,0,1,firstPoints)!;
    const secondPoints=full.coordinates[1][1].slice(0,-1).map(([lng,lat])=>[lng,lat+0.0001] as GeoJsonPosition);
    const second=replaceContourRing(first,1,1,secondPoints)!;
    same(contourRings(second)[1].coordinates,contourRings(first)[1].coordinates);
    const polygon:GeoJsonAreaGeometry={type:"Polygon",coordinates:clone(full.coordinates[0])};
    const next=replaceContourRing(polygon,0,1,firstPoints)!;assert.equal(next.type,"Polygon");assert.equal(next.coordinates.length,3);
    assert.equal(validateParsedPolygonsForImport([{id:"edit",name:"Edited",geometry:second,area_ha:null}]).ok,true);
  });
  await check("invalid ring indices, coordinates and vertex limits cannot construct a draft",()=>{
    const points:GeoJsonPosition[]=[[69,54],[69.01,54],[69.01,54.01]];
    for(const [part,ring] of [[-1,0],[3,0],[0,-1],[0,3],[0.5,0],[0,0.5]])assert.equal(replaceContourRing(full,part,ring,points),null);
    for(const invalid of [points.slice(0,2),[[NaN,54],[69,54],[69,55]],[[181,54],[69,54],[69,55]],[[69,91],[69,54],[69,55]],Array.from({length:1000},()=>[69,54])])assert.equal(replaceContourRing(full,0,0,invalid as GeoJsonPosition[]),null);
    assert.equal(replaceContourRing(null,0,0,points)?.type,"Polygon");assert.equal(replaceContourRing(null,0,1,points),null);
  });
  const page=read("components/fields-map/fields-map-page.tsx");
  await check("UI keeps working geometry across ring selection and original geometry for cancellation",()=>{
    assert.ok(page.includes("workingGeometry: boundaryDraftGeometry"));assert.ok(page.includes("originalGeometry: geometry"));
    assert.ok(page.includes("contourRings(boundaryDraftGeometry).find"));assert.ok(page.includes("replaceContourRing(boundaryEdit.workingGeometry"));
    assert.ok(!page.includes("boundaryRequiresKmlReplacement"));
  });
  console.log(JSON.stringify({suite:"fields-map contours v3 actual handlers and editor",passed,failed:failures.length,failures,
    scope:"Actual confirm/mutation handlers, server flag/role/error mapping, access policy and geometry validation. Session retrieval and Supabase transport are mocked. No remote calls."},null,2));
  if(failures.length)process.exitCode=1;
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
