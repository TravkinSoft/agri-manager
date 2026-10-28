import assert from "node:assert/strict";
import { countCompletedDriverTrips, type TripTicket } from "../lib/traffic/shift-trip-counts";
import { readShiftTripCounts } from "../lib/traffic/shift-trip-counts-server";
import { buildTrafficBoard } from "../lib/traffic/read-only-board";

let checks = 0;
const ticket = (id: string, extra: Partial<TripTicket> = {}): TripTicket => ({ id, shift_id: "s", vehicle_id: "v", driver_id: "d", op_type: "harvest_incoming",
  status: "finalized", is_finalized: true, is_voided: false, correction_of_ticket_id: null, replacement_ticket_id: null, ptc_event_id: null, ptc_cycle: null, ...extra });
async function check(name: string, fn: () => void | Promise<void>) { await fn(); checks++; console.log("PASS " + name); }
async function main() {
  await check("receipt counted once despite duplicate rows", () => assert.equal(countCompletedDriverTrips("s", [ticket("a"), ticket("a")]).get("d"), 1));
  await check("open, void, replaced, soil and other shifts excluded", () => {
    assert.equal(countCompletedDriverTrips("s", [ticket("good"), ticket("open", {status:"active",is_finalized:false}), ticket("void",{is_voided:true}),
      ticket("replaced",{replacement_ticket_id:"good"}),ticket("soil",{op_type:"weighbridge_impurities"}),ticket("yesterday",{shift_id:"old"})]).get("d"), 1);
  });
  await check("split plot allocations sharing one PTC cycle are one trip", () => assert.equal(countCompletedDriverTrips("s", [ticket("a",{ptc_cycle:8}),ticket("b",{ptc_cycle:8})]).get("d"),1));
  await check("same cycle numbers on different vehicles are separate trips", () => assert.equal(countCompletedDriverTrips("s", [ticket("a",{ptc_cycle:8}),ticket("b",{ptc_cycle:8,vehicle_id:"v2"})]).get("d"),2));
  await check("driver changed: previous driver's trips not assigned to new driver", () => {
    const result=countCompletedDriverTrips("s",[ticket("old"),ticket("new",{driver_id:"madi"})]);assert.equal(result.get("d"),1);assert.equal(result.get("madi"),1);
  });
  const original=ticket("original",{is_voided:true,replacement_ticket_id:"correction",ptc_cycle:9});
  const correction=ticket("correction",{shift_id:"tomorrow",correction_of_ticket_id:"original"});
  await check("correction next day belongs to original shift, not tomorrow",()=>{assert.equal(countCompletedDriverTrips("s",[original,correction]).get("d"),1);assert.equal(countCompletedDriverTrips("tomorrow",[original,correction]).size,0)});
  await check("draft correction leaves valid original counted",()=>assert.equal(countCompletedDriverTrips("s",[ticket("original"),ticket("draft",{correction_of_ticket_id:"original",status:"active",is_finalized:false})]).get("d"),1));
  await check("missing/cyclic correction history fails instead of invented total",()=>{assert.throws(()=>countCompletedDriverTrips("s",[correction]));assert.throws(()=>countCompletedDriverTrips("s",[ticket("a",{correction_of_ticket_id:"a"})]))});
  const snapshot:any={serverTime:"2026-09-25T05:00:00Z",vehicles:[{vehicle_id:"v",driverId:"madi",driver:"Мади",state:"empty",assigned:true,since:null}]};
  const fleet:any=[{id:"v",name:"КАМАЗ",plate:"TEST",driver:"Мади"}];
  await check("board uses current driver ID, not vehicle lifetime or text matching",()=>assert.equal(buildTrafficBoard("C",snapshot,fleet,new Map([["d",10],["madi",6]])).vehicles[0].shiftTrips,6));
  await check("unavailable differs from zero and plain board remains unchanged",()=>{assert.equal(buildTrafficBoard("C",snapshot,fleet,null).vehicles[0].shiftTrips,null);assert.equal(buildTrafficBoard("C",snapshot,fleet,new Map()).vehicles[0].shiftTrips,0);assert.equal(buildTrafficBoard("C",snapshot,fleet).vehicles[0].shiftTrips,undefined)});
  await check("concurrent driver reassignment never mixes name and count",()=>assert.equal(buildTrafficBoard("C",snapshot,[{...fleet[0],driver:"Другой"}],new Map([["madi",6]])).vehicles[0].shiftTrips,null));
  await check("offline fleet counts known drivers even without a manager state",()=>assert.equal(buildTrafficBoard("C",{serverTime:snapshot.serverTime,vehicles:[]},[{...fleet[0],driverId:"madi"}],new Map([["madi",6]])).vehicles[0].shiftTrips,6));
  const records:any={weighbridge_shifts:[{id:"s",company_id:"C",status:"open",opened_at:"2026-09-24T22:00:00Z"}],tickets:Array.from({length:1005},(_,i)=>({...ticket(String(i).padStart(5,"0")),company_id:"C"}))};
  const trace:string[]=[];let fail=false;
  const db:any={from(table:string){const filters:Array<(r:any)=>boolean>=[],sorts:Array<[string,boolean]>=[];let limit=Infinity,single=false;
    const q:any={select:()=>q,eq:(k:string,v:any)=>{filters.push(r=>r[k]===v);if(k==="company_id")trace.push(v);return q},gt:(k:string,v:any)=>{filters.push(r=>r[k]>v);return q},in:(k:string,v:any[])=>{filters.push(r=>v.includes(r[k]));return q},order:(k:string,o:any)=>{sorts.push([k,o?.ascending!==false]);return q},limit:(n:number)=>{limit=n;return q},maybeSingle:()=>{single=true;return q},then:(resolve:any,reject:any)=>{
      assert.equal(trace[trace.length-1],"C","every read tenant-scoped");const rows=[...(records[table]||[])].filter(r=>filters.every(f=>f(r))).sort((a,b)=>{for(const[k,asc]of sorts)if(a[k]!==b[k])return(a[k]<b[k]?-1:1)*(asc?1:-1);return 0}).slice(0,limit);
      return Promise.resolve({data:single?rows[0]??null:rows,error:fail?new Error("read failed"):null}).then(resolve,reject);
    }};return q}};
  await check("loader reads beyond 1000, current shift spans midnight",async()=>assert.equal((await readShiftTripCounts(db,"C"))?.get("d"),1005));
  await check("current shift wins over later closed shift; next shift resets",async()=>{records.weighbridge_shifts.push({id:"next",company_id:"C",status:"closed",opened_at:"2026-09-25T06:00:00Z"});assert.equal((await readShiftTripCounts(db,"C"))?.get("d"),1005);records.weighbridge_shifts[0].status="closed";records.weighbridge_shifts[1].status="open";assert.equal((await readShiftTripCounts(db,"C"))?.size,0)});
  await check("closed latest shift remains readable",async()=>{records.weighbridge_shifts[1].status="closed";records.tickets=[{...ticket("closed",{shift_id:"next"}),company_id:"C"}];assert.equal((await readShiftTripCounts(db,"C"))?.get("d"),1)});
  await check("loader resolves replacement outside selected shift",async()=>{records.weighbridge_shifts=[{id:"s",status:"open",opened_at:"2026-09-25",company_id:"C"}];records.tickets=[original,correction].map(r=>({...r,company_id:"C"}));assert.equal((await readShiftTripCounts(db,"C"))?.get("d"),1)});
  await check("read failure propagates, not zero trips",async()=>{fail=true;await assert.rejects(readShiftTripCounts(db,"C"));fail=false});
  await check("no shift is unavailable, not fabricated shift",async()=>{records.weighbridge_shifts=[];assert.equal(await readShiftTripCounts(db,"C"),null)});
  console.log(`PASS ${checks} trip checks; read-only fixtures`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
