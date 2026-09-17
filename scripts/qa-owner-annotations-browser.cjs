// Real components with local transport: never sends production business commands.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'package.json'));
req('tsx/cjs');
const output = path.join(root, '.artifacts', 'owner-annotations');
fs.mkdirSync(output, {recursive:true});

async function main() {
  const fixture = `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {HarvestDashboard} from './components/dashboard/harvest-dashboard';
    import {TrafficBoard} from './components/traffic/traffic-board';
    import {TrafficShiftControls} from './components/traffic/traffic-shift-controls';
    window.calls=[]; window.trafficLoads=0; window.changed=false;
    const shift={id:'shift',status:'open',openedAt:'2026-09-17T01:57:00Z',cropStructureId:'plot',fieldId:'field'};
    const car={vehicle_id:'car',name:'Truck',brand:'ZIL',driver:'Иван',plate:'QA-123',state:'empty',assigned:true,version:1,cycle:1,since:'2026-09-17T01:57:00Z'};
    window.snapshot={role:'harvester',companyId:'qa',personName:'QA',enabled:true,serverTime:'2026-09-17T07:20:30Z',fieldId:'field',fieldName:'28',combineShift:shift,vehicles:[car],events:[]};
    window.plot={cropStructureId:'plot',fieldId:'field',fieldName:'28',cropName:'Картофель',varietyName:'Сорая',reproductionName:'1',plannedAreaHa:12,actualCompletedHa:8.34,remainingAreaHa:3.66,status:'active'};
    const driver=(key,kg,trips)=>({key,driverId:key,driverName:key,netWeightKg:kg,tripCount:trips,averageNetWeightKg:kg/trips,vehicles:[{vehicleId:key,label:'МТЗ · '+key}],lastTripAt:'2026-09-17T07:00:00Z',averageTripMinutes:5,timedTripCount:1});
    window.summary=(offset=0)=>({period:{label:offset?'16.09, 07:00 — 17.09, 07:00':'17.09, 07:00 — сейчас'},potatoAcceptedKg:offset||window.changed?12000:4000,currentPlotAcceptedKg:4000,parties:[],harvestPlots:[{...window.plot,cropStructureAllocationId:'plot',isCurrent:true,acceptedKg:3000,areaHa:12},{...window.plot,cropStructureAllocationId:'old',fieldName:'Предыдущее поле',status:'completed',acceptedKg:1000,areaHa:12}],potatoDrivers:offset?[driver('Вчера',12000,3)]:window.changed?[driver('A',9000,10),driver('B',3000,1)]:[driver('A',1000,10),driver('B',3000,1)]});
    window.seasonSummary=()=>({...window.summary(),period:{label:'01.01.2026 07:00 — сейчас'},potatoAcceptedKg:window.changed?1200000:400000,potatoDrivers:window.changed?[driver('A',900000,100),driver('B',300000,10)]:[driver('A',100000,100),driver('B',300000,10)]});
    createRoot(document.getElementById('app')).render(new URLSearchParams(location.search).has('operator')?
      <main style={{padding:12}}><TrafficShiftControls snapshot={window.snapshot} stale={false} refresh={async()=>{}} onCommitted={async()=>{}}/><TrafficBoard snapshot={window.snapshot} stale={false} error='' refresh={async()=>{}} onCommitted={()=>true}/></main>:
      <main style={{padding:12}}><HarvestDashboard/></main>);
  `;
  const mocks = {
    auth: `export const useAuth=()=>({profile:{company_id:'qa',role:'agronomist'}});`,
    live: `export const LIVE_REFRESH_TABLES={weighbridge:[]}; export const useLiveRefresh=o=>{window.refreshDashboard=o.onRefresh;};`,
    service: `export const getHarvestBootstrap=async()=>({summary:window.summary()}); export const getHarvestSummary=async q=>{window.calls.push({summary:q});return q.period==='season'?window.seasonSummary():window.summary(q.dayOffset||0);};`,
    shiftSummary: `export const TrafficShiftSummary=()=>null;`,
    picker: `export const VehicleDriverAssignment=()=>null;`,
    transport: `export async function trafficRequest(url,method,body){
      if(method==='POST'){window.calls.push({url,body});return {eventId:'qa-event',vehicle:{...window.snapshot.vehicles[0],state:'loaded',version:2},serverTime:window.snapshot.serverTime};}
      if(url.endsWith('/plots'))return {plots:[window.plot]};
      window.trafficLoads++;return {snapshot:{...window.snapshot,vehicles:Array.from({length:window.changed?20:2},(_,i)=>({...window.snapshot.vehicles[0],vehicle_id:'car-'+i}))},fleet:[]};
    }`,
  };
  const bundle = await req('esbuild').build({stdin:{contents:fixture,resolveDir:root,loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_PTC_BOARD_V2':'"1"'},plugins:[{name:'local-only',setup(build){
    const map={'@/lib/contexts/auth-context':'auth','@/hooks/use-live-refresh':'live','@/lib/services/harvest-dashboard':'service','@/components/dashboard/traffic-shift-summary':'shiftSummary','@/components/vehicles/vehicle-driver-assignment':'picker','@/components/traffic/use-traffic':'transport','./use-traffic':'transport'};
    build.onResolve({filter:/.*/},args=>map[args.path]?{path:map[args.path],namespace:'mock'}:undefined);
    build.onResolve({filter:/^@\//},args=>({path:req.resolve(path.join(root,args.path.slice(2)))}));
    build.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'js'}));
  }}]});
  const config=req(path.join(root,'tailwind.config.ts')).default;
  config.content=[path.join(root,'components/dashboard/*.tsx'),path.join(root,'components/traffic/*.tsx'),path.join(root,'components/ui/*.tsx')];
  const css=(await req('postcss')([req('tailwindcss')(config)]).process(fs.readFileSync(path.join(root,'app/globals.css'),'utf8'),{from:undefined})).css;
  const server=http.createServer((r,s)=>{s.setHeader('Content-Type','text/html; charset=utf-8');s.end('<!doctype html><html data-theme="estate-graphite"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="app"></div><script>'+bundle.outputFiles[0].text+'</script></body></html>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const errors=[];
  try {
    const page=await browser.newPage({viewport:{width:1280,height:930}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
    await page.goto(base);
    const rows=page.locator('[data-driver-id]');
    await page.locator('[data-rank="1"][data-driver-id="B"]').waitFor();
    const champions=page.getByRole('region',{name:'Таблица чемпионов',exact:true});
    assert.match(await champions.innerText(),/За весь сезон/);
    assert.match(await rows.first().innerText(),/300 т/);
    assert.equal(await champions.getByRole('button',{name:'Показать предыдущий рабочий день'}).count(),0);
    assert.match(await page.getByLabel('Итоги выбранного рабочего дня').innerText(),/12 т/);
    assert.equal(await page.getByText(/^(Лидер|Самый быстрый|Больше всего тонн|Среднее время)$/).count(),0);
    assert(!/\d{2}:\d{2}/.test(await page.getByLabel('Текущее поле',{exact:true}).innerText()));
    await page.getByRole('tab',{name:/Предыдущее поле/}).click();
    assert.match(await page.getByLabel('Текущее поле',{exact:true}).innerText(),/Live[\s\S]*Завершено[\s\S]*Предыдущее поле/i);
    const geometry=()=>page.locator('[aria-labelledby="potato-driver-champions-title"]').evaluate(e=>({y:e.getBoundingClientRect().top+scrollY,height:e.getBoundingClientRect().height}));
    const before=await geometry();
    await rows.first().evaluate(e=>window.firstRow=e);
    await page.evaluate(async()=>{window.changed=true;await window.refreshDashboard();});
    await page.waitForFunction(()=>window.trafficLoads>=2);
    assert.deepEqual(await geometry(),before,'background traffic update must not move the table');
    assert.equal(await rows.first().evaluate(e=>e===window.firstRow),true);
    assert.equal(await rows.first().getAttribute('data-driver-id'),'B','background updates preserve ranking until requested');
    const lane=page.getByLabel('Машины: Пустые',{exact:true}).last();
    assert.deepEqual(await lane.evaluate(e=>({height:e.clientHeight,scrollable:e.scrollHeight>e.clientHeight,bar:getComputedStyle(e).scrollbarWidth})),{height:460,scrollable:true,bar:'none'});
    await page.getByRole('button',{name:'Обновить',exact:true}).click();
    await page.locator('[data-rank="1"][data-driver-id="A"]').waitFor();
    assert.match(await rows.first().innerText(),/900 т/);
    const seasonRows=await champions.innerText();
    await page.getByRole('button',{name:'Показать предыдущий рабочий день'}).click();
    await page.waitForFunction(()=>window.calls.some(c=>c.summary?.dayOffset===2));
    assert.match(await page.getByLabel('Итоги выбранного рабочего дня').innerText(),/12 т/);
    assert.equal(await champions.innerText(),seasonRows,'daily navigation must not change season champions');
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.summary?.period==='season').length),2,'season loads only initially and on explicit refresh');
    await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
    for(const width of [1024,768,360]){
      await page.setViewportSize({width,height:930});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+'px overflow');
    }
    await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});

    const operator=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    operator.on('pageerror',e=>errors.push(e.message));
    await operator.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
    await operator.goto(base+'/?operator');
    await operator.getByTestId('traffic-combine-shift').getByRole('button').first().click();
    assert.match(await operator.getByTestId('shift-elapsed').innerText(),/В работе 5 ч 23 мин/);
    assert.equal(await operator.getByTestId('shift-remaining').innerText(),'3,66 га');
    await operator.screenshot({path:path.join(output,'shift.png'),fullPage:true});
    await operator.keyboard.press('Escape');
    const card=operator.getByTestId('traffic-vehicle-car');
    const cdp=await operator.context().newCDPSession(operator);
    async function gesture(mode){
      const b=await card.boundingBox(); const x=b.x+20,y=b.y+b.height/2;
      const touch=(type,dx)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x:x+dx,y,id:1}]});
      await touch('touchStart',0);
      const distance=b.width*(mode==='short'?.3:.74);
      for(let i=1;i<=8;i++)await touch('touchMove',distance*i/8);
      await operator.waitForTimeout(450);
      assert.equal(await operator.evaluate(()=>window.calls.filter(c=>c.body).length),0,'no command while held');
      if(mode==='retract')await touch('touchMove',b.width*.2);
      await touch(mode==='cancel'?'touchCancel':'touchEnd',distance);
      if(mode==='accept')await operator.waitForFunction(()=>window.calls.some(c=>c.body));
      else await operator.waitForTimeout(400);
      assert.equal(await operator.evaluate(()=>window.calls.filter(c=>c.body).length),mode==='accept'?1:0,mode);
    }
    for(const mode of ['short','retract','cancel','accept'])await gesture(mode);
    assert.deepEqual(errors,[]);
    console.log('PASS: full dashboard stable on polling, tonnes-first, daily history, manual refresh, 3 viewport widths, hidden scrollbar; shift elapsed/remaining; trusted touch short/hold/retract/cancel/release.');
  } finally {await browser.close();server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
