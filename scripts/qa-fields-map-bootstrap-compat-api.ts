import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import * as accessPolicy from "../lib/fields-map/access-policy";
import { getFieldDisplayName } from "../lib/fields/display";
import { brandName, localizedName } from "../lib/i18n/helpers";

type Row=Record<string,any>;
const root=process.cwd();
const read=(file:string)=>readFileSync(path.join(root,file),"utf8");
const ids={company:"10000000-0000-4000-8000-000000000001",actor:"20000000-0000-4000-8000-000000000001",
  fieldA:"30000000-0000-4000-8000-000000000001",fieldB:"30000000-0000-4000-8000-000000000002",
  geometry:"50000000-0000-4000-8000-000000000001",unlinked:"50000000-0000-4000-8000-000000000002",deleted:"50000000-0000-4000-8000-000000000003",
  season2026:"60000000-0000-4000-8000-000000000001",season2025:"60000000-0000-4000-8000-000000000002"};
const polygon={type:"Polygon",coordinates:[[[69,54],[69.01,54],[69.01,54.01],[69,54.01],[69,54]]]};
const multi={type:"MultiPolygon",coordinates:[[polygon.coordinates[0]],[[[70,54],[70.01,54],[70.01,54.01],[70,54]]]]};
const fields=[{id:ids.fieldA,name:"Поле А",area:10,notes:null},{id:ids.fieldB,name:"Поле Б",area:20,notes:null}];
const legacy=[{id:ids.geometry,field_id:ids.fieldA,import_id:"40000000-0000-4000-8000-000000000001",source_file_name:"legacy.kml",geometry_geojson:polygon,area_from_kml_ha:9.5}];
const v3=[
  {...legacy[0],contour_id:ids.geometry,contour_version:2,is_active:true,display_name:"Новое имя А",source_polygon_id:"source-A",source_polygon_name:"Исходное А",source_file_name:"source.kml",source_import_id:"40000000-0000-4000-8000-000000000001",deleted_at:null},
  {id:ids.unlinked,contour_id:ids.unlinked,contour_version:1,field_id:null,is_active:true,display_name:"Неизвестный контур",geometry_geojson:multi,area_from_kml_ha:15,source_polygon_id:"source-U",source_polygon_name:"Исходное U",deleted_at:null},
  {id:ids.deleted,contour_id:ids.deleted,contour_version:3,field_id:ids.fieldB,is_active:false,display_name:"Удалённый Б",geometry_geojson:polygon,area_from_kml_ha:19,source_polygon_id:"source-B",deleted_at:"2026-09-10T00:00:00Z"},
];
const missingFunction={code:"PGRST202",message:"Could not find the function public.get_field_map_contours_v3(p_company_id) in the schema cache"};
class MockAuthError extends Error{status:number;constructor(message:string,status=401){super(message);this.status=status;}}

