// Real React/Radix components; only identity and business transport are stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = process.cwd(), req = createRequire(path.join(root, 'package.json'));
req('tsx/cjs');
const esbuild = req('esbuild'), postcss = req('postcss'), tailwind = req('tailwindcss');
const { chromium, webkit } = require(process.env.PTC_PLAYWRIGHT_MODULE || 'playwright');
async function main() {
  const source = `
    import React,{useState,useCallback} from 'react'; import {createRoot} from 'react-dom/client';
    import {TrafficBoard} from './components/traffic/traffic-board';
    import {TrafficAnalyticsPanel} from './components/traffic/traffic-analytics-panel';
    import {TrafficFleetControls} from './components/traffic/traffic-fleet-controls';
    const company='10000000-0000-4000-8000-000000000001';
    const initialNow=Date.now();
    const initialFleet=Array.from({length:60},(_,i)=>({id:'car-'+i,name:'КАМАЗ',plate:'НОМЕР-'+i,driver:i===5||i===6?null:'Виктор Новоковский '+i,assigned:i<2,inRepair:i===2,repairVersion:i===2?1:0,repairChangedAt:i===2?new Date(initialNow-30*60_000).toISOString():null,state:i===1?'loaded':'empty',lastActivity:new Date(initialNow-60*60_000).toISOString()}));
    const initialVehicles=initialFleet.filter(v=>v.assigned).map(v=>({...v,vehicle_id:v.id,version:0,cycle:0,since:v.lastActivity}));
    window.calls=[]; window.published=[];
    function App(){
      const [snapshot,setSnapshot]=useState({companyId:company,role:'manager',personName:'',enabled:true,fieldId:null,fieldName:null,flowRevision:new Date().toISOString(),serverTime:new Date().toISOString(),vehicles:initialVehicles,events:[]});
      const [managed,setManaged]=useState({fleet:initialFleet,canManageFleet:true,canManageRepairs:true,snapshot});
      const [selected,onSelected]=useState(null);
      const compactVehicles=[...Array.from({length:15},(_,i)=>({vehicle_id:'compact-empty-'+i,name:'КАМАЗ',brand:'КАМАЗ',plate:'ПУСТ-'+i,driver:'Водитель '+i,state:'empty',version:0,cycle:1,assigned:true,since:new Date().toISOString()})),{vehicle_id:'compact-loaded',name:'ЗИЛ',brand:'ЗИЛ',plate:'ГРУЗ-1',driver:'Загруженный Водитель',state:'loaded',version:0,cycle:1,assigned:true,since:new Date().toISOString()},{vehicle_id:'compact-repair',name:'МТЗ',brand:'МТЗ',plate:'РЕМ-1',driver:'Ремонт Водитель',state:'empty',version:0,cycle:1,assigned:true,inRepair:true,since:new Date().toISOString()}];
      const compactSnapshot={...snapshot,vehicles:compactVehicles};
      const compactFleet=[...compactVehicles.map(v=>({id:v.vehicle_id,...v,lastActivity:v.since})),{id:'compact-offline',name:'КамАЗ резерв',brand:'КамАЗ',plate:'РЕЗ-1',driver:'Резервный Водитель',state:'empty',assigned:false,lastActivity:new Date().toISOString()},{id:'compact-offline-repair',name:'МТЗ ремонт',brand:'МТЗ',plate:'РЕЗ-Р',driver:null,state:'empty',assigned:false,inRepair:true,repairVersion:3,lastActivity:new Date().toISOString()}];
      const refresh=useCallback(async()=>{
        const call=window.calls.at(-1);
        if(!call||call.applied)return;
        call.applied=true;
        if(call.url.includes('/line')){
          setManaged(m=>({...m,fleet:m.fleet.map(v=>call.body.vehicleIds.includes(v.id)?{...v,assigned:call.body.assigned}:v)}));
          setSnapshot(s=>({...s,flowRevision:new Date(Date.now()+1).toISOString(),vehicles:call.body.assigned?[...s.vehicles,...initialFleet.filter(v=>call.body.vehicleIds.includes(v.id)&&!s.vehicles.some(row=>row.vehicle_id===v.id)).map(v=>({...v,vehicle_id:v.id,assigned:true,version:0,cycle:0,since:new Date().toISOString()}))]:s.vehicles.filter(v=>!call.body.vehicleIds.includes(v.vehicle_id))}));
        }
        if(call.url.includes('/repair')){
          setManaged(m=>({...m,fleet:m.fleet.map(v=>v.id===call.body.vehicleId?{...v,inRepair:call.body.inRepair,repairVersion:2,repairChangedAt:call.responseChangedAt}:v)}));
          setSnapshot(s=>({...s,vehicles:s.vehicles.map(v=>v.vehicle_id===call.body.vehicleId?{...v,inRepair:call.body.inRepair,repairVersion:2,repairChangedAt:call.responseChangedAt}:v)}));
        }
      },[]);
      if(new URLSearchParams(location.search).has('compact'))return <main style={{padding:12}}><h1>Оборот машин</h1><section data-testid="compact-board"><TrafficBoard snapshot={compactSnapshot} fleet={compactFleet} stale={false} error='' refresh={async()=>{}} compactAgronomistMobile={true}/></section><section data-testid="compact-analytics"><TrafficAnalyticsPanel analytics={{windowLabel:'Текущая смена',windowStartedAt:new Date().toISOString(),completedLoads:4,lastLoadIntervalMinutes:12,averageLoadIntervalMinutes:14,averageFieldToWeighbridgeMinutes:18,averageUnloadingMinutes:6,averageReturnToLoadMinutes:22,averageVehicleCycleMinutes:46,latestFleetRoundMinutes:38,probableDowntimeCount:1,probableDowntimeMinutes:3,currentProbableDowntimeMinutes:null}}/></section></main>;
      return <main style={{padding:12}}><h1>Оборот машин</h1><TrafficBoard snapshot={snapshot} fleet={managed.fleet} stale={false} error='' refresh={refresh} onManageVehicle={onSelected}/>
        <TrafficFleetControls managed={managed} snapshot={snapshot} selected={selected} onSelected={onSelected} stale={false} refresh={refresh}/></main>;
    } createRoot(document.getElementById('root')).render(<App/>);
  `;
  const mocks = {
    transport: `export async function trafficRequest(url,method,body){
      const responseChangedAt=url.includes('/repair')?new Date().toISOString():null;
      window.calls.push({url,body,responseChangedAt,dialogs:document.querySelectorAll('[role=dialog],[role=alertdialog]').length,pointer:document.body.style.pointerEvents});
      await new Promise(r=>setTimeout(r,150));
      return url.includes('/repair')?{companyId:body.companyId,vehicleId:body.vehicleId,inRepair:body.inRepair,version:2,changedAt:responseChangedAt}:{};
    }`,
    changes: 'export const publishTrafficChanged=(companyId,kind="traffic")=>window.published.push({companyId,kind});',
    auth: 'export const supabase={auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};',
    drivers: `export async function loadVehicleDriverAssignment(id,company){return {companyId:company,canEdit:true,vehicle:{id,name:'КАМАЗ',plate:id,assignmentId:null,driverPersonId:null},drivers:Array.from({length:75},(_,i)=>({id:'driver-'+i,name:'Андрей Водитель '+i}))};}
      export async function saveVehicleDriverAssignment(body){window.driverSave=body;return {companyId:body.companyId,vehicle:{id:body.vehicleId,driverPersonId:body.driverPersonId}};}
      export const publishVehicleDriverAssignment=()=>{};`
  };
  const bundle=await esbuild.build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_PTC_BOARD_V2':'"1"'},
    plugins:[{name:'business-boundaries',setup(build){
      for(const [pattern,name] of [[/^\.\/use-traffic$/,'transport'],[/^@\/lib\/traffic\/changes$/,'changes'],[/^@\/lib\/supabase\/client$/,'auth'],[/^@\/lib\/vehicles\/driver-assignment-client$/,'drivers']])
        build.onResolve({filter:pattern},()=>({path:name,namespace:'mock'}));
      build.onResolve({filter:/^@\//},args=>({path:req.resolve(path.join(root,args.path.slice(2)))}));
      build.onLoad({filter:/.*/,namespace:'mock'},args=>({loader:'js',contents:mocks[args.path]}));
    }}]});
  const config=req(path.join(root,'tailwind.config.ts')).default;
  config.content=['components/traffic/*.tsx','components/vehicles/vehicle-driver-assignment.tsx','components/ui/*.tsx'].map(p=>path.join(root,p));
  const css=(await postcss([tailwind(config)]).process(fs.readFileSync('app/globals.css','utf8'),{from:undefined})).css;
  const server=http.createServer((_q,res)=>res.end('<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundle.outputFiles[0].text+'</script></body></html>'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let checks=0;
  const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
  const compactOnly=process.env.PTC_COMPACT_ONLY==='1';
  try {
    for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
      const browser=await engine.launch({headless:true,...(name==='chromium'?{channel:'chrome'}:{})});
      try {
        for(const width of compactOnly?[]:[320,390,412]) {
          const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
          const page=await context.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
          await page.goto('http://127.0.0.1:'+server.address().port);
          await page.waitForTimeout(50);
          if(errors.length)throw new Error(name+' fleet bootstrap: '+errors.join(' | '));
          await page.getByTestId('traffic-vehicle-car-0').tap();
          await page.getByRole('button',{name:'Сменить водителя',exact:true}).waitFor();
          await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>
            button.textContent?.trim()==='Сменить водителя'&&button.getBoundingClientRect().height>=48));
          check((await page.getByRole('button',{name:'Сменить водителя',exact:true}).boundingBox()).height>=48,true,'48px touch action');
          check(await page.getByRole('button',{name:'Сменить водителя',exact:true}).count(),1,'whole card opens menu');
          check(await page.getByTestId('traffic-vehicle-car-0').locator('button').count(),0,'no nested action buttons');
          await page.getByRole('button',{name:'Сменить водителя',exact:true}).tap();
          await page.getByRole('radio').last().waitFor({state:'attached'});
          const list=page.getByTestId('driver-scroll-list');
          check(await list.evaluate(el=>el.scrollHeight>el.clientHeight),true,'bounded driver scrolling');
          if(name==='chromium') {
            const box=await list.boundingBox(), cdp=await context.newCDPSession(page);
            const x=Math.round(box.x+box.width/2), y=Math.round(box.y+box.height-30);
            await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
            for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*25}]});await page.waitForTimeout(18);}
            await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
            await page.waitForTimeout(150);
            check(await list.evaluate(el=>el.scrollTop>30),true,'actual finger gesture scrolls');
          }
          await page.getByRole('textbox',{name:'Найти водителя'}).fill('Водитель 74');
          await page.getByRole('radio',{name:'Андрей Водитель 74',exact:true}).tap();
          await page.getByRole('button',{name:'Сохранить',exact:true}).tap();
          await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
          check(await page.evaluate(()=>window.driverSave.driverPersonId),'driver-74','canonical driver selected');
          check(await page.evaluate(()=>window.published.at(-1).kind),'fleet','driver assignment broadcasts typed fleet invalidation');
          await page.evaluate(()=>{window.published=[];});
          await page.getByTestId('traffic-filter-loaded').tap();
          await page.getByTestId('traffic-vehicle-car-1').tap();
          await page.getByRole('button',{name:'Отправить на ремонт',exact:true}).tap();
          const loadedRepairCopy=(await page.getByTestId('vehicle-actions').innerText()).replace(/\s+/g,' ').trim();
          check(loadedRepairCopy.includes('Таймер ремонта начнётся сразу'),true,'loaded repair starts its own timer');
          check(loadedRepairCopy.includes('Машина останется у весовщика до завершения этапа'),true,'loaded cargo stage remains actionable');
          check(loadedRepairCopy.includes('новая загрузка будет заблокирована'),true,'repair blocks a new load');
          await page.getByRole('button',{name:'Отмена',exact:true}).tap();
          check(await page.evaluate(()=>window.calls.length),0,'repair explanation has no premature request');
          check(await page.getByTestId('offline-sheet').count(),0,'old offline sheet removed');
          check(await page.getByTestId('offline-scroll-list').count(),0,'old offline scroll list removed');
          check(await page.locator('[data-testid^="traffic-group-"]').count(),5,'five board groups rendered');
          check(await page.locator('[data-testid^="traffic-vehicle-"]').count(),60,'every fleet vehicle rendered exactly once');
          await page.getByTestId('traffic-filter-offline').tap();
          const missingDriverCardLines=(await page.getByTestId('traffic-vehicle-car-5').innerText()).split('\n');
          check(missingDriverCardLines[0],'КАМАЗ','brand is primary without driver');
          check(missingDriverCardLines[1],'НОМЕР-5','plate remains visible below brand without driver');
          await page.getByTestId('traffic-vehicle-car-3').tap();
          await page.getByRole('button',{name:'Вывести на линию',exact:true}).tap();
          check(await page.getByRole('dialog').count(),0,'card line action unmounts instantly');
          await page.waitForTimeout(350);
          check(await page.evaluate(()=>window.calls[0].body.vehicleIds),['car-3'],'only selected card ID posted');
          check(await page.evaluate(()=>window.calls[0].body.assigned),true,'offline card moves onto line');
          check(await page.evaluate(()=>window.calls[0].dialogs),0,'no modal at transport entry');
          check(await page.evaluate(()=>window.published),[{companyId:'10000000-0000-4000-8000-000000000001',kind:'fleet'}],'line change broadcasts typed fleet invalidation');
          await page.getByTestId('traffic-filter-repair').tap();
          await page.getByTestId('traffic-vehicle-car-2').tap();
          check(await page.getByRole('button',{name:'Вывести на линию',exact:true}).count(),0,'repair not sent onto line');
          await page.getByRole('button',{name:'Вернуть из ремонта',exact:true}).tap();
          const returnRepairCopy=(await page.getByTestId('vehicle-actions').innerText()).replace(/\s+/g,' ').trim();
          check(returnRepairCopy.includes('таймер текущего статуса начнётся заново'),true,'repair exit resets operational timer');
          check(returnRepairCopy.includes('пустая машина встанет в конец очереди'),true,'repair exit explains empty queue tail');
          await page.getByRole('button',{name:'Подтвердить',exact:true}).tap();
          check(await page.getByRole('dialog').count(),0,'repair confirmation unmounts');
          await page.waitForTimeout(350);
          check(await page.evaluate(()=>window.calls.at(-1).body.inRepair),false,'return repair only');
          check(await page.evaluate(()=>window.published.length),2,'repair change broadcasts after commit');
          check(await page.evaluate(()=>window.published.at(-1).kind),'fleet','repair broadcasts typed fleet invalidation');
          await page.getByTestId('traffic-filter-offline').tap();
          const returnedRepairCard=(await page.getByTestId('traffic-vehicle-car-2').innerText()).replace(/\s+/g,' ').trim();
          check(returnedRepairCard.includes('только что'),true,'repair exit timer starts from receipt changedAt');
          await page.getByTestId('traffic-filter-empty').tap();
          await page.getByTestId('traffic-vehicle-car-0').tap();
          await page.getByRole('button',{name:'Убрать с линии',exact:true}).tap();
          await page.getByRole('button',{name:'Подтвердить',exact:true}).tap();
          check(await page.getByRole('dialog').count(),0,'remove confirmation unmounts instantly');
          await page.waitForTimeout(350);
          check(await page.evaluate(()=>window.calls.at(-1).body.vehicleIds),['car-0'],'assigned card ID posted');
          check(await page.evaluate(()=>window.calls.at(-1).body.assigned),false,'assigned empty card moves off line');
          await page.getByTestId('traffic-filter-offline').tap();
          check(await page.getByTestId('traffic-vehicle-car-0').count(),1,'removed vehicle appears in offline column');
          check(await page.evaluate(()=>window.calls.some(c=>c.url.includes('/operator'))),false,'manager has no cargo transport');
          check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
          check(errors,[],name+' browser errors');
          if(width===390 && process.env.FLEET_SCREENSHOT_DIR) {
            await page.screenshot({path:path.join(process.env.FLEET_SCREENSHOT_DIR,'fleet-'+name+'.png'),fullPage:true});
            await page.getByTestId('traffic-filter-offline').tap();
            await page.screenshot({path:path.join(process.env.FLEET_SCREENSHOT_DIR,'offline-column-'+name+'.png'),fullPage:true});
          }
          await context.close();
        }
        for(const compactWidth of [320,390,430]) {
          const compactContext=await browser.newContext({viewport:{width:compactWidth,height:844},isMobile:true,hasTouch:true});
          const compactPage=await compactContext.newPage(), compactErrors=[];
          compactPage.on('pageerror',error=>compactErrors.push(error.message));
          await compactPage.goto('http://127.0.0.1:'+server.address().port+'/?compact=1');
          await compactPage.waitForTimeout(50);
          if(compactErrors.length)throw new Error(name+' compact bootstrap: '+compactErrors.join(' | '));
          const compactBoard=await compactPage.getByTestId('compact-board').boundingBox();
          const compactAnalytics=await compactPage.getByTestId('compact-analytics').boundingBox();
          check(compactBoard.y<compactAnalytics.y,true,'mobile status board precedes analytics');
          const compactCard=await compactPage.getByTestId('traffic-vehicle-compact-empty-0').boundingBox();
          check(compactCard.height>=77&&compactCard.height<=79,true,'agronomist mobile card is about 20 percent smaller');
          check((await compactPage.getByTestId('traffic-line-total').innerText()).replace(/\s+/g,' ').trim(),'На линии: 16 машин · без машин в ремонте','line total excludes repair');
          check(await compactPage.locator('[data-testid^="traffic-filter-"]').count(),5,'agronomist has five status filters');
          check((await compactPage.getByTestId('traffic-filter-repair').innerText()).replace(/\s+/g,' ').trim().endsWith('2'),true,'assigned and offline repairs share repair group');
          check((await compactPage.getByTestId('traffic-filter-offline').innerText()).replace(/\s+/g,' ').trim().endsWith('1'),true,'offline repair is excluded from reserve group');
          check(await compactPage.locator('[data-testid^="traffic-vehicle-"]').evaluateAll(nodes=>nodes.every(node=>node.tagName==='ARTICLE')),true,'agronomist fleet cards are read-only');
          await compactPage.evaluate(()=>window.scrollTo(0,700));
          await compactPage.getByTestId('traffic-filter-loaded').tap();
          await compactPage.waitForTimeout(100);
          const loadedCard=await compactPage.getByTestId('traffic-vehicle-compact-loaded').boundingBox();
          check(loadedCard.y>=0&&loadedCard.y<844,true,'tab switch returns selected status cards into view');
          await compactPage.getByTestId('traffic-filter-offline').tap();
          await compactPage.waitForTimeout(100);
          const offlineCard=await compactPage.getByTestId('traffic-vehicle-compact-offline').boundingBox();
          check(offlineCard.y>=0&&offlineCard.y<844,true,'reserve card is directly visible from fifth filter');
          check(await compactPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'compact page has no horizontal overflow');
          check(compactErrors,[],name+' compact browser errors');
          if(process.env.FLEET_SCREENSHOT_DIR)await compactPage.screenshot({path:path.join(process.env.FLEET_SCREENSHOT_DIR,'agronomist-compact-'+name+'-'+compactWidth+'.png'),fullPage:true});
          await compactContext.close();
        }
      } finally { await browser.close(); }
    }
    console.log((compactOnly?'Agronomist compact mobile DOM':'Fleet mobile DOM')+' PASS: '+checks+' checks / Chromium + WebKit / 320,390,430'+(compactOnly?'':' plus fleet 320,390,412')+'; no hosted writes');
  } finally { await new Promise(r=>server.close(r)); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
