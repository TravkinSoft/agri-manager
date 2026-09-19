// Local UI fixture only. No credentials, no production network or writes.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
require('tsx/cjs');
const esbuild = require('esbuild');
const root = process.cwd();
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixture = { companyId:id(1), source:{ id:id(2),name:'КамАЗ',plate:'QA-526',driverId:id(3),driverName:'Тестовый водитель',assignmentId:id(4),version:3,state:'unloading',assigned:true },
  targets:[{ id:id(5),name:'HOWO',plate:'QA-754',driverId:null,driverName:null,assignmentId:null,version:1,state:'empty',assigned:false }] };
async function main(){
  const source=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {DriverVehicleReplacement} from './components/vehicles/driver-vehicle-replacement';
    function App(){const [receipt,setReceipt]=useState(null);return <main style={{padding:20}}>
      <h1>Локальная проверка — рабочие данные не используются</h1>
      <DriverVehicleReplacement companyId='${id(1)}' driverId='${id(3)}' onReplaced={setReceipt}/>
      <p role='status'>{receipt?'Замена подтверждена: HOWO QA-754. Водитель сохранён.':'Машина: КамАЗ QA-526. Изменений нет.'}</p>
      </main>};createRoot(document.getElementById('root')).render(<App/>);`;
  const transport=`const fixture=${JSON.stringify(fixture)};let saved=null;
    export async function trafficRequest(url,method,body){
      if(method==='GET')return fixture;
      await new Promise(resolve=>setTimeout(resolve,450));
      if(new URLSearchParams(location.search).get('mode')==='conflict')throw new Error('Машина уже занята. Обновите список');
      if(saved && saved.replacementId!==body.key)throw new Error('Повтор с новым ключом');
      saved={...body,state:'unloading',ptcEventId:'${id(8)}',ptcCycle:9,ticketIds:['${id(9)}'],replacementId:body.key};
      if(new URLSearchParams(location.search).get('mode')==='retry'&&!window.localLostOnce){window.localLostOnce=true;throw new Error('Ответ потерян. Повторите безопасно')};return saved;
    }`;
  const bundle=await esbuild.build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
    define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'local-only',setup(build){
      build.onResolve({filter:/^@\/components\/traffic\/use-traffic$/},()=>({path:'transport',namespace:'fixture'}));
      build.onResolve({filter:/^@\/lib\/traffic\/changes$/},()=>({path:'changes',namespace:'fixture'}));
      build.onResolve({filter:/^@\//},args=>({path:require.resolve(path.join(root,args.path.slice(2)))}));
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='changes'?'export function publishTrafficChanged(){}':transport}));
    }}]});
  const config=require(path.join(root,'tailwind.config.ts')).default;
  config.content=[path.join(root,'components/vehicles/driver-vehicle-replacement.tsx'),path.join(root,'components/ui/**/*.{ts,tsx}'),path.join(root,'components/weighbridge/searchable-combobox.tsx')];
  const css=(await require('postcss')([require('tailwindcss')(config)]).process(fs.readFileSync(path.join(root,'app/globals.css'),'utf8'),{from:undefined})).css;
  const html='<!doctype html><html lang="ru" class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundle.outputFiles[0].text+'</script></body></html>';
  http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)}).listen(4319,'127.0.0.1',()=>console.log('UI fixture ready: http://127.0.0.1:4319'));
}
main().catch(e=>{console.error(e);process.exitCode=1});
