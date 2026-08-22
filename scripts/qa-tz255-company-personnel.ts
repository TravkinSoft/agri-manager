import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { personnelRoleForVehicle, personnelRoleMatchesVehicle } from "../lib/weighbridge/personnel";

const root = process.cwd();
const resources = fs.readFileSync(path.join(root, "app/api/weighbridge/resources/route.ts"), "utf8");
const tickets = fs.readFileSync(path.join(root, "app/api/weighbridge/tickets/route.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "app/(dashboard)/weighbridge/page.tsx"), "utf8");
const transportPicker = fs.readFileSync(path.join(root, "components/weighbridge/transport-driver-picker.tsx"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260810120000_company_personnel_foundation_v1.sql"),
  "utf8"
);

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

check("truck selects drivers", () => assert.equal(personnelRoleForVehicle({ type: "truck" }), "driver"));
check("dump truck selects drivers", () => assert.equal(personnelRoleForVehicle({ fleetType: "dump_truck" }), "driver"));
check("tractor unit selects drivers", () => assert.equal(personnelRoleForVehicle({ fleetType: "tractor_unit" }), "driver"));
check("tractor selects machine operators", () => assert.equal(personnelRoleForVehicle({ type: "tractor" }), "mechanic_operator"));
check("unknown vehicle keeps both groups", () => assert.equal(personnelRoleForVehicle({ type: "other" }), null));
check("driver remains manually selectable for tractor", () => assert.equal(personnelRoleMatchesVehicle("driver", { type: "tractor" }), true));
check("machine operator can be selected for tractor", () => assert.equal(personnelRoleMatchesVehicle("mechanic_operator", { type: "tractor" }), true));
check("non-driver staff is rejected", () => assert.equal(personnelRoleMatchesVehicle("accountant", null), false));
check("resources use canonical company_people", () => assert.match(resources, /from\("company_people"\)/));
check("resources filter active people", () => assert.match(resources, /eq\("status", "active"\)/));
check("resources filter archived people", () => assert.match(resources, /is\("deleted_at", null\)/));
check("resources allow only two roles", () => assert.match(resources, /\.in\("role_type", WEIGHBRIDGE_PERSONNEL_ROLES\)/));
check("ticket validates canonical person", () => assert.match(tickets, /from\("company_people"\)/));
check("ticket validates current company", () => assert.match(tickets, /\.eq\("company_id", ticket\.company_id\)/));
check("ticket accepts only driver or machine operator roles", () => assert.match(tickets, /isWeighbridgePersonnelRole/));
check("UI keeps personnel name search", () => assert.match(transportPicker, /Имя или фамилия водителя/));
check("UI preserves canonical personnel roles", () => assert.match(page, /roleType: row\.roleType === "mechanic_operator"/));
check("UI searches position and department", () => {
  assert.match(transportPicker, /keywords: \[driver\.name, driver\.position \|\| "", driver\.department \|\| ""\]/);
});
check("migration adds position", () => assert.match(migration, /add column if not exists position text/i));
check("migration adds department", () => assert.match(migration, /add column if not exists department text/i));
check("migration keeps legacy supplier drivers readable", () => assert.match(migration, /reference_specialists/));
check("migration accepts canonical supplier drivers", () => assert.match(migration, /company_people/));

console.log(`TZ255 ${passed}/${passed} PASS`);
