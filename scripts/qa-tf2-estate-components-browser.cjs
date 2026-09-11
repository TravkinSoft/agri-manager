// Local component regression only: real JSX/primitives and CSS, synthetic draft state.
// No auth, API, Production or QA database traffic. Not a substitute for release QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = process.cwd();
const req = createRequire(path.join(root, 'package.json'));
req('tsx/cjs');
const { chromium, webkit } = require(process.env.PTC_PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(process.env.TF2_ESTATE_EVIDENCE || '.artifacts/estate-components');
const cropSource = fs.readFileSync('app/(dashboard)/crop-structure/page.tsx', 'utf8');
const start = cropSource.indexOf('const renderEditor =');
const end = cropSource.indexOf('const renderLegalContour =', start);
assert.ok(start > 0 && end > start, 'bounded real editor JSX');
function classContaining(fragment) {
 const match=[...cropSource.matchAll(/className="([^"]+)"/g)].find((item)=>item[1].includes(fragment));
 assert.ok(match, 'class fragment exists: '+fragment);
 return match[1];
}
const filterGridClass=classContaining('tf-crop-filter-grid');
const filterActionsClass=classContaining('tf-crop-filter-actions');
const addActionClass=classContaining('h-11 w-full whitespace-nowrap');
const viewActionClass=classContaining('h-11 min-w-[44px] px-2.5');
const exportActionClass=classContaining('h-11 min-w-[44px] whitespace-nowrap');
const compactActionLabelClass=classContaining('hidden sm:inline min-[800px]:hidden 2xl:inline');
const CLOSE_TIMEOUT_MS=8000;
const configuredWorkerTimeout=Number(process.env.TF2_ESTATE_WORKER_TIMEOUT_MS||90000);
const WORKER_TIMEOUT_MS=Number.isFinite(configuredWorkerTimeout)&&configuredWorkerTimeout>=1000?configuredWorkerTimeout:90000;
const workerEngineName=process.env.TF2_ESTATE_WORKER_ENGINE||'';

function errorText(error) {
 return error?String(error.stack||error).slice(0,2600):null;
}

function writeJsonAtomic(file,value) {
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const temporary=file+'.tmp-'+process.pid;
 fs.writeFileSync(temporary,JSON.stringify(value,null,2));
 fs.renameSync(temporary,file);
}

async function withDeadline(promise,timeoutMs,timeoutValue) {
 let timer;
 try {
  return await Promise.race([
   promise,
   new Promise((resolve)=>{timer=setTimeout(()=>resolve(timeoutValue),timeoutMs)}),
  ]);
 } finally {
  if(timer) clearTimeout(timer);
 }
}

async function closePlaywrightResource(label,close,isClosed) {
 if(isClosed()) return null;
 let timer;
 const outcome=await Promise.race([
  Promise.resolve().then(close).then(()=>({kind:'closed'}),(error)=>({kind:'error',error})),
  new Promise((resolve)=>{timer=setTimeout(()=>resolve({kind:'timeout'}),CLOSE_TIMEOUT_MS)}),
 ]);
 if(timer) clearTimeout(timer);
 if(outcome.kind==='closed') return null;
 if(isClosed()) {
  console.warn('WARN '+label+' close settled after transport disconnect');
  return null;
 }
 return outcome.kind==='error'?outcome.error:new Error(label+' close timed out while the resource remained open');
}

function childHasExited(child) {
 return !child||child.exitCode!==null||child.signalCode!==null;
}

async function waitForChildExit(child,timeoutMs=CLOSE_TIMEOUT_MS) {
 if(childHasExited(child)) return true;
 return new Promise((resolve)=>{
  let settled=false;
  const finish=(exited)=>{if(settled)return;settled=true;clearTimeout(timer);child.off('exit',onExit);resolve(exited)};
  const onExit=()=>finish(true);
  const timer=setTimeout(()=>finish(childHasExited(child)),timeoutMs);
  child.once('exit',onExit);
 });
}

async function waitForObservedClose(child,isClosed,timeoutMs=CLOSE_TIMEOUT_MS) {
 if(!child||isClosed()) return true;
 return new Promise((resolve)=>{
  let settled=false;
  const finish=(closed)=>{if(settled)return;settled=true;clearTimeout(timer);child.off('close',onClose);resolve(closed)};
  const onClose=()=>finish(true);
  const timer=setTimeout(()=>finish(isClosed()),timeoutMs);
  child.once('close',onClose);
 });
}

async function forceKillExactChild(label,child,processGroup=false) {
 if(childHasExited(child)) return null;
 const pid=child?.pid;
 if(!Number.isSafeInteger(pid)||pid<=0) return new Error(label+' cannot force-terminate an unvalidated child process');
 try {
  if(process.platform==='win32') {
   const result=spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{encoding:'utf8',windowsHide:true,timeout:CLOSE_TIMEOUT_MS});
   if(result.error&&result.error.code!=='ESRCH') throw result.error;
   if(result.status!==0&&!childHasExited(child)) {
    throw new Error('taskkill failed for exact child PID '+pid+': '+String(result.stderr||result.stdout||'unknown error').trim());
   }
  } else {
   process.kill(processGroup?-pid:pid,'SIGKILL');
  }
 } catch(error) {
  if(!childHasExited(child)) return error;
 }
 if(!await waitForChildExit(child)) return new Error(label+' exact child PID '+pid+' remained alive after force termination');
 return null;
}

