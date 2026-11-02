import pathlib,subprocess,json,hashlib,os,time
R=pathlib.Path(__file__).resolve().parents[1]; W=R/'scripts/output/catalog-hq6-native'; W.mkdir(parents=True,exist_ok=True)
ARGS=['node',str(R/'scripts/catalog-hq6-native/psql-proxy.cjs')]
env=os.environ.copy();env['PGCLIENTENCODING']='UTF8'
def query(sql,ok=True):
 r=subprocess.run(ARGS,input=sql,text=True,encoding='utf-8',capture_output=True,env=env,timeout=45)
 if ok and r.returncode:raise RuntimeError(r.stderr)
 return r
def value(sql):return (query(sql).stdout.strip().splitlines() or [''])[-1]
def literal(x):return "'"+x.replace("'","''")+"'"
def uid(n):return f'92000000-0000-4000-8000-{n:012d}'
actor=f"select set_config('test.actor','{uid(1)}',false); set role authenticated;"
def rec(n):
 return {'id':uid(1000+n),'research_id':f'NATIVE-SYNTH-{n}','type':'spare_part','name':'Синтетический фильтр','category':{'id':uid(100),'code':'TF-PC-08','name_ru':'Фильтры','aliases':['фильтр','фильтры','filter'],'revision':'ru-1'},'manufacturer':{'id':uid(101),'key':'Synthetic Only','name':'Synthetic Only'},'identity':{'kind':'mpn','mpn':f'00{n}-A/7','designation':None,'grade':None,'variant':None},'gaps':{},'provenance':{'synthetic':True},'sources':[{'id':uid(2000+n),'url':'https://example.com/synthetic','title':'Fixture','fingerprint':'a'*64,'checked_at':'2026-11-02T00:00:00Z','metadata':{'synthetic':True}}],'claims':[{'id':uid(3000+n),'field_path':'diameter','value':30,'unit':'mm','conditions':{'synthetic':True},'source_id':uid(2000+n),'locator':'fixture','fingerprint':'b'*64,'checked_at':'2026-11-02T00:00:00Z'}]}
def call(n,records):
 p=json.dumps({'records':records},ensure_ascii=False,separators=(',',':'));h=hashlib.sha256(p.encode()).hexdigest();return f"select public.catalog_hq6_import_part('TF_PARTS_HQ6_4437/part-{n:03}','2','{h}',{literal(p)});"
