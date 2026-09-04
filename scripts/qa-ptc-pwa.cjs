/* Isolated manifest, PNG and worker behavior checks. No network/DB access. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function main() {
  let checks=0;
  const check=(value,message)=>{assert.ok(value,message);checks++;};
  const root=path.join(__dirname,"..");
  const manifest=JSON.parse(fs.readFileSync(path.join(root,"public/traffic-operator.webmanifest"),"utf8"));
  check(manifest.id!=="/dashboard" && manifest.id.includes("ptc-v1"),"separate stable identity");
  check(manifest.start_url.split("?")[0]==="/traffic-operator","operator launch, not ERP dashboard");
  check(manifest.scope==="/traffic-operator" && manifest.start_url.startsWith(manifest.scope),"narrow manifest scope contains launch");
  check(manifest.display==="standalone" && manifest.prefer_related_applications===false,"standalone web install");
  for(const icon of manifest.icons){
    const bytes=fs.readFileSync(path.join(root,"public",icon.src));
    check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),"actual PNG signature");
    check(icon.type==="image/png" && icon.sizes===`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,"declared MIME and size match PNG header");
  }
  check(manifest.icons.some(i=>i.sizes==="192x192")&&manifest.icons.some(i=>i.sizes==="512x512"),"Android install icon sizes");
  const layout=fs.readFileSync(path.join(root,"app/traffic-operator/layout.tsx"),"utf8");
  check(layout.includes('manifest: "/traffic-operator.webmanifest"'),"operator metadata overrides root manifest");
  const installer=fs.readFileSync(path.join(root,"components/traffic/install-traffic-app.tsx"),"utf8");
  check(installer.includes('scope: "/traffic-operator"'),"narrow worker registration");
  check(installer.includes('return null') && !installer.includes('beforeinstallprompt'),"headless PWA registration leaves native browser install available without a panel");
  const runtime=fs.readFileSync(path.join(root,"components/offline/offline-runtime.tsx"),"utf8");
  check((runtime.match(/if \(independentTraffic\) return;/g)||[]).length===2,"both ERP registration and queue-sync effects disabled in PTC");
  const handlers={};let online=true;let networkCalls=0;
  const context={
    URL,Response,
    self:{location:{origin:"https://ptc.example"},addEventListener:(name,fn)=>{handlers[name]=fn;},skipWaiting:()=>Promise.resolve(),clients:{claim:()=>Promise.resolve()}},
    fetch:async (request,options)=>{networkCalls++;check(options.cache==="no-store","navigation bypasses HTTP response cache");if(!online)throw new Error("offline");return new Response("online cabinet");},
    get caches(){throw new Error("PTC worker must never touch CacheStorage");},
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,"public/ptc-sw.js"),"utf8"),context);
  for(const eventName of ["install","activate"]){let work;handlers[eventName]({waitUntil:p=>{work=p;}});await work;checks++;}
  const request=(suffix,method="GET",mode="cors")=>({url:`https://ptc.example${suffix}`,method,mode});
  async function dispatch(req){let response;handlers.fetch({request:req,respondWith:value=>{response=value;}});return response?await response:null;}
  for(const req of [request("/api/traffic/operator"),request("/api/traffic/session","POST"),request("/api/traffic/session","DELETE"),request("/dashboard","GET","navigate"),request("/_next/static/test.js"),request("/traffic-operator?_rsc=1")])check((await dispatch(req))===null,"no interception/storage/replay of API, writes, unrelated app or RSC");
  const live=await dispatch(request("/traffic-operator?source=pwa","GET","navigate"));
  check(await live.text()==="online cabinet","online navigation network-first");
  online=false;
  const offline=await dispatch(request("/traffic-operator","GET","navigate"));
  const html=await offline.text();
  check(offline.headers.get("cache-control")==="no-store","offline response not cached");
  check(html.includes("Нет соединения")&&html.includes("не сохраняются в очередь"),"bounded honest offline screen");
  check(html.includes('href="/traffic-operator"')&&!html.includes("/dashboard"),"offline retry remains in PTC");
  check(networkCalls===2,"only two navigation calls intercepted");
  console.log(`PTC PWA gate PASS: ${checks} manifest/icon/worker assertions. Hosted MIME/installability/DOM are a separate gate.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
