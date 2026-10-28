// Actual GET handlers + actual weighbridge ACL, isolated transport. No network or Production writes.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');

async function main() {
  const company = '10000000-0000-4000-8000-000000000001';
  const shift = '20000000-0000-4000-8000-000000000001';
  const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const state = { unauthorized: false, role: 'weighman', status: 'active', fail: null };
  const trace = [];
  const tickets = Array.from({ length: 132 }, (_, i) => ({ id: uuid(i + 1), company_id: company,
    shift_id: shift, status: i === 131 ? 'voided' : 'finalized', op_type: i % 3 ? 'harvest_incoming' : 'weighbridge_impurities',
    created_at: i === 131 ? '2026-09-22T20:00:00.000Z' : new Date(Date.parse('2026-09-22T05:00:00Z') + i * 60000).toISOString(), lines: [] }));
  tickets.push({ ...tickets[0], id: uuid(133), company_id: 'foreign' }, { ...tickets[0], id: uuid(134), status: 'active' });
  const shifts = Array.from({ length: 57 }, (_, i) => ({ id: uuid(1000+i), company_id: company, status: 'closed',
    opened_at: new Date(Date.parse('2026-09-22T05:00:00Z') - i * 86400000).toISOString(), closed_at: null }));
  const db = { from(table) {
    const predicates = [], sorts = []; let max = Infinity, single = false;
    const q = {
      select() { return q; }, eq(k,v) { predicates.push([k,'eq',v]); return q; },
      in(k,v) { predicates.push([k,'in',v]); return q; },
      gte(k,v) { predicates.push([k,'gte',v]); return q; }, lt(k,v) { predicates.push([k,'lt',v]); return q; },
      or(value) { const match = value.match(/^(created_at|opened_at)\.lt\.(.+),and\(\1\.eq\.(.+),id\.lt\.([0-9a-f-]+)\)$/); assert(match); assert.equal(match[2],match[3]); predicates.push([match[1],'cursor',[match[2],match[4]]]); return q; },
      order(k,o) { sorts.push([k,o.ascending]); return q; }, limit(n) { max=n; return q; }, maybeSingle() { single=true; return q; },
      then(resolve,reject) { try {
        trace.push({table,predicates,max});
        if (state.fail === table) return Promise.resolve({data:null,error:{message:'fixture read failure'}}).then(resolve,reject);
        let rows = table === 'tickets' ? tickets : table === 'weighbridge_shifts' ? shifts : table === 'profiles'
          ? [{id:'actor',company_id:company,role:state.role,status:state.status}] : table === 'companies' ? [{id:company,name:'Fixture'}] : [];
        if (['tickets','weighbridge_shifts'].includes(table)) assert(predicates.some(([k,op,v])=>k==='company_id'&&op==='eq'&&v===company));
        rows = rows.filter(row=>predicates.every(([k,op,v]) => op==='eq'?row[k]===v:op==='in'?v.includes(row[k]):op==='gte'?row[k]>=v:op==='lt'?row[k]<v:row[k]<v[0]||(row[k]===v[0]&&row.id<v[1])));
        rows = [...rows].sort((a,b)=>{for(const[k,asc]of sorts)if(a[k]!==b[k])return(a[k]<b[k]?-1:1)*(asc?1:-1);return 0;}).slice(0,max);
        return Promise.resolve({data:single?rows[0]||null:rows,error:null}).then(resolve,reject);
      } catch(e) { return Promise.reject(e).then(resolve,reject); } }
    }; return q;
  }, rpc() { throw Error('History must not call a write/session RPC'); } };
  const stubs = {
    'next/server': `export const NextResponse={json:(data,options={})=>({data,status:options.status||200,headers:options.headers||{}})};`,
    'server-only': '',
    '@/lib/auth/server-session': `export class SessionAuthError extends Error{constructor(message,status=403){super(message);this.status=status}}
      export async function getServerActorFromSession(){if(globalThis.qa.unauthorized)throw new SessionAuthError('No session',401);return{id:'actor',companyId:'${company}',role:globalThis.qa.role}}
      export const getUserScopedClientFromRequest=async()=>globalThis.db;
      export function resolveCompanyForActor(a,c){if(c&&c!==a.companyId)throw new SessionAuthError('company mismatch',403);return c||a.companyId}`,
    '@/lib/supabase/service': `export const getServiceClient=()=>{throw Error('Unexpected privileged client')};`,
    '@/lib/server/weighbridge-ticket-attribution': 'export const enrichTicketOperatorAttribution=async(_db,_company,rows)=>rows;',
    '@/lib/server/weighbridge-ticket-business-snapshots': 'export const enrichTicketBusinessSnapshots=async(_db,_company,rows)=>rows;',
    '@/lib/server/weighbridge-combine-operator': 'export const enrichTicketCombineOperators=async(_db,_company,rows)=>rows; export const validateActiveCombineOperator=()=>{throw Error("write path")};',
    '@/lib/server/weighbridge-shared-impurity': 'export const enrichSharedImpurityScopes=async(_db,_company,rows)=>rows;'
  };
  const endpoints = {};
  for(const name of ['tickets','tickets/history-shifts']) {
    const built = await esbuild.build({entryPoints:[`app/api/weighbridge/${name}/route.ts`],bundle:true,platform:'node',format:'cjs',write:false,
      plugins:[{name:'isolated-transport',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'qa'}:undefined);b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:stubs[a.path],loader:'js'}));}}]});
    const context = { module:{exports:{}}, exports:{}, require, console, Date, URL, Buffer, process, qa:state, db };
    context.exports=context.module.exports; vm.runInNewContext(built.outputFiles[0].text,context); endpoints[name]=context.module.exports;
  }
  const req = params => ({method:'GET',nextUrl:new URL('http://localhost/api/weighbridge/tickets?'+new URLSearchParams({companyId:company,historyOnly:'true',historyLimit:'50',...params}))});
  let count=0; const test=async(name,fn)=>{await fn();console.log('PASS '+(++count)+' '+name);};
  for (const [name,ep] of Object.entries(endpoints)) {
    for(const role of ['weighman','director','accountant']) await test(name+' allows '+role,async()=>{state.role=role;assert.equal((await ep.GET(req())).status,200);});
    await test(name+' denies wrong role and pending profile',async()=>{state.role='mechanic_operator';assert.equal((await ep.GET(req())).status,403);state.role='weighman';state.status='pending';assert.equal((await ep.GET(req())).status,403);state.status='active';});
    await test(name+' denies missing auth and foreign company',async()=>{state.unauthorized=true;assert.equal((await ep.GET(req())).status,401);state.unauthorized=false;assert.equal((await ep.GET(req({companyId:'foreign'}))).status,403);});
  }
  const ep=endpoints.tickets;
  await test('real GET returns 132 shift rows over three pages without duplicates',async()=>{
    let cursor='',ids=[]; do {const r=await ep.GET(req({historyShiftId:shift,...(cursor?{historyCursor:cursor}:{})}));assert.equal(r.status,200);assert.match(r.headers['Cache-Control'],/no-store/);ids.push(...r.data.tickets.map(t=>t.id));cursor=r.data.historyNextCursor;}while(cursor);
    assert.equal(ids.length,132);assert.equal(new Set(ids).size,132);
  });
  await test('yesterday excludes after-midnight and open/foreign tickets',async()=>{
    const r=await ep.GET(req({historyFrom:'2026-09-21T19:00:00.000Z',historyTo:'2026-09-22T19:00:00.000Z',historyStatus:'voided'}));assert.equal(r.status,200);assert.equal(r.data.tickets.length,0);
  });
  await test('minute and operation filters combine before limit',async()=>{
    const r=await ep.GET(req({historyFrom:'2026-09-22T05:15:00.000Z',historyTo:'2026-09-22T05:16:00.000Z',historyOperation:'weighbridge_impurities'}));assert.equal(r.status,200);assert.equal(r.data.tickets.length,1);assert.equal(r.data.tickets[0].id,uuid(16));
  });
  await test('invalid filter or cursor is 400, not unfiltered success',async()=>{
    for(const params of [{historyFrom:'2026-02-30T00:00:00Z'},{historyShiftId:'bad'},{historyCursor:'bad'},{historyStatus:'active'},{historyOperation:'__proto__'}])assert.equal((await ep.GET(req(params))).status,400);
  });
  await test('57 shift choices paginate with stable order and tenant scope',async()=>{
    const ep=endpoints['tickets/history-shifts'];const first=await ep.GET(req());const second=await ep.GET(req({cursor:first.data.nextCursor}));assert.equal(first.data.shifts.length,50);assert.equal(second.data.shifts.length,7);assert.equal(second.data.nextCursor,null);assert.equal(new Set([...first.data.shifts,...second.data.shifts].map(s=>s.id)).size,57);assert.equal((await ep.GET(req({cursor:'bad'}))).status,400);
  });
  await test('read failures cannot become empty successful history',async()=>{
    state.fail='tickets';assert.notEqual((await ep.GET(req())).status,200);state.fail='weighbridge_shifts';assert.equal((await endpoints['tickets/history-shifts'].GET(req())).status,500);state.fail=null;
  });
  await test('workspace still includes active ticket and ignores history filters',async()=>{
    const r=await ep.GET(req({historyOnly:'false',workspace:'true',historyShiftId:'bad'}));assert.equal(r.status,200);assert(r.data.tickets.some(t=>t.status==='active'));assert.equal(tickets.at(-1).status,'active');
  });
  console.log('History API PASS: '+count+' checks');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
