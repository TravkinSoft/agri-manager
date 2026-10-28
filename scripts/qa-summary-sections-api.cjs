// Execute the real GET handler and real assertActorAccess with an in-memory DB.
// Authentication transport is stubbed; JWT validation is not claimed by this QA.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');
async function main() {
  const fixtures = {
    companies: [{id:'A',operational_day_start_hour:7}],
    profiles: [{id:'actor',company_id:'A',role:'agronomist',status:'active'}],
    ptc_combine_shifts: [{id:'shift',company_id:'A',operator_user_id:'operator',operator_name:'Test',opened_at:'2026-09-21T02:14:00Z',closed_at:'2026-09-21T15:00:00Z',current_crop_structure_id:'plot',hectares_shift:5.87}],
    ptc_combine_field_segments: [{id:'segment',company_id:'A',shift_id:'shift',crop_structure_id:'plot',field_id:'field',planned_area_ha:24,hectares_segment:5.87,ended_field_total_ha:5.87,closed_at:'2026-09-21T15:00:00Z'}],
    crop_structure: [{id:'plot',company_id:'A',field_id:'field',area:24,variety_id:null,reproduction_id:null}],
    ptc_field_progress: [{company_id:'A',crop_structure_id:'plot',actual_completed_ha:5.87,status:'active'}],
    fields: [{id:'field',company_id:'A',name:'Field'}], varieties:[],seed_reproductions:[],
  };
  const trace=[];
  const db={from(table){const filters=[],sorts=[];let first=0,last=Infinity,single=false;
    const query={select(){return query},eq(key,value){filters.push([key,'eq',value]);return query},is(key,value){filters.push([key,'eq',value]);return query},gte(key,value){filters.push([key,'gte',value]);return query},lte(key,value){filters.push([key,'lte',value]);return query},lt(key,value){filters.push([key,'lt',value]);return query},in(key,value){filters.push([key,'in',value]);return query},order(key,options){sorts.push([key,options?.ascending!==false]);return query},range(a,b){first=a;last=b;return query},limit(n){last=n-1;return query},maybeSingle(){single=true;return query},then(resolve,reject){
      try {
        if(/^(ptc_|crop_structure$|fields$)/.test(table)) assert(filters.some(([key,op,value])=>key==='company_id'&&op==='eq'&&value==='A'),'tenant filter missing');
        trace.push({table,filters,first,last});
        let rows=(fixtures[table]||[]).filter(row=>filters.every(([key,op,value])=>op==='eq'?row[key]===value:op==='gte'?row[key]>=value:op==='lte'?row[key]<=value:op==='lt'?row[key]<value:value.includes(row[key])));
        rows=[...rows].sort((a,b)=>{for(const[key,asc]of sorts){if(a[key]!==b[key])return(a[key]<b[key]?-1:1)*(asc?1:-1)}return 0}).slice(first,last+1);
        return Promise.resolve({data:single?rows[0]??null:rows,error:null}).then(resolve,reject);
      } catch(error){return Promise.reject(error).then(resolve,reject)}
    }};return query;
  }};
  const state={actor:{id:'actor',companyId:'A',role:'agronomist'},unauthenticated:false};
  const stubs={
    '@/lib/auth/server-session':`export class SessionAuthError extends Error{constructor(message,status=403){super(message);this.status=status;}}
      export async function getServerActorFromSession(request,options){if(!options.skipCache)throw Error('stale actor');if(globalThis.qa.unauthenticated)throw new SessionAuthError('No session',401);return globalThis.qa.actor;}
      export function resolveCompanyForActor(actor,requested){if(requested&&requested!==actor.companyId&&actor.role!=='global_admin')throw new SessionAuthError('Company mismatch',403);return requested||actor.companyId;}`,
    '@/lib/supabase/service':`export const getServiceClient=()=>globalThis.db;`,
    '@/lib/traffic/server':`export class TrafficError extends Error{constructor(message,status=500){super(message);this.status=status}};export const noStore=data=>({status:200,data,headers:{'Cache-Control':'no-store'}});export const failed=error=>({status:error.status||500,error:error.message});`,
  };
  const build=await esbuild.build({entryPoints:['app/api/dashboard/combine-summary/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'scoped-qa',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'qa'}:undefined);b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:stubs[a.path],loader:'js'}));}}]});
  const ctx={module:{exports:{}},exports:{},require,console,URL,Date,Map,Set,Intl,qa:state,db};ctx.exports=ctx.module.exports;
  vm.runInNewContext(build.outputFiles[0].text,ctx);
  const endpoint=ctx.module.exports;
  const request=query=>({nextUrl:new URL('http://localhost/api/dashboard/combine-summary'+query)});
  let checks=0;
  async function test(name,fn){await fn();checks++;console.log('PASS '+name)}
  for(const role of ['agronomist','director','company_admin','global_admin']) await test(role+' reads own report through real ACL',async()=>{state.actor.role=role;fixtures.profiles[0].role=role;const r=await endpoint.GET(request('?companyId=A'));assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.totalHa,5.87);assert.equal(r.data.readOnly,true);assert.equal(r.data.plots[0].areaHa,24)});
  await test('unauthenticated 401 before DB',async()=>{state.unauthenticated=true;trace.length=0;assert.equal((await endpoint.GET(request('?companyId=A'))).status,401);assert.equal(trace.length,0);state.unauthenticated=false});
  for(const role of ['weighman','mechanic_operator','accountant'])await test(role+' cannot read new endpoint',async()=>{state.actor.role=role;trace.length=0;assert.equal((await endpoint.GET(request('?companyId=A'))).status,403);assert.equal(trace.length,0)});
  state.actor.role='agronomist';fixtures.profiles[0].role='agronomist';
  await test('cross-company query rejected',async()=>{assert.equal((await endpoint.GET(request('?companyId=B'))).status,403)});
  await test('revoked DB role cannot use stale allowed actor',async()=>{fixtures.profiles[0].role='weighman';assert.equal((await endpoint.GET(request('?companyId=A'))).status,403);fixtures.profiles[0].role='agronomist'});
  await test('pending profile rejected',async()=>{fixtures.profiles[0].status='pending';assert.equal((await endpoint.GET(request('?companyId=A'))).status,403);fixtures.profiles[0].status='active'});
  await test('DB tenant mismatch rejected',async()=>{fixtures.profiles[0].company_id='B';assert.equal((await endpoint.GET(request('?companyId=A'))).status,403);fixtures.profiles[0].company_id='A'});
  await test('invalid period fails explicitly',async()=>assert.equal((await endpoint.GET(request('?companyId=A&period=all_data'))).status,400));
  await test('current selection retains latest closed combine shift',async()=>{const r=await endpoint.GET(request('?companyId=A&period=active_shift'));assert.equal(r.status,200);assert.equal(r.data.shifts.length,1);assert.equal(r.data.shifts[0].id,'shift');assert.equal(r.data.totalHa,5.87);assert.equal(r.data.hasActiveShift,false);assert(r.data.availableDates.includes('2026-09-21'))});
  await test('explicit historical date selects the original shift including night closure',async()=>{const r=await endpoint.GET(request('?companyId=A&period=date&date=2026-09-21'));assert.equal(r.status,200);assert.equal(r.data.shifts[0].id,'shift');assert.equal(r.data.totalHa,5.87);assert.equal(r.data.period.start,'2026-09-21T02:00:00.000Z')});
  await test('invalid calendar date is not normalized to another day',async()=>assert.equal((await endpoint.GET(request('?companyId=A&period=date&date=2026-02-30'))).status,400));
  await test('empty historical day never selects the latest shift',async()=>{const r=await endpoint.GET(request('?companyId=A&period=date&date=2026-09-20'));assert.equal(r.status,200);assert.equal(r.data.shifts.length,0)});
  await test('active overnight shift is included, closed neighbour excluded',async()=>{const old=fixtures.ptc_combine_shifts;fixtures.ptc_combine_shifts=[...old,{...old[0],id:'overnight',opened_at:'2026-09-20T02:10:00Z',closed_at:null,hectares_shift:null}];const r=await endpoint.GET(request('?companyId=A&period=active_shift'));assert.equal(r.status,200);assert.deepEqual(Array.from(r.data.shifts,s=>s.id),['overnight']);fixtures.ptc_combine_shifts=old});
  await test('GET-only module',async()=>{for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(endpoint[method],undefined)});
  await test('full pagination over 500 segments',async()=>{
    fixtures.ptc_combine_field_segments=Array.from({length:601},(_,i)=>({...fixtures.ptc_combine_field_segments[0],id:'seg'+String(i).padStart(4,'0'),hectares_segment:i===0?5.87:0}));trace.length=0;
    const r=await endpoint.GET(request('?companyId=A'));assert.equal(r.status,200);assert.equal(r.data.totalHa,5.87);assert(trace.some(q=>q.table==='ptc_combine_field_segments'&&q.first===500));
  });
  await test('response excludes operator identity and mutation secrets',async()=>{const r=await endpoint.GET(request('?companyId=A'));assert(!JSON.stringify(r.data).includes('operator_user_id'));assert(!JSON.stringify(r.data).includes('session_token'));assert.equal(r.headers['Cache-Control'],'no-store')});
  console.log('Summary API: '+checks+' PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1});
