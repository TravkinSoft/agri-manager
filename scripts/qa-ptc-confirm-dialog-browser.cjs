// Real React DOM regression for harvester swipe and the remaining native
// confirmation boundaries. Only transport is replaced; Product is never called.
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
    window.pointerEvidence=[];
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel']) document.addEventListener(type,event=>window.pointerEvidence.push({type,isTrusted:event.isTrusted,pointerType:event.pointerType}),true);
    const params=new URLSearchParams(location.search);
    const manager=params.get('manager')==='1';
    const state=params.get('state')||'unloading';
    const role=manager?'manager':state==='empty'?'harvester':state==='loaded'?'weighman':'receiver';
    const repaired=params.get('repair')==='1';
    const serverTime='2026-09-09T06:30:00.000Z';
    const car={vehicle_id:'60000000-0000-4000-8000-000000000001',name:'ZIL 130-76',plate:'LOCAL-829',driver:'Local driver',state,version:1,cycle:1,assigned:true,since:'2026-09-09T06:00:00.000Z',inRepair:repaired,repairVersion:repaired?4:0,repairChangedAt:repaired?'2026-09-09T06:25:00.000Z':null};
    const cars=manager?Array.from({length:36},(_,index)=>({
      ...car,
      vehicle_id:'manager-'+index,
      name:'Vehicle '+index,
      plate:'QA-'+String(index).padStart(2,'0'),
      state:index<12?'empty':index<20?'loaded':'unloading',
      assigned:index<32,
      inRepair:index>=27&&index<32,
    })):[car,{...car,vehicle_id:'60000000-0000-4000-8000-000000000002',plate:'LOCAL-309'}];
    function App(){
      const [snapshot,setSnapshot]=useState({role,companyId:'local-only',personName:'Local operator',enabled:true,fieldName:null,fieldId:null,serverTime,vehicles:cars,events:[]});
      const [stale,setStale]=useState(false);
      window.setStale=setStale;
      window.updateCar=(patch)=>setSnapshot(s=>({...s,vehicles:s.vehicles.map(v=>v.vehicle_id===(manager?'manager-0':car.vehicle_id)?{...v,...patch}:v)}));
      window.updateSecondCar=(patch)=>setSnapshot(s=>({...s,vehicles:s.vehicles.map(v=>v.vehicle_id==='manager-1'?{...v,...patch}:v)}));
      return <main className="tf2-shell" style={{padding:20}}><h1>Local DOM regression</h1>{manager?null:<div style={{height:220}}/>}<TrafficBoard snapshot={snapshot} stale={stale} error='' refresh={async()=>{}} fleet={manager?cars.map(v=>({...v,id:v.vehicle_id})):undefined} onCommitted={(receipt)=>{setSnapshot(s=>applyTrafficCommit(s,receipt));return true;}}/>{manager?null:<div style={{height:1200}}/>}</main>;
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
    define:{
      'process.env.NODE_ENV':'"production"',
      'process.env.NEXT_PUBLIC_PTC_BOARD_V2':'"1"',
    },
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
  async function pointer(card,type,{pointerId=7,x,y,isPrimary=true,buttons=1}={}){
    await card.dispatchEvent(type,{pointerId,pointerType:'touch',isPrimary,button:0,buttons,clientX:x,clientY:y});
  }
  async function swipe(card,{dx,dy=0,cancel=false,secondPointer=false,beforeRelease}={}){
    const box=await card.boundingBox();
    if(!box)throw new Error('Swipe card has no bounding box');
    const start={x:box.x+24,y:box.y+box.height/2};
    const finish={x:start.x+dx,y:start.y+dy};
    await pointer(card,'pointerdown',{...start});
    if(secondPointer)await pointer(card,'pointerdown',{pointerId:8,x:start.x+4,y:start.y+4,isPrimary:false});
    await pointer(card,'pointermove',{...finish});
    if(beforeRelease)await beforeRelease();
    await pointer(card,cancel?'pointercancel':'pointerup',{...finish,buttons:0});
    return {start,finish};
  }
  async function trustedMouseSwipe(page,card,dx,dy=0){
    const box=await card.boundingBox();
    if(!box)throw new Error('Trusted swipe card has no bounding box');
    const start={x:box.x+24,y:box.y+box.height/2};
    await page.mouse.move(start.x,start.y);
    await page.mouse.down();
    for(let step=1;step<=6;step++)await page.mouse.move(start.x+dx*step/6,start.y+dy*step/6);
    await page.mouse.up();
  }
  async function trustedChromiumTouch(cdp,start,dx,dy){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start.x,y:start.y,id:1}]});
    for(let step=1;step<=8;step++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+dx*step/8,y:start.y+dy*step/8,id:1}]});
      await new Promise(resolve=>setTimeout(resolve,18));
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  try {
    for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
      const browser=await engine.launch({headless:true,...(name==='chromium'?{channel:'chrome'}:{})});
      try {
        const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
        const cases=[
          ...['tap','short','left','vertical','diagonal','pointer-cancel','multitouch','blur','accept','keyboard','enter','space','reject','uncertain','offline'].map(mode=>({state:'empty',mode})),
          ...['loaded','unloading'].flatMap(state=>['accept','cancel','cancel-repeat'].map(mode=>({state,mode}))),
          ...['loaded','unloading'].map(state=>({state,mode:'repair-accept',repair:true})),
        ];
        for(const {state,mode,repair=false} of cases) {
          const page=await context.newPage();
          const errors=[];
          let nativeConfirmations=0;
          const nativeConfirmationMessages=[];
          page.on('pageerror',error=>errors.push(error.message));
          page.on('dialog',dialog=>{
            nativeConfirmations++;
            nativeConfirmationMessages.push(dialog.message());
            if(mode==='cancel'||mode==='cancel-repeat') void dialog.dismiss();
            else void dialog.accept();
          });
          await page.goto(base+'/?state='+state+'&mode='+mode+(repair?'&repair=1':''));
          await page.waitForFunction(()=>typeof window.setStale==='function');
          const card=page.getByTestId('traffic-vehicle-60000000-0000-4000-8000-000000000001');
          const label=name+'/'+state+'/'+mode;
          const harvester=state==='empty';
          if(repair) {
            check(await card.count(),1,label+'/repair-stage-visible');
            check(await card.evaluate(node=>node.tagName),'BUTTON',label+'/repair-stage-actionable');
            check(await card.isEnabled(),true,label+'/repair-stage-enabled');
            check(await card.getAttribute('data-repair-stage-action'),'true',label+'/repair-stage-marker');
            const cardText=(await card.innerText()).replace(/\s+/g,' ').trim();
            check(cardText.includes('Ремонт отмечен'),true,label+'/repair-copy');
            check(cardText.includes(state==='loaded'?'Загружена':'На выгрузке'),true,label+'/cargo-state-copy');
            check(/(?:29|30) мин/.test(cardText),true,label+'/cargo-timer-preserved');
            check(cardText.includes('5 мин'),false,label+'/repair-timer-not-substituted');
            const stageNote=(await page.getByTestId('traffic-repair-stage-note').innerText()).replace(/\s+/g,' ').trim();
            check(stageNote.includes(state==='loaded'?'Отметьте прибытие на выгрузку':'Завершите фактическую выгрузку'),true,label+'/stage-note');
          }
          if(mode==='offline') {
            await page.evaluate(()=>window.setStale(true));
            await page.waitForFunction(()=>document.querySelector('[data-testid="traffic-vehicle-60000000-0000-4000-8000-000000000001"]')?.disabled===true);
            check(await card.isDisabled(),true,label+'/offline-blocks-card');
            check(nativeConfirmations,0,label+'/no-confirmation');
            check(await page.evaluate(()=>window.calls.length),0,label+'/no-offline-command');
          } else if(harvester&&['tap','short','left','vertical','diagonal','pointer-cancel','multitouch','blur'].includes(mode)) {
            if(mode==='tap')await card.tap();
            else await swipe(card,{
              dx:mode==='short'?70:mode==='left'?-130:mode==='vertical'?6:mode==='diagonal'?110:130,
              dy:mode==='vertical'?140:mode==='diagonal'?90:0,
              cancel:mode==='pointer-cancel',
              secondPointer:mode==='multitouch',
              beforeRelease:mode==='blur'?()=>page.evaluate(()=>window.dispatchEvent(new Event('blur'))):undefined,
            });
            await page.waitForTimeout(80);
            check(nativeConfirmations,0,label+'/no-confirmation');
            check(await page.evaluate(()=>window.calls.length),0,label+'/no-command');
            check(await card.getAttribute('data-swipe-action'),'loaded',label+'/still-swipe-action');
            check(await card.getAttribute('data-swipe-ready'),'false',label+'/gesture-reset');
          } else if(mode==='cancel'||mode==='cancel-repeat') {
            const attempts=mode==='cancel-repeat'?3:1;
            for(let attempt=0;attempt<attempts;attempt++) await card.tap();
            await page.waitForTimeout(150);
            check(nativeConfirmations,attempts,label+'/native-cancel-count');
            check(await page.evaluate(()=>window.calls.length),0,label+'/no-request');
            check(await card.count(),1,label+'/card-remains');
            check(await card.isEnabled(),true,label+'/card-remains-enabled');
          } else {
            if(mode==='keyboard') await card.press('ArrowRight');
            else if(mode==='enter') await card.press('Enter');
            else if(mode==='space') await card.press(' ');
            else if(harvester) await swipe(card,{dx:180,beforeRelease:mode==='accept'?async()=>{
              await page.waitForFunction(()=>document.querySelector('[data-swipe-action="loaded"]')?.getAttribute('data-swipe-ready')==='true');
              check(await page.evaluate(()=>window.calls.length),0,label+'/commit-only-on-release');
              check(await card.getAttribute('data-swipe-ready'),'true',label+'/threshold-visible');
              check((await page.getByTestId('traffic-swipe-track-60000000-0000-4000-8000-000000000001').innerText()).includes('Отпустите'),true,label+'/release-copy-visible');
              check(await card.evaluate(node=>getComputedStyle(node).touchAction),'pan-y',label+'/vertical-pan-native');
              check(await card.evaluate(node=>getComputedStyle(node).transform!=='none'),true,label+'/card-translates');
            }:undefined});
            else await card.tap();
            await page.waitForFunction(()=>window.calls.length===1);
            const calls=await page.evaluate(()=>window.calls);
            check(nativeConfirmations,harvester?0:1,label+'/confirmation-contract');
            if(repair) {
              const confirmation=nativeConfirmationMessages[0]||'';
              check(confirmation.includes(state==='loaded'?'Машина фактически прибыла на выгрузку?':'Выгрузка фактически завершена?'),true,label+'/repair-confirmation-stage');
              check(confirmation.includes('останется в ремонте'),true,label+'/repair-confirmation-overlay');
            }
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
        for(const width of [320,430]) {
          const page=await context.newPage();
          const errors=[];
          page.on('pageerror',error=>errors.push(error.message));
          await page.setViewportSize({width,height:844});
          await page.goto(base+'/?state=empty&mode=accept');
          const card=page.getByTestId('traffic-vehicle-60000000-0000-4000-8000-000000000001');
          await swipe(card,{dx:180});
          await page.waitForFunction(()=>window.calls.length===1);
          check(await page.evaluate(()=>window.calls.length),1,name+'/'+width+'/single-command');
          check(await page.evaluate(()=>window.calls[0].body.target),'loaded',name+'/'+width+'/loaded-target');
          check(errors,[],name+'/'+width+'/no-browser-errors');
          await page.close();
        }
        {
          const page=await context.newPage();
          const errors=[];
          page.on('pageerror',error=>errors.push(error.message));
          await page.goto(base+'/?state=empty&mode=accept');
          const card=page.getByTestId('traffic-vehicle-60000000-0000-4000-8000-000000000001');
          await trustedMouseSwipe(page,card,180);
          await page.waitForFunction(()=>window.calls.length===1);
          const trusted=await page.evaluate(()=>window.pointerEvidence.filter(event=>event.pointerType==='mouse'));
          check(trusted.some(event=>event.type==='pointerdown'&&event.isTrusted),true,name+'/trusted-mouse/down');
          check(trusted.some(event=>event.type==='pointermove'&&event.isTrusted),true,name+'/trusted-mouse/move');
          check(trusted.some(event=>event.type==='pointerup'&&event.isTrusted),true,name+'/trusted-mouse/up');
          check(await page.evaluate(()=>window.calls.length),1,name+'/trusted-mouse/single-command');
          check(errors,[],name+'/trusted-mouse/no-browser-errors');
          await page.close();
        }
        if(name==='chromium') {
          const verticalPage=await context.newPage();
          const verticalErrors=[];
          verticalPage.on('pageerror',error=>verticalErrors.push(error.message));
          await verticalPage.goto(base+'/?state=empty&mode=accept');
          const verticalCard=verticalPage.getByTestId('traffic-vehicle-60000000-0000-4000-8000-000000000001');
          const verticalBox=await verticalCard.boundingBox();
          const verticalCdp=await context.newCDPSession(verticalPage);
          await trustedChromiumTouch(verticalCdp,{x:verticalBox.x+24,y:verticalBox.y+verticalBox.height/2},6,-170);
          await verticalPage.waitForTimeout(120);
          const verticalEvidence=await verticalPage.evaluate(()=>window.pointerEvidence.filter(event=>event.pointerType==='touch'));
          check(await verticalPage.evaluate(()=>scrollY>0),true,'chromium/trusted-touch/vertical-scroll');
          check(await verticalPage.evaluate(()=>window.calls.length),0,'chromium/trusted-touch/vertical-no-command');
          check(verticalEvidence.some(event=>event.isTrusted&&event.type==='pointercancel'),true,'chromium/trusted-touch/native-pointercancel');
          check(verticalErrors,[],'chromium/trusted-touch/vertical-no-browser-errors');
          await verticalPage.close();

          const horizontalPage=await context.newPage();
          const horizontalErrors=[];
          horizontalPage.on('pageerror',error=>horizontalErrors.push(error.message));
          await horizontalPage.goto(base+'/?state=empty&mode=accept');
          const horizontalCard=horizontalPage.getByTestId('traffic-vehicle-60000000-0000-4000-8000-000000000001');
          const horizontalBox=await horizontalCard.boundingBox();
          const horizontalCdp=await context.newCDPSession(horizontalPage);
          await trustedChromiumTouch(horizontalCdp,{x:horizontalBox.x+24,y:horizontalBox.y+horizontalBox.height/2},180,2);
          await horizontalPage.waitForFunction(()=>window.calls.length===1);
          const horizontalEvidence=await horizontalPage.evaluate(()=>window.pointerEvidence.filter(event=>event.pointerType==='touch'));
          check(horizontalEvidence.some(event=>event.isTrusted&&event.type==='pointerup'),true,'chromium/trusted-touch/horizontal-up');
          check(await horizontalPage.evaluate(()=>window.calls.length),1,'chromium/trusted-touch/horizontal-single-command');
          check(await horizontalPage.evaluate(()=>scrollY),0,'chromium/trusted-touch/horizontal-no-scroll');
          check(horizontalErrors,[],'chromium/trusted-touch/horizontal-no-browser-errors');
          await horizontalPage.close();
        }
        {
          const desktopPage=await context.newPage();
          const desktopErrors=[];
          desktopPage.on('pageerror',error=>desktopErrors.push(error.message));
          await desktopPage.setViewportSize({width:1440,height:900});
          await desktopPage.goto(base+'/?manager=1');
          const lists=desktopPage.getByTestId('traffic-manager-lists');
          const metrics=await lists.evaluate(node=>({
            overflowY:getComputedStyle(node).overflowY,
            clientHeight:node.clientHeight,
            scrollHeight:node.scrollHeight,
          }));
          check(metrics.overflowY,'auto',name+'/desktop/board-scroll');
          check(metrics.scrollHeight>metrics.clientHeight,true,name+'/desktop/board-overflow');
          const headings=desktopPage.locator('[data-testid^="traffic-group-"] h2');
          check(await headings.count(),5,name+'/desktop/five-lane-headings');
          check(await headings.evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).position==='sticky')),true,name+'/desktop/sticky-headings');
          await lists.evaluate(node=>{node.scrollTop=420;node.dispatchEvent(new Event('scroll'));});
          await desktopPage.waitForTimeout(50);
          const stickyGeometry=await desktopPage.evaluate(()=>{
            const list=document.querySelector('[data-testid="traffic-manager-lists"]');
            const top=list.getBoundingClientRect().top;
            return Array.from(document.querySelectorAll('[data-testid^="traffic-group-"] h2')).map(node=>Math.abs(node.getBoundingClientRect().top-top));
          });
          check(stickyGeometry.every(delta=>delta<2),true,name+'/desktop/headings-remain-visible');
          await desktopPage.evaluate(()=>window.updateCar({state:'loaded',version:2}));
          await desktopPage.waitForFunction(()=>document.querySelector('[data-traffic-card-id="manager-0"]')?.getAttribute('data-traffic-card-group')==='loaded');
          const moved=desktopPage.locator('[data-traffic-card-id="manager-0"]');
          await moved.waitFor({state:'visible'});
          check(await moved.getAttribute('data-traffic-card-group'),'loaded',name+'/desktop/card-moved-lane');
          check(await moved.getAttribute('data-transitioning'),'true',name+'/desktop/card-settle-state');
          check(await moved.evaluate(node=>getComputedStyle(node).animationName),'tf2-traffic-card-settle',name+'/desktop/card-settle-motion');
          await desktopPage.emulateMedia({reducedMotion:'reduce'});
          await desktopPage.evaluate(()=>window.updateSecondCar({state:'loaded',version:2}));
          await desktopPage.waitForFunction(()=>document.querySelector('[data-traffic-card-id="manager-1"]')?.getAttribute('data-traffic-card-group')==='loaded');
          const reduced=desktopPage.locator('[data-traffic-card-id="manager-1"]');
          await reduced.waitFor({state:'visible'});
          check(await reduced.getAttribute('data-transitioning'),'true',name+'/desktop/reduced-state-observed');
          check(await reduced.evaluate(node=>getComputedStyle(node).animationName),'none',name+'/desktop/reduced-motion-none');
          check(desktopErrors,[],name+'/desktop/no-browser-errors');
          await desktopPage.close();
        }
        await context.close();
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve=>server.close(resolve));}
  console.log(JSON.stringify({checks,failed:failures.length,failures},null,2));
  if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
