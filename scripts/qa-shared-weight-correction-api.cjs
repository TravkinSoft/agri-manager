// Real correction POST + real weighbridge ACL, mocked transport only. No network/writes.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');

async function main() {
  const company='10000000-0000-4000-8000-000000000001', ticket='20000000-0000-4000-8000-000000000001';
  const state={role:'weighman',status:'active',unauthorized:false,pin:true,missing:false,shared:true,rpcError:null,activityFails:false};
  const calls=[];
  const db={from(table){ const filters=[];
    const q={select(){return q},eq(k,v){filters.push([k,v]);return q},maybeSingle(){return q},then(resolve,reject){
      let data=table==='profiles'?{id:'actor',company_id:company,role:state.role,status:state.status}:table==='companies'?{id:company}:
        table==='tickets'&&!state.missing?{id:ticket,company_id:company,correction_of_ticket_id:null}:null;
      if(table==='tickets')assert(filters.some(([k,v])=>k==='company_id'&&v===company));
      return Promise.resolve({data,error:null}).then(resolve,reject);
    }};return q;
  },async rpc(name,args){calls.push({name,args});
    if(name==='weighbridge_operator_session_state_v1')return{data:state.pin?{unlocked:true,operator:{id:'person'},shift:{id:'shift'}}:{unlocked:false}};
    if(name==='touch_weighbridge_operator_activity_v1')return state.activityFails?{error:{message:'fixture activity failure'}}:{data:{ok:true}};
    assert.equal(name,'correct_shared_impurity_ticket_weights_v1');
    return state.rpcError?{error:state.rpcError}:{data:{ok:true,ticket_id:ticket,revision_id:args.p_idempotency_key}};
  }};
  const stubs={
    'next/server':`export const NextResponse={json:(data,o={})=>({data,status:o.status||200})};`,
    'server-only':'',
    '@/lib/auth/server-session':`export class SessionAuthError extends Error{constructor(m,status=403){super(m);this.status=status}}
      export async function getServerActorFromSession(){if(globalThis.qa.unauthorized)throw new SessionAuthError('No session',401);return{id:'actor',companyId:'${company}',role:globalThis.qa.role}}
      export const getUserScopedClientFromRequest=async()=>globalThis.db;
      export function resolveCompanyForActor(a,c){if(c&&c!==a.companyId)throw new SessionAuthError('foreign company',403);return c||a.companyId}`,
    '@/lib/supabase/service':`export const getServiceClient=()=>{throw Error('Unexpected privileged client')};`,
    '@/lib/server/weighbridge-shared-impurity':`export const loadSharedImpurityTicketIds=async(_d,c,ids)=>new Set(globalThis.qa.shared?ids.filter(Boolean):[]);`,
  };
  const built=await esbuild.build({entryPoints:['app/api/weighbridge/tickets/[id]/correction/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,
    plugins:[{name:'qa-transport',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'qa'}:undefined);b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:stubs[a.path],loader:'js'}));}}]});
  const context={module:{exports:{}},exports:{},require,console:{...console,error(){}},Date,URL,Buffer,process,qa:state,db};context.exports=context.module.exports;
  vm.runInNewContext(built.outputFiles[0].text,context);
  const body={action:'shared_weights',reason:'Исправление брутто',companyId:company,gross_weight_kg:13000,tare_weight_kg:7400,
    expected_gross_weight_kg:12866,expected_tare_weight_kg:7400,idempotency_key:'30000000-0000-4000-8000-000000000001'};
  const post=patch=>context.module.exports.POST({method:'POST',nextUrl:new URL('http://localhost/api/correction'),cookies:{get:()=>({value:'qa-pin-token'})},json:async()=>({...body,...patch})},{params:Promise.resolve({id:ticket})});
  let checks=0; const test=async(name,fn)=>{calls.length=0;await fn();console.log('PASS '+(++checks)+' '+name)};
  const noWrite=()=>assert(!calls.some(c=>c.name==='correct_shared_impurity_ticket_weights_v1'));
  for(const role of ['weighman','company_admin','global_admin'])await test(role+' sends exact expected/new weights and key via scoped RPC',async()=>{
    state.role=role;const r=await post();assert.equal(r.status,200);assert.equal(r.data.ticket.id,ticket);
    const c=calls.find(c=>c.name==='correct_shared_impurity_ticket_weights_v1');assert.equal(c.args.p_session_token,'qa-pin-token');
    assert.equal(c.args.p_expected_gross_weight_kg,12866);assert.equal(c.args.p_gross_weight_kg,13000);assert.equal(c.args.p_idempotency_key,body.idempotency_key);
  });
  await test('anonymous, wrong role, inactive actor and foreign company cannot write',async()=>{
    state.unauthorized=true;assert.equal((await post()).status,401);state.unauthorized=false;
    state.role='agronomist';assert.equal((await post()).status,403);state.role='weighman';
    state.status='pending';assert.equal((await post()).status,403);state.status='active';
    assert.equal((await post({companyId:'foreign'})).status,403);noWrite();
  });
  await test('all roles require live PIN, including admin',async()=>{
    state.pin=false;for(const role of ['weighman','global_admin']){state.role=role;assert.equal((await post()).status,423)}state.pin=true;state.role='weighman';noWrite();
  });
  await test('invalid weights, missing reason or key rejected before RPC',async()=>{
    for(const patch of [{gross_weight_kg:'13000'},{gross_weight_kg:Infinity},{tare_weight_kg:-1},{gross_weight_kg:7400},
      {expected_gross_weight_kg:null},{idempotency_key:''},{reason:''},{reason:'x'.repeat(2001)}])assert.equal((await post(patch)).status,400);noWrite();
  });
  await test('foreign/missing ticket and ordinary ticket cannot enter shared path',async()=>{
    state.missing=true;assert.equal((await post()).status,404);state.missing=false;state.shared=false;assert.equal((await post()).status,400);state.shared=true;noWrite();
  });
  await test('old generic shared-copy path stays forbidden',async()=>{const r=await post({action:'start'});assert.equal(r.status,409);assert.match(r.data.error,/Аннулировать талон не требуется/);noWrite()});
  await test('conflicts and closed report have actionable messages',async()=>{
    for(const message of ['SHARED_WEIGHT_CONFLICT','SHARED_WEIGHT_ACCOUNTING_SHIFT_CLOSED','SHARED_WEIGHT_STOCK_COMMITTED']){
      state.rpcError={message,code:'23514'};const r=await post();assert.equal(r.status,409);assert.equal(r.data.code,message);
    }state.rpcError=null;
  });
  await test('activity failure cannot hide successfully committed correction',async()=>{state.activityFails=true;assert.equal((await post()).status,200);state.activityFails=false});
  console.log('Shared weight correction API PASS: '+checks+' checks');
}
main().catch(e=>{console.error(e);process.exitCode=1});
