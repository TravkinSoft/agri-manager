// Isolated browser regression fixture. The real page and controls are bundled;
// only external services/auth are replaced. No production requests or writes.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const company = 'fixture-company';
const fixtures = `
const company='${company}';
const season={seasonId:'fixture-season',seasonYear:2026,byField:{},incompleteByField:{}};
const shift={id:'fixture-shift',status:'open',opened_at:new Date().toISOString()};
const resources={fields:[{id:'f9',name:'9',area:11}],destinations:[{id:'wh',name:'Погреб',placeType:'WAREHOUSE',warehouseType:'potato_storage'}],vehicles:[{id:'v1',name:'МТЗ',model:'МТЗ',plate:'0001',source:'reference_vehicles',type:'tractor',fleetType:'tractor'}],drivers:[{id:'d1',name:'Курмангалиев Серик',roleType:'driver',assignedVehicleIds:[]}],combineOperators:[],driverNames:{d1:'Курмангалиев Серик'}};
const source={harvestLotId:'lot9',cropStructureId:'plot9',fieldName:'9',cropName:'Картофель',varietyName:'Сорая',reproductionName:'1 репродукция',areaHa:11};
const batches=[{id:'wh:lot9',warehouseId:'wh',aggregateLot:true,aggregateLotId:'lot9',productId:'potato',productName:'Картофель',cropId:'potato',cropName:'Картофель',varietyName:'Сорая',reproductionName:'1 репродукция',fieldName:'9',cleanMassKg:398470,grossMassKg:400000,impurityMassKg:1530,detailLevel:'summary',cropStructureSources:[source]}];
const state=window.fixture={calls:[],tickets:[],batches,season,shift,refresh:null,toasts:[],delay:0};
state.originalBatches=[...batches,{...batches[0],id:'lot49',aggregateLotId:'lot49',varietyName:'Гала',fieldName:'49-2',cropStructureSources:[{...source,harvestLotId:'lot49',cropStructureId:'elite49',fieldName:'49-2',varietyName:'Гала',reproductionName:'Элита',areaHa:23},{...source,harvestLotId:'lot49',cropStructureId:'first49',fieldName:'49-2',varietyName:'Гала',areaHa:7}]},{...batches[0],id:'legacy9',aggregateLotId:'legacy9',varietyName:'Baltic Rose',cropStructureSources:[]}];state.batches=state.originalBatches;
const call=(name,args)=>state.calls.push({name,args,time:Date.now()});
window.fetch=async(url,options)=>{
 call('fetch',String(url));
 if(String(url).includes('harvest-allocations'))return Response.json(season);
 return Response.json({items:[],active:[],completed:[],...season});
};
window.localStorage.setItem('travkin.weighbridge.workstation.v1','fixture-terminal');
if(!localStorage.getItem('fixture-seeded')) {
 const form={operationType:'impurity_removal',warehouseFromId:'wh'};
 localStorage.setItem('travkin.weighbridge.universalWorkspaces.v3.${company}.fixture-season.fixture-terminal',JSON.stringify({version:3,selectedId:'fixture-tab',workspaces:[{id:'fixture-tab',form,supplierReceiptLines:[],showSupplierExtraFields:false}],migratedLegacyHarvest:true}));
 localStorage.setItem('fixture-seeded','1');
}
export const useAuth=()=>({loading:false,profile:{id:'fixture-user',company_id:company,role:'weighman',full_name:'Проверка'},user:{id:'fixture-user'}});
export const useLanguage=()=>({language:'ru',t:key=>key});
const fixtureToast=message=>{state.toasts.push(message);console.log('TOAST',message.title,message.description||'')};
export const useToast=()=>({toast:fixtureToast});
export const LIVE_REFRESH_TABLES={weighbridge:[]};
export const useLiveRefresh=options=>{if(options.enabled)state.refresh=options.onRefresh};
const query=new Proxy({}, {get:(_,key)=>key==='then'?((done)=>Promise.resolve({data:[],error:null}).then(done)):(()=>query)});
export const supabase={from:()=>query,rpc:async()=>({data:[],error:null}),auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})},channel:()=>query,removeChannel:()=>{}};
export const buildClientAuthHeaders=async()=>({});
export const getWeighbridgeOperatorState=async(...args)=>{call('operator',args);return {unlocked:true,shift:state.shift,operators:[{id:'operator',full_name:'Проверка'}],operator:{id:'operator',full_name:'Проверка'},initial_workspace:args[1]?.includeWorkspace?{resources,harvestAllocations:season}:undefined}};
export const getWeighbridgeResources=async(...args)=>{call('resources',args);return resources};
export const getWeighbridgeTransportPickerData=async()=>({recentPairs:[],openAssignments:[],latestDriverByVehicle:{},latestVehicleByDriver:{}});
export const getWeighbridgeBootstrap=async()=>({shift:state.shift});
export const listActiveHarvestRoutes=async()=>({...season,active:[],completed:[]});
export const listWeighbridgeWorkspaceTickets=async()=>({open:state.tickets.filter(t=>t.status==='active'),history:state.tickets.filter(t=>t.status==='finalized'),tickets:state.tickets,hasMore:false});
export const listHarvestBatchSummaries=async(...args)=>{call('batches',args);if(state.delay)await new Promise(r=>setTimeout(r,state.delay));return state.batches.map(b=>({...b,...(!args[1]?.summaryOnly?{detailLevel:'full'}:{})}))};
export const createTicket=async(...args)=>{call('create',args);const input=args[0];const ticket={...input,id:'ticket-'+(state.tickets.length+1),ticket_no:'FIXTURE-'+(state.tickets.length+1),status:'active',created_at:new Date().toISOString(),lines:args[1],gross_weight_kg:input.gross_weight_kg};state.tickets.push(ticket);return {ticket}};
export const getTicketDetails=async(id)=>({ticket:state.tickets.find(t=>t.id===id)||state.tickets.at(-1)});
export const finalizeTicket=async(...args)=>{call('finalize',args);const ticket=state.tickets.at(-1);ticket.status='finalized';return {ticket}};
`;
const serviceNames = ['adminTicketAction','changeActiveHarvestRouteContext','closeShift','createActiveHarvestRoute','downloadTicketPdf','handoverWeighbridgeOperator','patchTicket','startTicketCorrection','unlockWeighbridgeOperator','updateActiveHarvestRoute','voidTicket','createWarehouseTransfer','performProcessingAction'];
const noopExports = serviceNames.map(n=>`export const ${n}=async()=>({});`).join('\n');
const mocks = new Set(['@/lib/contexts/auth-context','@/lib/contexts/language-context','@/hooks/use-toast','@/hooks/use-live-refresh','@/lib/supabase/client','@/lib/supabase/client-auth','@/lib/services/weighbridge','@/lib/services/warehouses','@/lib/services/processing']);
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import './fixture-mocks';import Page from './app/(dashboard)/weighbridge/page';
function Tools(){return <aside style={{position:'fixed',top:0,right:0,zIndex:99999,background:'white',color:'black'}}><button onClick={()=>window.fixture.refresh?.({source:'realtime',tables:['inventory_batches']})}>Обновить остатки (проверка)</button><button onClick={()=>{window.fixture.shift={...window.fixture.shift,id:'next-shift'};window.fixture.refresh?.({source:'realtime',tables:['weighbridge_shifts']})}}>Обновить смену (проверка)</button><button onClick={()=>{window.fixture.batches=[];window.fixture.refresh?.({source:'realtime',tables:['inventory_batches']})}}>Временно пустой список</button><button onClick={()=>{window.fixture.batches=window.fixture.originalBatches;window.fixture.refresh?.({source:'realtime',tables:['inventory_batches']})}}>Вернуть список</button><button onClick={()=>{window.fixture.delay=6000;window.fixture.refresh?.({source:'realtime',tables:['inventory_batches']})}}>Медленное обновление</button><button onClick={()=>{const pre=document.getElementById('fixture-result');pre.textContent=JSON.stringify({calls:window.fixture.calls,toasts:window.fixture.toasts,workspace:localStorage.getItem('travkin.weighbridge.universalWorkspaces.v3.${company}.fixture-season.fixture-terminal')})}}>Результат проверки</button><pre id="fixture-result" style={{maxHeight:200,maxWidth:700,overflow:'auto'}}/></aside>};createRoot(document.getElementById('root')).render(<><Tools/><Page/></>);`;
const result=await esbuild.build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'fixture-entry.tsx',loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'fixture-only',setup(build){
 build.onResolve({filter:/.*/},args=>{
  if(mocks.has(args.path)||args.path==='./fixture-mocks')return {path:'mock',namespace:'fixture'};
  if(args.path==='next/link')return {path:'link',namespace:'fixture'};
  if(args.path==='next/navigation')return {path:'navigation',namespace:'fixture'};
  if(args.path==='@/components/weighbridge/processing-workspace'||args.path==='@/components/weighbridge/daily-reconciliation')return {path:'unrelated',namespace:'fixture'};
 });
 build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='mock'?fixtures+'\n'+noopExports:args.path==='link'?`export default function Link({children,...props}){return <a {...props}>{children}</a>}`:args.path==='navigation'?`export const useRouter=()=>({push(){},replace(){}});export const usePathname=()=>'/weighbridge';export const useSearchParams=()=>new URLSearchParams();`:`export const ProcessingWorkspace=()=>null;export const DailyReconciliation=()=>null;`,loader:'tsx',resolveDir:process.cwd()}));
}}]});
const js=result.outputFiles[0].text;
const css=readdirSync(resolve('.next/static/css')).filter(name=>name.endsWith('.css')).map(name=>readFileSync(resolve('.next/static/css',name),'utf8')).join('\n');
const server=createServer((req,res)=>{
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><style>${css}\nbody{margin-top:60px;background:#181a14;color:#eee}aside{max-width:750px}aside button{padding:5px;font-size:12px}button{cursor:pointer} [data-testid=impurity-source-picker] [role=group]{border:1px solid #666;padding:12px} [data-testid=impurity-source-picker] label{display:inline-flex}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
server.listen(4179,'127.0.0.1',()=>console.log('WEIGHBRIDGE_FIXTURE http://127.0.0.1:4179 (local fake data only)'));