async function closeManagedBrowser(name,browser,browserServer,launchedChild) {
 let cleanupError=null;
 const remember=(error)=>{if(error&&!cleanupError) cleanupError=error};
 if(browser) remember(await closePlaywrightResource(name+' browser connection',()=>browser.close(),()=>!browser.isConnected()));
 if(browserServer) {
  const gracefulError=await closePlaywrightResource(name+' browser server',()=>browserServer.close(),()=>childHasExited(launchedChild));
  remember(gracefulError);
  if(process.platform!=='win32'&&!childHasExited(launchedChild)) {
   remember(await closePlaywrightResource(name+' browser server kill',()=>browserServer.kill(),()=>childHasExited(launchedChild)));
  }
 }
 // Do not call BrowserServer.kill() here: Playwright's Windows implementation
 // delegates to an unbounded synchronous taskkill. Our bounded exact-PID path
 // keeps the harness itself deterministic even when graceful transport close hangs.
 if(!childHasExited(launchedChild)) remember(await forceKillExactChild(name+' browser',launchedChild));
 if(!childHasExited(launchedChild)) remember(new Error(name+' launched browser child did not exit'));
 return cleanupError;
}

async function closeFixtureServer(server,sockets) {
 return new Promise((resolve)=>{
  let settled=false;
  const timer=setTimeout(()=>finish(new Error('Fixture server close timed out')),CLOSE_TIMEOUT_MS);
  const finish=(error=null)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(error)};
  try {
   server.close((error)=>finish(error||null));
   server.closeIdleConnections?.();
   server.closeAllConnections?.();
   for(const socket of sockets) socket.destroy();
  } catch(error) {
   finish(error);
  }
 });
}

