import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Actual GET handler and actual profile ACL; session/database transports are mocked.
class AuthError extends Error { constructor(message:string,public status:number){super(message);} }
function harness(role:string,status='active',home='home',target='selected',invalid=false,count=2,fail=false){
  const actor={id:'admin',role,companyId:home}; let lists=0; let pages=0;
  const rows=Array.from({length:count},(_,i)=>({id:`user-${i}`,company_id:target,role:'mechanic_operator'}));
  const db={from:(table:string)=>{
    assert.equal(table,'profiles');let selection='';let filters:Record<string,unknown>={};let range=[0,499];
    const q:any={select:(s:string)=>{selection=s;return q;},eq:(k:string,v:unknown)=>{filters[k]=v;return q;},order:()=>q,range:(a:number,b:number)=>{range=[a,b];return q;},
      maybeSingle:async()=>({data:{id:'admin',role,status,company_id:home},error:null}),
      then:(yes:any,no:any)=>{lists++;pages++;assert.equal(filters.company_id,target);assert.ok(!selection.includes('*'));return Promise.resolve({data:fail?null:rows.slice(range[0],range[1]+1),error:fail?new Error('private internal detail'):null}).then(yes,no);}};
    return q;
  }};
  const cache=new Map<string,any>();
  function load(name:string):any{
    const file=resolve(process.cwd(),name);if(cache.has(file))return cache.get(file).exports;
    const mod={exports:{} as any};cache.set(file,mod);
    const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const req=(id:string):any=>{
      if(id==='next/server')return{NextResponse:{json:(body:unknown,init:any={})=>({body,status:init.status||200,headers:init.headers})}};
      if(id==='@/lib/supabase/service')return{getServiceClient:()=>db};
      if(id==='@/lib/auth/server-session')return{SessionAuthError:AuthError,getServerActorFromSession:async(_:unknown,options:any)=>{assert.equal(options.ignoreImpersonation,true);assert.equal(options.skipCache,true);if(invalid)throw new AuthError('missing',401);return actor;},resolveCompanyForActor:(_:unknown,company:string)=>company};
      if(id.startsWith('@/'))return load(id.slice(2)+'.ts');
      throw new Error('Unexpected dependency '+id);
    };
    vm.runInNewContext('(function(require,module,exports,process){'+code+'\n})',{},{filename:file})(req,mod,mod.exports,process);return mod.exports;
  }
  return{run:()=>load('app/api/users/route.ts').GET({nextUrl:new URL('https://example.test/api/users?company_id='+target)}),counts:()=>({lists,pages})};
}
async function main(){let checks=0;
  for(const [role,home,target,expected] of [
    ['global_admin','home','selected',200],['company_admin','selected','selected',200],
    ['company_admin','home','selected',403],['mechanic_operator','selected','selected',403],
    ['vegetable_brigadier','selected','selected',403],['agronomist','selected','selected',403],
  ]){const h=harness(role,'active',home,target);const r=await h.run();assert.equal(r.status,expected);if(expected===403)assert.equal(h.counts().lists,0);else assert.equal(r.body.profiles.length,2);checks++;}
  for(const status of ['inactive','revoked']){const h=harness('global_admin',status);assert.equal((await h.run()).status,403);assert.equal(h.counts().lists,0);checks++;}
  assert.equal((await harness('global_admin','active','home','selected',true).run()).status,401);checks++;
  const h=harness('global_admin','active','home','selected',false,1001);const r=await h.run();assert.equal(r.body.profiles.length,1001);assert.equal(h.counts().pages,3);assert.match(r.headers['Cache-Control'],/no-store/);checks++;
  const failed=await harness('global_admin','active','home','selected',false,2,true).run();assert.equal(failed.status,500);assert.ok(!JSON.stringify(failed.body).includes('private internal'));checks++;
  console.log(`PTC admin account list PASS: ${checks} actual route/ACL cases; no remote writes.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
