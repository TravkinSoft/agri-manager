// Real React DOM regression for the browser-native confirmation boundary. Only
// the traffic transport is replaced; no business-data endpoint is contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = process.cwd();
const req = createRequire(path.join(root, 'package.json'));
req('tsx/cjs');
const esbuild = req('esbuild');
const postcss = req('postcss');
const tailwind = req('tailwindcss');
const { chromium, webkit } = require(process.env.PTC_PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const source = `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {TrafficBoard} from './components/traffic/traffic-board';
    import {applyTrafficCommit} from './lib/traffic/model';
    window.calls=[];
    const params=new URLSearchParams(location.search);
    const state=params.get('state')||'unloading';
    const role=state==='empty'?'harvester':state==='loaded'?'weighman':'receiver';
    const car={vehicle_id:'60000000-0000-4000-8000-000000000001',name:'ZIL 130-76',plate:'LOCAL-829',driver:'Local driver',state,version:1,cycle:1,assigned:true,since:new Date().toISOString()};
    function App(){
      const [snapshot,setSnapshot]=useState({role,companyId:'local-only',personName:'Local operator',enabled:true,fieldName:null,fieldId:null,serverTime:new Date().toISOString(),vehicles:[car,{...car,vehicle_id:'60000000-0000-4000-8000-000000000002',plate:'LOCAL-309'}],events:[]});
      const [stale,setStale]=useState(false);
      window.setStale=setStale;
      window.updateCar=(patch)=>setSnapshot(s=>({...s,vehicles:s.vehicles.map(v=>v.vehicle_id===car.vehicle_id?{...v,...patch}:v)}));
      return <main style={{padding:20}}><h1>Local DOM regression</h1><TrafficBoard snapshot={snapshot} stale={stale} error='' refresh={async()=>{}} onCommitted={(receipt)=>{setSnapshot(s=>applyTrafficCommit(s,receipt));return true;}}/></main>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  const transport = `
    export async function trafficRequest(url,method,body){
      const entry={body,dialogCount:document.querySelectorAll('[role=alertdialog]').length,overlayCount:document.querySelectorAll('[data-state][class*="inset-0"]').length,pointerEvents:document.body.style.pointerEvents,bodyText:document.body.innerText};
      window.calls.push(entry);
      const mode=new URLSearchParams(location.search).get('mode');
      await new Promise(r=>setTimeout(r,900));
      if(mode==='reject')throw Object.assign(new Error('Local conflict'),{status:409});
      if(mode==='uncertain'&&window.calls.length===1)throw new Error('Local lost response');
      return {eventId:'70000000-0000-4000-8000-000000000001',replayed:mode==='uncertain',serverTime:new Date().toISOString(),refreshRequired:false,vehicle:{vehicle_id:body.vehicleId,state:body.target,version:body.version+1,cycle:1,assigned:true,since:new Date().toISOString()}};
    }
  `;
  const bundle = await esbuild.build({
    stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',
    define:{'process.env.NODE_ENV':'"production"'},
    plugins:[{name:'local-transport-only',setup(build){
      build.onResolve({filter:/^\.\/use-traffic$/},()=>({path:'transport',namespace:'test'}));
      build.onResolve({filter:/^@\/components\/vehicles\/vehicle-driver-assignment$/},()=>({path:'picker',namespace:'test'}));
      build.onResolve({filter:/^@\//},args=>({path:req.resolve(path.join(root,args.path.slice(2)))}));
      build.onLoad({filter:/.*/,namespace:'test'},args=>({loader:'js',contents:args.path==='picker'?'export const VehicleDriverAssignment=()=>null;':transport}));
    }}]
  });
  const config = req(path.join(root,'tailwind.config.ts')).default;
  config.content=[path.join(root,'components/traffic/traffic-board.tsx')];
  const css=(await postcss([tailwind(config)]).process(fs.readFileSync(path.join(root,'app/globals.css'),'utf8'),{from:undefined})).css;
  const html='<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundle.outputFiles[0].text+'</script></body></html>';
  const server=http.createServer((request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  let checks=0;
  const failures=[];
  function check(actual,expected,label){checks++;try{assert.deepEqual(actual,expected,label);}catch(error){failures.push({label,actual,expected});}}
  try {
    for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
      const browser=await engine.launch({headless:true,...(name==='chromium'?{channel:'chrome'}:{})});
      try {
        const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
        const cases=[
          ...['empty','loaded','unloading'].flatMap(state=>['accept','cancel','cancel-repeat'].map(mode=>({state,mode}))),
          {state:'empty',mode:'keyboard'},
          {state:'empty',mode:'reject'},
          {state:'empty',mode:'uncertain'},
          {state:'unloading',mode:'offline'},
        ];
        for(const {state,mode} of cases) {
          const page=await context.newPage();
          const errors=[];
          let nativeConfirmations=0;
          page.on('pageerror',error=>errors.push(error.message));
          page.on('dialog',dialog=>{
            nativeConfirmations++;
            if(mode==='cancel'||mode==='cancel-repeat') void dialog.dismiss();
            else void dialog.accept();
          });
          await page.goto(base+'/?state='+state+'&mode='+mode);
          const card=page.getByTestId('traffic-vehicle-60000000-0000-4000-8000-000000000001');
          const label=name+'/'+state+'/'+mode;
          if(mode==='offline') {
            await page.evaluate(()=>window.setStale(true));
            check(await card.isDisabled(),true,label+'/offline-blocks-card');
            check(nativeConfirmations,0,label+'/no-confirmation');
            check(await page.evaluate(()=>window.calls.length),0,label+'/no-offline-command');
          } else if(mode==='cancel'||mode==='cancel-repeat') {
            const attempts=mode==='cancel-repeat'?3:1;
            for(let attempt=0;attempt<attempts;attempt++) await card.tap();
            await page.waitForTimeout(150);
            check(nativeConfirmations,attempts,label+'/native-cancel-count');
            check(await page.evaluate(()=>window.calls.length),0,label+'/no-request');
            check(await card.count(),1,label+'/card-remains');
            check(await card.isEnabled(),true,label+'/card-remains-enabled');
          } else {
            if(mode==='keyboard') await card.press('Enter');
            else await card.tap();
            await page.waitForFunction(()=>window.calls.length===1);
            const calls=await page.evaluate(()=>window.calls);
            check(nativeConfirmations,1,label+'/one-native-confirmation');
            check(calls.length,1,label+'/single-command');
            check(calls[0]?.dialogCount,0,label+'/no-app-dialog');
            check(calls[0]?.overlayCount,0,label+'/no-app-overlay');
            check(calls[0]?.pointerEvents==='none',false,label+'/page-unlocked-before-transport');
            check(await page.getByTestId('traffic-vehicle-60000000-0000-4000-8000-000000000002').isEnabled(),true,label+'/other-car-enabled');
            await page.waitForTimeout(1050);
            if(mode==='reject') {
              check(await card.isEnabled(),true,label+'/known-failure-restores-car');
              check(await page.getByRole('alert').count(),1,label+'/visible-error');
            } else if(mode==='uncertain') {
              const key=calls[0]?.body.key;
              await page.getByRole('button',{name:'Повторить отправку',exact:true}).tap();
              check(await page.evaluate(()=>window.calls[1].body.key),key,label+'/same-key-retry');
              await page.waitForTimeout(1050);
            }
            if(mode!=='reject') {
              if(state!=='empty') check(await card.count(),0,label+'/role-queue-card-removed');
              else check(await card.innerText().then(text=>text.includes('Загружена')),true,label+'/target-state-visible');
            }
          }
          check(errors,[],label+'/no-browser-errors');
          await page.close();
        }
        await context.close();
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve=>server.close(resolve));}
  console.log(JSON.stringify({checks,failed:failures.length,failures},null,2));
  if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
