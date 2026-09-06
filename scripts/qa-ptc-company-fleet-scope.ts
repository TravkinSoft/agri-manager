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
    create table company_people(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, user_id uuid,
      full_name text not null, role_type text not null, employment_type text not null default 'unknown',
      position text, status text not null default 'active', notes text,
      created_by_user_id uuid, updated_by_user_id uuid, deleted_at timestamptz,
      created_at timestamptz not null default now()
    );
    create table reference_specialists(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, user_id uuid not null,
      person_id uuid, full_name text not null, role text, personnel_type text not null,
      status text not null, archived boolean not null default false, created_at timestamptz default now()
    );
    create unique index specialist_name_live on reference_specialists(company_id, lower(full_name)) where archived=false;
    create unique index specialist_person_live on reference_specialists(person_id) where person_id is not null and archived=false;
    create table reference_machines(
      id uuid primary key default gen_random_uuid(), company_id uuid, user_id uuid, name text, full_name text,
      type text, status text, is_active boolean, archived boolean, category text, machinery_type text,
      description text, import_source text, import_source_row integer, inventory_number text,
      license_plate text, vin text, serial_number text, manufacture_year integer,
      source_raw_name text, source_clean_name text
    );
    create unique index machine_provenance on reference_machines(company_id, import_source, import_source_row)
      where import_source is not null and import_source_row is not null;
    create table reference_vehicles(
      id uuid primary key default gen_random_uuid(), company_id uuid, user_id uuid,
      name text not null, full_name text not null, custom_name text, type text not null,
      fleet_type text not null, plate_number text not null, license_plate text,
      status text not null default 'free', is_active boolean not null default true,
      archived boolean not null default false, import_source text,
      import_source_row integer, inventory_number text, vin text, serial_number text,
      manufacture_year integer, source_raw_name text, source_clean_name text,
      primary_responsible_personnel_id uuid, created_at timestamptz not null default now()
    );
    create unique index vehicle_provenance on reference_vehicles(company_id, import_source, import_source_row)
      where import_source is not null and import_source_row is not null;
    create unique index vehicle_plate_live on reference_vehicles(company_id, lower(plate_number)) where archived=false;
    create table ptc_flows(company_id uuid primary key, field_id uuid);
    create table ptc_vehicle_states(
      company_id uuid not null, vehicle_id uuid not null, assigned boolean not null default true,
      state text not null default 'empty', primary key(company_id, vehicle_id)
    );
    create table ptc_events(id uuid primary key default gen_random_uuid(), vehicle_id uuid not null);
    create table ptc_vehicle_repairs(vehicle_id uuid primary key, in_repair boolean not null);
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
  const redKamaz = randomUUID();
  const extraTruck = randomUUID();
  const auditTruck = randomUUID();
  const trailer = randomUUID();
  const uaz = randomUUID();
  const hilux = randomUUID();
  const special = randomUUID();
  const blockingManual = randomUUID();
  const mtz075 = randomUUID();
  const mtz878 = randomUUID();
  const irrelevantTractor = randomUUID();
  const attachment = randomUUID();
  const excavator = randomUUID();
  const otherTruck = randomUUID();
  const kalymov = randomUUID();
  const kalymovBridge = randomUUID();

  await db.query("insert into companies values($1,'Owner company'),($2,'Other company')", [company, otherCompany]);
  await db.query(`
    insert into company_people(id,company_id,full_name,role_type,status)
    values($1,$2,'Калымов Канат Айтенович','mechanic_operator','active')
  `, [kalymov, company]);
  await db.query(`
    insert into reference_specialists(
      id,company_id,user_id,person_id,full_name,role,personnel_type,status,archived
    ) values($1,$2,$3,null,'Калымов Канат Айтенович','mechanic_operator','machine_operator','active',false)
  `, [kalymovBridge, company, user]);
  await db.query(`
    insert into reference_vehicles(
      id,company_id,user_id,name,full_name,type,fleet_type,plate_number,license_plate,
      import_source,import_source_row,inventory_number,source_raw_name
    ) values
      ($1,$2,$3,'ZIL 665','ZIL 665','truck','truck','665','665','ptc_owner_roster_2026-09-06',null,null,'owner roster'),
      ($4,$2,$3,'KAMAZ','KAMAZ','truck','truck','984 AE 15','984 AE 15','fixed_assets_osv_2026',47,null,'Самосвал'),
      ($5,$2,$3,'KAMAZ 55102','KAMAZ 55102','truck','truck','Т-801 BN','Т-801 BN','fixed_assets_osv_2026',78,null,'Камаз Красный 801'),
      ($6,$2,$3,'Extra','Extra','truck','truck','EXTRA-1','EXTRA-1','fixed_assets_osv_2026',58,null,'Грузовой автомобиль'),
      ($7,$2,$3,'Audit','Audit','truck','truck','AUDIT-1','AUDIT-1','fleet_audit_2026',null,'PROD-WB-AUDIT-1','QA'),
      ($8,$2,$3,'PTS','PTS','trailer','tractor_trailer','PTS-1',null,'fixed_assets_osv_2026',324,null,'Прицеп'),
      ($9,$2,$3,'UAZ','UAZ','truck','truck','UAZ-1','UAZ-1','fixed_assets_osv_2026',301,null,'УАЗ'),
      ($10,$2,$3,'Hilux','Hilux','truck','truck','HILUX-1','HILUX-1','fixed_assets_osv_2026',302,null,'Toyota Hilux'),
      ($11,$2,$3,'Fuel truck','Fuel truck','truck','truck','FUEL-1','FUEL-1','fixed_assets_osv_2026',303,null,'Топливозаправщик'),
      ($12,$13,$3,'Other truck','Other truck','truck','truck','OTHER-1','OTHER-1','fixed_assets_osv_2026',47,null,'Самосвал')
  `, [
    ownerRoster, company, user, sourceTruck, redKamaz, extraTruck, auditTruck,
    trailer, uaz, hilux, special, otherTruck, otherCompany,
  ]);
  await db.query(`
    insert into reference_vehicles(
      id,company_id,user_id,name,full_name,type,fleet_type,plate_number,license_plate,import_source
    ) values($1,$2,$3,'ZIL 13-19','ZIL 13-19','truck','truck','13-19','13-19','ptc_owner_roster_2026-09-06')
  `, [ownerRoster2, company, user]);
  const remainingConfirmedOsvRows = [48,49,50,51,69,70,72,73,76,83,89,128];
  for (const sourceRow of remainingConfirmedOsvRows) {
    const id = randomUUID();
    await db.query(`
      insert into reference_vehicles(
        id,company_id,user_id,name,full_name,type,fleet_type,plate_number,license_plate,
        import_source,import_source_row,source_raw_name
      ) values($1,$2,$3,$4,$4,'truck','truck',$5,$5,'fixed_assets_osv_2026',$6,'Самосвал')
    `, [id, company, user, `Confirmed ${sourceRow}`, `OSV-${sourceRow}`, sourceRow]);
  }
  await db.query(`
    insert into reference_vehicles(
      id,company_id,user_id,name,full_name,type,fleet_type,plate_number,license_plate
    ) values($1,$2,$3,'Non-roster loaded','Non-roster loaded','truck','truck','BUSY-1','BUSY-1')
  `, [blockingManual, company, user]);
  await db.query(
    "insert into ptc_vehicle_states(company_id,vehicle_id,assigned,state) values($1,$2,true,'loaded')",
    [company, blockingManual],
  );
  await db.query("insert into ptc_vehicle_states(company_id,vehicle_id,assigned) values($1,$2,false)", [otherCompany, otherTruck]);
  await db.query(`
    insert into reference_machines(
      id,company_id,user_id,name,full_name,type,status,is_active,archived,category,machinery_type,
      import_source,import_source_row,license_plate,source_raw_name,source_clean_name
    ) values
      ($1,$2,$3,'МТЗ 82 #3','МТЗ 82','tractor','free',true,false,'tractor','tractor','fixed_assets_osv_2026',445,'T 075 ALB','Трактор Беларус-82.1 № T 075 ALB','МТЗ 82'),
      ($4,$2,$3,'MTZ / BELARUS BELARUS 952.2','MTZ / BELARUS BELARUS 952.2','tractor','free',true,false,'tractor','tractor','fixed_assets_osv_2026',446,null,'Трактор Беларус-952 2 T 878 ATD','МТЗ 952.2'),
      ($5,$2,$3,'FENDT 312','FENDT 312','tractor','free',true,false,'tractor','tractor','fixed_assets_osv_2026',442,'T 197 AND','Трактор Fendt 312','FENDT 312'),
      ($6,$2,$3,'МТЗ attachment','МТЗ attachment','machine','free',true,false,'other','other','fixed_assets_osv_2026',248,null,'КУН-ПФН-Т-219 для МТЗ','КУН'),
      ($7,$2,$3,'ЮМЗ','ЮМЗ','tractor','free',true,false,'tractor','tractor','fixed_assets_osv_2026',473,null,'Трактор ЮМЗ экскаватор','ЮМЗ')
  `, [mtz075, company, user, mtz878, irrelevantTractor, attachment, excavator]);

  const migration = readFileSync("supabase/migrations/20260906120823_ptc_company_fleet_scope_v1.sql", "utf8");
  assert.match(migration, /PTC_OWNER_ROSTER_MARKERS_AMBIGUOUS/);
  assert.match(migration, /PTC_NON_ROSTER_VEHICLE_IN_FLIGHT/);
  assert.match(migration, /PTC_CURATED_ROSTER_POSTCONDITION/);
  assert.match(migration, /security definer[\s\S]*PTC_IN_FLIGHT_VEHICLE_MUST_REMAIN_VISIBLE/i);
  assert.doesNotMatch(migration, /39,129,207,208,209,440,441,442,443,444/);
  await assert.rejects(db.exec(migration), /PTC_NON_ROSTER_VEHICLE_IN_FLIGHT/);
  await db.query("delete from ptc_vehicle_states where vehicle_id=$1", [blockingManual]);
  await db.exec(migration);

  assert.equal((await db.query<{ total: number }>(`
    select count(*)::int total from reference_vehicles
    where company_id=$1 and ptc_enabled and is_active and not archived
  `, [company])).rows[0].total, 21, "final PTC roster must be exactly 21 active rows");
  assert.equal((await db.query<{ total: number }>(`
    select count(distinct import_source_row)::int total from reference_vehicles
    where company_id=$1 and ptc_enabled and import_source='fixed_assets_osv_2026'
  `, [company])).rows[0].total, 14, "all 14 confirmed OSV keys must be unique and enabled");

  const scoped = await db.query<{ id: string; ptc_enabled: boolean }>(`
    select id::text,ptc_enabled from reference_vehicles
    where id=any($1::uuid[]) order by id
  `, [[ownerRoster, sourceTruck, redKamaz, extraTruck, auditTruck, trailer, uaz, hilux, special]]);
  const enabled = new Map(scoped.rows.map((row) => [row.id, row.ptc_enabled]));
  assert.equal(enabled.get(ownerRoster), true);
  assert.equal(enabled.get(sourceTruck), true);
  assert.equal(enabled.get(redKamaz), true);
  for (const id of [extraTruck, auditTruck, trailer, uaz, hilux, special]) assert.equal(enabled.get(id), false);
  assert.equal((await db.query<{ ptc_enabled: boolean }>(
    "select ptc_enabled from reference_vehicles where id=$1", [blockingManual],
  )).rows[0].ptc_enabled, false, "null-provenance legacy rows stay outside PTC");

  const whiteKamaz = await db.query<{
    name: string; plate_number: string; license_plate: string; ptc_enabled: boolean;
    primary_responsible_personnel_id: string | null;
  }>(`
    select name,plate_number,license_plate,ptc_enabled,primary_responsible_personnel_id
    from reference_vehicles
    where company_id=$1 and import_source='ptc_potato_roster_2026-09-06' and import_source_row=1120
  `, [company]);
  assert.deepEqual(whiteKamaz.rows, [{
    name: "КАМАЗ белый", plate_number: "1120", license_plate: "1120",
    ptc_enabled: true, primary_responsible_personnel_id: null,
  }]);
  assert.equal((await db.query<{ assignment: string | null }>(
    "select primary_responsible_personnel_id assignment from reference_vehicles where id=$1", [redKamaz],
  )).rows[0].assignment, null);

  const projected = await db.query<{
    source: string; source_row: number; name: string; license_plate: string | null;
    ptc_enabled: boolean; driver_name: string | null; personnel_type: string | null; description: string | null;
  }>(`
    select machine.import_source source,machine.import_source_row source_row,vehicle.name,
      vehicle.license_plate,vehicle.ptc_enabled,person.full_name driver_name,
      specialist.personnel_type,machine.description
    from reference_vehicles vehicle
    join reference_machines machine on machine.id=vehicle.source_machine_id
    left join reference_specialists specialist on specialist.id=vehicle.primary_responsible_personnel_id
    left join company_people person on person.id=specialist.person_id
    order by machine.import_source,machine.import_source_row
  `);
  assert.equal(projected.rows.length, 4);
  assert.deepEqual(projected.rows.map(row => ({
    source: row.source, sourceRow: row.source_row, name: row.name, plate: row.license_plate,
    enabled: row.ptc_enabled, driver: row.driver_name, personnelType: row.personnel_type,
  })), [
    { source: "fixed_assets_osv_2026", sourceRow: 445, name: "МТЗ 075", plate: "T 075 ALB", enabled: true, driver: "Теребол Айбол", personnelType: "driver" },
    { source: "fixed_assets_osv_2026", sourceRow: 446, name: "МТЗ 878", plate: "T 878 ATD", enabled: true, driver: "Калымов Канат Айтенович", personnelType: "machine_operator" },
    { source: "ptc_potato_roster_2026-09-06", sourceRow: 1, name: "МТЗ (номер неизвестен)", plate: null, enabled: true, driver: null, personnelType: null },
    { source: "ptc_potato_roster_2026-09-06", sourceRow: 2, name: "МТЗ (Пушкин — аренда)", plate: null, enabled: true, driver: null, personnelType: null },
  ]);
  assert.match(projected.rows.find(row => row.source_row === 2)?.description ?? "", /Грязнов, имя неизвестно/);
  assert.equal((await db.query<{ total: number }>(
    "select count(*)::int total from company_people where company_id=$1 and full_name='Калымов Канат Айтенович'", [company],
  )).rows[0].total, 1);
  assert.equal((await db.query<{ person_id: string | null }>(
    "select person_id::text from reference_specialists where id=$1", [kalymovBridge],
  )).rows[0].person_id, kalymov, "compatible active name-only specialist bridge is linked, not duplicated");
  assert.equal((await db.query<{ total: number }>(
    "select count(*)::int total from company_people where company_id=$1 and full_name='Теребол Айбол'", [company],
  )).rows[0].total, 1);
  const terebolSpecialist = (await db.query<{ id: string }>(`
    select specialist.id::text
    from reference_specialists specialist
    join company_people person on person.id=specialist.person_id
    where person.company_id=$1 and person.full_name='Теребол Айбол'
  `, [company])).rows[0].id;
  await db.query("update reference_specialists set status='inactive' where id=$1", [terebolSpecialist]);
  await assert.rejects(db.exec(migration), /PTC_SPECIALIST_BRIDGE_INACTIVE_OR_INCOMPATIBLE/);
  assert.equal((await db.query<{ status: string }>(
    "select status from reference_specialists where id=$1", [terebolSpecialist],
  )).rows[0].status, "inactive", "migration must not reactivate a manually disabled specialist bridge");
  await db.query("update reference_specialists set status='active',role='other' where id=$1", [terebolSpecialist]);
  await assert.rejects(db.exec(migration), /PTC_SPECIALIST_BRIDGE_INACTIVE_OR_INCOMPATIBLE/);
  assert.equal((await db.query<{ role: string }>(
    "select role from reference_specialists where id=$1", [terebolSpecialist],
  )).rows[0].role, "other", "migration must not repurpose an incompatible specialist bridge");
  await db.query("update reference_specialists set role='driver' where id=$1", [terebolSpecialist]);
  await db.exec(migration);
  assert.equal((await db.query<{ total: number }>(
    "select count(*)::int total from reference_vehicles where source_machine_id in ($1,$2,$3)",
    [irrelevantTractor, attachment, excavator],
  )).rows[0].total, 0);

  await db.query("insert into ptc_events(vehicle_id) values($1)", [extraTruck]);
  await db.query("insert into ptc_vehicle_repairs(vehicle_id,in_repair) values($1,true)", [extraTruck]);
  const operationalDriver = (await db.query<{ id: string }>(`
    select specialist.id::text
    from reference_specialists specialist
    join company_people person on person.id=specialist.person_id
    where person.company_id=$1 and person.full_name='Теребол Айбол'
  `, [company])).rows[0].id;
  await db.query(`
    update reference_vehicles
    set status='manual-status', primary_responsible_personnel_id=$2
    where company_id=$1 and (
      (import_source='fixed_assets_osv_2026' and import_source_row=78)
      or (import_source='ptc_potato_roster_2026-09-06' and import_source_row=1120)
      or source_machine_id=$3
    )
  `, [company, operationalDriver, mtz075]);
  await db.exec(migration);
  assert.equal((await db.query<{ total: number }>(`
    select count(*)::int total from reference_vehicles
    where company_id=$1 and status='manual-status'
      and primary_responsible_personnel_id=$2
      and (
        (import_source='fixed_assets_osv_2026' and import_source_row=78)
        or (import_source='ptc_potato_roster_2026-09-06' and import_source_row=1120)
        or source_machine_id=$3
      )
  `, [company, operationalDriver, mtz075])).rows[0].total, 3,
  "rerun must preserve manual assignments and operational statuses");
  assert.equal((await db.query<{ total: number }>(
    "select count(*)::int total from reference_vehicles where source_machine_id is not null",
  )).rows[0].total, 4, "migration rerun must not duplicate tractor projections");
  assert.equal((await db.query<{ total: number }>(
    "select count(*)::int total from company_people where full_name in ('Калымов Канат Айтенович','Теребол Айбол')",
  )).rows[0].total, 2, "migration rerun must not duplicate people");
  assert.equal((await db.query<{ total: number }>("select count(*)::int total from ptc_events")).rows[0].total, 1);
  assert.equal((await db.query<{ total: number }>("select count(*)::int total from ptc_vehicle_repairs")).rows[0].total, 1);

  const conflicting1120 = randomUUID();
  await db.query(`
    insert into reference_vehicles(id,company_id,user_id,name,full_name,type,fleet_type,plate_number,license_plate)
    values($1,$2,$3,'Duplicate white KAMAZ','Duplicate white KAMAZ','truck','truck','1 120','1 120')
  `, [conflicting1120, company, user]);
  await assert.rejects(db.exec(migration), /PTC_KAMAZ_1120_IDENTITY_CONFLICT/);
  await db.query("delete from reference_vehicles where id=$1", [conflicting1120]);
  await db.exec(migration);

  const conflictingMtz = randomUUID();
  await db.query(`
    insert into reference_machines(
      id,company_id,user_id,name,full_name,type,status,is_active,archived,category,machinery_type,
      import_source,import_source_row
    ) values($1,$2,$3,'МТЗ номер неизвестен','МТЗ номер неизвестен','tractor','free',true,false,
      'tractor','tractor','manual-conflict',99)
  `, [conflictingMtz, company, user]);
  await assert.rejects(db.exec(migration), /PTC_MANUAL_MTZ_IDENTITY_CONFLICT/);
  await db.query("delete from reference_machines where id=$1", [conflictingMtz]);
  await db.exec(migration);

  const ordinaryManual = randomUUID();
  await db.query(`
    insert into reference_vehicles(id,company_id,user_id,name,full_name,type,fleet_type,plate_number)
    values($1,$2,$3,'Direct truck','Direct truck','truck','truck','DIRECT-1')
  `, [ordinaryManual, company, user]);
  assert.equal((await db.query<{ ptc_enabled: boolean }>(
    "select ptc_enabled from reference_vehicles where id=$1", [ordinaryManual],
  )).rows[0].ptc_enabled, false, "generic direct inserts stay out of PTC");

  const managerManual = randomUUID();
  await db.query(`
    insert into reference_vehicles(id,company_id,user_id,name,full_name,type,fleet_type,plate_number,import_source)
    values($1,$2,$3,'Manager truck','Manager truck','truck','truck','MANAGER-1','ptc_fleet_manager_manual_v1')
  `, [managerManual, company, user]);
  assert.equal((await db.query<{ ptc_enabled: boolean }>(
    "select ptc_enabled from reference_vehicles where id=$1", [managerManual],
  )).rows[0].ptc_enabled, true, "guarded fleet-manager provenance enters PTC");

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
    db.query("update reference_machines set company_id=$1 where id=$2", [otherCompany, mtz075]),
    /PTC_MACHINE_COMPANY_MISMATCH/,
  );

  await db.exec("grant select on reference_vehicles to authenticated; grant update(ptc_enabled) on reference_vehicles to authenticated");
  await db.exec("set role authenticated");
  try {
    await db.query("update reference_vehicles set ptc_enabled=ptc_enabled where id=$1", [sourceTruck]);
  } finally {
    await db.exec("reset role");
  }
  await db.query("insert into ptc_vehicle_states(company_id,vehicle_id,assigned,state) values($1,$2,true,'loaded')", [company, sourceTruck]);
  await db.exec("set role authenticated");
  try {
    await assert.rejects(
      db.query("update reference_vehicles set ptc_enabled=false where id=$1", [sourceTruck]),
      /PTC_IN_FLIGHT_VEHICLE_MUST_REMAIN_VISIBLE/,
    );
  } finally {
    await db.exec("reset role");
  }
  await assert.rejects(
    db.query("update reference_vehicles set ptc_enabled=false where id=$1", [sourceTruck]),
    /PTC_IN_FLIGHT_VEHICLE_MUST_REMAIN_VISIBLE/,
  );
  await db.query("update ptc_vehicle_states set state='empty' where company_id=$1 and vehicle_id=$2", [company, sourceTruck]);
  await db.query("update reference_vehicles set ptc_enabled=false where id=$1", [sourceTruck]);
  await assert.rejects(
    db.query("update ptc_vehicle_states set state='loaded' where company_id=$1 and vehicle_id=$2", [company, sourceTruck]),
    /PTC_INELIGIBLE_VEHICLE/,
  );
  await db.query("update ptc_vehicle_states set assigned=false where company_id=$1 and vehicle_id=$2", [company, sourceTruck]);
  await assert.rejects(
    db.query("update ptc_vehicle_states set assigned=true where company_id=$1 and vehicle_id=$2", [company, sourceTruck]),
    /PTC_INELIGIBLE_VEHICLE/,
  );

  assert.equal((await db.query<{ ptc_enabled: boolean }>(
    "select ptc_enabled from reference_vehicles where id=$1", [otherTruck],
  )).rows[0].ptc_enabled, true);

  await db.query(`
    update reference_vehicles set is_active=false,archived=true
    where company_id=$1 and import_source='ptc_potato_roster_2026-09-06' and import_source_row=1120
  `, [company]);
  await assert.rejects(db.exec(migration), /PTC_CURATED_ROSTER_POSTCONDITION/);
  assert.deepEqual((await db.query(`
    select is_active,archived,status,primary_responsible_personnel_id
    from reference_vehicles
    where company_id=$1 and import_source='ptc_potato_roster_2026-09-06' and import_source_row=1120
  `, [company])).rows, [{
    is_active: false, archived: true, status: "manual-status",
    primary_responsible_personnel_id: operationalDriver,
  }], "rerun must fail closed without reactivating or clearing an operational row");

  await db.close();
  console.log("PTC company fleet scope PASS: exact trucks + 4 MTZ, duplicate-safe people, hidden legacy rows and in-flight guards");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
