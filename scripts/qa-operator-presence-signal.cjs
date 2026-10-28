// Actual effect under a deterministic clock. No network or Production writes.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');
async function main() {
 const build = await esbuild.build({entryPoints:['components/dashboard/operator-presence-signal.tsx'],bundle:true,platform:'node',format:'cjs',write:false,
  plugins:[{name:'qa',setup(b){
   b.onResolve({filter:/^(react|@\/lib\/supabase\/client-auth)$/},a=>({path:a.path,namespace:'qa'}));
   b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:a.path==='react'?'export const useEffect=(effect)=>globalThis.effects.push(effect);':'export const fetchWithClientAuth=(...args)=>globalThis.request(...args);',loader:'js'}));
  }}]});
 function fixture({enabled=true,identityKey='actor:company',status=200,hidden=false,offline=false,pending=false}={}) {
  let now=100000,id=0,responseStatus=status,cleanup;
  const timers=new Map(),listeners=new Map(),effects=[],calls=[];
  const document={visibilityState:hidden?'hidden':'visible'},navigator={onLine:!offline};
  const target={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name)}};
  Object.assign(document,target);
  const window={...target,setInterval:(fn,ms)=>{timers.set(++id,{fn,ms,at:now+ms});return id},clearInterval:i=>timers.delete(i),
   setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id},clearTimeout:i=>timers.delete(i)};
  const context={module:{exports:{}},exports:{},require,console,AbortController,Date:class extends Date{static now(){return now}},effects,document,navigator,window,
   request:(url,init)=>{calls.push({url,init});return pending?new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted')))):Promise.resolve({status:responseStatus})}};
  context.exports=context.module.exports;vm.runInNewContext(build.outputFiles[0].text,context);
  context.module.exports.OperatorPresenceSignal({enabled,identityKey});cleanup=effects[0]();
  const flush=async()=>{await Promise.resolve();await Promise.resolve()};
  return {calls,timers,listeners,document,navigator,flush,setStatus:s=>responseStatus=s,cleanup:()=>cleanup?.(),
   async event(name){listeners.get(name)?.();await flush()},
   async advance(ms){const end=now+ms;await flush();while(true){const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;if(next[1].ms)next[1].at+=next[1].ms;else timers.delete(next[0]);next[1].fn();await flush()}now=end;await flush()}};
 }
 let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name)}
 await test('disabled/absent identity makes no request or timers',async()=>{for(const options of [{enabled:false},{identityKey:''}]){const f=fixture(options);await f.flush();assert.equal(f.calls.length,0);assert.equal(f.timers.size,0)}});
 await test('visible operator sends immediate pulse then every 30 seconds',async()=>{const f=fixture();await f.flush();assert.equal(f.calls.length,1);await f.advance(60000);assert.equal(f.calls.length,3);for(const c of f.calls){assert.equal(c.url,'/api/dashboard/presence');assert.equal(c.init.method,'POST');assert.equal(c.init.cache,'no-store')}f.cleanup()});
 await test('hidden/offline tabs do not fabricate online; foreground resumes',async()=>{const f=fixture({hidden:true});await f.advance(60000);assert.equal(f.calls.length,0);f.document.visibilityState='visible';await f.event('visibilitychange');assert.equal(f.calls.length,1);f.navigator.onLine=false;await f.advance(60000);assert.equal(f.calls.length,1);f.navigator.onLine=true;await f.event('online');assert.equal(f.calls.length,2);f.cleanup()});
 for(const status of [401,403])await test(status+' backs off then recovers instead of permanent revocation',async()=>{const f=fixture({status});await f.flush();f.setStatus(200);await f.advance(30000);assert.equal(f.calls.length,1);await f.advance(30000);assert.equal(f.calls.length,2);await f.advance(30000);assert.equal(f.calls.length,3);f.cleanup()});
 await test('hung pulse times out without blocking future pulses',async()=>{const f=fixture({pending:true});await f.advance(8000);assert.equal(f.calls[0].init.signal.aborted,true);await f.advance(22000);assert.equal(f.calls.length,2);f.cleanup();await f.flush()});
 await test('unmount aborts outstanding request and removes timers/listeners',async()=>{const f=fixture({pending:true});f.cleanup();await f.flush();assert.equal(f.calls[0].init.signal.aborted,true);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);await f.advance(90000);assert.equal(f.calls.length,1)});
 await test('focus does not duplicate immediate pulse',async()=>{const f=fixture();await f.flush();await f.event('focus');await f.event('online');assert.equal(f.calls.length,1);f.cleanup()});
 console.log(`PASS ${count} actual operator presence lifecycle checks`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
