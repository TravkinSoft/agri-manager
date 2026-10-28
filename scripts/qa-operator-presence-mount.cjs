// Execute the actual standalone page gate and ERP wrapper with isolated hooks.
const assert=require('node:assert/strict'),esbuild=require('esbuild'),vm=require('node:vm');
async function main(){
 const stubs={
  react:`export const useState=v=>globalThis.hooks.state(v);export const useEffect=f=>globalThis.hooks.effects.push(f);export const useCallback=f=>f;export default {createElement:(type,props,...children)=>({type,props:{...props,children}})};`,
  'react/jsx-runtime':`export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment='fragment';`,
  'next/navigation':`export const useRouter=()=>({replace:path=>globalThis.redirects.push(path)});export const usePathname=()=>globalThis.pathname;`,
  'lucide-react':`export const Truck='Truck',LogOut='LogOut',Loader2='Loader2';`,
  '@/lib/traffic/model':`export const ROLE_LABEL={};`,
  '@/components/traffic/traffic-board':`export const TrafficBoard='board';`,
  '@/components/traffic/use-traffic':`export const trafficRequest=async()=>({actor:globalThis.actor});export const useTraffic=()=>({});`,
  '@/components/traffic/install-traffic-app':`export const TrafficPwa='pwa';`,
  '@/components/traffic/traffic-shift-controls':`export const TrafficShiftControls='shift-controls';`,
  '@/lib/supabase/client':`export const supabase={auth:{getSession:async()=>({data:{session:globalThis.session?{}:null}})}};`,
  '@/lib/contexts/auth-context':`export const useAuth=()=>({profile:globalThis.profile});`,
  '@/components/dashboard/operator-presence-signal':`export const OperatorPresenceSignal='presence-signal';`,
  './operator-presence-signal':`export const OperatorPresenceSignal='presence-signal';`,
 };
 const builds=await Promise.all(['app/traffic-operator/page.tsx','components/dashboard/operator-heartbeat.tsx'].map(entry=>esbuild.build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,plugins:[{name:'qa',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'qa'}:undefined);b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:stubs[a.path],loader:'js'}))}}]})));
 const findSignal=node=>!node?null:node.type==='presence-signal'?node:((Array.isArray(node.props?.children)?node.props.children:[node.props?.children]).map(findSignal).find(Boolean)||null);
 async function render(role,{status='active',impersonating=false,session=true,companyId='company',standalone=true}={}){
  let cursor=0;const values=[],effects=[],redirects=[];
  const actor={id:'operator',companyId,role,status,isImpersonating:impersonating};
  const hooks={effects,state:v=>{const i=cursor++;if(!(i in values))values[i]=v;return[values[i],next=>{values[i]=next}]}};
  const context={module:{exports:{}},exports:{},require,console,process,hooks,actor,session,redirects,pathname:'/weighbridge',profile:{...actor,company_id:companyId,is_impersonating:impersonating}};
  context.exports=context.module.exports;vm.runInNewContext(builds[standalone?0:1].outputFiles[0].text,context);
  const Component=context.module.exports[standalone?'default':'OperatorHeartbeat'];
  let node=Component();if(standalone){effects.splice(0).forEach(effect=>effect());await new Promise(resolve=>setImmediate(resolve));cursor=0;node=Component()}
  return{signal:findSignal(node),redirects};
 }
 let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS '+name)}
 await test('standalone active combine mounts a signal without ERP AuthProvider',async()=>{const r=await render('mechanic_operator');assert.equal(r.signal.props.enabled,true);assert.equal(r.signal.props.identityKey,'operator:company')});
 for(const options of [{status:'pending'},{impersonating:true},{companyId:null}])await test('standalone unsafe identity does not enable presence '+JSON.stringify(options),async()=>assert.notEqual((await render('mechanic_operator',options)).signal?.props.enabled,true));
 for(const role of ['vegetable_brigadier','director','global_admin'])await test(role+' cannot generate a combine signal',async()=>assert.notEqual((await render(role)).signal?.props.enabled,true));
 await test('missing session redirects without a signal',async()=>{const r=await render('mechanic_operator',{session:false});assert.equal(r.signal,null);assert.equal(r.redirects[0],'/auth/login')});
 await test('weighbridge ERP wrapper keeps active weighman signal',async()=>assert.equal((await render('weighman',{standalone:false})).signal.props.enabled,true));
 await test('ERP role preview cannot signal',async()=>assert.equal((await render('weighman',{standalone:false,impersonating:true})).signal.props.enabled,false));
 console.log(`PASS ${checks} actual page / layout presence mount checks`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
