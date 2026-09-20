const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.artifacts', 'dashboard-fast-browser');
const mocks = {
  '@/lib/contexts/auth-context': `import{createContext,useContext}from'react';export const TestAuth=createContext(null);export const useAuth=()=>useContext(TestAuth);`,
  '@/lib/supabase/client': `window.__signOutListeners=new Set();export const supabase={auth:{onAuthStateChange(fn){window.__signOutListeners.add(fn);return{data:{subscription:{unsubscribe(){window.__signOutListeners.delete(fn)}}}}}}};`,
  '@/lib/services/harvest-dashboard': `
    window.__requests=[];
    export function request(kind,signal){return new Promise((resolve,reject)=>{const r={kind,signal,resolve,reject,done:false};window.__requests.push(r);signal?.addEventListener('abort',()=>{r.done=true;reject(new DOMException('cancelled','AbortError'))},{once:true})})}
    export const getHarvestSummary=(_q,o)=>request('summary',o.signal);
    export const getHarvestChampions=o=>request('champions',o.signal);
  `,
  '@/components/traffic/use-traffic': `import{request}from'@/lib/services/harvest-dashboard';export const trafficRequest=(_p,_m,_b,_a,signal)=>request('traffic',signal);`,
  '@/hooks/use-live-refresh': `import{useEffect}from'react';export const LIVE_REFRESH_TABLES={weighbridge:['tickets']};export function useLiveRefresh({enabled,onRefresh}){useEffect(()=>{if(!enabled)return;const run=()=>onRefresh();window.addEventListener('test-ticket-closed',run);return()=>window.removeEventListener('test-ticket-closed',run)},[enabled,onRefresh])}`,
};
const fixture = `
  import React,{useState}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
  import{HarvestDashboard}from'./components/dashboard/harvest-dashboard';import{TestAuth}from'@/lib/contexts/auth-context';
  import{buildHarvestOverview,resolveHarvestPeriod}from'./lib/dashboard/harvest-summary';
  import{buildHarvestChampions}from'./lib/dashboard/harvest-champions';
  const empty=buildHarvestOverview([],{period:resolveHarvestPeriod({preset:'current_day',operationalDayStartHour:7}),warehouseRows:[]});
  window.answer=(kind,kg=21300)=>{const r=window.__requests.find(r=>r.kind===kind&&!r.done);if(!r)throw Error('No pending '+kind);r.done=true;
    r.resolve(kind==='summary'?{...empty,potatoPeriodMovement:{...empty.potatoPeriodMovement,netAfterRemovalsKg:kg,receivedNetKg:kg,removedImpuritiesKg:0}}:kind==='champions'?buildHarvestChampions([],{operationalDayStartHour:7}):{snapshot:{vehicles:[],serverTime:new Date().toISOString()},fleet:[]});};
  function App(){const[visible,setVisible]=useState(true),[tenant,setTenant]=useState('company-a');
    window.toggle=()=>flushSync(()=>setVisible(x=>!x));window.tenant=t=>flushSync(()=>setTenant(t));
    return <TestAuth.Provider value={{user:{id:'user',last_sign_in_at:'login-1'},profile:{id:'profile',role:'agronomist',company_id:tenant}}}><main className="mx-auto max-w-[1200px] p-4">{visible?<HarvestDashboard/>:<p>Другая страница</p>}</main></TestAuth.Provider>;
  }createRoot(document.getElementById('app')).render(<App/>);
`;
async function main() {
  fs.mkdirSync(output, { recursive: true });
  execFileSync(process.execPath, [path.join(root,'node_modules/tailwindcss/lib/cli.js'),'-i','app/globals.css','-o',path.join(output,'test.css'),'-c','tailwind.config.ts'],{cwd:root,stdio:'pipe',windowsHide:true});
  await require('esbuild').build({stdin:{contents:fixture,resolveDir:root,loader:'tsx'},bundle:true,jsx:'automatic',outfile:path.join(output,'test.js'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'dashboard-fixtures',setup(build){build.onResolve({filter:/^@\//},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:root}))}}]});
  const server=http.createServer((req,res)=>{const file=req.url==='/test.js'?'test.js':req.url==='/test.css'?'test.css':null;
    if(file){res.setHeader('Content-Type',file.endsWith('js')?'text/javascript':'text/css');fs.createReadStream(path.join(output,file)).pipe(res);return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ru" data-theme="estate-graphite"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/test.css"><body><div id="app"></div><script src="/test.js"></script></body></html>');});
  await new Promise(r=>server.listen(3199,'127.0.0.1',r));
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const pending=kind=>page.waitForFunction(k=>window.__requests.some(r=>r.kind===k&&!r.done),kind);
  try{
    await page.goto('http://127.0.0.1:3199');await pending('summary');
    assert.equal(await page.getByRole('status',{name:'Загрузка показателей сводки'}).count(),1);
    assert.equal(await page.getByRole('region',{name:'Главные показатели уборки'}).count(),0);
    await page.evaluate(()=>{answer('summary');answer('champions');answer('traffic')});
    const metrics=page.getByRole('region',{name:'Главные показатели уборки'});await metrics.waitFor();
    assert.match(await metrics.innerText(),/21,3 т/);
    await page.evaluate(()=>toggle());
    const immediate=await page.evaluate(()=>{const start=performance.now();toggle();return{ms:performance.now()-start,text:document.body.innerText}});
    assert.match(immediate.text,/21,3 т/);assert.match(immediate.text,/Сохранённая сводка/);assert.ok(immediate.ms<500);
    await pending('summary');
    await page.evaluate(()=>{window.dispatchEvent(new Event('test-ticket-closed'));window.dispatchEvent(new Event('test-ticket-closed'));});
    assert.equal(await page.evaluate(()=>__requests.filter(r=>r.kind==='summary'&&!r.done).length),1,'events must not abort or duplicate in-flight load');
    await page.evaluate(()=>{answer('summary',24000);answer('champions');answer('traffic')});await pending('summary');
    await page.evaluate(()=>{answer('summary',25000);answer('champions');answer('traffic')});
    await page.waitForFunction(()=>document.querySelector('[aria-label="Главные показатели уборки"]')?.textContent.includes('25 т'));
    await page.evaluate(()=>window.dispatchEvent(new Event('test-ticket-closed')));await pending('summary');
    await page.evaluate(()=>{const r=__requests.find(r=>r.kind==='summary'&&!r.done);r.done=true;r.reject(new Error('Тест: нет связи'))});
    await page.getByText('Тест: нет связи',{exact:true}).waitFor();
    assert.match(await metrics.innerText(),/25 т/);assert.match(await page.locator('body').innerText(),/не удалось обновить/);
    await page.screenshot({path:path.join(output,'desktop-stale.png'),fullPage:true});
    const switched=await page.evaluate(()=>{tenant('company-b');return document.body.innerText});assert.ok(!switched.includes('25 т'),'old tenant must disappear in first render');
    await pending('summary');await page.evaluate(()=>{answer('summary',42000);answer('champions');answer('traffic')});
    await page.waitForFunction(()=>document.querySelector('[aria-label="Главные показатели уборки"]')?.textContent.includes('42 т'));
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    await page.evaluate(()=>__signOutListeners.forEach(fn=>fn('SIGNED_OUT')));
    await page.getByRole('status',{name:'Загрузка показателей сводки'}).waitFor();assert.ok(!(await page.locator('body').innerText()).includes('42 т'));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',checks:['cold skeleton, no fake KPI zeros','warm synchronous snapshot','saved-data label','coalesced close events, queued fresh read','error keeps last good data visibly stale','company switch hides previous frame','mobile no overflow','signout clears snapshots','no browser errors'],warmRenderMs:immediate.ms,screenshots:output}));
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1});
