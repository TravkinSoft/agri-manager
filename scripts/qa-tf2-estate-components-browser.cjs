// Local component regression only: real JSX/primitives and CSS, synthetic draft state.
// No auth, API, Production or QA database traffic. Not a substitute for release QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
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
 return <main className="tf-manor travkin-shell mx-auto min-h-screen max-w-5xl space-y-5 p-4 md:p-8">
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

async function main() {
 const bundle=await req('esbuild').build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'alias',setup(build){build.onResolve({filter:/^@\//},args=>({path:req.resolve(path.join(root,args.path.slice(2)))}));}}]});
 const config=req(path.join(root,'tailwind.config.ts')).default;
 const css=(await req('postcss')([req('tailwindcss')({...config,content:[{raw:source,extension:'tsx'},path.join(root,'components/ui/*.tsx'),path.join(root,'components/crop-structure/*.tsx')]})]).process(fs.readFileSync('app/globals.css','utf8'),{from:undefined})).css;
 const html='<!doctype html><html lang="ru" data-theme="estate-register"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body class="tf-manor"><div id="root"></div><script>'+bundle.outputFiles[0].text+'</script></body></html>';
 fs.mkdirSync(output,{recursive:true});
 const server=http.createServer((request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const evidence=[];
 try {
  for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
   const browser=await engine.launch(name==='chromium'?{headless:true,channel:'chrome'}:{headless:true});
   try {
    for(const width of [360,768,1440]) {
     const page=await browser.newPage({viewport:{width,height:1000},hasTouch:width===360,isMobile:width===360,reducedMotion:'reduce'});
     page.setDefaultTimeout(6000);
     const errors=[],external=[];
     page.on('pageerror',error=>errors.push(error.message));
     await page.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();external.push(route.request().url());return route.abort();});
     try {
      await page.goto(origin); await page.getByTestId('crop-structure-editor').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0,name+'/'+width+': horizontal overflow');
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
      await input.fill('075'); await input.press('Enter');
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
      await modalInput.press('Escape');
      await modalList.waitFor({state:'hidden'});
      assert.equal(await ticketDialog.isVisible(),true,'Escape closes list, not enclosing document');
      await modalInput.press('Tab'); await page.keyboard.press('Escape');
      await ticketDialog.waitFor({state:'hidden'});
      await page.screenshot({path:path.join(output,name+'-'+width+'.png'),fullPage:true});
      assert.deepEqual(errors,[],'browser exceptions');assert.deepEqual(external,[],'fixture has zero external requests');
      evidence.push({engine:name,width,pass:true,checks:21,screenshot:name+'-'+width+'.png'});
      console.log('PASS '+name+'/'+width+' editor, inline search, portal, draft, keyboard and disabled checks');
     } catch(error) {
      await page.screenshot({path:path.join(output,name+'-'+width+'-failure.png'),fullPage:true});
      throw error;
     } finally {await page.close();}
    }
   } finally {await browser.close();}
  }
 } finally {await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({scope:'local components only',evidence},null,2));}
}
main().catch(error=>{console.error(String(error.stack||error).slice(0,2600));process.exitCode=1;});