const source = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { X, Plus, Maximize2 } from 'lucide-react';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './components/ui/select';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog';
import { CatalogIdentityCombobox } from './components/crop-structure/catalog-identity-combobox';
import { InlineSearchCombobox } from './components/ui/inline-search-combobox';
const initial = { id:'plot-1', land_use_type:'crop', crop_id:'potato', variety_id:'gala', reproduction_id:'r2', area:34, irrigation_type:'sprinkler', row_spacing_m:0.75, seed_spacing_cm:32, notes:'Сохранённая заметка', mix_components:[] };
const options = [{value:'244',label:'КамАЗ · Т244 ALB',group:'Недавно использованные', keywords:['Т 244 ALB','T244ALB']},{value:'075',label:'МТЗ 075 · T075 ALB',description:'Трактор',group:'Парк компании'},{value:'long',label:'Очень длинное название транспортного средства без сокращения',status:'Занят'}];
function App() {
 const [value,setValue]=useState('244'); const [commits,setCommits]=useState(0);
 const [saving,setSaving]=useState(false); const [dialog,setDialog]=useState(false);
 const [draftRows,setRows]=useState([initial]); const [deleted,setDeleted]=useState(false);
 const selectedField={id:'field',name:'4 (2-4)',area:84};
 const fmtHa=(n)=>n.toLocaleString('ru-RU')+' га'; const sumArea=(rows)=>rows.reduce((n,r)=>n+Number(r.area||0),0);
 const EPS=0.0001, seasonId='2026',hasUnsavedStructureChanges=true,editorValidationError='',language='ru';
 const displayCropId=(id)=>id; const vars=[{id:'gala',name:'Гала'},{id:'colombo',name:'Коломбо'}];
 const varietiesByCrop=new Map([['potato',vars]]), operationFactsByAllocation=new Map(),consumptionsByAllocation=new Map();
 const isFallowAllocation=(r)=>r.land_use_type==='fallow',isCropMixAllocation=(r)=>r.land_use_type==='crop_mix';
 const patchDraft=(index,patch)=>{if(!saving)setRows(rows=>rows.map((r,i)=>i===index?{...r,...patch}:r));};
 const requestRemoveRow=()=>setDeleted(true),cropSelectOptions=()=>[{id:'potato',name:'Картофель'},{id:'wheat',name:'Пшеница'}],cropLabel=(r)=>r.name;
 const globalReproductions=[{id:'r2',name:'Вторая репродукция'},{id:'r1',name:'Первая репродукция'}];
 const localizedName=(r)=>r.name,catalogIdentitySearchValue=(r)=>r.name,standardReproductionLabel=(r)=>r.name;
 const grainMixTotalKg=()=>0,patchMixComponent=()=>{},grainMixComponentTotalKg=()=>0,GRAIN_MIX_MIN_COMPONENTS=2,GRAIN_MIX_MAX_COMPONENTS=8,removeMixComponent=()=>{},addMixComponent=()=>{};
 const normalizeIrrigationType=(s)=>s||'unknown',fillRemainingArea=(i)=>patchDraft(i,{area:84}),isPotatoAllocation=(r)=>r.crop_id==='potato',parseNum=(s)=>s===''?null:Number(s.replace(',','.'));
 ${cropSource.slice(start,end)}
 return <main className="tf-manor travkin-shell min-h-screen w-full space-y-5 p-4 md:p-8">
  <section data-testid="crop-toolbar-shell" className="travkin-shell tf-manor-shell -mx-4 flex w-[calc(100%+2rem)] overflow-hidden md:-mx-8 md:w-[calc(100%+4rem)]">
   <aside className="tf-desktop-sidebar hidden w-64 shrink-0 md:flex md:h-screen md:shrink-0" aria-hidden="true"><div className="w-64" /></aside>
   <div className="min-w-0 flex-1">
    <div className="tf-manor-workspace min-w-0 px-3 sm:px-4 md:px-6">
     <div className="p-3">
      <div data-testid="crop-filter-grid" className=${JSON.stringify(filterGridClass)}>
       <div data-testid="crop-filter-search" className="relative min-w-0"><input className="h-11 w-full" aria-label="Поиск поля" /></div>
       <button data-testid="crop-filter-crop" className="h-11 w-full">Все культуры</button>
       <button data-testid="crop-filter-status" className="h-11 w-full">Все статусы</button>
       <button data-testid="crop-filter-sort" className="h-11 w-full">Сорт: поле</button>
       <div data-testid="crop-filter-actions" className=${JSON.stringify(filterActionsClass)}>
        <button className=${JSON.stringify(addActionClass)} aria-label="Добавить поле">+<span className=${JSON.stringify(compactActionLabelClass)}>Добавить поле</span></button>
        <div className="flex shrink-0 border p-0.5">
         <button className=${JSON.stringify(viewActionClass)} aria-label="Показать карточками">▦<span className=${JSON.stringify(compactActionLabelClass)}>Карточки</span></button>
         <button className=${JSON.stringify(viewActionClass)} aria-label="Показать таблицей">▤<span className=${JSON.stringify(compactActionLabelClass)}>Таблица</span></button>
         <button className=${JSON.stringify(viewActionClass)} aria-label="Показать на карте">⌖<span className=${JSON.stringify(compactActionLabelClass)}>Карта</span></button>
        </div>
        <button className=${JSON.stringify(exportActionClass)} aria-label="Экспортировать в Excel">⇩<span className=${JSON.stringify(compactActionLabelClass)}>Excel</span></button>
       </div>
      </div>
     </div>
    </div>
   </div>
  </section>
  <h1 className="text-3xl">Структура посевов · 4 (2-4)</h1>
  <section className="tf-estate-document p-5">{renderEditor()}</section>
  <section className="rounded-md border border-border bg-card p-4 space-y-3">
   <h2 className="text-2xl">Весовая · поиск транспорта</h2>
   <fieldset disabled={saving}><InlineSearchCombobox value={value} options={options} onValueChange={v=>{setValue(v);setCommits(n=>n+1)}} placeholder="Выберите транспорт" searchPlaceholder="Машина, модель или госномер" emptyLabel="Не найдено" ariaLabel="Транспорт" /></fieldset>
   <Button id="after-search" variant="outline">Следующее поле</Button>
   <output id="search-state">{value+':'+commits}</output>
  </section>
  <section className="tf-estate-rail rounded-md p-4"><h2>Открытые талоны</h2><p className="text-muted-foreground">МТЗ 075 · 15 880 кг</p><Button variant="outline">Закрыть талон</Button></section>
  <Dialog open={dialog} onOpenChange={setDialog}><DialogTrigger asChild><Button>Открыть проверочный диалог</Button></DialogTrigger><DialogContent><DialogTitle>Талон</DialogTitle><DialogDescription>Локальная проверка поиска</DialogDescription><InlineSearchCombobox value={value} options={options} onValueChange={setValue} placeholder="Выберите транспорт" searchPlaceholder="Поиск" emptyLabel="Не найдено" ariaLabel="Транспорт в диалоге" /></DialogContent></Dialog>
  <Button onClick={()=>setSaving(v=>!v)}>{saving?'Снять блокировку':'Заблокировать'}</Button>
  <output id="draft-state" className="sr-only">{JSON.stringify(draftRows)}</output><output id="delete-state" className="sr-only">{String(deleted)}</output>
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;

async function workerMain() {
 assert.ok(workerEngineName==='chromium'||workerEngineName==='webkit','worker engine must be chromium or webkit');
 const workerReportPath=path.resolve(process.env.TF2_ESTATE_WORKER_REPORT||path.join(output,'worker-'+workerEngineName+'.json'));
 const esbuild=req('esbuild');
 const bundle=await esbuild.build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'alias',setup(build){build.onResolve({filter:/^@\//},args=>({path:req.resolve(path.join(root,args.path.slice(2)))}));}}]});
 const config=req(path.join(root,'tailwind.config.ts')).default;
 const css=(await req('postcss')([req('tailwindcss')({...config,content:[{raw:source,extension:'tsx'},path.join(root,'components/ui/*.tsx'),path.join(root,'components/crop-structure/*.tsx')]})]).process(fs.readFileSync('app/globals.css','utf8'),{from:undefined})).css;
 const html='<!doctype html><html lang="ru" data-theme="estate-register"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body class="tf-manor"><div id="root"></div><script>'+bundle.outputFiles[0].text+'</script></body></html>';
 fs.mkdirSync(output,{recursive:true});
 const server=http.createServer((request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html)});
 const sockets=new Set();
 server.on('connection',(socket)=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const evidence=[];
 let launchedBrowserPid=null,launchedBrowserClosed=false;
 let testFailure=null,cleanupFailure=null,reportFailure=null;
 try {
  for(const [name,engine] of [[workerEngineName,workerEngineName==='chromium'?chromium:webkit]]) {
   let browserServer=null,browser=null,launchedChild=null;
    try {
     browserServer=await engine.launchServer(name==='chromium'?{headless:true,channel:'chrome'}:{headless:true});
     launchedChild=browserServer.process();
     assert.ok(Number.isSafeInteger(launchedChild?.pid)&&launchedChild.pid>0,name+': browser server exposes its exact launched child PID');
     launchedBrowserPid=launchedChild.pid;
     launchedChild.once('close',()=>{launchedBrowserClosed=true});
     browser=await engine.connect(browserServer.wsEndpoint());
     const baseViewports=[
      {label:'360x844',width:360,height:844,mobile:true},
      {label:'844x390',width:844,height:390,mobile:true},
      {label:'768x1024',width:768,height:1024,mobile:false},
      {label:'1440x1000',width:1440,height:1000,mobile:false},
     ];
     const chromiumRegressionViewports=[
      {label:'667x390',width:667,height:390,mobile:true},
      {label:'736x390',width:736,height:390,mobile:true},
      {label:'740x390',width:740,height:390,mobile:true},
      {label:'768x390',width:768,height:390,mobile:true},
      {label:'800x390',width:800,height:390,mobile:true},
      {label:'812x390',width:812,height:390,mobile:true},
      {label:'820x800',width:820,height:800,mobile:false},
      {label:'900x700',width:900,height:700,mobile:false},
      {label:'1023x700',width:1023,height:700,mobile:false},
     ];
     const viewports=name==='chromium'?[...baseViewports.slice(0,3),...chromiumRegressionViewports,baseViewports[3]]:baseViewports;
     for(const {label,width,height,mobile} of viewports) {
      let context=null,page=null,contextClosed=false;
      const errors=[],external=[];
      try {
       context=await browser.newContext({viewport:{width,height},hasTouch:mobile,isMobile:mobile,reducedMotion:'reduce'});
       context.once('close',()=>{contextClosed=true});
       page=await context.newPage();
       page.setDefaultTimeout(6000);
       page.on('pageerror',error=>errors.push(error.message));
       await page.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();external.push(route.request().url());return route.abort();});
       await page.goto(origin); await page.getByTestId('crop-structure-editor').waitFor();
       if(process.env.TF2_ESTATE_TEST_FORCE_UI_FAILURE===name+'/'+label) throw new Error('intentional UI assertion failure for lifecycle verification');
       assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0,name+'/'+label+': horizontal overflow');
       const filterGrid=page.getByTestId('crop-filter-grid');
       const filterItems=await filterGrid.locator(':scope > *').evaluateAll((nodes)=>nodes.map((node)=>{const box=node.getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height}}));
       const filterMetrics=await filterGrid.evaluate((node)=>({clientWidth:node.clientWidth,scrollWidth:node.scrollWidth}));
       assert.ok(filterMetrics.scrollWidth<=filterMetrics.clientWidth,name+'/'+label+': filter grid has no internal overflow');
       for(let i=0;i<filterItems.length;i+=1) for(let j=i+1;j<filterItems.length;j+=1) {
        const a=filterItems[i],b=filterItems[j];
        const overlapX=Math.min(a.right,b.right)-Math.max(a.left,b.left);
        const overlapY=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
        assert.ok(overlapX<=0||overlapY<=0,name+'/'+label+': filter items '+i+' and '+j+' do not overlap');
       }
       const sortBox=await page.getByTestId('crop-filter-sort').boundingBox(),actionsBox=await page.getByTestId('crop-filter-actions').boundingBox();
       const actionButtonBoxes=await page.getByTestId('crop-filter-actions').locator('button').evaluateAll((nodes)=>nodes.map((node)=>{const box=node.getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom}}));
       assert.ok(sortBox&&actionsBox,name+'/'+label+': sort and actions geometry is measurable');
       for(const box of actionButtonBoxes) {
        assert.ok(box.left>=actionsBox.x-0.5&&box.right<=actionsBox.x+actionsBox.width+0.5,name+'/'+label+': every action stays inside its grid track');
        const overlapX=Math.min(box.right,sortBox.x+sortBox.width)-Math.max(box.left,sortBox.x);
        const overlapY=Math.min(box.bottom,sortBox.y+sortBox.height)-Math.max(box.top,sortBox.y);
        assert.ok(overlapX<=0||overlapY<=0,name+'/'+label+': action descendants do not overlap Sort');
       }
       if([820,900,1023].includes(width)||(height===390&&width<812)) {
        assert.ok(sortBox && actionsBox && actionsBox.y>=sortBox.y+sortBox.height,name+'/'+label+': sidebar-constrained actions stay on a separate row');
       }
       if(height===390&&width>=812) {
        assert.ok(filterItems.every((box)=>Math.abs(box.top-filterItems[0].top)<4),name+'/'+label+': sidebar-hidden short landscape keeps the toolbar on one row');
       }
       const editor=page.getByTestId('crop-structure-editor');
       const coreControls=[
        page.getByLabel('Использование *',{exact:true}),
        page.getByLabel('Площадь, га *',{exact:true}),
        page.getByLabel('Культура *',{exact:true}),
        page.getByRole('combobox',{name:'Сорт участка 1',exact:true}),
        page.getByRole('combobox',{name:'Репродукция участка 1',exact:true}),
       ];
       for(const control of coreControls) {
        await control.scrollIntoViewIfNeeded();
        assert.equal(await control.isVisible(),true,name+'/'+label+': all five primary fields stay visible');
        const box=await control.boundingBox();
        assert.ok(box && box.height>=44,name+'/'+label+': primary field touch target is at least 44px');
       }
       const useBox=await coreControls[0].boundingBox(),areaBox=await coreControls[1].boundingBox(),cropBox=await coreControls[2].boundingBox();
       const varietyBox=await coreControls[3].boundingBox(),reproductionBox=await coreControls[4].boundingBox();
       assert.ok(Math.abs(useBox.y-areaBox.y)<4,name+'/'+label+': usage and area share a row');
       assert.ok(Math.abs(varietyBox.y-reproductionBox.y)<4,name+'/'+label+': variety and reproduction share a row');
       if(width===844) {
        assert.ok(Math.abs(useBox.y-cropBox.y)<4,name+'/'+label+': compact landscape keeps usage, area and crop on the first row');
        const plotBox=await editor.locator('.tf-estate-plot').first().boundingBox();
        assert.ok(plotBox && plotBox.y<height-64,name+'/'+label+': first plot starts above the reserved mobile navigation zone');
       }
      const initialDraft=await page.locator('#draft-state').textContent();
      assert.equal(await page.locator('details').getAttribute('open'),null,'optional section collapsed');
      await page.locator('summary').click();
      assert.equal(await page.getByLabel('Комментарий',{exact:true}).inputValue(),'Сохранённая заметка');
      assert.equal(await page.getByLabel('Междурядье, м',{exact:true}).inputValue(),'0.75');
      assert.equal(await page.getByLabel('Расстояние между семенами, см',{exact:true}).inputValue(),'32');
      await page.locator('summary').click();
      assert.equal(await page.locator('#draft-state').textContent(),initialDraft,'collapse does not erase draft');
      await page.getByLabel('Площадь, га *',{exact:true}).fill('40,5');
      assert.equal(JSON.parse(await page.locator('#draft-state').textContent())[0].area,40.5);
      await page.getByLabel('Культура *',{exact:true}).click();
      await page.getByRole('option',{name:'Картофель',exact:true}).click();
      await page.getByRole('combobox',{name:'Сорт участка 1',exact:true}).click();
      await page.getByRole('option',{name:/Коломбо/}).click();
      assert.equal(JSON.parse(await page.locator('#draft-state').textContent())[0].variety_id,'colombo');
       const input=page.getByRole('combobox',{name:'Транспорт',exact:true});
       await input.fill('T244ALB');
       const transportList=page.getByRole('listbox',{name:'Транспорт',exact:true});
       await transportList.waitFor({state:'visible'});
       await transportList.getByRole('option').nth(1).waitFor({state:'hidden'});
       assert.equal(await input.getAttribute('aria-expanded'),'true','editable combobox stays expanded while typing');
       assert.equal(await transportList.getByRole('option').count(),1,'plate compact search');
      assert.equal(await page.locator('#search-state').textContent(),'244:0','typing never commits identity');
      assert.equal(await page.getByRole('combobox',{name:'Транспорт',exact:true}).count(),1,'one transport combobox only');
      assert.equal(await transportList.locator('..').locator('input').count(),0,'search stays in the field without a second popup input');
      const inputBox=await input.boundingBox(),listBox=await transportList.boundingBox();
      assert.ok(listBox.width>=inputBox.width-50,'popup follows field width');
      await input.press('Escape');
      assert.equal(await input.inputValue(),'КамАЗ · Т244 ALB','cancel restores selected identity');
      await input.fill('неизвестная машина'); await page.getByRole('status').filter({hasText:'Не найдено'}).waitFor();
      await input.press('Enter');assert.equal(await page.locator('#search-state').textContent(),'244:0');
      await input.fill('075');
      await transportList.waitFor({state:'visible'});
      await transportList.getByRole('option',{name:/МТЗ 075/}).waitFor({state:'visible'});
      await transportList.getByRole('option').nth(1).waitFor({state:'hidden'});
      assert.equal(await transportList.getByRole('option').count(),1,'keyboard search settles to one option');
      await input.press('Enter');
      assert.equal(await page.locator('#search-state').textContent(),'075:1','keyboard commits exactly once');
      await input.click(); await page.getByRole('listbox',{name:'Транспорт',exact:true}).getByRole('option',{name:/КамАЗ/}).click();
      assert.equal(await page.locator('#search-state').textContent(),'244:2','pointer commits exactly once');
      await input.click(); await input.press('Tab');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'after-search','Tab exits search normally');
      await page.getByRole('button',{name:'Заблокировать',exact:true}).click();
      assert.equal(await input.isDisabled(),true);
      assert.equal(await page.getByLabel('Площадь, га *',{exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'Снять блокировку',exact:true}).click();
      await page.getByRole('button',{name:'Открыть проверочный диалог'}).click();
      const ticketDialog=page.getByRole('dialog',{name:'Талон',exact:true});
      const modalInput=page.getByRole('combobox',{name:'Транспорт в диалоге',exact:true});
      await modalInput.fill('075');
      const modalList=page.getByRole('listbox',{name:'Транспорт в диалоге',exact:true});
      await modalList.waitFor({state:'visible'});
      await modalList.getByRole('option').nth(1).waitFor({state:'hidden'});
      assert.equal(await modalInput.getAttribute('aria-expanded'),'true','modal combobox is open before Escape routing is tested');
      await modalList.evaluate(()=>new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await modalList.isVisible(),true,'portalled list remains visible after Radix layer effects settle');
      assert.equal(await modalInput.getAttribute('aria-expanded'),'true','combobox remains expanded after Radix layer effects settle');
      await modalInput.press('Escape');
      await modalList.waitFor({state:'hidden'});
      assert.equal(await ticketDialog.isVisible(),true,'Escape closes list, not enclosing document');
      await modalInput.press('Escape');
      await ticketDialog.waitFor({state:'hidden'});
       await page.screenshot({path:path.join(output,name+'-'+label+'.png'),fullPage:true});
       assert.deepEqual(errors,[],'browser exceptions');assert.deepEqual(external,[],'fixture has zero external requests');
       evidence.push({engine:name,width,height,pass:true,checks:30,screenshot:name+'-'+label+'.png'});
       console.log('PASS '+name+'/'+label+' responsive editor, inline search, portal, draft, keyboard and disabled checks');
       } catch(error) {
        try { if(page&&!page.isClosed()) await page.screenshot({path:path.join(output,name+'-'+label+'-failure.png'),fullPage:true}); }
        catch(screenshotError) { console.warn('WARN '+name+'/'+label+' failure screenshot: '+errorText(screenshotError)); }
       throw error;
      } finally {
       if(page) {
        const pageCloseError=await closePlaywrightResource(name+'/'+label+' page',()=>page.close(),()=>page.isClosed()||!browser.isConnected());
        if(pageCloseError&&!cleanupFailure) cleanupFailure=pageCloseError;
       }
       if(context) {
        const contextCloseError=await closePlaywrightResource(name+'/'+label+' context',()=>context.close(),()=>contextClosed||!browser.isConnected());
        if(contextCloseError&&!cleanupFailure) cleanupFailure=contextCloseError;
       }
      }
     }
    } catch(error) {
     if(!testFailure) testFailure=error;
    } finally {
     try {
      writeJsonAtomic(workerReportPath,{
       scope:'local components only',engine:workerEngineName,phase:'ui-complete',pass:false,evidence,
       uiPass:!testFailure,testFailure:errorText(testFailure),cleanupFailure:errorText(cleanupFailure),
       lifecycle:{browserPid:launchedBrowserPid,browserClosed:launchedBrowserClosed},
      });
     } catch(error) {
      if(!reportFailure) reportFailure=error;
     }
     if(process.env.TF2_ESTATE_TEST_HANG_AFTER_UI===name) await new Promise(()=>{});
     const browserCloseError=await closeManagedBrowser(name,browser,browserServer,launchedChild);
     if(browserCloseError&&!cleanupFailure) cleanupFailure=browserCloseError;
     if(!await waitForObservedClose(launchedChild,()=>launchedBrowserClosed)&&!cleanupFailure) {
      cleanupFailure=new Error(name+' browser child exited without closing its process streams');
     }
    }
   }
 } finally {
  const serverCloseError=await closeFixtureServer(server,sockets);
  if(serverCloseError&&!cleanupFailure) cleanupFailure=serverCloseError;
  try {
   await esbuild.stop();
  } catch(error) {
   if(!cleanupFailure) cleanupFailure=error;
  }
  try {
   writeJsonAtomic(workerReportPath,{
    scope:'local components only',engine:workerEngineName,phase:'complete',pass:!(testFailure||cleanupFailure),evidence,
    testFailure:errorText(testFailure),cleanupFailure:errorText(cleanupFailure),
    lifecycle:{browserPid:launchedBrowserPid,browserClosed:launchedBrowserClosed},
   });
  } catch(error) {
   reportFailure=error;
  }
 }
 // If an exact browser child survived every bounded cleanup attempt, keep its
 // owning worker alive. The controller watchdog can then terminate the whole
 // worker tree instead of letting an orphan escape when this process exits.
 if(launchedBrowserPid&&!launchedBrowserClosed) await new Promise(()=>{});
 if(testFailure) {
  if(cleanupFailure) console.error('Cleanup error after test failure: '+String(cleanupFailure));
  if(reportFailure) console.error('Report error after test failure: '+String(reportFailure));
  throw testFailure;
 }
 if(cleanupFailure) throw cleanupFailure;
 if(reportFailure) throw reportFailure;
}

