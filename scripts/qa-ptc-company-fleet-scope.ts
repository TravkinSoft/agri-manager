import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

async function main() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table companies(id uuid primary key, name text not null);
    create table fields(id uuid primary key, company_id uuid);
    create table company_people(id uuid primary key, company_id uuid);
    create table reference_machines(
      id uuid primary key, company_id uuid, user_id uuid, name text, full_name text,
      type text, status text, is_active boolean, archived boolean,
      import_source text, import_source_row integer, inventory_number text,
      license_plate text, vin text, serial_number text, manufacture_year integer,
      source_raw_name text, source_clean_name text
    );
    create table reference_vehicles(
      id uuid primary key default gen_random_uuid(), company_id uuid, user_id uuid,
      name text not null, full_name text not null, custom_name text, type text not null,
      fleet_type text not null, plate_number text not null, license_plate text,
      status text not null default 'free', is_active boolean not null default true,
      archived boolean not null default false, import_source text,
      import_source_row integer, inventory_number text, vin text, serial_number text,
      manufacture_year integer, source_raw_name text, source_clean_name text,
      created_at timestamptz not null default now()
    );
    create table ptc_flows(company_id uuid primary key, field_id uuid);
    create table ptc_vehicle_states(
      company_id uuid not null, vehicle_id uuid not null, assigned boolean not null default true,
      state text not null default 'empty', primary key(company_id, vehicle_id)
    );
    create table ptc_access(company_id uuid, person_id uuid);
    create function ptc_check_references_v1() returns trigger language plpgsql as $$
      begin return new; end
    $$;
    create trigger ptc_vehicle_refs before insert or update on ptc_vehicle_states
      for each row execute function ptc_check_references_v1();
  `);

  const company = randomUUID();
  const otherCompany = randomUUID();
  const user = randomUUID();
  const ownerRoster = randomUUID();
  const ownerRoster2 = randomUUID();
  const sourceTruck = randomUUID();
  const extraTruck = randomUUID();
  const auditTruck = randomUUID();
  const trailer = randomUUID();
  const blockingManual = randomUUID();
  const tractor = randomUUID();
  const attachment = randomUUID();
  const excavator = randomUUID();
  const otherTruck = randomUUID();

  await db.query("insert into companies values($1,'Owner company'),($2,'Other company')", [company, otherCompany]);
  await db.query(`
    insert into reference_vehicles(
      id,company_id,user_id,name,full_name,type,fleet_type,plate_number,license_plate,
      import_source,import_source_row,inventory_number,source_raw_name
    ) values
      ($1,$2,$3,'ZIL 665','ZIL 665','truck','truck','665','665','ptc_owner_roster_2026-09-06',null,null,'owner roster'),
      ($4,$2,$3,'KAMAZ','KAMAZ','truck','truck','984 AE 15','984 AE 15','fixed_assets_osv_2026',47,null,'Самосвал'),
      ($5,$2,$3,'Extra','Extra','truck','truck','EXTRA-1','EXTRA-1','fixed_assets_osv_2026',58,null,'Грузовой автомобиль'),
      ($6,$2,$3,'Audit','Audit','truck','truck','AUDIT-1','AUDIT-1','fleet_audit_2026',null,'PROD-WB-AUDIT-1','QA'),
      ($7,$2,$3,'PTS','PTS','trailer','tractor_trailer','PTS-1',null,'fixed_assets_osv_2026',324,null,'Прицеп'),
      ($8,$9,$3,'Other truck','Other truck','truck','truck','OTHER-1','OTHER-1','fixed_assets_osv_2026',47,null,'Самосвал')
  `, [ownerRoster, company, user, sourceTruck, extraTruck, auditTruck, trailer, otherTruck, otherCompany]);
  await db.query(`
    insert into reference_vehicles(
      id,company_id,user_id,name,full_name,type,fleet_type,plate_number,license_plate,import_source
    ) values($1,$2,$3,'ZIL 13-19','ZIL 13-19','truck','truck','13-19','13-19','ptc_owner_roster_2026-09-06')
  `, [ownerRoster2, company, user]);
  await db.query(`
    insert into reference_vehicles(
      id,company_id,user_id,name,full_name,type,fleet_type,plate_number,license_plate
    ) values($1,$2,$3,'Manual busy truck','Manual busy truck','truck','truck','BUSY-1','BUSY-1')
  `, [blockingManual, company, user]);
  await db.query(
    "insert into ptc_vehicle_states(company_id,vehicle_id,assigned,state) values($1,$2,true,'loaded')",
    [company, blockingManual],
  );
  await db.query("insert into ptc_vehicle_states(company_id,vehicle_id,assigned) values($1,$2,false)", [otherCompany, otherTruck]);
  await db.query(`
    insert into reference_machines(
      id,company_id,user_id,name,full_name,type,status,is_active,archived,
      import_source,import_source_row,license_plate,source_raw_name
    ) values
      ($1,$2,$3,'FENDT 312','FENDT 312','tractor','free',true,false,'fixed_assets_osv_2026',442,'T 197 AND','Трактор Fendt 312'),
      ($4,$2,$3,'МТЗ 80','МТЗ 80','tractor','free',true,false,'fixed_assets_osv_2026',248,null,'КУН-ПФН-Т-219 для МТЗ'),
      ($5,$2,$3,'ЮМЗ','ЮМЗ','tractor','free',true,false,'fixed_assets_osv_2026',473,null,'Трактор ЮМЗ экскаватор')
  `, [tractor, company, user, attachment, excavator]);

  const migration = readFileSync("supabase/migrations/20260906120823_ptc_company_fleet_scope_v1.sql", "utf8");
  assert.match(migration, /PTC_OWNER_ROSTER_MARKERS_AMBIGUOUS/);
  assert.match(migration, /PTC_NON_ROSTER_VEHICLE_ASSIGNED/);
  await assert.rejects(db.exec(migration), /PTC_NON_ROSTER_VEHICLE_ASSIGNED/);
  await db.query("delete from ptc_vehicle_states where vehicle_id=$1", [blockingManual]);
  await db.query("delete from reference_vehicles where id=$1", [blockingManual]);
  await db.exec(migration);

  const scoped = await db.query<{ id: string; ptc_enabled: boolean }>(`
    select id::text,ptc_enabled from reference_vehicles
    where id=any($1::uuid[]) order by id
  `, [[ownerRoster, sourceTruck, extraTruck, auditTruck, trailer]]);
  const enabled = new Map(scoped.rows.map((row) => [row.id, row.ptc_enabled]));
  assert.equal(enabled.get(ownerRoster), true);
  assert.equal(enabled.get(sourceTruck), true);
  assert.equal(enabled.get(extraTruck), false);
  assert.equal(enabled.get(auditTruck), false);
  assert.equal(enabled.get(trailer), false);

  const projected = await db.query<{ id: string; source_machine_id: string; type: string; fleet_type: string; plate_number: string; license_plate: string | null; ptc_enabled: boolean }>(`
    select id::text,source_machine_id::text,type,fleet_type,plate_number,license_plate,ptc_enabled
    from reference_vehicles where source_machine_id is not null
  `);
  assert.equal(projected.rows.length, 1);
  assert.deepEqual({ ...projected.rows[0], id: "bridge" }, {
    id: "bridge", source_machine_id: tractor, type: "tractor", fleet_type: "tractor",
    plate_number: `PTC-TRACTOR-${tractor.replaceAll("-", "")}`,
    license_plate: "T 197 AND", ptc_enabled: true,
  });

  const manual = randomUUID();
  await db.query(`
    insert into reference_vehicles(id,company_id,user_id,name,full_name,type,fleet_type,plate_number)
    values($1,$2,$3,'Manual KAMAZ','Manual KAMAZ','truck','truck','MANUAL-1')
  `, [manual, company, user]);
  assert.equal((await db.query<{ ptc_enabled: boolean }>(
    "select ptc_enabled from reference_vehicles where id=$1", [manual]
  )).rows[0].ptc_enabled, true);

  await assert.rejects(
    db.query("insert into ptc_vehicle_states(company_id,vehicle_id,assigned) values($1,$2,true)", [company, extraTruck]),
    /PTC_INELIGIBLE_VEHICLE/,
  );

  await assert.rejects(
    db.query(`
      insert into reference_vehicles(
        company_id,user_id,name,full_name,type,fleet_type,plate_number,source_machine_id
      ) values($1,$2,'Foreign tractor','Foreign tractor','tractor','tractor','FOREIGN',$3)
    `, [otherCompany, user, attachment]),
    /PTC_MACHINE_COMPANY_MISMATCH/,
  );
  await assert.rejects(
    db.query("update reference_machines set company_id=$1 where id=$2", [otherCompany, tractor]),
    /PTC_MACHINE_COMPANY_MISMATCH/,
  );
  await db.query("insert into ptc_vehicle_states(company_id,vehicle_id,assigned) values($1,$2,true)", [company, projected.rows[0].id]);

  // A vehicle already working on the line can finish its cycle and be removed
  // even if an administrator disables it concurrently; only re-entry is blocked.
  await db.query("insert into ptc_vehicle_states(company_id,vehicle_id,assigned,state) values($1,$2,true,'empty')", [company, sourceTruck]);
  await db.query("update reference_vehicles set ptc_enabled=false where id=$1", [sourceTruck]);
  await db.query("update ptc_vehicle_states set state='loaded' where company_id=$1 and vehicle_id=$2", [company, sourceTruck]);
  await assert.rejects(
    db.query(
      "update ptc_vehicle_states set vehicle_id=$1 where company_id=$2 and vehicle_id=$3",
      [extraTruck, company, sourceTruck],
    ),
    /PTC_INELIGIBLE_VEHICLE/,
  );
  await db.query("update ptc_vehicle_states set assigned=false where company_id=$1 and vehicle_id=$2", [company, sourceTruck]);
  await assert.rejects(
    db.query("update ptc_vehicle_states set assigned=true where company_id=$1 and vehicle_id=$2", [company, sourceTruck]),
    /PTC_INELIGIBLE_VEHICLE/,
  );

  assert.equal((await db.query<{ ptc_enabled: boolean }>(
    "select ptc_enabled from reference_vehicles where id=$1", [otherTruck]
  )).rows[0].ptc_enabled, true);
  assert.equal((await db.query<{ total: number }>(
    "select count(*)::int total from reference_vehicles where source_machine_id in ($1,$2)",
    [attachment, excavator],
  )).rows[0].total, 0);

  await db.close();
  console.log("PTC company fleet scope PASS: curated trucks, tractor projection, hidden legacy rows and DB guard");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
