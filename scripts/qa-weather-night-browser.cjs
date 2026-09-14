// Real WebGL comparison against the pre-fix scene in Git, plus boundary scrubs.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),dir=path.join(root,'public/weather-scene/approved-road-v1'),out=path.join(__dirname,'output/weather-night');
fs.mkdirSync(out,{recursive:true});
const baseline=execFileSync('git',['show','452cd1d0c:public/weather-scene/approved-road-v1/scene.js'],{cwd:root,maxBuffer:1024*1024});
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/favicon.ico'){res.statusCode=204;return res.end();}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(`<body style="margin:0;background:#171912"><iframe style="width:720px;height:309px;border:0" src="/${url.searchParams.has('baseline')?'baseline':'fixed'}/index.html"></iframe></body>`);}
  const name=path.basename(url.pathname),file=path.join(dir,name);
  if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.webp':'image/webp','.jpeg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');
  // Stretch only the tween clock so software WebGL cannot skip its middle frames.
  if(name==='scene.js')return res.end((url.pathname.startsWith('/baseline/')?baseline.toString():fs.readFileSync(file,'utf8')).replace('(now-hourChanged)/240','(now-hourChanged)/2400'));
  fs.createReadStream(file).pipe(res);
});
async function main(){
  await new Promise(r=>server.listen(3198,'127.0.0.1',r));
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=9238']});
  console.log('Night QA browser: CDP 9238; http://127.0.0.1:3198');
  try{
    const report={};
    for(const version of ['baseline','fixed']){
      const page=await browser.newPage({viewport:{width:720,height:309}}),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://127.0.0.1:3198/'+(version==='baseline'?'?baseline':''));
      const frame=page.frameLocator('iframe'),r=frame.locator('#tf-wheat-light');await r.waitFor();
      const send=async(hour,cloud=0,rain=0)=>{
        await page.evaluate(p=>document.querySelector('iframe').contentWindow.postMessage({type:'tf-weather-scene',hour:p.hour,cloud:p.cloud,rain:p.rain,wind:0,paused:true,active:true},location.origin),{hour,cloud,rain});
        await page.waitForFunction(p=>{const d=document.querySelector('iframe').contentDocument.querySelector('#tf-wheat-light').dataset;return d.ready==='true'&&Math.abs(Number(d.hour)-p.hour)<.001&&Math.abs(Number(d.cloud)-p.cloud)<.001&&Math.abs(Number(d.rain)-p.rain)<.001},{hour,cloud,rain},{timeout:60000});
      };
      await send(23.5);
      await page.screenshot({path:path.join(out,version+'-clear-night.png')});
      await r.evaluate(el=>{window.nightSamples=[];new MutationObserver(()=>window.nightSamples.push({hour:+el.dataset.hour,day:+el.dataset.day})).observe(el,{attributes:true,attributeFilter:['data-hour']});});
      // Sample every frame for both directions, including the paused renderer.
      for(const hour of [.5,23.5,.2,23.8])await send(hour);
      const samples=await r.evaluate(()=>window.nightSamples);
      const peak=Math.max(...samples.map(s=>s.day));
      report[version]={samples,peak};
      console.log(version,JSON.stringify({samples,peak}));
      if(version==='fixed')assert(peak===0,'midnight scrub must never pass through daylight');
      else assert(peak>.5,'baseline must reproduce a visible daylight flash');
      await send(0,1,1);await page.screenshot({path:path.join(out,version+'-rain-night.png')});
      await send(12,.35,0);await page.screenshot({path:path.join(out,version+'-day.png')});
      await send(18,0,0);await page.screenshot({path:path.join(out,version+'-sunset.png')});
      assert.deepEqual(errors,[]);await page.close();
    }
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);server.close();process.exitCode=1;});
