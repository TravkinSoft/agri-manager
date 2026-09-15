// Real components, bounded page JSX and handlers; fixture reads only, no business writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),out=path.join(__dirname,'output/annotations');fs.mkdirSync(out,{recursive:true});
const crop=fs.readFileSync(path.join(root,'app/(dashboard)/crop-structure/page.tsx'),'utf8');
const wh=fs.readFileSync(path.join(root,'app/(dashboard)/warehouses/page.tsx'),'utf8');
const dash=fs.readFileSync(path.join(root,'components/dashboard/harvest-dashboard.tsx'),'utf8');
const aside=crop.slice(crop.indexOf('<aside className="min-w-0 lg:flex'),crop.indexOf('</aside>',crop.indexOf('<aside className="min-w-0 lg:flex'))+8);
const handler=wh.slice(wh.indexOf('const openHarvestBatch ='),wh.indexOf('const openReceiptDialog ='));
const toolbar=wh.slice(wh.indexOf('<div className="flex flex-wrap items-center gap-2" data-testid="warehouse-toolbar">'),wh.indexOf('{searchDataLoading ?'));
const metrics=dash.slice(dash.indexOf('<section className="grid grid-cols-3'),dash.indexOf('</section>',dash.indexOf('<section className="grid grid-cols-3'))+10);
assert(aside&&handler&&toolbar&&metrics);
const source=`import React,{useState,useRef}from'react';import{createRoot}from'react-dom/client';import{Search,Settings2,ClipboardList}from'lucide-react';
import{FieldHarvestLive}from'./components/crop-structure/field-harvest-live';import{HarvestBatchDialog}from'./components/warehouses/harvest-batch-dialog';
import{Badge}from'./components/ui/badge';import{Input}from'./components/ui/input';import{Button}from'./components/ui/button';
const Link=({href,children,...p})=><a href={href} {...p}>{children}</a>;
function App(){const [key,setSelectedDossierAllocationKey]=useState('a11'),setDossierDetailTab=()=>{};
const rowItems=[{key:'a11',title:'Картофель, Сорая, 1 р.',plannedArea:11},{key:'a34',title:'Картофель, Baltic Rose, 4 р.',plannedArea:34},{key:'a12',title:'Морковь, Каскад F1, F1',plannedArea:12},{key:'a20',title:'Пар',plannedArea:20}].map(r=>({...r,operationsForAllocation:[],materialRows:[]}));const selectedItem=rowItems.find(r=>r.key===key),fmtHa=n=>n+' га';
const[selectedBatch,setSelectedBatch]=useState(null),[selectedBatchLoading,setSelectedBatchLoading]=useState(false),[selectedBatchError,setSelectedBatchError]=useState(null),selectedBatchRequestGeneration=useRef(0),profile={company_id:'c'};
const listHarvestBatchSummaries=async(c,o)=>(await(await fetch('/api/fixture/batches?detail='+(o.originsOnly?'origins':'full'))).json()).batches;
const toast=()=>{};${handler}
const batch={id:'lot',warehouseId:'wh',warehouseName:'Картофеле-Хранилище',cropName:'Картофель',varietyName:'Сорая',reproductionName:'1',cleanMassKg:428810,detailLevel:'summary',fieldSummaries:[],tripBatches:[],outgoingDocuments:[]};
const [search,setSearch]=useState(''),handleSearchKeyDown=()=>{},isReorderMode=false,canManageWarehouses=true,canStockOperate=true;
const receivedKg=608200,stockKg=8382300,yieldTonnes=null,mass=n=>(n/1000).toLocaleString('ru-RU')+' т',setCalculatorOpen=()=>{};
return <main className="tf-manor-shell p-3 space-y-5"><section aria-label="Сводка">${metrics}</section>${toolbar}<button id="open-batch" onClick={()=>openHarvestBatch(batch)}>Открыть партию</button>
<div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">${aside}<FieldHarvestLive companyId="c" seasonId="s" fieldId="f9" allocationId={key} allocationLabel={selectedItem.title}/></div>
<HarvestBatchDialog open={!!selectedBatch} onOpenChange={v=>{if(!v){selectedBatchRequestGeneration.current++;setSelectedBatch(null);}}} batch={selectedBatch} loading={selectedBatchLoading} error={selectedBatchError} onLoadHistory={()=>openHarvestBatch(selectedBatch,true)} onRetryOrigins={()=>openHarvestBatch(selectedBatch)}/></main>;}createRoot(document.getElementById('app')).render(<App/>);`;
async function main(){
 await require('esbuild').build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,jsx:'automatic',outfile:path.join(out,'browser.js'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture',setup(b){b.onResolve({filter:/lib\/supabase\/client$/},()=>({path:'auth',namespace:'fixture'}));b.onResolve({filter:/weighbridge\/ticket-preview-dialog$/},()=>({path:'ticket',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='auth'?"export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})}};":"export const TicketPreviewDialog=()=>null;",loader:'js'}));}}]});
 const cssDir=path.join(root,'.next/static/css'),css=fs.readdirSync(cssDir).filter(f=>f.endsWith('.css')).map(f=>`<link rel="stylesheet" href="/css/${f}">`).join('');
 const counts={origins:0,full:0};
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','text/html');
  if(url.pathname==='/')return res.end(`<!doctype html><html lang="ru" data-theme="estate-graphite"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<body class="tf-manor"><div id="app"></div><script src="/browser.js"></script></body></html>`);
  if(url.pathname==='/api/fixture/batches'){const d=url.searchParams.get('detail');counts[d]++;res.setHeader('Content-Type','application/json');const origin={fieldId:'f9',fieldName:'9',netWeightKg:814350,areaHa:11,yieldTPerHa:74.032,tripCount:78};return res.end(JSON.stringify({batches:[{id:'lot',warehouseId:'wh',warehouseName:'Картофеле-Хранилище',cropName:'Картофель',varietyName:'Сорая',reproductionName:'1',cleanMassKg:428810,receivedKg:814350,removedKg:385540,detailLevel:d==='full'?'full':'origins',fieldSummaries:[origin],outgoingDocuments:d==='full'?[{id:'doc',label:'Вывоз примеси',direction:'out',quantityKg:500,sourceType:'weighbridge_ticket',ticketId:'ticket',occurredAt:'2026-09-15T10:00:00Z'}]:[],tripBatches:[]}]}));}
  if(url.pathname.includes('field-harvest-summary')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({companyId:'c',seasonId:'s',fieldId:'f9',acceptedMassKg:2108490,yieldAreaHa:77,yieldTPerHa:27.383,reconciliationStatus:'reconciled',unassignedAcceptedMassKg:0,byAllocation:[{allocationId:'a11',areaHa:11,acceptedMassKg:814350,yieldTPerHa:74.032},{allocationId:'a34',areaHa:34,acceptedMassKg:1294140,yieldTPerHa:38.063},{allocationId:'a12',areaHa:12,acceptedMassKg:0,yieldTPerHa:null},{allocationId:'a20',areaHa:20,acceptedMassKg:0,yieldTPerHa:null}]}));}
  if(url.pathname==='/favicon.ico'){res.statusCode=204;return res.end();}
  const file=url.pathname==='/browser.js'?path.join(out,'browser.js'):path.join(cssDir,path.basename(url.pathname));if(!fs.existsSync(file)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');fs.createReadStream(file).pipe(res);
 });await new Promise(r=>server.listen(3199,'127.0.0.1',r));if(process.argv.includes('--serve')){console.log('Annotation QA http://127.0.0.1:3199');return;}
 const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const browser=await chromium.launch({channel:'msedge',headless:true});
 try{const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:3199');
 const live=page.getByTestId('field-harvest-live');await live.getByText('74,032 т/га').waitFor();assert(!(await live.innerText()).includes('77 га'));
 const plots=page.getByRole('complementary',{name:'Участки поля'});const widths=await plots.getByRole('button').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().width));assert(Math.max(...widths)-Math.min(...widths)<1,'equal plot button widths');
 await plots.getByRole('button',{name:/Baltic Rose/}).click();await live.getByText('38,063 т/га').waitFor();assert((await live.innerText()).includes('34 га'));assert(!(await live.innerText()).includes('814'));
 await plots.getByRole('button',{name:/Морковь/}).click();await live.getByText('0 кг',{exact:true}).waitFor();assert(!(await live.innerText()).includes('38,063'));
 const toolbarBox=page.getByTestId('warehouse-toolbar');const input=await toolbarBox.getByRole('textbox').boundingBox(),manage=await toolbarBox.getByRole('link',{name:'Управление складами'}).boundingBox();assert(Math.abs(input.y-manage.y)<2,'warehouse search and actions on one row');
 const metric=await page.getByRole('region',{name:'Главные показатели картофеля'}).boundingBox();assert(metric.height<75,'compact KPI height');await page.waitForTimeout(350);await page.screenshot({path:path.join(out,'desktop.png')});
 assert.equal(counts.full,0);await page.locator('#open-batch').click();const dialog=page.getByRole('dialog');await dialog.getByRole('region',{name:'Поступление с полей'}).getByText('74,03',{exact:true}).waitFor();assert.equal(counts.origins,1);assert.equal(counts.full,0);assert.equal(await dialog.getByText('Вывоз примеси',{exact:true}).count(),0);
 await page.waitForTimeout(350);await page.screenshot({path:path.join(out,'batch-origins.png')});await dialog.getByRole('button',{name:'Рейсы и движения',exact:true}).click();await dialog.getByText('Вывоз примеси',{exact:true}).waitFor();assert.equal(counts.full,1);
 assert.equal(await dialog.locator('.tf-scroll-hidden').evaluate(el=>getComputedStyle(el).scrollbarWidth),'none');await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.setViewportSize({width:360,height:780});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#open-batch').click();await page.getByRole('dialog').getByText('74,03',{exact:true}).waitFor();assert.equal(counts.full,1,'reopening a card must not fetch history');await page.waitForTimeout(350);await page.screenshot({path:path.join(out,'mobile-batch.png')});assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:['plot switch 11/34/12 ha','same width short/long plot labels','compact KPI','one-row toolbar','zero automatic history requests','explicit history load','reopen stays lazy','hidden scrollbar with scrolling','360px overflow','no JS errors'],counts}));
 }finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
