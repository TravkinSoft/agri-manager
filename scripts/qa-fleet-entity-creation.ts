import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  findDriverDuplicates,
  findVehicleDuplicates,
  normalizePersonName,
  normalizedPersonKey,
  normalizeVehiclePlate,
} from "../lib/fleet/entity-creation";

const company = "00000000-0000-4000-8000-000000000001";
const otherCompany = "00000000-0000-4000-8000-000000000002";
const fleetManager = "00000000-0000-4000-8000-000000000003";
const outsider = "00000000-0000-4000-8000-000000000004";
let checks = 0;
const equal = (actual: unknown, expected: unknown, message?: string) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};

async function main() {
  equal(normalizeVehiclePlate("Т-309 ВК"), "T309BK", "Cyrillic and punctuation normalize");
  equal(normalizeVehiclePlate("t 309-bk"), "T309BK", "Latin plate normalizes");
  equal(normalizePersonName("  Мухамеджанов—Жандос  "), "мухамеджанов жандос");
  equal(normalizedPersonKey("Андрей Цалко"), normalizedPersonKey("Цалко Андрей"));

  const exactVehicle = findVehicleDuplicates({ name: "ЗИЛ 554", plate: "T 309 BK" }, [{
    id: "vehicle-1", name: "ZIL MMZ 554", plate_number: "Т-309 ВК", license_plate: null,
  }]);
  equal(exactVehicle[0]?.level, "exact");
  const possibleVehicle = findVehicleDuplicates({ name: "Камаз 308", plate: "308" }, [{
    id: "vehicle-2", name: "КАМАЗ 45142-011", plate_number: "308 AR 15", license_plate: null,
  }]);
  equal(possibleVehicle[0]?.level, "potential");
  equal(findVehicleDuplicates({ name: "КАМАЗ 45142-011", plate: "984 AE 15" }, [{
    id: "vehicle-3", name: "КАМАЗ 45142-011", plate_number: "308 AR 15", license_plate: null,
  }]).length, 0, "same model with a different plate is allowed");

  equal(findDriverDuplicates("Андрей Цалко", [{ id: "driver-1", full_name: "Цалко Андрей" }])[0]?.level, "exact");
  equal(findDriverDuplicates("Мухамеджанов Жандос", [{
    id: "driver-2", full_name: "Мухаметжанов Жандос Тулубаевич",
  }])[0]?.level, "potential");
  equal(findDriverDuplicates("Балгожинов Ерганат", [{
    id: "driver-3", full_name: "Балгужинов Ерканат Нурханович",
  }])[0]?.level, "potential");
  equal(findDriverDuplicates("Иванов Иван", [{ id: "driver-4", full_name: "Петров Пётр" }]).length, 0);

  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.profiles(
      id uuid primary key, company_id uuid, role text, status text
    );
    create table public.reference_vehicles(
      id uuid primary key default gen_random_uuid(), company_id uuid, user_id uuid,
      name text not null, full_name text not null, custom_name text, type text not null,
      fleet_type text not null, plate_number text not null, license_plate text,
      status text not null default 'free', is_active boolean not null default true,
      archived boolean not null default false, created_at timestamptz not null default now()
    );
    create unique index vehicle_plate_live on public.reference_vehicles(company_id, lower(plate_number)) where archived=false;
    create table public.company_people(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, user_id uuid,
      full_name text not null, role_type text not null default 'worker', employment_type text not null default 'unknown',
      position text, status text not null default 'active', created_by_user_id uuid,
      updated_by_user_id uuid, deleted_at timestamptz, created_at timestamptz not null default now()
    );
    create table public.reference_specialists(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, user_id uuid not null,
      person_id uuid, full_name text not null, role text, personnel_type text not null,
      status text not null, archived boolean default false, created_at timestamptz default now()
    );
    create unique index specialist_name_live on public.reference_specialists(company_id, lower(full_name)) where archived=false;
    create unique index specialist_person_live on public.reference_specialists(person_id) where person_id is not null and archived=false;
    insert into public.profiles values
      ('${fleetManager}','${company}','fleet_manager','active'),
      ('${outsider}','${otherCompany}','fleet_manager','active');
  `);
  await db.exec(fs.readFileSync("supabase/migrations/20260906105748_fleet_entity_creation_v1.sql", "utf8"));

  const create = async (actor: string, kind: "vehicle" | "driver", name: string, plate: string | null) => {
    const result = await db.query<{ result: Record<string, unknown> }>(
      "select public.fleet_create_entity_v1($1,$2,$3,$4,$5) as result",
      [actor, company, kind, name, plate],
    );
    return result.rows[0].result;
  };

  const vehicle = await create(fleetManager, "vehicle", "ZIL MMZ 554", "Т-309 ВК");
  equal(vehicle.status, "created");
  equal(vehicle.kind, "vehicle");
  equal((await db.query("select name,plate_number,license_plate,status from reference_vehicles")).rows, [{
    name: "ZIL MMZ 554", plate_number: "Т-309 ВК", license_plate: "Т-309 ВК", status: "free",
  }]);
  const duplicateVehicle = await create(fleetManager, "vehicle", "Другая запись", "T 309-BK");
  equal(duplicateVehicle.status, "duplicate");
  equal((await db.query<{ count: number }>("select count(*)::int as count from reference_vehicles")).rows[0].count, 1);

  const driver = await create(fleetManager, "driver", "Цалко Андрей", null);
  equal(driver.status, "created");
  const linked = await db.query("select p.full_name,s.full_name as specialist_name,s.person_id=p.id as linked from company_people p join reference_specialists s on s.person_id=p.id");
  equal(linked.rows, [{ full_name: "Цалко Андрей", specialist_name: "Цалко Андрей", linked: true }]);
  const duplicateDriver = await create(fleetManager, "driver", "Андрей Цалко", null);
  equal(duplicateDriver.status, "duplicate");
  equal((await db.query<{ count: number }>("select count(*)::int as count from company_people")).rows[0].count, 1);

  await assert.rejects(() => create(outsider, "vehicle", "КАМАЗ", "001 AA 01"));
  checks++;
  equal((await db.query("select has_function_privilege('authenticated','public.fleet_create_entity_v1(uuid,uuid,text,text,text)','execute') as allowed")).rows, [{ allowed: false }]);
  equal((await db.query("select has_function_privilege('service_role','public.fleet_create_entity_v1(uuid,uuid,text,text,text)','execute') as allowed")).rows, [{ allowed: true }]);

  await db.close();
  console.log(`Fleet entity creation PASS: ${checks} checks; local database only.`);
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