async function waitForWorker(child,name) {
 const closeOutcome=new Promise((resolve)=>{
  child.once('close',(code,signal)=>resolve({kind:'closed',code,signal}));
  child.once('error',(error)=>resolve({kind:'spawn-error',error}));
 });
 const outcome=await withDeadline(closeOutcome,WORKER_TIMEOUT_MS,{kind:'timeout'});
 if(outcome.kind!=='timeout') return {...outcome,timedOut:false,killError:null};
 const killError=await forceKillExactChild(name+' worker',child,true);
 const afterKill=await withDeadline(closeOutcome,CLOSE_TIMEOUT_MS,{kind:'kill-close-timeout'});
 return {...afterKill,timedOut:true,killError:errorText(killError)};
}

async function runWorker(name,token) {
 const workerReportPath=path.join(output,'.worker-'+name+'-'+token+'.json');
 const child=spawn(process.execPath,[__filename],{
  cwd:root,
  env:{...process.env,TF2_ESTATE_WORKER_ENGINE:name,TF2_ESTATE_WORKER_REPORT:workerReportPath},
  stdio:['ignore','pipe','pipe'],
  windowsHide:true,
  detached:process.platform!=='win32',
 });
 assert.ok(Number.isSafeInteger(child.pid)&&child.pid>0,name+': controller owns an exact worker PID');
 child.stdout.on('data',(chunk)=>process.stdout.write(chunk));
 child.stderr.on('data',(chunk)=>process.stderr.write(chunk));
 const lifecycle=await waitForWorker(child,name);
 let report=null,readError=null;
 try { report=JSON.parse(fs.readFileSync(workerReportPath,'utf8')); } catch(error) { readError=errorText(error); }
 return {name,workerPid:child.pid,lifecycle,report,readError};
}

