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
    import {TrafficFleetControls} from './components/traffic/traffic-fleet-controls';
    const company='10000000-0000-4000-8000-000000000001';
    const fleet=Array.from({length:60},(_,i)=>({id:'car-'+i,name:'КАМАЗ',plate:'НОМЕР-'+i,driver:'Виктор Новоковский '+i,assigned:i<2,inRepair:i===2,repairVersion:i===2?1:0,state:i===1?'loaded':'empty'}));
    const vehicles=fleet.slice(0,2).map(v=>({...v,vehicle_id:v.id,version:0,cycle:0,since:new Date().toISOString()}));
    window.calls=[]; window.published=[]; window.fleet=fleet;
    function App(){
      const [snapshot,setSnapshot]=useState({companyId:company,role:'manager',personName:'',enabled:true,fieldId:null,fieldName:null,flowRevision:new Date().toISOString(),serverTime:new Date().toISOString(),vehicles,events:[]});
      const [managed,setManaged]=useState({fleet,canManageRepairs:true,snapshot});
      const [selected,onSelected]=useState(null),[drawerOpen,onDrawerOpen]=useState(false);
      const refresh=useCallback(async()=>{
        const call=window.calls.at(-1);
        if(!call||call.applied)return;
        call.applied=true;
        if(call.url.includes('/line'))setSnapshot(s=>({...s,vehicles:call.body.assigned?[...s.vehicles,...fleet.filter(v=>call.body.vehicleIds.includes(v.id)).map(v=>({...v,vehicle_id:v.id,assigned:true,version:0,cycle:0,since:new Date().toISOString()}))]:s.vehicles.filter(v=>!call.body.vehicleIds.includes(v.vehicle_id))}));
        if(call.url.includes('/repair'))setManaged(m=>({...m,fleet:m.fleet.map(v=>v.id===call.body.vehicleId?{...v,inRepair:call.body.inRepair,repairVersion:2}:v)}));
      },[]);
      return <main style={{padding:12}}><h1>Оборот машин</h1><TrafficBoard snapshot={snapshot} stale={false} error='' refresh={refresh} onManageVehicle={onSelected}/>
        <TrafficFleetControls managed={managed} snapshot={snapshot} selected={selected} onSelected={onSelected} drawerOpen={drawerOpen} onDrawerOpen={onDrawerOpen} stale={false} refresh={refresh}/></main>;
    } createRoot(document.getElementById('root')).render(<App/>);
  `;
  const mocks = {
    transport: `export async function trafficRequest(url,method,body){
      window.calls.push({url,body,dialogs:document.querySelectorAll('[role=dialog],[role=alertdialog]').length,pointer:document.body.style.pointerEvents});
      await new Promise(r=>setTimeout(r,150));
      return url.includes('/repair')?{companyId:body.companyId,vehicleId:body.vehicleId,inRepair:body.inRepair,version:2,changedAt:new Date().toISOString()}:{};
    }`,
    changes: 'export const publishTrafficChanged=companyId=>window.published.push(companyId);',
    auth: 'export const supabase={auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};',
    drivers: `export async function loadVehicleDriverAssignment(id,company){return {companyId:company,canEdit:true,vehicle:{id,name:'КАМАЗ',plate:id,assignmentId:null,driverPersonId:null},drivers:Array.from({length:75},(_,i)=>({id:'driver-'+i,name:'Андрей Водитель '+i}))};}
      export async function saveVehicleDriverAssignment(body){window.driverSave=body;return {companyId:body.companyId,vehicle:{id:body.vehicleId,driverPersonId:body.driverPersonId}};}
      export const publishVehicleDriverAssignment=()=>{};`
  };
  const bundle=await esbuild.build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
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
  try {
    for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
      const browser=await engine.launch({headless:true,...(name==='chromium'?{channel:'chrome'}:{})});
      try {
        for(const width of [320,390,412]) {
          const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
          const page=await context.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
          await page.goto('http://127.0.0.1:'+server.address().port);
          await page.getByTestId('traffic-vehicle-car-0').tap();
          await page.getByRole('button',{name:'Сменить водителя',exact:true}).waitFor();
          await page.waitForTimeout(250);
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
          await page.getByRole('button',{name:/^Не на линии/}).tap();
          await page.getByTestId('offline-sheet').waitFor();
          await page.waitForTimeout(300);
          const sheet=await page.getByTestId('offline-sheet').boundingBox();
          check(Math.abs(sheet.y+sheet.height-844)<3,true,'sheet anchored to viewport bottom');
          check(await page.getByTestId('offline-scroll-list').evaluate(el=>el.scrollHeight>el.clientHeight),true,'offline list scrolls');
          await page.getByRole('button',{name:/Виктор Новоковский 3 КАМАЗ · НОМЕР-3$/}).tap();
          await page.getByRole('button',{name:/Виктор Новоковский 4 КАМАЗ · НОМЕР-4$/}).tap();
          check(await page.getByRole('button',{pressed:true}).count(),2,'multi-select checkmarks');
          await page.getByRole('button',{name:'Вывести на линию · 2',exact:true}).tap();
          check(await page.getByRole('dialog').count(),0,'line dialog unmounts instantly');
          await page.waitForTimeout(350);
          check(await page.evaluate(()=>window.calls[0].body.vehicleIds),['car-3','car-4'],'only selected IDs posted');
          check(await page.evaluate(()=>window.calls[0].dialogs),0,'no modal at transport entry');
          check(await page.evaluate(()=>window.published),['10000000-0000-4000-8000-000000000001'],'line change broadcasts after commit');
          await page.getByRole('button',{name:/^Не на линии/}).tap();
          await page.getByRole('button',{name:/Виктор Новоковский 2 КАМАЗ · НОМЕР-2/}).tap();
          check(await page.getByRole('button',{name:'Вывести на линию',exact:true}).count(),0,'repair not sent onto line');
          await page.getByRole('button',{name:'Вернуть из ремонта',exact:true}).tap();
          await page.getByRole('button',{name:'Подтвердить',exact:true}).tap();
          check(await page.getByRole('dialog').count(),0,'repair confirmation unmounts');
          await page.waitForTimeout(350);
          check(await page.evaluate(()=>window.calls.at(-1).body.inRepair),false,'return repair only');
          check(await page.evaluate(()=>window.published.length),2,'repair change broadcasts after commit');
          check(await page.evaluate(()=>window.calls.some(c=>c.url.includes('/operator'))),false,'manager has no cargo transport');
          check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
          check(errors,[],name+' browser errors');
          if(width===390 && process.env.FLEET_SCREENSHOT_DIR) {
            await page.screenshot({path:path.join(process.env.FLEET_SCREENSHOT_DIR,'fleet-'+name+'.png'),fullPage:true});
            await page.getByRole('button',{name:/^Не на линии/}).tap();
            await page.getByTestId('offline-sheet').waitFor();
            await page.waitForTimeout(300);
            await page.screenshot({path:path.join(process.env.FLEET_SCREENSHOT_DIR,'offline-'+name+'.png')});
          }
          await context.close();
        }
      } finally { await browser.close(); }
    }
    console.log('Fleet mobile DOM PASS: '+checks+' checks / Chromium + WebKit / 320,390,412; no hosted writes');
  } finally { await new Promise(r=>server.close(r)); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
