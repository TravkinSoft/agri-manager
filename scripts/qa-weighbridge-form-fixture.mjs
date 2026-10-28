// Isolated browser regression fixture. The real page and controls are bundled;
// only external services/auth are replaced. No production requests or writes.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const company = 'fixture-company';
const destinationScenario = process.argv.includes('--destinations');
const impurityWarehouseScenario = process.argv.includes('--impurity-warehouses');
const historyScenario = process.argv.includes('--history');
const correctionScenario = process.argv.includes('--shared-correction');
const trafficScenario = process.argv.includes('--traffic');
const fixtures = `
const company='${company}';
const season={seasonId:'fixture-season',seasonYear:2026,byField:{},incompleteByField:{}};
const shift={id:'fixture-shift',status:'open',opened_at:new Date().toISOString()};
const resources={fields:[{id:'f9',name:'9',area:11}],destinations:[{id:'wh',name:'Погреб',placeType:'WAREHOUSE',warehouseType:'potato_storage'}],vehicles:[{id:'v1',name:'МТЗ',model:'МТЗ',plate:'0001',source:'reference_vehicles',type:'tractor',fleetType:'tractor'}],drivers:[{id:'d1',name:'Курмангалиев Серик',roleType:'driver',assignedVehicleIds:[]}],combineOperators:[],driverNames:{d1:'Курмангалиев Серик'}};
const source={harvestLotId:'lot9',cropStructureId:'plot9',fieldName:'9',cropName:'Картофель',varietyName:'Сорая',reproductionName:'1 репродукция',areaHa:11};
const batches=[{id:'wh:lot9',warehouseId:'wh',aggregateLot:true,aggregateLotId:'lot9',productId:'potato',productName:'Картофель',cropId:'potato',cropName:'Картофель',varietyName:'Сорая',reproductionName:'1 репродукция',fieldName:'9',cleanMassKg:398470,grossMassKg:400000,impurityMassKg:1530,detailLevel:'summary',cropStructureSources:[source]}];
const state=window.fixture={calls:[],tickets:[],batches,season,shift,refresh:null,toasts:[],delay:0};
state.traffic={companyId:company,readOnly:true,serverTime:new Date().toISOString(),vehicles:['empty','loaded','unloading','repair','offline'].map((group,i)=>({id:'ptc-'+i,name:'КамАЗ '+(100+i),brand:'КамАЗ',plate:(100+i)+' AP 15',driver:'Водитель проверки '+(i+1),group,since:new Date(Date.now()-(i+1)*60000).toISOString()}))};
state.originalBatches=[...batches,{...batches[0],id:'lot49',aggregateLotId:'lot49',varietyName:'Гала',fieldName:'49-2',cropStructureSources:[{...source,harvestLotId:'lot49',cropStructureId:'elite49',fieldName:'49-2',varietyName:'Гала',reproductionName:'Элита',areaHa:23},{...source,harvestLotId:'lot49',cropStructureId:'first49',fieldName:'49-2',varietyName:'Гала',areaHa:7}]},{...batches[0],id:'legacy9',aggregateLotId:'legacy9',varietyName:'Baltic Rose',cropStructureSources:[]}];state.batches=state.originalBatches;
${destinationScenario ? `
resources.fields=[{id:'f9',name:'Виноград',area:92}];
resources.destinations=[{id:'wh',name:'Хранилище (Тайынша)',placeType:'WAREHOUSE',warehouseType:'potato_storage'},{id:'hangar',name:'Ангар (Тайынша)',placeType:'WAREHOUSE',warehouseType:'potato_storage'}];
resources.vehicles.push({...resources.vehicles[0],id:'v2',plate:'0002'});
resources.drivers.push({...resources.drivers[0],id:'d2',name:'Второй водитель'});
resources.combineOperators=[{id:'co',name:'Комбайнёр проверки',roleType:'combine_operator'}];
season.byField.f9=[{allocationId:'plot9',areaHa:92,cropId:'potato',cropName:'Картофель',varietyId:'gala',varietyName:'Гала',reproductionId:'rep1',reproductionName:'1 репродукция',cropSlug:'potato',plotCount:1,isIncomplete:false}];
if(!localStorage.getItem('fixture-destinations-seeded')) {
 const form={operationType:'harvest_incoming',fieldId:'f9',cropStructureAllocationId:'plot9',cropId:'potato',varietyId:'gala',reproductionId:'rep1',warehouseToId:'wh',combineOperatorPersonId:'co'};
 localStorage.setItem('travkin.weighbridge.universalWorkspaces.v3.${company}.fixture-season.fixture-terminal',JSON.stringify({version:3,selectedId:'one',workspaces:[{id:'one',form:{...form,vehicleId:'v1',driverId:'d1',grossKg:'20000'},supplierReceiptLines:[],showSupplierExtraFields:false},{id:'two',form:{...form,vehicleId:'v2',driverId:'d2',grossKg:'17000'},supplierReceiptLines:[],showSupplierExtraFields:false}],migratedLegacyHarvest:true}));
 localStorage.setItem('travkin.weighbridge.defaultDestination.v2.${company}.fixture-terminal','wh');
 localStorage.setItem('fixture-seeded','1');localStorage.setItem('fixture-destinations-seeded','1');
}
` : ''}
${impurityWarehouseScenario ? `
resources.destinations=[{id:'wh',name:'Хранилище (Тайынша)',placeType:'WAREHOUSE',warehouseType:'potato_storage'},{id:'hangar',name:'Ангар (Тайынша)',placeType:'WAREHOUSE',warehouseType:'potato_storage'}];
resources.vehicles.push({...resources.vehicles[0],id:'v2',plate:'0002'});
resources.drivers.push({...resources.drivers[0],id:'d2',name:'Второй водитель'});
state.batches=[batches[0],{...batches[0],id:'hangar:lot9',warehouseId:'hangar',cleanMassKg:120000,grossMassKg:120000,impurityMassKg:0}];
state.originalBatches=state.batches;
if(!localStorage.getItem('fixture-impurity-warehouses-seeded')) {
 const form={operationType:'impurity_removal',warehouseFromId:'wh',impurityType:'soil_and_trash',sourceBatchId:'wh:lot9',impuritySourceSelections:[{batchId:'wh:lot9',harvestLotId:'lot9',cropStructureId:'plot9'}]};
 localStorage.setItem('travkin.weighbridge.universalWorkspaces.v3.${company}.fixture-season.fixture-terminal',JSON.stringify({version:3,selectedId:'one',workspaces:[{id:'one',form:{...form,vehicleId:'v1',driverId:'d1',grossKg:'20000'},supplierReceiptLines:[],showSupplierExtraFields:false},{id:'two',form:{...form,vehicleId:'v2',driverId:'d2',grossKg:'17000'},supplierReceiptLines:[],showSupplierExtraFields:false}],migratedLegacyHarvest:true}));
 localStorage.setItem('fixture-seeded','1');localStorage.setItem('fixture-impurity-warehouses-seeded','1');
}
` : ''}
const call=(name,args)=>state.calls.push({name,args,time:Date.now()});
window.fetch=async(url,options)=>{
 call('fetch',String(url));
 if(String(url).includes('/api/traffic/board')){if(state.trafficDelay)await new Promise(r=>setTimeout(r,state.trafficDelay));if(state.trafficFail)return Response.json({error:'Проверка ошибки ПТС'},{status:503});return Response.json({...state.traffic,serverTime:new Date().toISOString()});}
 if(String(url).includes('harvest-allocations'))return Response.json(season);
 if(String(url).includes('harvest-context'))return Response.json({status:'ready',harvestedMassKg:0,harvestedAreaHa:0,yieldStatus:'not_available'});
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
export const useLiveRefresh=options=>{if(options.enabled){if(options.tables?.includes('ptc_vehicle_states'))state.trafficRefresh=options.onRefresh;else state.refresh=options.onRefresh}};
const query=new Proxy({}, {get:(_,key)=>key==='then'?((done)=>Promise.resolve({data:[],error:null}).then(done)):(()=>query)});
export const supabase={from:()=>query,rpc:async()=>({data:[],error:null}),auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})},channel:()=>query,removeChannel:()=>{}};
export const buildClientAuthHeaders=async()=>({});
export const getWeighbridgeOperatorState=async(...args)=>{call('operator',args);return {unlocked:true,shift:state.shift,operators:[{id:'operator',full_name:'Проверка'}],operator:{id:'operator',full_name:'Проверка'},initial_workspace:args[1]?.includeWorkspace?{resources,harvestAllocations:season}:undefined}};
export const getWeighbridgeResources=async(...args)=>{call('resources',args);return resources};
export const getWeighbridgeTransportPickerData=async()=>({recentPairs:[],openAssignments:[],latestDriverByVehicle:{},latestVehicleByDriver:{}});
export const getWeighbridgeBootstrap=async()=>({shift:state.shift});
export const getWeighbridgeShiftPreview=async()=>({});
export const listActiveHarvestRoutes=async()=>({...season,active:[],completed:[]});
export const listWeighbridgeWorkspaceTickets=async()=>({open:state.tickets.filter(t=>t.status==='active'),history:state.tickets.filter(t=>t.status==='finalized'),tickets:state.tickets,hasMore:false});
const yesterday=new Date(Date.now()+5*3600000-86400000).toISOString().slice(0,10);
const historyShift={id:'00000000-0000-4000-8000-000000000001',status:'closed',opened_at:yesterday+'T08:00:00+05:00',closed_at:new Date().toISOString()};
const historyRows=${historyScenario ? 'Array.from({length:132},(_,i)=>({id:"history-"+i,ticket_no:"HISTORY-"+String(i+1).padStart(3,"0"),company_id:company,shift_id:historyShift.id,status:i===0?"voided":"finalized",is_voided:i===0,is_finalized:i!==0,op_type:i%3===0?"weighbridge_impurities":"harvest_incoming",created_at:new Date(Date.parse(yesterday+"T10:00:00+05:00")+i*60000).toISOString(),finalized_at:new Date(Date.parse(yesterday+"T10:00:00+05:00")+i*60000+600000).toISOString(),gross_weight_kg:20000,tare_weight_kg:10000,net_weight_kg:10000,vehicle_id:"v1",driver_id:"d1",field_id:"f9",warehouse_to_id:"wh",warehouse_from_id:"wh",lines:[]})).reverse()' : '[]'};
${correctionScenario ? `historyRows.splice(0,historyRows.length,{id:'soil-correction',ticket_no:'SOIL-QA',company_id:company,shift_id:shift.id,status:'finalized',is_finalized:true,op_type:'weighbridge_impurities',gross_weight_kg:12866,tare_weight_kg:7400,net_weight_kg:5466,created_at:new Date().toISOString(),finalized_at:new Date().toISOString(),vehicle_id:'v1',driver_id:'d1',warehouse_from_id:'wh',lines:[],impurity_source_scope:{allocation_mode:'unresolved_total',source_count:1,sources:[]}});` : ''}
export const correctSharedImpurityWeights=async(id,input)=>{call('sharedCorrection',{id,input});if(state.correctionFail){state.correctionFail=false;throw new Error('Проверка повтора: связь потеряна');}const t=historyRows.find(t=>t.id===id);const old={gross_weight_kg:t.gross_weight_kg,tare_weight_kg:t.tare_weight_kg,net_weight_kg:t.net_weight_kg};t.gross_weight_kg=input.gross_weight_kg;t.tare_weight_kg=input.tare_weight_kg;t.net_weight_kg=input.gross_weight_kg-input.tare_weight_kg;t.correction_audit=[{id:'revision',action:'shared_impurity_weight_corrected',when_at:new Date().toISOString(),reason:input.reason,old_values:old,new_values:{gross_weight_kg:t.gross_weight_kg,tare_weight_kg:t.tare_weight_kg,net_weight_kg:t.net_weight_kg}}];return {ok:true,ticket:{id}}};
export const listTicketHistoryShifts=async()=>({shifts:[state.shift,historyShift],nextCursor:null});
export const listTicketHistoryPage=async(_company,_user,options={})=>{call('history',{filters:options.filters,cursor:options.cursor});const f=options.filters||{};const selected=historyRows.filter(t=>(!f.shiftId||t.shift_id===f.shiftId)&&(!f.from||t.created_at>=f.from)&&(!f.to||t.created_at<f.to)&&(!f.operation||t.op_type===f.operation)&&(!f.status||t.status===f.status));const start=Number(options.cursor||0);if(state.historyFail){state.historyFail=false;throw new Error('Проверка ошибки загрузки');}if(state.historyDelay)await new Promise(r=>setTimeout(r,state.historyDelay));const tickets=selected.slice(start,start+(options.limit||50));const next=start+tickets.length;return {tickets,hasMore:next<selected.length,nextCursor:next<selected.length?String(next):null}};
export const listHarvestBatchSummaries=async(...args)=>{call('batches',args);const rows=state.batches.filter(b=>!args[1]?.warehouseId||b.warehouseId===args[1].warehouseId).map(b=>({...b,...(!args[1]?.summaryOnly?{detailLevel:'full'}:{})}));if(state.delay)await new Promise(r=>setTimeout(r,state.delay));return rows};
export const createTicket=async(...args)=>{call('create',args);const input=args[0];const ticket={...input,id:'ticket-'+(state.tickets.length+1),ticket_no:'FIXTURE-'+(state.tickets.length+1),status:'active',created_at:new Date().toISOString(),lines:args[1],gross_weight_kg:input.gross_weight_kg};state.tickets.push(ticket);return {ticket}};
export const getTicketDetails=async(id)=>({ticket:historyRows.find(t=>t.id===id)||state.tickets.find(t=>t.id===id)||state.tickets.at(-1)});
export const finalizeTicket=async(...args)=>{call('finalize',args);const ticket=state.tickets.at(-1);ticket.status='finalized';return {ticket}};
`;
const serviceNames = ['adminTicketAction','changeActiveHarvestRouteContext','closeShift','createActiveHarvestRoute','downloadTicketPdf','handoverWeighbridgeOperator','patchTicket','startTicketCorrection','unlockWeighbridgeOperator','updateActiveHarvestRoute','voidTicket','createWarehouseTransfer','performProcessingAction'];
const noopExports = serviceNames.map(n=>`export const ${n}=async()=>({});`).join('\n');
const mocks = new Set(['@/lib/contexts/auth-context','@/lib/contexts/language-context','@/hooks/use-toast','@/hooks/use-live-refresh','@/lib/supabase/client','@/lib/supabase/client-auth','@/lib/services/weighbridge','@/lib/services/warehouses','@/lib/services/processing']);
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import './fixture-mocks';import Page from './app/(dashboard)/weighbridge/page';
function Tools(){return <aside style={{position:'fixed',top:0,right:0,zIndex:99999,background:'white',color:'black'}}><button onClick={()=>window.fixture.refresh?.({source:'realtime',tables:['inventory_batches']})}>Обновить остатки (проверка)</button><button onClick={()=>{window.fixture.shift={...window.fixture.shift,id:'next-shift'};window.fixture.refresh?.({source:'realtime',tables:['weighbridge_shifts']})}}>Обновить смену (проверка)</button><button onClick={()=>{window.fixture.batches=[];window.fixture.refresh?.({source:'realtime',tables:['inventory_batches']})}}>Временно пустой список</button><button onClick={()=>{window.fixture.batches=window.fixture.originalBatches;window.fixture.refresh?.({source:'realtime',tables:['inventory_batches']})}}>Вернуть список</button><button onClick={()=>{window.fixture.delay=6000;window.fixture.refresh?.({source:'realtime',tables:['inventory_batches']})}}>Медленное обновление</button><button onClick={()=>{const pre=document.getElementById('fixture-result');pre.textContent=JSON.stringify({calls:window.fixture.calls,toasts:window.fixture.toasts,workspace:localStorage.getItem('travkin.weighbridge.universalWorkspaces.v3.${company}.fixture-season.fixture-terminal')})}}>Результат проверки</button>${trafficScenario ? `<button onClick={()=>{window.fixture.traffic.vehicles[1].group=\'unloading\';window.fixture.trafficRefresh?.({source:\'realtime\'});}}>ПТС: сменить статус</button><button onClick={()=>{window.fixture.trafficFail=true;window.fixture.trafficRefresh?.({source:\'realtime\'});}}>ПТС: ошибка</button><button onClick={()=>{window.fixture.trafficFail=false;window.fixture.trafficDelay=5000;window.fixture.trafficRefresh?.({source:\'realtime\'});}}>ПТС: медленно</button><button onClick={()=>{window.fixture.trafficFail=false;window.fixture.trafficDelay=0;window.fixture.trafficRefresh?.({source:\'realtime\'});}}>ПТС: восстановить</button>` : ''}<pre id="fixture-result" style={{maxHeight:200,maxWidth:700,overflow:'auto'}}/></aside>};createRoot(document.getElementById('root')).render(<><Tools/><Page/></>);`;
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
const css=!historyScenario && existsSync(resolve('.next/static/css'))
 ? readdirSync(resolve('.next/static/css')).filter(name=>name.endsWith('.css')).map(name=>readFileSync(resolve('.next/static/css',name),'utf8')).join('\n')
 : (await require('postcss')([require('tailwindcss')({config:resolve('tailwind.config.ts')})]).process(readFileSync(resolve('app/globals.css'),'utf8'),{from:resolve('app/globals.css')})).css;
const server=createServer((req,res)=>{
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\nbody{margin-top:60px;background:#181a14;color:#eee}aside{max-width:750px}aside button{padding:5px;font-size:12px}button{cursor:pointer} [data-testid=impurity-source-picker] [role=group]{border:1px solid #666;padding:12px} [data-testid=impurity-source-picker] label{display:inline-flex}</style></head><body><div id="root"></div>${historyScenario ? '<div style="position:fixed;bottom:0;right:0;z-index:99999;background:white;color:black"><button onclick="window.fixture.historyDelay=3000">Медленная история (проверка)</button> <button onclick="window.fixture.historyDelay=0;window.fixture.historyFail=true">Ошибка истории (проверка)</button></div>' : ''}<script src="/fixture.js"></script></body></html>`);
});
server.listen(4179,'127.0.0.1',()=>console.log('WEIGHBRIDGE_FIXTURE http://127.0.0.1:4179 (local fake data only)'));