function harness(options:Row={}){
  const tables:Array<{table:string;select:string;filters:Array<[string,unknown]>}>=[];
  const rpc:Array<{name:string;args:Row}>=[];
  const actor={id:ids.actor,role:options.role??"agronomist",roleRawKey:options.role??"agronomist",roleIsLegacyAlias:false};
  const records:Record<string,any>={
    companies:{id:ids.company,name:"Local QA"},fields,
    seasons:options.seasons??[{id:ids.season2025,year:2025,name:"2025"},{id:ids.season2026,year:2026,name:"2026"}],
    field_geometries:options.legacyRows??legacy,
    crop_structure:[{id:"crop-row",field_id:ids.fieldA,area:10,crop_id:"crop-potato",variety_id:"variety",reproduction_id:"repro",
      crops:{name:"Картофель",name_ru:"Картофель"},varieties:{name:"Гала"},seed_reproductions:{name:"Вторая репродукция"}}],
    operations:[{id:"operation",field_id:ids.fieldA,crop_structure_id:"crop-row",operation_type:"harvest",date:"2026-09-09",status:"draft",work_status:"in_progress",created_at:"2026-09-09"}],
    field_material_consumptions:[{id:"material",field_id:ids.fieldA,crop_structure_row_id:"crop-row",operation_type:"fertilize",material_category:"fertilizer",quantity_kg:12.5,area_ha:5,consumed_at:"2026-09-09",products:{name_ru:"Удобрение"}}],
    tickets:[{id:"ticket",ticket_no:"LOCAL-1",field_id:ids.fieldA,status:"closed",op_type:"harvest_incoming",net_weight_kg:9980,finalized_at:"2026-09-09",created_at:"2026-09-09",is_voided:false,
      ticket_lines:[{id:"line",product_name_snapshot:"Картофель",quantity:9.98,uom:"т"}]}],
    field_engineering_objects:[],profiles:[],
  };
  const supabase={from(table:string){
    if(!(table in records))throw new Error(`Unexpected table ${table}`);
    const call={table,select:"",filters:[] as Array<[string,unknown]>};tables.push(call);
    const response=()=>({data:records[table],error:table==="field_geometries"?options.legacyError??null:options.tableErrors?.[table]??null});
    const chain:any={select(selection:string){call.select=selection;return chain;},eq(key:string,value:unknown){call.filters.push([key,value]);return chain;},
      is(key:string,value:unknown){call.filters.push([key,value]);return chain;},in(key:string,value:unknown){call.filters.push([key,value]);return chain;},
      gte(key:string,value:unknown){call.filters.push([`gte:${key}`,value]);return chain;},lte(key:string,value:unknown){call.filters.push([`lte:${key}`,value]);return chain;},
      order(){return chain;},limit(){return chain;},maybeSingle(){return Promise.resolve(response());},
      then(resolveValue:any,rejectValue:any){return Promise.resolve(response()).then(resolveValue,rejectValue);}};
    return chain;
  },async rpc(name:string,args:Row){rpc.push({name,args});if(options.rpcThrows)throw new Error(options.rpcThrows);return{data:options.v3Rows??v3,error:options.rpcError??null};}};
  const auth={SessionAuthError:MockAuthError,getServerActorFromSession:async()=>{if(options.authError)throw new MockAuthError("Session expired",401);return actor;},resolveCompanyForActor:()=>ids.company};
  const dependencies:Record<string,unknown>={"next/server":{NextRequest,NextResponse},"@/lib/auth/server-session":auth,"@/lib/supabase/service":{getServiceClient:()=>supabase},
    "@/lib/fields-map/access-policy":accessPolicy,"@/lib/fields/display":{getFieldDisplayName},"@/lib/i18n/helpers":{brandName,localizedName},
    "@/lib/fields-map/engineering-objects":{mapEngineeringObjectRow:(row:Row)=>row},
    "@/lib/travkinflow-2/release":{TRAVKINFLOW_2_FUNCTIONS_RELEASED:options.released??true}};
  const cache=new Map<string,Row>();
  function load(file:string):Row{
    if(cache.has(file))return cache.get(file)!;
    const output=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const loaded={exports:{} as Row};cache.set(file,loaded.exports);
    vm.runInNewContext(output,{module:loaded,exports:loaded.exports,Error,TypeError,SyntaxError,process:{env:{}},require:(name:string)=>{
      if(Object.prototype.hasOwnProperty.call(dependencies,name))return dependencies[name];
      if(name.startsWith("@/lib/fields-map/"))return load(`${name.slice(2)}.ts`);
      if(name.startsWith(".")){
        const resolved=path.relative(root,path.resolve(root,path.dirname(file),name)).replace(/\\/gu,"/");
        if(resolved.startsWith("lib/fields-map/")&&existsSync(path.join(root,`${resolved}.ts`)))return load(`${resolved}.ts`);
      }
      throw new Error(`Unexpected dependency ${name}; auth clients/network dependencies are prohibited in this harness`);
    }});
    return loaded.exports;
  }
  const handler=load("app/api/fields-map/bootstrap/route.ts").GET;
  return{tables,rpc,get:async(queryString="")=>{const response=await handler(new NextRequest(`http://local.test/api/fields-map/bootstrap${queryString}`));return{status:response.status,body:await response.json()};}};
}

let passed=0;const failures:string[]=[];
async function check(name:string,run:()=>void|Promise<void>){try{await run();passed+=1;console.log(`PASS ${name}`);}catch(error){const message=`${name}: ${error instanceof Error?error.message:String(error)}`;failures.push(message);console.error(`FAIL ${message}`);}}
const same=(actual:unknown,expected:unknown)=>assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)));
function fieldCardAssertions(body:Row){
  assert.equal(body.fields.length,2);const field=body.fields.find((item:Row)=>item.field_id===ids.fieldA);assert.ok(field);
  assert.equal(field.geometry_id,ids.geometry);same(field.geometry,polygon);assert.equal(field.geometry_area_ha,9.5);assert.equal(field.field_area_ha,10);
  assert.equal(field.crop_plan.crop_name,"Картофель");assert.equal(field.crop_plan.variety_name,"Гала");assert.equal(field.crop_structure.length,1);
  assert.equal(field.recent_operations[0].id,"operation");assert.equal(field.work_status,"in_progress");
  assert.equal(field.material_summary[0].quantity_kg,12.5);assert.equal(field.harvest_summary[0].net_weight_kg,9980);assert.equal(field.harvest_summary[0].quantity,9.98);
  assert.equal(body.fields.find((item:Row)=>item.field_id===ids.fieldB).geometry,null);
}

