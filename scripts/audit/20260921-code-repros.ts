// Read-only to hosted systems: all writes below target disposable in-memory PGlite.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { signedLedgerQuantity } from "../../lib/warehouse/stock-math";
import { buildWarehouseMassBreakdown } from "../../lib/warehouse/warehouse-summary-math";

async function main() {
  assert.equal(signedLedgerQuantity({ direction: "in", quantity: 100, delta_qty_signed: null }), 0);
  console.log("REPRO W3: legacy NULL signed quantity returns 0, expected fallback +100; no current Production NULL rows found.");
  const mass = buildWarehouseMassBreakdown([
    { warehouse_id: "w", quantity: 100, uom: "kg" },
    { warehouse_id: "w", quantity: -20, uom: "kg" },
  ], new Map());
  assert.equal(mass.get("w")?.totalWeightKg, 100);
  console.log("REPRO W4: +100 and -20 identity balances display 100 instead of signed 80; negative identity is hidden.");

  const fixture = readFileSync("scripts/qa-harvest-plot-driver-v1.ts", "utf8");
  const start = fixture.indexOf("await db.exec(`") + "await db.exec(`".length;
  const finish = fixture.indexOf("`);", start);
  assert(start > 13 && finish > start);
  const db = new PGlite();
  try {
    await db.exec(fixture.slice(start, finish));
    for (const file of ["20260916042809_harvest_plot_driver_v1.sql", "20260916160357_ptc_open_shift_progress_constraint.sql"])
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    const company = randomUUID(), field = randomUUID(), plot = randomUUID();
    const a = randomUUID(), b = randomUUID();
    await db.query("insert into companies values($1)", [company]);
    await db.query("insert into fields values($1,$2,'Audit fixture')", [field,company]);
    await db.query("insert into crop_structure(id,company_id,field_id,area,archived,land_use_type) values($1,$2,$3,54,false,'crop')", [plot,company,field]);
    await db.query("insert into ptc_flows values($1,true,$2)",[company,field]);
    for (const actor of [a,b]) {
      await db.query("insert into profiles values($1,$2,'mechanic_operator','active','Audit operator')",[actor,company]);
      await db.query("insert into company_people values($1,$2,$3,'Audit operator','active',null)",[randomUUID(),company,actor]);
    }
    const open = async (actor: string) => (await db.query<any>("select ptc_set_combine_shift_v2($1,'open',null,$2,null,null,false,$3) value",[actor,plot,randomUUID()])).rows[0].value;
    const first = await open(a), second = await open(b);
    const close = async (actor: string, shift: string, ha: number) => db.query("select ptc_set_combine_shift_v2($1,'close',$2,null,$3,false,false,$4)",[actor,shift,ha,randomUUID()]);
    await close(a,first.shiftId,10);
    await close(b,second.shiftId,6);
    const progress = (await db.query<any>("select actual_completed_ha from ptc_field_progress where crop_structure_id=$1",[plot])).rows[0];
    const total = (await db.query<any>("select sum(hectares_segment) hectares from ptc_combine_field_segments where crop_structure_id=$1",[plot])).rows[0];
    assert.equal(Number(progress.actual_completed_ha),6);
    assert.equal(Number(total.hectares),16);
    console.log("REPRO S3: two operators open one plot from 0 ha; totals 10 then 6 accepted; plot regresses to 6 while segments sum to 16.");
  } finally { await db.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