def start(name,sql):
 e=env.copy();e['PGAPPNAME']=name
 p=subprocess.Popen(ARGS,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',env=e)
 p.stdin.write(sql);p.stdin.close();p.stdin=None;return p
def wait_for(sql,expected,timeout=5):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  if value(sql)==expected:return
  time.sleep(.05)
 raise AssertionError('Local expected concurrent state not reached')
checks=[]
def passed(s):checks.append(s);print('PASS',s,flush=True)
query((R/'scripts/fixtures/catalog-hq6-existing-schema.sql').read_text(encoding='utf-8'))
query((R/'supabase/migrations/20261102010135_catalog_hq6_accounting_mode.sql').read_text(encoding='utf-8'))
query('begin;'+(R/'supabase/migrations/20261102010136_catalog_hq6_schema.sql').read_text(encoding='utf-8')+'commit;')
query((R/'supabase/migrations/20261102011920_catalog_hq6_search.sql').read_text(encoding='utf-8'))
passed('PostgreSQL 17.6 fixture and all migrations apply')
query(f"insert into auth.users values('{uid(1)}'),('{uid(2)}');insert into profiles values('{uid(1)}','global_admin','active',null),('{uid(2)}','specialist','active',null);")
c1=call(1,[rec(1),rec(2)])
p1=start('hq6_race_first','begin;'+actor+c1+'select pg_sleep(2);commit;')
wait_for("select coalesce(max(wait_event),'') from pg_stat_activity where application_name='hq6_race_first'",'PgSleep')
p2=start('hq6_race_second',actor+c1)
wait_for("select coalesce(max(wait_event),'') from pg_stat_activity where application_name='hq6_race_second'",'advisory')
o1,e1=p1.communicate(timeout=15);o2,e2=p2.communicate(timeout=15)
assert p1.returncode==p2.returncode==0,(e1,e2)
r1=json.loads(next(x for x in o1.splitlines() if x.startswith('{')));r2=json.loads(next(x for x in o2.splitlines() if x.startswith('{')))
assert r1['inserted']==2 and r2['inserted']==0 and r2['status']=='unchanged',(r1,r2)
assert value("select count(*) from products where type='spare_part'")=='2'
passed('two real connections wait on advisory lock; one import and zero-growth repeat')
r=query(actor+call(1,[rec(3)]),ok=False);assert r.returncode and 'logical_version_digest_conflict' in r.stderr
passed('same version different digest refused on native server')
p3=start('hq6_crash','begin;'+actor+call(2,[rec(3)])+'select pg_sleep(20);commit;')
wait_for("select coalesce(max(wait_event),'') from pg_stat_activity where application_name='hq6_crash'",'PgSleep')
assert value("select pg_terminate_backend(pid) from pg_stat_activity where application_name='hq6_crash'")=='t'
p3.communicate(timeout=5)
assert value(f"select count(*) from products where id='{uid(1003)}'")=='0'
assert value("select count(*) from glbd_import_batches where source_package like '%002'")=='0'
passed('real backend termination before commit leaves no product or batch')
r=json.loads(value(actor+call(2,[rec(3)])));assert r['inserted']==1
r=json.loads(value(actor+call(2,[rec(3)])));assert r['inserted']==0
passed('restart after aborted transaction and response-loss repeat recover deterministically')
for t in ['products','product_catalog_details','product_evidence_claims','glbd_product_sources','glbd_import_batches','glbd_import_batch_rows']:
 assert value(f"select set_config('test.actor','{uid(2)}',false);set role authenticated;select count(*) from {t};")=='0',t
passed('native RLS hides drafts and all related evidence from ordinary actor')
for q in ['фильтр','фильтры','filter']:
 assert value(actor+f"select count(*) from product_catalog_details where search_ru@@plainto_tsquery('russian',{literal(q)}) or search_simple@@plainto_tsquery('simple',{literal(q)});")=='3'
passed('native Russian plural and English category alias work')
# Test morphology for two additional categories without importing accepted records.
for i,(name,words,terms) in enumerate([('Масла',['масло','масла','oil'],['масло','масла','oil']),('Подшипники',['подшипник','подшипники','bearing'],['подшипник','подшипники','bearing'])],10):
 x=rec(i);x['name']=name;x['category']={'id':uid(100+i),'code':f'SYNTH-{i}','name_ru':name,'aliases':words,'revision':'ru-1'}
 query(actor+call(i,[x]))
 for term in terms:assert value(actor+f"select count(*) from product_catalog_details where product_id='{x['id']}' and (search_ru@@plainto_tsquery('russian',{literal(term)}) or search_simple@@plainto_tsquery('simple',{literal(term)}));")=='1'
passed('native oil and bearing Russian/English synonyms')
elapsed=time.monotonic();big=[rec(n) for n in range(100,300)];r=json.loads(value(actor+call(100,big)));ms=round((time.monotonic()-elapsed)*1000);assert r['inserted']==200
r=json.loads(value(actor+call(100,big)));assert r['inserted']==0
passed('native bounded 200-record batch and repeat')
heavy=[rec(n) for n in range(500,560)]
for item in heavy:
 item['gaps']['synthetic_load_padding']=''
 base_claim=item['claims'][0]
 item['claims']=[dict(base_claim,id=uid(50000+int(item['id'][-12:])*10+j),field_path=f'synthetic_property_{j}',value=j) for j in range(7)]
base=len(json.dumps({'records':heavy},ensure_ascii=False,separators=(',',':')).encode())
for item in heavy:item['gaps']['synthetic_load_padding']='x'*((880000-base)//60)
heavy_bytes=len(json.dumps({'records':heavy},ensure_ascii=False,separators=(',',':')).encode());assert 870000<=heavy_bytes<=900000
heavy_start=time.monotonic();assert json.loads(value(actor+call(200,heavy)))['inserted']==60
heavy_ms=round((time.monotonic()-heavy_start)*1000);assert json.loads(value(actor+call(200,heavy)))['inserted']==0
passed('native near-limit 880KB synthetic payload and unchanged repeat')
assert json.loads(value(actor+"select row_to_json(t) from catalog_hq6_search('001-A/7') t;"))['is_exact'] is True
passed('native search RPC exact MPN')
out={'checked_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'engine':value('select version()'),'synthetic_only':True,'connections':2,'checks':checks,'passed':len(checks),'batch_200_ms':ms,'near_limit_bytes':heavy_bytes,'near_limit_ms':heavy_ms,'race_receipts':[r1,r2],'product_executed':False}
(W/'native-runtime-result.json').write_text(json.dumps(out,indent=2,ensure_ascii=False),encoding='utf-8');print(json.dumps(out,ensure_ascii=False),flush=True)
