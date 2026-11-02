/** Legacy service-role readers bypass RLS. Keep catalogue-only entries out of
 * their lists/counts, including archive searches. The new catalogue uses a
 * user-scoped client/RPC; no service-role exception is provided here. */
export function protectLegacyProductReads<T extends { from: (relation: string) => any }>(client:T):T {
 const originalFrom=client.from.bind(client);
 client.from=((relation:string)=>{
  const builder=originalFrom(relation);
  if(relation==='products'){
   const originalSelect=builder.select.bind(builder);
   builder.select=(...args:unknown[])=>originalSelect(...args).not('type','in','(spare_part,technical_fluid,maintenance_material)');
  }
  return builder;
 }) as T['from'];
 return client;
}
