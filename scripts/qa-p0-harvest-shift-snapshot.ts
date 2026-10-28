import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

async function main() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.weighbridge_shifts(id uuid primary key,company_id uuid,status text,opened_at timestamptz default now(),closed_at timestamptz,
      operator_person_id uuid,closed_by uuid,closed_by_person_id uuid,close_reason text,summary_json jsonb,ticket_count integer,
      closed_ticket_count integer,voided_ticket_count integer,gross_total_kg numeric,net_total_kg numeric,unresolved_ticket_count integer,unsynced_count integer);
    create table public.tickets(id uuid primary key,company_id uuid,shift_id uuid,op_type text,status text,is_finalized boolean default true,is_voided boolean default false,
      replacement_ticket_id uuid,correction_of_ticket_id uuid,ticket_no text,created_at timestamptz default now(),local_sync_status text,
      accepted_weight_kg numeric,net_weight_kg numeric,gross_weight_kg numeric,field_id uuid,crop_structure_allocation_id uuid);
    create table public.inventory_batches(id uuid primary key,company_id uuid,parent_batch_id uuid,source_ticket_id uuid);
    create table public.stock_ledger_entries(id uuid primary key,company_id uuid,inventory_batch_id uuid,batch_id_text text,batch_id text,delta_qty_signed numeric,reason_type text);
    create table public.ticket_lines(id uuid primary key,ticket_id uuid,crop_id uuid);
    create table public.crops(id uuid primary key,name_ru text,name text);
    create table public.fields(id uuid primary key,company_id uuid,name text);
  `);
  await db.exec(readFileSync("supabase/migrations/20260918122738_p0_weighbridge_shift_snapshot_v1.sql", "utf8"));
  const company = randomUUID(), foreign = randomUUID(), shift = randomUUID(), operator = randomUUID(), actor = randomUUID(), crop = randomUUID();
  const root = randomUUID(), child = randomUUID(), pool = randomUUID(), receipt = randomUUID(), original = randomUUID(), corrected = randomUUID(), open = randomUUID();
  await db.query("insert into weighbridge_shifts(id,company_id,status,operator_person_id) values($1,$2,'open',$3)", [shift,company,operator]);
  await db.query("insert into crops values($1,'Картофель','Картофель')", [crop]);
  for (const [id,op,status,kg] of [[receipt,'harvest_incoming','finalized',10000],[original,'harvest_incoming','voided',8000],[corrected,'harvest_incoming','finalized',8000],[randomUUID(),'shipment_outgoing','finalized',1000],[open,'harvest_incoming','active',0]] as const) {
    await db.query("insert into tickets(id,company_id,shift_id,op_type,status,ticket_no,net_weight_kg) values($1::uuid,$2,$3,$4,$5,$1::uuid::text,$6)", [id,company,shift,op,status,kg]);
    await db.query("insert into ticket_lines values($1,$2,$3)",[randomUUID(),id,crop]);
  }
  await db.query("update tickets set replacement_ticket_id=$2,is_voided=true where id=$1",[original,corrected]);
  await db.query("insert into inventory_batches values($1,$4,null,$5),($2,$4,$1,null),($3,$4,null,null)",[root,child,pool,company,receipt]);
  for (const [batch,tenant,delta,reason] of [[root,company,-1000,'weighbridge_impurities_shared_member'],[child,company,-500,'weighbridge_impurities'],[child,company,200,'storno_weighbridge_impurities'],[pool,company,-1000,'weighbridge_impurities_shared'],[root,foreign,-300,'weighbridge_impurities'],[root,company,-2000,'shipment']] as const) {
    await db.query("insert into stock_ledger_entries values($1,$2,$3,null,null,$4,$5)",[randomUUID(),tenant,batch,delta,reason]);
  }
  const clean = await db.query<{ result: Record<string,number> }>("select harvest_impurities_by_receipt_v1($1) result",[company]);
  assert.deepEqual(clean.rows[0].result,{[receipt]:1300});
  const close = () => db.query<{ result: any }>("select close_weighbridge_shift_snapshot_v1($1,$2,$3,$4) result",[company,shift,actor,operator]);
  await assert.rejects(close(), /Сначала закройте талоны/);
  await db.query("update tickets set status='voided',is_voided=true where id=$1",[open]);
  await db.query("update tickets set local_sync_status='pending' where id=$1",[receipt]);
  await assert.rejects(close(), /несинхронизированные/);
  await db.query("update tickets set local_sync_status='synced' where id=$1",[receipt]);
  const closed = (await close()).rows[0].result;
  assert.equal(closed.status,'closed');
  assert.equal(closed.summary_json.potatoNetKg,18000);
  assert.equal(closed.summary_json.potatoCleanKg,16700);
  assert.equal(closed.summary_json.closedTicketCount,3);
  assert.deepEqual((await close()).rows[0].result,closed);
  await assert.rejects(db.query("insert into tickets(id,company_id,shift_id) values($1,$2,$3)",[randomUUID(),company,shift]),/уже закрыта/);
  await assert.rejects(db.query("select close_weighbridge_shift_snapshot_v1($1,$2,$3,$4)",[foreign,shift,actor,operator]),/не найдена/);
  const access = await db.query<{ allowed:boolean }>("select has_function_privilege('authenticated','public.close_weighbridge_shift_snapshot_v1(uuid,uuid,uuid,uuid)','execute') allowed");
  assert.equal(access.rows[0].allowed,false);
  // Later soil must not mutate the snapshot.
  await db.query("insert into stock_ledger_entries values($1,$2,$3,null,null,-100,'weighbridge_impurities')",[randomUUID(),company,root]);
  assert.deepEqual((await close()).rows[0].result,closed);
  await db.close();
  console.log('PASS: clean lineage, transfer, soil storno, shared-pool double-count protection, company isolation, pending/unsynced guards, atomic snapshot, idempotency, frozen report, closed-shift insert guard, RPC ACL');
}
main().catch(error => { console.error(error); process.exit(1); });
