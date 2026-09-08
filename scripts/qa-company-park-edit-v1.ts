import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
let checks = 0;

async function check(name: string, run: () => void | Promise<void>) {
  await run();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
}

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "local-anon-key";
  const { normalizeCompanyAssetPlate } = await import("../lib/services/references");

  await check("plate comparison handles Cyrillic lookalikes, spaces and punctuation", () => {
    assert.equal(normalizeCompanyAssetPlate("Т-309 ВК"), "T309BK");
    assert.equal(normalizeCompanyAssetPlate(" t 309-bk "), "T309BK");
    assert.equal(normalizeCompanyAssetPlate("984 AE 15"), "984AE15");
    assert.notEqual(normalizeCompanyAssetPlate("984 AE 15"), normalizeCompanyAssetPlate("984 AE 16"));
  });

  const service = read("lib/services/references.ts");
  const duplicateGuard = service.slice(
    service.indexOf("async function assertCompanyAssetPlateAvailable"),
    service.indexOf("function isVehiclePlateUniqueViolation"),
  );
  await check("duplicate guard checks both company asset tables and ignores machine proxy rows", () => {
    assert.match(duplicateGuard, /\.from\("reference_machines"\)/);
    assert.match(duplicateGuard, /\.from\("reference_vehicles"\)/);
    assert.match(duplicateGuard, /\.eq\("company_id", companyId\)/);
    assert.match(duplicateGuard, /\.eq\("archived", false\)/);
    assert.match(duplicateGuard, /\.is\("source_machine_id", null\)/);
    assert.match(duplicateGuard, /\[row\.plate_number, row\.license_plate\]\.some/);
    assert.match(duplicateGuard, /normalizeCompanyAssetPlate\(candidate\) === wantedPlate/);
  });

  await check("create and update paths reject cross-table plate duplicates", () => {
    assert.match(service, /createVehicleReference[\s\S]*?assertCompanyAssetPlateAvailable\(companyId, "vehicle", null, plateNumber\)/);
    assert.match(service, /updateVehicleReference[\s\S]*?assertCompanyAssetPlateAvailable\(companyId, "vehicle", id, plateNumber\)/);
    assert.match(service, /createMachineReference[\s\S]*?assertCompanyAssetPlateAvailable\(companyId, "machine", null, plateNumber\)/);
    assert.match(service, /updateMachineReference[\s\S]*?assertCompanyAssetPlateAvailable\(companyId, "machine", id, plateNumber\)/);
  });

  const machineUpdate = service.slice(
    service.indexOf("export async function updateMachineReference"),
    service.indexOf("export async function archiveMachineReference"),
  );
  await check("machine edit is company-scoped and uses a strict non-PTC allowlist", () => {
    assert.match(machineUpdate, /\.eq\("id", id\)[\s\S]*?\.eq\("company_id", companyId\)/);
    assert.match(machineUpdate, /license_plate: plateNumber/);
    assert.match(machineUpdate, /inventory_number:/);
    assert.match(machineUpdate, /manufacture_year:/);
    assert.match(machineUpdate, /is_active: payload\.is_active/);
    assert.doesNotMatch(machineUpdate, /\.update\(payload\)/);
    assert.doesNotMatch(machineUpdate, /\bstatus\b|ptc_enabled|fleet_status|repair|on_line/);
  });

  const page = read("app/(dashboard)/references/page.tsx");
  await check("company park exposes machine edit only to existing reference managers", () => {
    assert.match(page, /const canManageCompanyReferences = profile\?\.role === "company_admin" \|\| profile\?\.role === "global_admin"/);
    assert.match(page, /const editMachine = \(machine: any\)/);
    assert.match(page, /canManageCompanyReferences[\s\S]*?onClick=\{\(\) => editMachine\(x\)\}/);
    assert.match(page, /updateMachineReference\(profile\.company_id, editingMachineId/);
  });

  await check("machine edit keeps catalog identity and operational status read-only", () => {
    assert.match(page, /modalType === "machine" && !editingMachineId/);
    assert.match(page, /editingMachineId \? "Редактировать технику" : "Добавить технику"/);
    assert.match(page, /editingMachineId \? \([\s\S]*?<Label>Активность<\/Label>/);
    const updateCall = page.slice(
      page.indexOf("await updateMachineReference"),
      page.indexOf("} else {", page.indexOf("await updateMachineReference")),
    );
    assert.doesNotMatch(updateCall, /model|brand|series|status|source_machine_id|ptc/);
  });

  console.log(`Company park edit QA PASS: ${checks} checks; no database writes.`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
