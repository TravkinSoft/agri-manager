/* Local real-component harness; all service calls replaced, no Production access.
 * Start with --serve, then interact using the browser tool. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = process.cwd();
const out = path.join(root, 'scripts/output/summary-sections/browser');
const source = `
import React, {useState, createContext, useContext} from 'react';
import {createRoot} from 'react-dom/client';
import {HarvestDashboard} from './components/dashboard/harvest-dashboard';
import {Sidebar} from './components/layout/sidebar';
import {MobileBottomNav} from './components/layout/mobile-bottom-nav';
import {QaAuth} from '@/lib/contexts/auth-context';
import {buildCombineWorkday} from './lib/dashboard/combine-workday';
const period={start:'2026-09-21T02:00:00Z',end:'2026-09-22T02:00:00Z',label:'21.09 07:00 — 22.09 07:00',operationalDayStartHour:7};
window.qa={calls:[],role:'agronomist',company:'A',deny:false,slow:false};
window.qaLog=()=>{document.getElementById('qa-log').textContent=JSON.stringify(window.qa.calls,null,2)};
const shifts=[{id:'first',operator_user_id:'operator',operator_name:'Комбайнёр (тест)',opened_at:'2026-09-21T02:14:14Z',closed_at:'2026-09-21T15:55:45Z',current_crop_structure_id:'new24',hectares_shift:14.3},{id:'second',operator_user_id:'operator',operator_name:'Комбайнёр (тест)',opened_at:'2026-09-21T15:56:58Z',closed_at:'2026-09-21T19:48:22Z',current_crop_structure_id:'new24',hectares_shift:5.87}];
window.combine=buildCombineWorkday({companyId:'A',serverTime:new Date().toISOString(),period,shifts,segments:[{id:'a',shift_id:'first',crop_structure_id:'old54',field_id:'old',planned_area_ha:54,ended_field_total_ha:52,hectares_segment:14.3,closed_at:shifts[0].closed_at},{id:'b',shift_id:'second',crop_structure_id:'new24',field_id:'new',planned_area_ha:24,ended_field_total_ha:5.87,hectares_segment:5.87,closed_at:shifts[1].closed_at}],plots:[{id:'old54',label:'Виноград · участок 54 га · Гала · 1 репродукция',areaHa:54,totalHa:52,status:'completed'},{id:'new24',label:'Виноградовка · участок 24 га · Гала · 1 репродукция',areaHa:24,totalHa:5.87,status:'active'}]});
const plot=(id,area,current,total,ha)=>({cropStructureAllocationId:id,fieldId:id==='old54'?'old':'new',fieldName:id==='old54'?'Виноград':'Виноградовка',seasonId:'2026',cropId:'potato',cropName:'Картофель',varietyId:'gala',varietyName:'Гала',reproductionId:'r1',reproductionName:'1 репродукция',areaHa:area,fieldAreaHa:id==='old54'?54:92,completedAreaHa:ha,harvestedAreaHa:ha,areaPending:false,latestShiftAreaHa:ha,combineShiftOpen:false,acceptedKg:10000,totalAcceptedKg:total,yieldTPerHa:total/1000/ha,status:id==='old54'?'completed':'active',isCurrent:current,startedAt:period.start,lastChangedAt:period.end});
window.harvest={period,completedTripCount:29,openTicketCount:2,potatoAcceptedKg:303300,potatoPeriodMovement:{receivedNetKg:320000,removedImpuritiesKg:16700,netAfterRemovalsKg:303300,unresolvedTicketCount:0},currentPlotTotalAcceptedKg:100600,currentPlotHarvestedAreaStatus:'verified',parties:[{cropName:'Картофель',currentStockKg:8000000}],harvestPlots:[plot('old54',54,false,1200000,52),plot('new24',24,true,100600,5.87)],harvestFields:[],weighbridgeShifts:[{id:'wb1',status:'closed',opened_at:period.start,closed_at:period.end,summary_json:{version:'weighbridge_shift_snapshot_v1',potatoPeriodResultKg:303300,potatoNetKg:320000,closedTicketCount:29}}]};
window.traffic={companyId:'A',readOnly:true,serverTime:new Date().toISOString(),vehicles:['empty','loaded','unloading','repair','offline'].map((group,i)=>({id:group,name:'КАМАЗ',brand:'КАМАЗ',plate:'TEST 00'+i,driver:'Тестовый водитель с длинным именем '+i,group,since:'2026-09-21T19:00:00Z'}))};
function App(){const[role,setRole]=useState('agronomist'),[company,setCompany]=useState('A');return <QaAuth.Provider value={{profile:{id:'qa-'+role,role,company_id:company},loading:false}}>
<div className="border-b border-border p-2 text-xs"><strong>ЛОКАЛЬНЫЙ ТЕСТ · Production не подключён</strong><div className="mt-2 flex flex-wrap gap-3"><label>Роль <select aria-label="QA роль" value={role} onChange={e=>{window.qa.role=e.target.value;setRole(e.target.value)}}><option value="agronomist">Агроном</option><option value="director">Директор</option><option value="weighman">Весовщик</option></select></label><button onClick={()=>{const c=company==='A'?'B':'A';window.qa.company=c;setCompany(c)}}>QA: компания {company}</button><label><input type="checkbox" onChange={e=>window.qa.deny=e.target.checked}/> QA: отказ доступа</label><label><input type="checkbox" onChange={e=>window.qa.slow=e.target.checked}/> QA: медленный ответ</label></div></div>
<div className="flex min-w-0"><aside className="hidden w-64 shrink-0 md:block"><Sidebar/></aside><main className="min-w-0 flex-1 p-3 pb-24"><HarvestDashboard/><details className="mt-8"><summary>QA журнал запросов</summary><pre id="qa-log" className="whitespace-pre-wrap break-all text-[10px]">[]</pre></details></main></div><MobileBottomNav/>
</QaAuth.Provider>}; createRoot(document.getElementById('app')).render(<App/>);`;
const auth = `import React from 'react'; export const QaAuth=React.createContext(null); export const useAuth=()=>React.useContext(QaAuth);`;
const traffic = `export async function trafficRequest(path,method='GET',body,bypass,signal){
 const company=new URL(path,'http://localhost').searchParams.get('companyId'); window.qa.calls.push({path,method,company});window.qaLog();
 await new Promise((resolve,reject)=>{const t=setTimeout(resolve,window.qa.slow?2000:25);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('aborted'))},{once:true})});
 if(window.qa.deny){const e=new Error('No access');e.status=403;throw e;}
 return {...(path.includes('combine-summary')?window.combine:window.traffic),companyId:company};}`;
const services = `export async function getHarvestBootstrap(q){return {summary:await getHarvestSummary(q)}};export async function getHarvestSummary(q){window.qa.calls.push({path:'harvest-summary',includeDriverStats:q.includeDriverStats,company:window.qa.company});window.qaLog();return window.harvest;}`;
const refresh = `import{useEffect}from'react';export const LIVE_REFRESH_TABLES={weighbridge:['tickets']};export function useLiveRefresh({enabled,onRefresh,intervalMs}){useEffect(()=>{if(!enabled)return;const id=setInterval(onRefresh,intervalMs);return()=>clearInterval(id)},[enabled,onRefresh,intervalMs])}`;
const stubs = {
  '@/lib/contexts/auth-context':auth,
  '@/components/traffic/use-traffic':traffic,
  '@/lib/services/harvest-dashboard':services,
  '@/hooks/use-live-refresh':refresh,
  '@/lib/traffic/changes':`export const subscribeTrafficChanges=()=>()=>{};`,
  '@/lib/contexts/sidebar-context':`export const useSidebar=()=>({isCollapsed:false});`,
  '@/lib/contexts/language-context':`export const useLanguage=()=>({language:'ru',t:k=>({dashboard:'Панель',harvest_summary:'Сводка',weighbridge:'Весовая',crop_structure:'Структура посевов',warehouses:'Склады',traffic:'Оборот машин',mobile_more:'Ещё',field_map:'Карта полей',weather:'Погода',analytics:'Аналитика'}[k]||k)});`,
  '@/components/operations/system-health-badge':`export const SystemHealthBadge=()=>null;`,
  '@/components/layout/travkin-logo':`export const TravkinLogo=()=> 'TravkinFlow';`,
  'next/navigation':`export const usePathname=()=>'/dashboard';export const useRouter=()=>({});`,
  'next/link':`import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}`,
};
async function main(){
  fs.mkdirSync(out,{recursive:true});
  await require('esbuild').build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,jsx:'automatic',outfile:path.join(out,'browser.js'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'qa-stubs',setup(build){
    build.onResolve({filter:/.*/},args=>stubs[args.path]?{path:args.path,namespace:'qa'}:undefined);
    build.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:root}));
  }}]});
  const css=await require('postcss')([require('tailwindcss')({config:path.join(root,'tailwind.config.ts'),content:[{raw:source,extension:'tsx'},'components/dashboard/**/*.tsx','components/layout/**/*.tsx','components/ui/**/*.tsx','components/weighbridge/shift-report.tsx']})]).process(fs.readFileSync(path.join(root,'app/globals.css'),'utf8'),{from:path.join(root,'app/globals.css')});
  fs.writeFileSync(path.join(out,'browser.css'),css.css);
  if(process.argv.includes('--build-only'))return;
  const server=http.createServer((req,res)=>{
    if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="ru" data-theme="estate-graphite"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Summary tabs local QA</title><link rel="stylesheet" href="/browser.css"><body class="tf-manor"><div id="app"></div><script src="/browser.js"></script></body></html>');}
    if(['/browser.js','/browser.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');return fs.createReadStream(path.join(out,path.basename(req.url))).pipe(res);}
    res.statusCode=404;res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  console.log('LOCAL_FIXTURE_URL=http://127.0.0.1:'+server.address().port);
}
main().catch(error=>{console.error(error);process.exitCode=1});
