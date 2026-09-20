// Only a bounded read; never prints credentials or business rows.
process.loadEnvFile(process.argv[2]);
const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (base.hostname !== 'bhsemlvmkikpntabctml.supabase.co') throw new Error('Unexpected project');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error('Missing server credential');
const url = new URL('/rest/v1/stock_ledger_entries', base);
url.searchParams.set('select','id');
url.searchParams.set('company_id','eq.10000000-0000-0000-0000-000000000001');
const response = await fetch(url,{headers:{apikey:key,Authorization:`Bearer ${key}`,Prefer:'count=exact'},signal:AbortSignal.timeout(30000)});
if(!response.ok) throw new Error(`Read failed ${response.status}`);
const rows = await response.json();
console.log(JSON.stringify({status:response.status,returnedRows:rows.length,contentRange:response.headers.get('content-range')}));