async function controllerMain() {
 fs.mkdirSync(output,{recursive:true});
 const token=process.pid+'-'+Date.now();
 const requestedEngines=(process.env.TF2_ESTATE_ENGINES||'chromium,webkit').split(',').map((name)=>name.trim()).filter(Boolean);
 assert.ok(requestedEngines.length>0&&requestedEngines.every((name)=>name==='chromium'||name==='webkit'),'controller engines must be chromium and/or webkit');
 const workers=[];
 for(const name of requestedEngines) workers.push(await runWorker(name,token));
 const evidence=workers.flatMap((worker)=>worker.report?.evidence||[]);
 const workerSummaries=workers.map((worker)=>({
  engine:worker.name,
  workerPid:worker.workerPid,
  closed:worker.lifecycle.kind==='closed',
  exitCode:worker.lifecycle.code??null,
  signal:worker.lifecycle.signal??null,
  timedOut:worker.lifecycle.timedOut,
  killError:worker.lifecycle.killError,
  reportPhase:worker.report?.phase||null,
  uiPass:worker.report?.uiPass??(worker.report?.phase==='complete'&&!worker.report?.testFailure),
  browserPid:worker.report?.lifecycle?.browserPid??null,
  browserClosed:worker.report?.lifecycle?.browserClosed??false,
  testFailure:worker.report?.testFailure||null,
  cleanupFailure:worker.report?.cleanupFailure||(
   worker.lifecycle.killError?worker.lifecycle.killError
   :worker.lifecycle.kind==='kill-close-timeout'?'worker tree termination did not close its process streams'
   :worker.lifecycle.timedOut?'worker watchdog timed out and terminated its exact process tree'
   :worker.lifecycle.kind!=='closed'?'worker process did not close cleanly'
   :null
  ),
  reportReadError:worker.readError,
 }));
 const pass=workers.every((worker)=>worker.lifecycle.kind==='closed'&&worker.lifecycle.code===0&&!worker.lifecycle.timedOut&&!worker.readError&&worker.report?.phase==='complete'&&worker.report?.pass===true);
 writeJsonAtomic(path.join(output,'report.json'),{scope:'local components only',pass,evidence,workers:workerSummaries});
 if(!pass) {
  const primary=workerSummaries.find((worker)=>worker.testFailure)?.testFailure
   ||workerSummaries.find((worker)=>worker.cleanupFailure)?.cleanupFailure
   ||workerSummaries.find((worker)=>worker.reportReadError)?.reportReadError
   ||'component browser worker lifecycle failed';
  throw new Error(primary);
 }
}

const entry=workerEngineName?workerMain:controllerMain;
entry().then(
 ()=>process.exit(0),
 error=>{console.error(errorText(error));process.exit(1)},
);
