import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { assertCatalogTarget,CATALOG_TARGET,catalogManifest,validateCatalogPart } from '../lib/glbd/catalog-hq6';

// CLI explicitly uses an existing short-lived user session, never a service-role key.
// No .env auto-loading, password collection, token refresh/persistence or role simulation.
async function main(){
 const [mode,directory]=process.argv.slice(2);
 if(!directory || !['check','apply'].includes(mode))throw new Error('Usage: tsx scripts/import-catalog-hq6.ts check|apply <approved-package-directory>');
 const loaded=[];
 for(const part of catalogManifest.parts){const text=await readFile(path.join(directory,part.file),'utf8');validateCatalogPart(part.file,text);loaded.push({part,text});}
 if(mode==='check'){console.log(JSON.stringify({status:'FILE_VALIDATED_ONLY',products:catalogManifest.products,claims:catalogManifest.attribute_claims,parts:loaded.length}));return;}
 assertCatalogTarget(process.env.NEXT_PUBLIC_SUPABASE_URL||'');
 const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,token=process.env.TF_CATALOG_SESSION_TOKEN;
 if(!key||!token)throw new Error('Existing Product publishable key and existing Global Admin user session required');
 const client=createClient(CATALOG_TARGET,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`}}});
 const {data:user,error:authError}=await client.auth.getUser(token);
 if(authError||!user.user)throw new Error('Existing user session is not valid');
 const {data:profile,error:profileError}=await client.from('profiles').select('role,status').eq('id',user.user.id).single();
 if(profileError||profile?.role!=='global_admin'||profile?.status!=='active')throw new Error('Active existing Global Admin required');
 const results=[];
 for(const {part,text} of loaded){
  const {data,error}=await client.rpc('catalog_hq6_import_part',{p_package:part.package,p_version:part.version,p_digest:part.digest,p_payload:text});
  if(error)throw new Error(`Part ${part.file}: import stopped (${error.code||'RPC_ERROR'}). Inspect journal before continuing; no automatic blind retry.`);
  results.push({file:part.file,...data});console.log(JSON.stringify(results.at(-1)));
 }
 console.log(JSON.stringify({status:'RPC_PARTS_RETURNED_REQUIRES_POSTFLIGHT',parts:results.length,inserted:results.reduce((n,r)=>n+Number(r.inserted),0)}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Import failed');process.exitCode=1;});