async function main(){
  await check("v3 success preserves independent contours, tombstones and complete business cards",async()=>{
    for(const released of [false,true]){const app=harness({released});const response=await app.get();assert.equal(response.status,200);
      assert.equal(response.body.contour_editing_available,true);fieldCardAssertions(response.body);assert.equal(response.body.contours.length,3);
      const unlinked=response.body.contours.find((item:Row)=>item.contour_id===ids.unlinked);assert.equal(unlinked.field_id,null);same(unlinked.geometry,multi);
      assert.ok(response.body.contours.find((item:Row)=>item.contour_id===ids.deleted).deleted_at);
      assert.equal(app.tables.filter(item=>item.table==="field_geometries").length,0);assert.equal(app.rpc.length,1);assert.equal(app.rpc[0].name,"get_field_map_contours_v3");
    }
  });
  await check("exact missing v3 RPC codes fall back read-only before and after functional release",async()=>{
    for(const released of [false,true]){for(const rpcError of [missingFunction,{code:"42883",message:"function public.get_field_map_contours_v3(uuid) does not exist"}]){
      const app=harness({released,rpcError});const response=await app.get();assert.equal(response.status,200);assert.equal(response.body.contour_editing_available,false);
      fieldCardAssertions(response.body);assert.equal(response.body.contours.length,1);same(response.body.contours[0].geometry,polygon);assert.equal(response.body.contours[0].field_id,ids.fieldA);
      assert.equal(response.body.contours[0].contour_id,ids.geometry);assert.equal(response.body.contours[0].contour_version,1);
      assert.equal(response.body.contours[0].display_name,getFieldDisplayName(fields[0]));assert.equal(response.body.contours[0].source_import_id,legacy[0].import_id);
      assert.equal(response.body.contours[0].source_polygon_id,null);assert.equal(response.body.contours[0].source_polygon_name,null);
      const reads=app.tables.filter(item=>item.table==="field_geometries");assert.equal(reads.length,1);assert.ok(reads[0].filters.some(([key,value])=>key==="is_active"&&value===true));
      assert.ok(reads[0].filters.some(([key,value])=>key==="company_id"&&value===ids.company));
      assert.ok(!/contour_id|contour_version|source_polygon|source_import_id|display_name|deleted_at/u.test(reads[0].select),"legacy projection may not ask for new columns");
    }}
  });
  await check("only exact missing v3 column names qualify for schema-compatible fallback",async()=>{
    for(const column of ["contour_id","contour_version","source_polygon_id","source_polygon_name","source_geometry_geojson","source_import_id","display_name","deleted_at"]){
      const app=harness({rpcError:{code:"42703",message:`column g.${column} does not exist`}});const response=await app.get();assert.equal(response.status,200,column);
      assert.equal(response.body.contour_editing_available,false);fieldCardAssertions(response.body);
    }
  });
  await check("permission, network, arbitrary RPC and unrelated missing schema errors never silently downgrade",async()=>{
    const errors=[{code:"42501",message:"permission denied for function get_field_map_contours_v3"},
      {code:"PGRST301",message:"JWT expired"},{code:"XX000",message:"get_field_map_contours_v3 internal failure"},
      {code:"PGRST202",message:"Could not find the function public.unrelated_rpc() in the schema cache"},
      {code:"42883",message:"function public.unrelated_rpc() does not exist"},
      {code:"42703",message:"column g.field_id does not exist"},{code:"42703",message:"column g.unrelated_column does not exist"},
      {code:"42P01",message:"relation public.field_geometries does not exist"},
      {code:"42501",message:"column g.contour_id does not exist"},
      {message:"function public.get_field_map_contours_v3(uuid) does not exist"},
      {code:"PGRST202",message:"Could not find the function public.get_field_map_contours_v30() in the schema cache"}];
    for(const rpcError of errors){const app=harness({rpcError});const response=await app.get();assert.notEqual(response.status,200,JSON.stringify(rpcError));assert.equal(app.tables.filter(item=>item.table==="field_geometries").length,0,JSON.stringify(rpcError));}
    const app=harness({rpcThrows:"fetch failed"});assert.notEqual((await app.get()).status,200);assert.equal(app.tables.filter(item=>item.table==="field_geometries").length,0);
  });
  await check("legacy fallback failure remains an error and is not retried or hidden",async()=>{
    for(const legacyError of [{code:"42501",message:"permission denied for table field_geometries"},{code:"42703",message:"column field_geometries.field_id does not exist"}]){
      const app=harness({rpcError:missingFunction,legacyError});assert.notEqual((await app.get()).status,200);assert.equal(app.tables.filter(item=>item.table==="field_geometries").length,1);
    }
  });
  await check("session and read-role gates run before any database query",async()=>{
    for(const scenario of [{options:{authError:true},status:401},{options:{role:"weighman"},status:403},{options:{role:"fleet_manager"},status:403}]){
      const app=harness(scenario.options);assert.equal((await app.get()).status,scenario.status);assert.equal(app.tables.length,0);assert.equal(app.rpc.length,0);
    }
    for(const role of ["global_admin","company_admin","director","agronomist","legal_operator"]){const app=harness({role,rpcError:missingFunction});assert.equal((await app.get()).status,200,role);}
  });
  await check("legacy response preserves season selection and empty-season fields without new business rows",async()=>{
    const selected=harness({rpcError:missingFunction});assert.equal((await selected.get(`?seasonId=${ids.season2025}`)).body.selected_season_id,ids.season2025);
    const missing=harness({rpcError:missingFunction,seasons:[]});const response=await missing.get();assert.equal(response.status,200);assert.equal(response.body.selected_season_id,null);
    assert.equal(response.body.fields.length,2);same(response.body.fields[0].geometry,polygon);assert.equal(response.body.fields[0].crop_plan,null);
    assert.equal(missing.tables.some(item=>["operations","crop_structure","field_material_consumptions","tickets"].includes(item.table)),false);
    const empty=harness({rpcError:missingFunction,legacyRows:[]});const emptyResponse=await empty.get();assert.equal(emptyResponse.status,200);assert.equal(emptyResponse.body.contour_editing_available,false);
    assert.equal(emptyResponse.body.contours.length,0);assert.ok(emptyResponse.body.fields.every((field:Row)=>field.geometry===null));
  });
  await check("all successful legacy queries remain company-scoped and read-only",async()=>{
    const app=harness({rpcError:missingFunction});assert.equal((await app.get()).status,200);
    for(const call of app.tables){if(call.table==="companies")assert.ok(call.filters.some(([key,value])=>key==="id"&&value===ids.company));
      else assert.ok(call.filters.some(([key,value])=>key==="company_id"&&value===ids.company),call.table);}
    assert.ok(app.rpc.every(call=>call.name==="get_field_map_contours_v3"&&call.args.p_company_id===ids.company));
  });
  await check("client capability defaults off and enables new contour editing only with exact true",()=>{
    const page=read("components/fields-map/fields-map-page.tsx");
    const sourceFile=ts.createSourceFile("fields-map-page.tsx",page,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let expression="";
    const visit=(node:ts.Node)=>{
      if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==="canMutateBoundaries"&&node.initializer)expression=node.initializer.getText(sourceFile);
      ts.forEachChild(node,visit);
    };
    visit(sourceFile);assert.ok(expression,"client mutation capability expression must exist");
    assert.ok(/contour_editing_available\s*===\s*true/u.test(expression),"only exact true grants schema capability");
    for(const bootstrap of [null,undefined,{}, {contour_editing_available:false},{contour_editing_available:1},{contour_editing_available:"true"}]){
      assert.equal(vm.runInNewContext(expression,{FIELD_BOUNDARY_UI_ENABLED:true,profile:{role:"global_admin"},bootstrap}),false);
    }
    assert.equal(vm.runInNewContext(expression,{FIELD_BOUNDARY_UI_ENABLED:true,profile:{role:"global_admin"},bootstrap:{contour_editing_available:true}}),true);
    assert.equal(vm.runInNewContext(expression,{FIELD_BOUNDARY_UI_ENABLED:false,profile:{role:"global_admin"},bootstrap:{contour_editing_available:true}}),false);
    assert.equal(vm.runInNewContext(expression,{FIELD_BOUNDARY_UI_ENABLED:true,profile:{role:"agronomist"},bootstrap:{contour_editing_available:true}}),false);
  });
  console.log(JSON.stringify({suite:"fields-map bootstrap pre-v3 compatibility actual GET",passed,failed:failures.length,failures,
    scope:"Actual bootstrap GET, schema compatibility helper, server role/flag/error logic; session and database transport mocked. No remote calls, no auth actions."},null,2));
  if(failures.length)process.exitCode=1;
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
