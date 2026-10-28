// Real API handlers and ACL; in-memory transport. Never connects to Production.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');
async function main() {
 const company='10000000-0000-0000-0000-000000000001', shiftId='20000000-0000-0000-0000-000000000001';
 const fixtures={companies:[{id:company,operational_day_start_hour:7}],profiles:[{id:'actor',company_id:company,role:'agronomist',status:'active'}],
  weighbridge_shifts:[{id:shiftId,company_id:company,status:'open',opened_at:'2026-09-21T23:00:00Z',closed_at:null}],
  ptc_combine_shifts:[{id:'combine-shift',company_id:company,opened_at:'2026-09-21T22:00:00Z',closed_at:null}],
  v_harvest_lot_stock_v2:[], harvest_lots:[], crops:[{id:'potato',name:'Картофель'},{id:'wheat',name:'Пшеница'}],
  varieties:[{id:'gala',name:'Гала'}],seed_reproductions:[{id:'r1',name:'1 репродукция'}],seasons:[{id:'season',company_id:company,year:2026}],
  warehouses:[{id:'w1',company_id:company,name:'Первый'},{id:'w2',company_id:company,name:'Второй'}],tickets:[],dashboard_operator_presence:[]};
 for(let i=0;i<505;i++){fixtures.harvest_lots.push({id:'lot'+i,company_id:company,crop_id:'potato',variety_id:'gala',reproduction_id:'r1',season_id:'season'});fixtures.v_harvest_lot_stock_v2.push({company_id:company,harvest_lot_id:'lot'+i,warehouse_id:i===504?'w2':'w1',current_weight_kg:100,batch_class:'commodity',physical_state:'SOURCE'});}
 fixtures.v_harvest_lot_stock_v2.push({company_id:company,harvest_lot_id:'lot0',warehouse_id:'w1',current_weight_kg:10000,batch_class:'waste',physical_state:'SOURCE'});
 fixtures.tickets.push(...['w1','w2'].map((id,i)=>({id:'t'+i,company_id:company,warehouse_to_id:id,op_type:'harvest_incoming',status:'finalized',is_finalized:true,is_voided:false,replacement_ticket_id:null,finalized_at:`2026-09-22T0${i+3}:00:00Z`})));
 const report={reportVersion:2,shiftId,reviewToken:'secret-not-for-readers',operatorName:'Весовщик',capturedAt:'2026-09-22T03:00:00Z',closedAt:null,
  potatoNetKg:100000,potatoPeriodImpuritiesKg:20000,potatoPeriodResultKg:80000,potatoCleanKg:98000,potatoReceiptCount:10,openTicketCount:2,closedTicketCount:10,unsyncedTicketCount:0,operations:[],plots:[],tickets:[]};
 const state={actor:{id:'actor',companyId:company,role:'agronomist',isImpersonating:false},unauthorized:false,failTable:null,failPage:false};
 const trace=[],writes=[];
 const db={from(table){const filters=[],sorts=[];let first=0,last=Infinity,single=false,mutation=null;
  const q={select(){return q},eq(k,v){filters.push([k,'eq',v]);return q},is(k,v){filters.push([k,'eq',v]);return q},in(k,v){filters.push([k,'in',v]);return q},order(k,o){sorts.push([k,o?.ascending!==false]);return q},range(a,b){first=a;last=b;return q},limit(n){last=n-1;return q},maybeSingle(){single=true;return q},upsert(row){mutation=row;return q},then(resolve,reject){try{
   trace.push({table,filters,first,last,mutation});
   if(!['companies','profiles','crops','varieties','seed_reproductions'].includes(table)&&!mutation)assert(filters.some(([k,o,v])=>k==='company_id'&&o==='eq'&&v===company),'tenant filter missing '+table);
   if(table==='companies')assert(filters.some(([k,o,v])=>k==='id'&&o==='eq'&&v===company));
   if(state.failTable===table||(state.failPage&&table==='v_harvest_lot_stock_v2'&&first>=500))return Promise.resolve({data:null,error:{message:'read failed'}}).then(resolve,reject);
   if(mutation){writes.push(mutation);return Promise.resolve({data:null,error:null}).then(resolve,reject)}
   let rows=(fixtures[table]||[]).filter(row=>filters.every(([k,o,v])=>o==='eq'?row[k]===v:v.includes(row[k])));
   rows=[...rows].sort((a,b)=>{for(const[k,asc]of sorts)if(a[k]!==b[k])return(a[k]<b[k]?-1:1)*(asc?1:-1);return 0}).slice(first,last+1);
   return Promise.resolve({data:single?rows[0]??null:rows,error:null}).then(resolve,reject);
  }catch(e){return Promise.reject(e).then(resolve,reject)}}};return q;},
  async rpc(name,args){assert.equal(name,'preview_weighbridge_shift_snapshot_v2');assert.equal(args.p_company_id,company);assert.equal(args.p_shift_id,shiftId);trace.push({rpc:name});return{data:report,error:null}}};
 const stubs={
  '@/lib/auth/server-session':`export class SessionAuthError extends Error{constructor(message,status=403){super(message);this.status=status}}
   export async function getServerActorFromSession(r,o){if(!o.skipCache)throw Error('stale actor');if(globalThis.qa.unauthorized)throw new SessionAuthError('No session',401);return globalThis.qa.actor}
   export function resolveCompanyForActor(a,c){if(c&&c!==a.companyId&&a.role!=='global_admin')throw new SessionAuthError('company mismatch',403);return c||a.companyId}`,
  '@/lib/supabase/service':`export const getServiceClient=()=>globalThis.db;`,
  '@/lib/traffic/server':`export class TrafficError extends Error{constructor(message,status=500){super(message);this.status=status}};export const noStore=(data,status=200)=>({status,data,headers:{'Cache-Control':'no-store'}});export const failed=e=>({status:e.status||500,error:e.message});export function sameOrigin(r){if(r.headers.get('origin')!==r.nextUrl.origin)throw new TrafficError('origin',403)}`,
 };
 const endpoints={};
 for(const name of ['weighbridge-summary','potato-stock','presence']){
  const build=await esbuild.build({entryPoints:[`app/api/dashboard/${name}/route.ts`],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'qa',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'qa'}:undefined);b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:stubs[a.path],loader:'js'}))}}]});
  const context={module:{exports:{}},exports:{},require,console,Date,URL,qa:state,db};context.exports=context.module.exports;vm.runInNewContext(build.outputFiles[0].text,context);endpoints[name]=context.module.exports;
 }
 const req=(query='',origin='http://localhost')=>({nextUrl:new URL('http://localhost/api/dashboard/test?companyId='+company+query),headers:new Map([['origin',origin]])});
 let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name)}
 for(const[name,endpoint]of Object.entries(endpoints)){
  for(const role of ['agronomist','director','company_admin','global_admin'])await test(`${name}: ${role} allowed`,async()=>{state.actor.role=role;fixtures.profiles[0].role=role;assert.equal((await endpoint.GET(req())).status,200)});
  for(const role of ['weighman','mechanic_operator','accountant'])await test(`${name}: ${role} cannot read manager summary`,async()=>{state.actor.role=role;trace.length=0;assert.equal((await endpoint.GET(req())).status,403);assert.equal(trace.length,0)});
  state.actor.role=fixtures.profiles[0].role='agronomist';
  await test(name+': foreign company denied',async()=>{const r=req();r.nextUrl.searchParams.set('companyId','foreign');assert.equal((await endpoint.GET(r)).status,403)});
  await test(name+': unauthenticated denied',async()=>{state.unauthorized=true;assert.equal((await endpoint.GET(req())).status,401);state.unauthorized=false});
  await test(name+': pending denied',async()=>{fixtures.profiles[0].status='pending';assert.equal((await endpoint.GET(req())).status,403);fixtures.profiles[0].status='active'});
  await test(name+': revoked role denied',async()=>{fixtures.profiles[0].role='weighman';assert.equal((await endpoint.GET(req())).status,403);fixtures.profiles[0].role='agronomist'});
 }
 await test('shift uses same-shift flow, not cohort clean, and strips sensitive fields',async()=>{const r=await endpoints['weighbridge-summary'].GET(req());assert.equal(r.data.report.potatoPeriodResultKg,80000);assert.equal(r.data.report.openTicketCount,2);assert(!JSON.stringify(r).includes('secret-not-for-readers'));assert(!('tickets'in r.data.report));assert(!('potatoCleanKg'in r.data.report))});
 await test('expanded report remains read-only and never exposes the close review token',async()=>{const r=await endpoints['weighbridge-summary'].GET(req('&details=true'));assert.equal(r.status,200);assert.equal(r.data.readOnly,true);assert.equal(r.data.report.reviewToken,'');assert.equal(r.data.report.shiftId,shiftId);assert(Array.isArray(r.data.report.tickets));assert(!JSON.stringify(r).includes('secret-not-for-readers'))});
 await test('foreign/unavailable shift fails without RPC',async()=>{trace.length=0;const r=await endpoints['weighbridge-summary'].GET(req('&shiftId=99999999-0000-0000-0000-000000000001'));assert.equal(r.status,404);assert(!trace.some(t=>t.rpc))});
 await test('no shift is not a fabricated zero shift',async()=>{const old=fixtures.weighbridge_shifts;fixtures.weighbridge_shifts=[];const r=await endpoints['weighbridge-summary'].GET(req());assert.equal(r.data.selectedShift,null);assert.equal(r.data.report,null);fixtures.weighbridge_shifts=old});
 await test('current mode retains last closed report until the next shift opens',async()=>{const row=fixtures.weighbridge_shifts[0];row.status='closed';row.closed_at='2026-09-22T20:00:00Z';trace.length=0;const r=await endpoints['weighbridge-summary'].GET(req('&period=active_shift'));assert.equal(r.status,200);assert.equal(r.data.selectedShift.id,shiftId);assert.equal(r.data.selectedShift.status,'closed');assert.equal(r.data.report.potatoPeriodResultKg,80000);assert(trace.some(t=>t.rpc));row.status='open';row.closed_at=null});
 await test('active mode selects open identity',async()=>{const r=await endpoints['weighbridge-summary'].GET(req('&period=active_shift'));assert.equal(r.status,200);assert.equal(r.data.selectedShift.id,shiftId)});
 await test('new empty shift wins over last closed total, without carrying yesterday kilograms',async()=>{const old=fixtures.weighbridge_shifts;const saved={...report};fixtures.weighbridge_shifts=[{...old[0],opened_at:'2026-09-26T02:52:00Z'},{...old[0],id:'20000000-0000-0000-0000-000000000002',status:'closed',closed_at:'2026-09-25T20:41:00Z'}];report.potatoNetKg=0;report.potatoPeriodImpuritiesKg=0;report.potatoPeriodResultKg=0;report.potatoReceiptCount=0;const r=await endpoints['weighbridge-summary'].GET(req('&period=active_shift'));assert.equal(r.status,200);assert.equal(r.data.selectedShift.id,shiftId);assert.equal(r.data.report.potatoPeriodResultKg,0);Object.assign(report,saved);fixtures.weighbridge_shifts=old});
 await test('empty yesterday is explicit and never current fallback',async()=>{const r=await endpoints['weighbridge-summary'].GET(req('&period=previous_day'));assert.equal(r.status,200);assert.equal(r.data.selectedShift,null)});
 await test('invalid or ambiguous shift selection rejected',async()=>{assert.equal((await endpoints['weighbridge-summary'].GET(req('&period=bad'))).status,400);assert.equal((await endpoints['weighbridge-summary'].GET(req('&period=active_shift&shiftId='+shiftId))).status,400)});
 await test('date history is not capped at first page',async()=>{const old=fixtures.weighbridge_shifts;fixtures.weighbridge_shifts=[...old,...Array.from({length:501},(_,i)=>({...old[0],id:'history-'+i,status:'closed',closed_at:'2026-09-22T20:00:00Z'}))];trace.length=0;const r=await endpoints['weighbridge-summary'].GET(req('&period=active_shift'));assert.equal(r.status,200);assert.equal(r.data.shifts.length,502);assert(trace.some(t=>t.table==='weighbridge_shifts'&&t.first===500));fixtures.weighbridge_shifts=old});
 await test('complete paginated stock, excludes waste, latest warehouse first',async()=>{const r=await endpoints['potato-stock'].GET(req());assert.equal(r.status,200);assert.equal(r.data.totalKg,50500);assert.equal(r.data.warehouses[0].id,'w2');assert.equal(r.data.warehouses.reduce((s,w)=>s+w.parties.length,0),505)});
 await test('stock page failure never returns a partial successful total',async()=>{state.failPage=true;assert.equal((await endpoints['potato-stock'].GET(req())).status,500);state.failPage=false});
 await test('negative balances are not silently removed',async()=>{fixtures.v_harvest_lot_stock_v2[0].current_weight_kg=-100;const r=await endpoints['potato-stock'].GET(req());assert.equal(r.data.totalKg,50300);fixtures.v_harvest_lot_stock_v2[0].current_weight_kg=100});
 await test('missing stock identity is not silently zero',async()=>{const old=fixtures.harvest_lots[0].crop_id;fixtures.harvest_lots[0].crop_id='missing';assert.equal((await endpoints['potato-stock'].GET(req())).status,500);fixtures.harvest_lots[0].crop_id=old});
 await test('presence failure is an error, not offline',async()=>{state.failTable='dashboard_operator_presence';assert.equal((await endpoints.presence.GET(req())).status,500);state.failTable=null});
 await test('shift-only summary never reads heartbeat or depends on its availability',async()=>{state.failTable='dashboard_operator_presence';trace.length=0;const r=await endpoints.presence.GET(req('&shiftsOnly=true'));assert.equal(r.status,200);assert.equal(r.data.weighbridge.shift.status,'open');assert(!trace.some(t=>t.table==='dashboard_operator_presence'));state.failTable=null});
 await test('open shifts remain open without any heartbeat',async()=>{const r=await endpoints.presence.GET(req());assert.equal(r.data.weighbridge.shift.status,'open');assert.equal(r.data.combine.shift.status,'open');assert.equal(r.data.combine.lastSeenAt,null);assert.equal(writes.length,0)});
 await test('foreign and newer closed shifts cannot hide the active company shift',async()=>{fixtures.ptc_combine_shifts.push({id:'foreign',company_id:'foreign',opened_at:'2026-09-23T09:00:00Z',closed_at:null},{id:'new-closed',company_id:company,opened_at:'2026-09-23T08:00:00Z',closed_at:'2026-09-23T09:00:00Z'});const r=await endpoints.presence.GET(req());assert.equal(r.data.combine.shift.id,'combine-shift');fixtures.ptc_combine_shifts.splice(1)});
 await test('closed shift stays closed even with a fresh connection',async()=>{fixtures.ptc_combine_shifts[0].closed_at='2026-09-22T08:00:00Z';const fresh=new Date().toISOString();fixtures.dashboard_operator_presence.push({company_id:company,workspace:'combine',last_seen_at:fresh});const r=await endpoints.presence.GET(req());assert.equal(r.data.combine.shift.status,'closed');assert.equal(r.data.combine.lastSeenAt,fresh);fixtures.ptc_combine_shifts[0].closed_at=null;fixtures.dashboard_operator_presence=[]});
 await test('missing shift stays null, never fabricated open or closed',async()=>{const old=fixtures.ptc_combine_shifts;fixtures.ptc_combine_shifts=[];const r=await endpoints.presence.GET(req());assert.equal(r.data.combine.shift,null);fixtures.ptc_combine_shifts=old});
 for(const table of ['weighbridge_shifts','ptc_combine_shifts'])await test(table+' read failure cannot claim the shift is closed',async()=>{state.failTable=table;assert.equal((await endpoints.presence.GET(req())).status,500);state.failTable=null});
 await test('admin cannot heartbeat as operator',async()=>{state.actor.role=fixtures.profiles[0].role='global_admin';assert.equal((await endpoints.presence.POST(req())).status,403)});
 await test('impersonation cannot heartbeat',async()=>{state.actor.role=fixtures.profiles[0].role='weighman';state.actor.isImpersonating=true;assert.equal((await endpoints.presence.POST(req())).status,403);state.actor.isImpersonating=false});
 await test('cross-origin heartbeat denied',async()=>assert.equal((await endpoints.presence.POST(req('','http://evil'))).status,403));
 for(const role of ['weighman','mechanic_operator'])await test(role+' heartbeat scopes identity server-side',async()=>{state.actor.role=fixtures.profiles[0].role=role;assert.equal((await endpoints.presence.POST(req('&companyId=foreign'))).status,200);assert.equal(writes.at(-1).company_id,company);assert.equal(writes.at(-1).profile_id,'actor');assert.equal(writes.at(-1).workspace,role==='weighman'?'weighbridge':'combine')});
 for(const name of ['weighbridge-summary','potato-stock'])await test(name+' is GET only',()=>{for(const method of ['POST','PATCH','DELETE','PUT'])assert.equal(endpoints[name][method],undefined)});
 console.log(`PASS ${count} operational summary API checks`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
