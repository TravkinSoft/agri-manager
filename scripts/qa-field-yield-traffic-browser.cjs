// Real React components and calculation model, fixture network/auth only.
// No production credentials, live tickets or mutations. Test server is loopback-only.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), out = path.join(__dirname, 'output/field-yield-traffic');
const source = `import React from 'react';import {createRoot} from 'react-dom/client';
import {HarvestDashboard} from './components/dashboard/harvest-dashboard';
import {ReadOnlyTrafficBoard} from './components/weighbridge/read-only-traffic-board';
import {buildHarvestOverview,resolveHarvestPeriod} from './lib/dashboard/harvest-summary';
const period=resolveHarvestPeriod({preset:'current_day',now:new Date('2026-09-21T15:00:00Z')});
window.fixtureProfile={id:'user',role:'director',company_id:'company'};
window.makeSummary=(pending,invalidArea)=>{
const plots=['a24','a68'].map((id,i)=>({cropStructureAllocationId:id,fieldId:'field92',fieldName:'Виноградовка',fieldAreaHa:92,seasonId:'s26',cropId:'potato',cropName:'Картофель',varietyId:'gala',varietyName:'Гала',reproductionId:id,reproductionName:i?'4':'1',areaHa:i?68:24,harvestedAreaHa:i?30:10,completedAreaHa:null,combineShiftOpen:pending&&i===1,areaPending:pending&&i===1,acceptedKg:0,totalAcceptedKg:0,yieldTPerHa:null,status:'active',isCurrent:i===0,startedAt:period.start,lastChangedAt:period.start}));
const tickets=plots.map((p,i)=>({id:'ticket'+i,op_type:'harvest_incoming',status:'finalized',is_finalized:true,is_voided:false,net_weight_kg:i?307000:207000,harvest_clean_weight_kg:i?300000:200000,field_id:p.fieldId,field_name_snapshot:p.fieldName,season_id:p.seasonId,crop_structure_allocation_id:p.cropStructureAllocationId,created_at:'2026-09-21T03:00:00Z',finalized_at:'2026-09-21T04:00:00Z',lines:[{id:'line'+i,crop_id:p.cropId,crop_name:p.cropName,product_name:p.cropName,variety_id:p.varietyId,variety_name:p.varietyName,reproduction_id:p.reproductionId,reproduction_name:p.reproductionName}]}));
if(invalidArea)plots[0].harvestedAreaHa=51;
return buildHarvestOverview(tickets,{period,harvestPlots:plots,includeDriverStats:false});};
window.fixtureSwitchCompany=(company)=>{window.fixtureProfile={...window.fixtureProfile,company_id:company};window.dispatchEvent(new Event('fixture-auth'));};
createRoot(document.getElementById('app')).render(<main className="tf-manor-shell mx-auto max-w-[1500px] space-y-5 p-3"><HarvestDashboard/><div className="rounded-xl border border-border p-3 text-sm">Рабочая зона весовой — талоны</div><ReadOnlyTrafficBoard/><div className="rounded-xl border border-border p-3 text-sm">Статистика</div></main>);`;
const stubs = {
  auth: `import {useState,useEffect} from 'react';export function useAuth(){const [profile,setProfile]=useState(window.fixtureProfile);useEffect(()=>{const update=()=>setProfile(window.fixtureProfile);window.addEventListener('fixture-auth',update);return()=>window.removeEventListener('fixture-auth',update)},[]);return{profile}}`,
  live: `import {useEffect} from 'react';export const LIVE_REFRESH_TABLES={weighbridge:[]};export function useLiveRefresh(o){useEffect(()=>{const name=o.intervalMs===5000?'refreshBoard':'refreshDashboard';window[name]=o.onRefresh;window[name+'Interval']=o.intervalMs;return()=>{delete window[name]}},[o.onRefresh]);}`,
  changes: `export function subscribeTrafficChanges(company,callback){window.trafficChanged=()=>callback(company,'traffic');return()=>{delete window.trafficChanged}}`,
  service: `export async function getHarvestSummary(_,options){const response=await fetch('/fixture/summary',{method:'GET',signal:options?.signal});const {pending,invalidArea}=await response.json();return window.makeSummary(pending,invalidArea);}export async function getHarvestBootstrap(q,o){return{summary:await getHarvestSummary(q,o),options:{}}}`,
  traffic: `export async function trafficRequest(path,method='GET',_,__,signal){const response=await fetch(path,{method,signal});if(!response.ok){const error=new Error('fixture unavailable');error.status=response.status;throw error;}return response.json();}`,
  report: `export const TrafficShiftSummary=()=>null;`,
  history: `export const WeighbridgeShiftHistory=()=>null;`,
};
async function main() {
  fs.mkdirSync(out, { recursive: true });
  await require('esbuild').build({ stdin: { contents: source, resolveDir: root, loader: 'tsx' }, bundle: true, jsx: 'automatic', outfile: path.join(out,'browser.js'), define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name:'fixtures', setup(build) {
    const paths = [['lib/contexts/auth-context','auth'],['hooks/use-live-refresh','live'],['lib/traffic/changes','changes'],['lib/services/harvest-dashboard','service'],['components/traffic/use-traffic','traffic'],['components/dashboard/traffic-shift-summary','report'],['components/dashboard/weighbridge-shift-history','history']];
    for(const [suffix,name] of paths) build.onResolve({filter:new RegExp(suffix+'$')},()=>({path:name,namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js',resolveDir:root}));
  } }] });
  const css = await require('postcss')([require('tailwindcss')({config:path.join(root,'tailwind.config.ts'),content:[{raw:source,extension:'tsx'},'components/dashboard/harvest-dashboard.tsx','components/weighbridge/read-only-traffic-board.tsx']})]).process(fs.readFileSync(path.join(root,'app/globals.css'),'utf8'),{from:path.join(root,'app/globals.css')});
  fs.writeFileSync(path.join(out,'browser.css'),css.css);
  let mode='normal', pending=false, invalidArea=false, generation=0;
  const calls=[];
  const board = companyId => ({companyId,readOnly:true,serverTime:new Date().toISOString(),vehicles:['empty','loaded','unloading','repair','offline'].map((group,i)=>({id:group,name:'HOWO '+(754+i),brand:'HOWO',plate:''+(754+i),driver:(companyId==='company'?'Водитель':'Другая компания')+' '+i,group:generation&&group==='loaded'?'unloading':group,since:new Date(Date.now()-65*60_000).toISOString()}))});
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');calls.push({url:url.pathname,method:req.method});
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="ru" data-theme="estate-graphite"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Field yield and readonly PTC QA</title><link rel="stylesheet" href="/browser.css"><body class="tf-manor"><div id="app"></div><script src="/browser.js"></script></body></html>');}
    if(url.pathname==='/favicon.ico'){res.statusCode=204;return res.end();}
    if(url.pathname==='/fixture/summary'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({pending,invalidArea}));}
    if(url.pathname==='/api/traffic/board'){
      const next=board(url.searchParams.get('companyId'));const currentMode=mode;
      const send=()=>{res.setHeader('Content-Type','application/json');res.statusCode=currentMode==='fail'?503:currentMode==='forbidden'?403:200;res.end(JSON.stringify(next));};
      if(currentMode==='delay')return setTimeout(send,1200);return send();
    }
    const file=['/browser.js','/browser.css'].includes(url.pathname)?path.join(out,path.basename(url.pathname)):null;
    if(!file){res.statusCode=404;return res.end();}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  if(process.argv.includes('--serve')){console.log(url);return;}
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const passed=[];
  try{
    const page=await browser.newPage({viewport:{width:1440,height:980}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);const rail=page.getByRole('tablist',{name:'Активное и предыдущие поля'}),metrics=page.getByRole('region',{name:'Главные показатели уборки'}),ptc=page.getByRole('region',{name:'ПТС весовой — только просмотр'});
    await rail.getByRole('tab',{name:/Всё поле/}).waitFor();await ptc.getByText('Водитель 4',{exact:true}).waitFor();
    assert.equal(await rail.getByRole('tab').count(),3);await rail.getByRole('tab',{name:/Всё поле/}).click();
    assert((await metrics.innerText()).includes('12,5 т/га'));assert((await metrics.innerText()).includes('500 т'));assert((await metrics.innerText()).includes('40 га'));
    assert(!(await rail.innerText()).includes('отклонение'));passed.push('whole field 500 clean t / 40 confirmed ha = 12.5, 92 planned ha not denominator');
    await rail.getByRole('tab',{name:/24 га/}).click();assert((await metrics.innerText()).includes('20 т/га'));
    await rail.getByRole('tab',{name:/68 га/}).click();assert((await metrics.innerText()).includes('10 т/га'));passed.push('switch whole field / 24 ha / 68 ha');
    await rail.getByRole('tab',{name:/Всё поле/}).click();await page.evaluate(()=>window.refreshDashboard());
    assert.equal(await rail.getByRole('tab',{name:/Всё поле/}).getAttribute('aria-selected'),'true');
    for(const name of ['Пустые','В пути на весовую','На выгрузке','На ремонте','Не на линии'])assert.equal(await ptc.getByRole('region',{name,exact:true}).count(),1);
    assert.equal(await ptc.locator('article').count(),5);assert.equal(await ptc.locator('button,a,input,[role="button"],[tabindex]').count(),0);
    assert.equal(await page.evaluate(()=>window.refreshBoardInterval),5000);passed.push('5 full columns, repair/offline, plate/driver/time, no controls, 5s fallback configured');
    await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
    mode='delay';const before=await ptc.boundingBox();await page.evaluate(()=>{void window.refreshBoard()});
    await page.waitForTimeout(200);assert.equal(await ptc.locator('article').count(),5);assert.equal((await ptc.boundingBox()).height,before.height);
    await page.waitForTimeout(1300);mode='fail';await page.evaluate(()=>window.refreshBoard());assert.equal(await ptc.locator('article').count(),5);assert((await ptc.innerText()).includes('последний полученный снимок'));
    mode='normal';generation=1;await page.evaluate(()=>window.trafficChanged());await ptc.getByRole('region',{name:'На выгрузке',exact:true}).getByText('Водитель 1',{exact:true}).waitFor();passed.push('background retains cards on delay/failure; committed traffic event refreshes statuses');
    invalidArea=true;await page.evaluate(()=>window.refreshDashboard());
    await page.getByText(/Проверьте гектары участка 24 га: в закрытых сменах указано 51 га/).waitFor();
    assert(!(await metrics.innerText()).includes('т/га'));assert((await metrics.innerText()).includes('500 т'));
    await page.screenshot({path:path.join(out,'data-quality.png'),fullPage:true});passed.push('51 ha on 24 ha plot shows a data-quality warning, suppresses yield, preserves mass');
    invalidArea=false;pending=true;await page.evaluate(()=>window.refreshDashboard());assert((await metrics.innerText()).includes('Комбайнёр должен закрыть смену и указать убранные гектары'));assert(!(await metrics.innerText()).includes('т/га'));
    await metrics.getByRole('button').click();await page.getByRole('textbox').fill('40');assert(!(await page.getByRole('region',{name:'Калькулятор урожайности'}).innerText()).includes('т/га'));passed.push('open shift suppresses official and manual whole-field yield');
    await page.setViewportSize({width:360,height:800});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    for(const name of ['Пустые','В пути на весовую','На выгрузке','На ремонте','Не на линии'])assert(await ptc.getByRole('region',{name,exact:true}).isVisible());
    for(const pattern of [/24 га/,/68 га/,/Всё поле/])await rail.getByRole('tab',{name:pattern}).click();
    await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});passed.push('360px: all 5 columns, all three plot tabs usable, no horizontal page overflow');
    mode='delay';await page.evaluate(()=>window.fixtureSwitchCompany('company2'));await page.waitForTimeout(100);
    assert(!(await ptc.innerText()).includes('Водитель'));await ptc.getByText('Другая компания 4',{exact:true}).waitFor();
    mode='forbidden';await page.evaluate(()=>window.refreshBoard());assert.equal(await ptc.locator('article').count(),0);passed.push('tenant switch clears old snapshot; 403 revokes visible fleet');
    assert(calls.every(call=>call.method==='GET'));assert(!calls.some(call=>call.url==='/api/traffic/operator'));
    assert.equal(await page.locator('[data-nextjs-dialog],.vite-error-overlay,#webpack-dev-server-client-overlay').count(),0);
    assert.deepEqual(errors,[]);passed.push('GET only; no operator endpoint, JS errors or framework error overlay');
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed,requests:calls,errors},null,2));console.log(JSON.stringify({passed,screenshots:out}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
