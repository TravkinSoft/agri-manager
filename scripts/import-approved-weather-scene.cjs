// Reproducible import of the owner's frozen scene. Geometry and textures stay intact.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = fs.readFileSync(process.argv[2]);
const hash = crypto.createHash('sha256').update(source).digest('hex');
if (hash !== '28d1ec4def96c153c4e740af3b35d0f60d4e29bfe39223d71cb1989819c92772') throw Error('Not the approved road v1 source');
const dir = path.join(__dirname, '../public/weather-scene/approved-road-v1');
fs.mkdirSync(dir, { recursive: true });
let html = source.toString('utf8'), count = 0;
html = html.replace(/data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)/g, (_, ext, bytes) => {
  const name = `asset-${count++}.${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(bytes, 'base64'));
  return `./${name}`;
});
let code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const replace = (before, after) => { if (!code.includes(before)) throw Error(`Missing import anchor: ${before.slice(0, 80)}`); code = code.replace(before, after); };
replace("https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js", './three-0.160.1.min.js');
replace("let stopped=false,launched=false,loadTimer=0;let release=()=>{};", `let stopped=false,launched=false,loadTimer=0;let release=()=>{};
 let productState={hour:17.25,wind:0,rain:0,cloud:.35,active:false,paused:true},applyProduct=()=>{};
 const announce=type=>parent.postMessage({type},location.origin);
 window.addEventListener('message',event=>{
   if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='tf-weather-scene')return;
   const p=event.data;
   if(!['hour','wind','rain','cloud'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k]))||typeof p.active!=='boolean'||typeof p.paused!=='boolean')return;
   productState={hour:Math.max(0,Math.min(24,p.hour)),wind:Math.max(0,Math.min(16,p.wind)),rain:Math.max(0,Math.min(1,p.rain)),cloud:Math.max(0,Math.min(1,p.cloud)),active:p.active,paused:p.paused};
   clockInput.value=String(productState.hour);slider.value=String(productState.wind);rainInput.value=String(productState.rain*100);
   if(!launched&&productState.active)launch();else applyProduct();
 });
 window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(loadTimer);lifecycle.abort();release();});
 announce('tf-weather-ready');`);
replace("function fail(){stopped=true;", "function fail(){announce('tf-weather-failed');stopped=true;");
replace("root.dataset.state='failed';", "root.dataset.state='failed';if(view.querySelector('img'))view.querySelector('img').hidden=false;");
replace("view.querySelector('img')?.remove();", "if(view.querySelector('img'))view.querySelector('img').hidden=true;");
replace("skyMaterial.uniforms.uRain=rainUniforms.uRain;", "skyMaterial.uniforms.uRain={value:0};");
// Cloud amount drives the sky independently; rain still exclusively drives drops and puddles.
replace("function applySolar(h){", "function applySolar(h){h=((h%24)+24)%24;const overcast=Math.max(rain,cloud);skyMaterial.uniforms.uRain.value=overcast;");
replace("*(1.-rain*.94)", "*(1.-overcast*.94)");
replace("*(1.-rain*.75)", "*(1.-overcast*(.65-.25*moonBlend))");
replace("multiplyScalar(1.-rain*.24);sunlight.intensity*=1.-rain*.87;ambient.intensity*=1.-rain*.24;", "multiplyScalar(1.-overcast*(.18-.08*moonBlend));sunlight.intensity*=1.-overcast*(.80-.35*moonBlend);ambient.intensity*=1.-overcast*.12;");
// Lift moonlit materials and diffuse sky fill, keeping a blue night palette.
replace(".48*moonBlend", ".65*moonBlend");
replace("setRGB(.43+day*.57,.55+day*.45,.83+day*.17)", "setRGB(.82+day*.34,.98+day*.18,1.24-day*.06)");
replace("+.85*moonBlend;ambient.intensity=.65+day*.50;ambient.color.setRGB(.38+day*.24,.49+day*.21,.75+day*.06)", "+1.15*moonBlend;ambient.intensity=.98+day*.30;ambient.color.setRGB(.55+day*.12,.66+day*.10,.90-day*.04)");
replace("vec3(.065,.105,.18),vec3(.009,.021,.058)", "vec3(.10,.16,.26),vec3(.023,.045,.105)");
replace("vec3(.14,.18,.25),vec3(.065,.09,.14)", "vec3(.18,.24,.33),vec3(.12,.17,.25)");
replace("vec3(.31,.43,.65)", "vec3(.52,.69,.95)");
replace("vec3(.085,.14,.24),sky,uDay", "vec3(.12,.20,.33),sky,uDay");
replace("let rain=Number(rainInput.value)/100", "let cloud=productState.cloud,targetCloud=cloud,cloudFrom=cloud,cloudChanged=performance.now()-1000;let rain=Number(rainInput.value)/100");
replace("speed=4,target=4,windFrom=4", "speed=productState.wind,target=productState.wind,windFrom=productState.wind");
replace("paused=false,near=false", "paused=productState.paused,near=false");
replace("root.dataset.cloudShift=", "root.dataset.cloud=cloud.toFixed(3);root.dataset.paused=String(paused);root.dataset.cloudShift=");
// Interpolate across midnight on the short circular arc, never through noon.
replace("function leafUpdate(){", `function setHour(value){
 const next=hour+(((value-hour+12)%24+24)%24-12);
 if(Math.abs(targetHour-next)>1e-7){hourFrom=hour;targetHour=next;hourChanged=performance.now();}
}
function leafUpdate(){`);
replace("hourFrom=hour;targetHour=Number(clockInput.value);hourChanged=performance.now();", "setHour(Number(clockInput.value));");
replace("const rt=Math.min", "if(cloud!==targetCloud){const ct=Math.min(1,Math.max(0,(now-cloudChanged)/650));cloud=ct===1?targetCloud:cloudFrom+(targetCloud-cloudFrom)*ct*ct*(3-2*ct);applySolar(hour);dirty=true;}const rt=Math.min");
replace("if(hour!==targetHour||rain!==targetRain||(!paused", "if(cloud!==targetCloud||hour!==targetHour||rain!==targetRain||(!paused");
replace("visible&&!document.hidden)raf=", "visible&&productState.active&&!document.hidden)raf=");
replace("const reduced=matchMedia", `applyProduct=()=>{
   const p=productState;
   setHour(p.hour);
   if(targetRain!==p.rain){rainFrom=rain;targetRain=p.rain;rainChanged=performance.now();}
   if(target!==p.wind){windFrom=speed;target=p.wind;windChanged=performance.now();if(p.paused)speed=target;}
   if(targetCloud!==p.cloud){cloudFrom=cloud;targetCloud=p.cloud;cloudChanged=performance.now();}paused=p.paused;dirty=true;labels();
   if(!p.active)cancelFrame();else wake();
 };
 const reduced=matchMedia`);
replace("root.dataset.plants=String(plants);", "applyProduct();root.dataset.plants=String(plants);");
fs.writeFileSync(path.join(dir, 'scene.js'), code);
html = html.replace(/<script>[\s\S]*?<\/script>/, '<script src="./scene.js"></script>');
html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Погода · TravkinFlow</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#191b17}#tf-wheat-light .controls,#tf-wheat-light>p{display:none!important}#tf-wheat-light .view{height:100%;aspect-ratio:21/9}#tf-wheat-light{height:100%}</style></head><body>'+html+'</body></html>';
fs.writeFileSync(path.join(dir, 'index.html'), html);
fs.writeFileSync(path.join(dir, 'provenance.json'), JSON.stringify({source: 'wheat-panorama-approved-road-v1.html', sha256:hash, assets:count, geometry:'unchanged',integration:'forecast time, rainfall, cloud cover, wind, pause, lifecycle'},null,2)+'\n');
console.log(`Approved scene imported; ${count} unchanged image assets`);
