import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as eligibility from "../lib/traffic/vehicle-eligibility";
const requireLocal = createRequire(import.meta.url);
const id = (n:number) => `10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
class AuthError extends Error { constructor(message:string, public status:number){super(message)} }
const contexts:any[]=[], rpc:any[]=[];
let allowed=true, sameOrigin=true, databaseError:string|null=null;
const loaded={exports:{} as any};
vm.runInNewContext(ts.transpileModule(readFileSync("app/api/vehicles/replace-for-driver/route.ts","utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{module:loaded,exports:loaded.exports,Error,SyntaxError,Map,Set,URLSearchParams,process,
  require:(name:string)=>({
    "@/lib/auth/server-session":{SessionAuthError:AuthError},
    "@/lib/traffic/vehicle-eligibility":eligibility,
    "@/lib/vehicles/driver-assignment-server":{
      assignmentSameOrigin:()=>{if(!sameOrigin)throw new AuthError("Cross origin",403)},
      assignmentResponse:(data:any,status=200)=>({data,status}),
      assignmentContext:async (_request:any,company:string,write:boolean)=>{
        contexts.push({company,write}); if(!allowed)throw new AuthError("Unauthorized",403);
        return {companyId:id(1),actorId:id(8),canEdit:true,db:{rpc:async(name:string,args:any)=>{
          rpc.push({name,args});return databaseError?{error:{message:databaseError,code:"P0001"}}:{data:{companyId:id(1),vehicleId:id(3)}};
        }}};
      },
    },
  } as Record<string,unknown>)[name]??requireLocal(name),
});
const command={companyId:id(1),driverId:id(4),sourceVehicleId:id(2),vehicleId:id(3),sourceVersion:3,targetVersion:0,
  sourceAssignmentId:id(5),targetAssignmentId:null,key:id(6)};
const request=(body:any)=>({json:async()=>body});
async function main(){
  let count=0;
  const check=(a:unknown,b:unknown)=>{assert.deepEqual(a,b);count++};
  check((await loaded.exports.POST(request(command))).status,200);
  check(contexts[0].write,true); check(contexts[0].company,id(1));
  check(rpc[0].args.p_actor,id(8)); check(rpc[0].args.p_company,id(1));
  check(rpc[0].args.p_source,id(2)); check(rpc[0].args.p_target,id(3)); check(rpc[0].args.p_key,id(6));
  for(const patch of [{sourceVersion:-1},{sourceVersion:1.5},{key:"no"},{vehicleId:""},{actorId:id(9)}]){
    check((await loaded.exports.POST(request({...command,...patch}))).status,400);
  }
  check(rpc.length,1);
  allowed=false;check((await loaded.exports.POST(request(command))).status,403);check(rpc.length,1);allowed=true;
  sameOrigin=false;check((await loaded.exports.POST(request(command))).status,403);check(rpc.length,1);sameOrigin=true;
  for(const code of ["PTC_REPLACE_TARGET_BUSY","PTC_REPLACE_CONFLICT","PTC_REPLACE_DRIVER_CHANGED","PTC_REPLACE_TICKET_CONFLICT","PTC_KEY_CONFLICT"]){
    databaseError=code;const result=await loaded.exports.POST(request(command));
    check(result.status,409);check(result.data.error.includes(code),false);
  }
  databaseError="secret postgres detail";const failed=await loaded.exports.POST(request(command));
  check(failed.status,500);check(failed.data.error.includes("secret"),false);
  console.log(`Driver vehicle replacement API: ${count} PASS`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
