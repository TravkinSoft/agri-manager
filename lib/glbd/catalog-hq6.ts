import { createHash } from 'node:crypto';
import approved from './catalog-hq6-manifest.json';

export const CATALOG_TARGET='https://bhsemlvmkikpntabctml.supabase.co';
export function validateCatalogPart(file:string,text:string) {
 const part=approved.parts.find(p=>p.file===file);
 if(!part)throw new Error('Part is not in the approved 4437 manifest');
 if(Buffer.byteLength(text,'utf8')!==part.bytes || createHash('sha256').update(text).digest('hex')!==part.digest)throw new Error('Immutable package digest mismatch');
 const body=JSON.parse(text);
 if(!Array.isArray(body.records)||body.records.length!==part.products)throw new Error('Product count mismatch');
 if(body.records.reduce((sum:number,r:any)=>sum+r.claims.length,0)!==part.claims)throw new Error('Claim count mismatch');
 return part;
}
export function assertCatalogTarget(url:string){
 if(url.replace(/\/$/,'')!==CATALOG_TARGET)throw new Error('Only existing canonical Product is allowed; no QA catalogue');
}
export { approved as catalogManifest };
