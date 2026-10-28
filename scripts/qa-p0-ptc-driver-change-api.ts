// Real Next route handlers + real assignment validation; synthetic read-only DB.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const company=uid(1), vehicle=uid(2), oldDriver=uid(3), newDriver=uid(4), specialist=uid(5), event=uid(6);
let tables: Record<string, any[]>;
const db = {from(table:string) {
  let single=false, limit=Infinity;
  const filters: Array<(row:any)=>boolean> = [];
  const orders: Array<{key:string;ascending:boolean}> = [];
  const q:any = new Proxy({}, {get:(_target,key) => {
    if (key==="then") return (done:any) => {
      let rows=(tables[table] || []).filter(row=>filters.every(f=>f(row)));
      rows=[...rows].sort((a,b)=>{for(const o of orders){const v=String(a[o.key]).localeCompare(String(b[o.key]));if(v)return o.ascending?v:-v;}return 0;}).slice(0,limit);
      return Promise.resolve({data:single?(rows[0]||null):rows,error:null}).then(done);
    };
    return (...args:any[]) => {
      if(key==="eq") filters.push(row=>row[args[0]]===args[1]);
      else if(key==="neq") filters.push(row=>row[args[0]]!==args[1]);
      else if(key==="in") filters.push(row=>args[1].includes(row[args[0]]));
      else if(key==="maybeSingle") single=true;
      else if(key==="limit") limit=args[0];
      else if(key==="order") orders.push({key:args[0],ascending:args[1].ascending});
      else assert.equal(key,"select",`Unexpected/write DB method ${table}.${String(key)}`);
      return q;
    };
  }});
  return q;
}};
const reset = () => {
  tables={
    ptc_vehicle_states:[{company_id:company,vehicle_id:vehicle,assigned:true,state:"loaded",cycle:111,since:"2026-09-22T12:42:00Z"}],
    ptc_events:[
      {id:event,company_id:company,vehicle_id:vehicle,driver_id:oldDriver,to_state:"loaded",cycle:111,created_at:"2026-09-22T12:42:00Z"},
      {id:uid(7),company_id:company,vehicle_id:vehicle,driver_id:oldDriver,to_state:"loaded",cycle:111,created_at:"2026-09-22T11:44:00Z"},
    ],
    reference_vehicles:[{id:vehicle,company_id:company,type:"truck",primary_responsible_personnel_id:specialist,plate_number:"244 AP15"}],
    reference_specialists:[{id:specialist,company_id:company,personnel_type:"driver",status:"active",archived:false,
      person:{id:newDriver,company_id:company,full_name:"Новый водитель",status:"active",deleted_at:null,role_type:"driver"}}],
    company_people:[{id:oldDriver,company_id:company,full_name:"Прежний водитель"}],
  };
};
(globalThis as any).__ptcTestBoundary = (name:string) => ({
  WEIGHBRIDGE_READ_ROLES:["weighman"],WEIGHBRIDGE_WRITE_ROLES:["weighman"],WEIGHBRIDGE_TICKET_READ_ROLES:["weighman"],
  resolveWeighbridgeSession:async()=>({companyId:company,actor:{id:uid(8)},supabase:db}),
  asSessionErrorResponse:()=>null,
  getServiceClient:()=>db,
  validateActiveCombineOperator:async()=>({ok:true,person:{name:"Комбайнёр"}}),
  resolveHarvestTicketContext:async()=>({status:"ready"}),
  sanitizeClientTicketAuditJson:()=>({}),
}[name] ?? (()=>{throw Error(`Unexpected boundary ${name}`)}));
async function route(path:string) {
  const source=readFileSync(path,"utf8"), imports=new Map<string,string[]>();
  for(const m of Array.from(source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["'](@\/[^"']+)["']/g))) {
    if (["weight-input","ptc-driver-trip","ptc-current-driver","transport"].some(s=>m[2]===`@/lib/weighbridge/${s}`)) continue;
    imports.set(m[2],m[1].split(",").map(n=>n.trim()).filter(n=>n&&!n.startsWith("type ")));
  }
  const result=await build({entryPoints:[path],bundle:true,write:false,format:"cjs",platform:"node",packages:"external",
    plugins:[{name:"ptc-isolation",setup(builder){
      builder.onResolve({filter:/^@\//},args=>imports.has(args.path)?{path:args.path,namespace:"ptc-mock"}:undefined);
      builder.onLoad({filter:/.*/,namespace:"ptc-mock"},args=>({loader:"js",contents:imports.get(args.path)!.map(name=>
        `export const ${name}=globalThis.__ptcTestBoundary(${JSON.stringify(name)});`).join("\n")}));
    }}]});
  const compiled=new Module(resolve(path)+".qa.cjs",module);
  compiled.filename=resolve(path)+".qa.cjs"; compiled.paths=module.paths;
  (compiled as any)._compile(result.outputFiles[0].text,compiled.filename);
  return compiled.exports;
}
async function main(){
  const tickets=await route("app/api/weighbridge/tickets/route.ts"), queue=await route("app/api/weighbridge/ptc-queue/route.ts");
  const post=async(driver=newDriver,cycle=111) => {
    const res=await tickets.POST({headers:new Headers(),json:async()=>({ticket:{
      ticket_type:"weight",op_type:"harvest_incoming",direction:"incoming",
      source_kind:"field",destination_kind:"warehouse",field_id:uid(9),crop_structure_allocation_id:uid(10),
      combine_operator_person_id:uid(11),vehicle_id:vehicle,driver_id:driver,ptc_event_id:event,ptc_cycle:cycle,
    },lines:[]})});
    return {status:res.status,body:await res.json()};
  };
  let passed=0;
  const check=async(name:string,run:()=>Promise<void>)=>{reset();await run();console.log(`PASS ${++passed} ${name}`);};
  const accepted=async(driver=newDriver)=> {
    const res=await post(driver);
    // Deliberately stop after the real trip checks, before any business writes.
    assert.equal(res.status,400);
    assert.equal(res.body.error,"Приход урожая должен содержать одну складскую номенклатуру.");
  };
  await check("new current driver passes actual ticket PTC guard",()=>accepted());
  await check("unchanged historical driver remains compatible",()=>accepted(oldDriver));
  await check("unassigned driver is rejected",async()=>assert.equal((await post(uid(99))).status,409));
  await check("archived assignment is rejected",async()=>{tables.reference_specialists[0].archived=true;assert.equal((await post()).status,409);});
  await check("foreign company assignment is rejected",async()=>{tables.reference_specialists[0].company_id=uid(99);assert.equal((await post()).status,409);});
  await check("inactive person is rejected",async()=>{tables.reference_specialists[0].person.status="pending";assert.equal((await post()).status,409);});
  await check("wrong role is rejected",async()=>{tables.reference_specialists[0].person.role_type="director";assert.equal((await post()).status,409);});
  await check("truck cannot use tractor-only operator role",async()=>{tables.reference_specialists[0].personnel_type="machine_operator";tables.reference_specialists[0].person.role_type="mechanic_operator";assert.equal((await post()).status,409);});
  await check("driver change never bypasses current cycle/state",async()=>{assert.equal((await post(newDriver,110)).status,409);tables.ptc_vehicle_states[0].state="unloading";assert.equal((await post()).status,409);});
  await check("already ticketed trip is rejected",async()=>{tables.tickets=[{id:uid(20),company_id:company,ptc_event_id:event,is_voided:false,ticket_no:"WB-EXISTING"}];assert.equal((await post()).status,409);});
  await check("queue uses latest load event and current driver without rewriting history",async()=>{
    const before=JSON.stringify(tables.ptc_events);
    const res=await queue.GET({}); assert.equal(res.status,200);
    const body=await res.json();assert.equal(body.queue.length,1);
    assert.equal(body.queue[0].ptcEventId,event); assert.equal(body.queue[0].driverId,newDriver);
    assert.equal(body.queue[0].driverName,"Новый водитель");
    assert.equal(JSON.stringify(tables.ptc_events),before);
  });
  await check("queue does not suggest inactive assignment",async()=>{
    tables.reference_specialists[0].archived=true;
    const body=await (await queue.GET({})).json(); assert.equal(body.queue[0].driverId,oldDriver);
  });
  console.log(JSON.stringify({suite:"P0 driver change real HTTP guards and queue",passed,failed:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
