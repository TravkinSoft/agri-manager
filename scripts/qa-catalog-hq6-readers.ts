import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { protectLegacyProductReads } from '../lib/supabase/catalog-read-boundary';
import { assertCatalogTarget,CATALOG_TARGET,validateCatalogPart } from '../lib/glbd/catalog-hq6';

const requests:{url:URL;method:string}[]=[];
const client=protectLegacyProductReads(createClient('https://example.invalid','synthetic-public-key',{
 auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{requests.push({url:new URL(String(input)),method:String(init?.method)});return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});}}
}));
async function main(){
 await client.from('products').select('id,name').or('company_id.is.null,company_id.eq.00000000-0000-4000-8000-000000000001');
 assert.equal(requests[0].url.searchParams.get('type'),'not.in.(spare_part,technical_fluid,maintenance_material)');
 assert.ok(requests[0].url.searchParams.has('or'));
 await client.from('products').select('id',{count:'exact',head:true});assert.equal(requests[1].url.searchParams.get('type'),requests[0].url.searchParams.get('type'));
 await client.from('products').insert({name:'Synthetic old crop',type:'produce'}).select();assert.equal(requests[2].url.searchParams.has('type'),false);
 await client.from('products').update({name:'Updated synthetic'}).eq('id','synthetic').select();assert.equal(requests[3].url.searchParams.has('type'),false);assert.equal(requests[3].url.searchParams.get('id'),'eq.synthetic');
 await client.from('stock_ledger_entries').select('id');assert.equal(requests[4].url.searchParams.has('type'),false);
 assertCatalogTarget(CATALOG_TARGET);assert.throws(()=>assertCatalogTarget('https://wscmvenaiugtmwgvcpnm.supabase.co'),/Only existing/);
 assert.throws(()=>validateCatalogPart('part-001.json','{}'),/digest mismatch/);assert.throws(()=>validateCatalogPart('pending.json','{}'),/approved 4437/);
 console.log('PASS 9 service-reader/request/manifest boundaries; mocked network only');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
