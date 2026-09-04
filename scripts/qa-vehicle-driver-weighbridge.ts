import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as transport from "../lib/weighbridge/transport";
import {
  preferredDriverForVehicle,
  preferredVehicleForDriver,
  type OpenTransportAssignment,
} from "../lib/weighbridge/transport-pairing";

const drivers = [
  { id: "current-person", assignedVehicleIds: ["vehicle-1"] },
  { id: "historical-person", assignedVehicleIds: [] },
];
const vehicles = [
  { id: "vehicle-1", primaryPersonnelId: "specialist-fk" },
  { id: "vehicle-2", primaryPersonnelId: null },
];
const open: OpenTransportAssignment[] = [{
  ticketId: "open-ticket", ticketNo: "WB-1", vehicleId: "vehicle-2", driverId: "current-person",
}];
const driverParams = {
  vehicle: vehicles[0], drivers,
  latestDriverByVehicle: { "vehicle-1": "historical-person", "vehicle-2": "historical-person" },
  openAssignments: [] as OpenTransportAssignment[],
};
const vehicleParams = {
  driver: drivers[0], drivers, vehicles,
  latestVehicleByDriver: { "current-person": "vehicle-2", "historical-person": "vehicle-1" },
  openAssignments: [] as OpenTransportAssignment[],
};
let checks = 0;
function check(name: string, run: () => void) {
  run();
  checks += 1;
  console.log(`PASS ${checks} ${name}`);
}

check("canonical current person outranks historical ticket driver and specialist FK", () => {
  assert.equal(preferredDriverForVehicle(driverParams), "current-person");
});
check("busy assigned person never falls back to historical driver", () => {
  assert.equal(preferredDriverForVehicle({ ...driverParams, openAssignments: open }), "");
});
check("unresolved or inactive permanent person does not resurrect ticket history", () => {
  assert.equal(preferredDriverForVehicle({ ...driverParams, drivers: [drivers[1]] }), "");
});
check("historical suggestion remains available for unassigned vehicles", () => {
  assert.equal(preferredDriverForVehicle({ ...driverParams, vehicle: vehicles[1] }), "historical-person");
});
check("history never selects an unavailable driver", () => {
  assert.equal(preferredDriverForVehicle({ ...driverParams, vehicle: vehicles[1], drivers: [] }), "");
});
check("ambiguous assigned drivers require an explicit choice", () => {
  assert.equal(preferredDriverForVehicle({ ...driverParams, drivers: drivers.map((driver) => ({ ...driver, assignedVehicleIds: ["vehicle-1"] })) }), "");
});
check("reverse suggestion prefers permanent vehicle", () => {
  assert.equal(preferredVehicleForDriver(vehicleParams), "vehicle-1");
});
check("history cannot suggest a vehicle now assigned to another person", () => {
  assert.equal(preferredVehicleForDriver({ ...vehicleParams, driver: drivers[1] }), "");
});
check("multiple assigned vehicles require manual vehicle selection", () => {
  const driver = { ...drivers[0], assignedVehicleIds: ["vehicle-1", "vehicle-2"] };
  assert.equal(preferredVehicleForDriver({ ...vehicleParams, driver }), "");
});
check("reverse suggestion retains open-ticket busy guards", () => {
  assert.equal(preferredVehicleForDriver({ ...vehicleParams, openAssignments: [{ ...open[0], vehicleId: "vehicle-1" }] }), "");
});

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const picker = read("components/weighbridge/transport-driver-picker.tsx");
check("assignment editor label includes the same vehicle and plate as the transport picker", () => {
  assert.equal(transport.transportPickerOptionLabel({ name: "KAMAZ", plate: "QA-207" }), "KAMAZ · QA-207");
  assert.match(page, /vehicleLabel=\{transportPickerOptionLabel\(selectedVehicle\)\}/);
});
check("UI still blocks selected busy vehicles and drivers", () => {
  assert.match(picker, /const assignment = assignmentByVehicle\.get\(nextVehicleId\);\s*if \(assignment\) \{\s*onBlockedAssignment\(assignment\);\s*return;/);
  assert.match(picker, /const assignment = assignmentByDriver\.get\(nextDriverId\);\s*if \(assignment\) \{\s*onBlockedAssignment\(assignment\);\s*return;/);
  assert.match(picker, /!nextDriverId \|\| nextVehicleId !== vehicleId/);
});
check("assignment broadcasts refresh only options and reject stale company results", () => {
  const subscription = page.slice(page.indexOf("const unsubscribe = subscribeVehicleDriverAssignments"), page.indexOf("const siteConfirm"));
  assert.match(subscription, /result\.companyId !== companyId \|\| resourceCompanyRef\.current !== companyId/);
  assert.match(subscription, /controller\.signal\.aborted \|\| resourceCompanyRef\.current !== companyId/);
  assert.match(subscription, /requestController\?\.abort\(\)/);
  assert.doesNotMatch(subscription, /setForm\(|setTickets\(|setActiveTicket\(|patchTicket\(/);
});
check("explicit save updates only same-workspace unsaved form and checks busy drivers", () => {
  const explicitSave = page.slice(page.indexOf("const applyAssignmentToNewDraft"), page.indexOf("const updateTransportPickerData"));
  assert.match(explicitSave, /current\.companyId !== result\.companyId \|\| current\.workspaceId !== selectedWorkspaceId/);
  assert.match(explicitSave, /current\.savedTicketId \|\| current\.editingTicket/);
  assert.match(explicitSave, /current\.openAssignments\.some/);
  assert.match(explicitSave, /previous\.vehicleId === result\.vehicle\.id/);
  assert.doesNotMatch(explicitSave, /patchTicket\(|setTickets\(|setActiveTicket\(/);
  assert.match(page, /key=\{`\$\{profile\?\.company_id\}:\$\{selectedWorkspaceId\}:\$\{selectedVehicle\.id\}`\}/);
});
check("resource loads started before assignment cannot restore old driver links", () => {
  assert.match(page, /const assignmentRevision = vehicleAssignmentRevisionRef\.current/);
  assert.match(page, /!failedResources\.has\("company_people"\) && assignmentRevision === vehicleAssignmentRevisionRef\.current/);
});

async function checkCurrentResourceAssignmentBridges() {
  const bridges = [
    { status: "active", archived: false, personnel_type: "driver" },
    { status: "inactive", archived: false, personnel_type: "driver" },
    { status: "active", archived: true, personnel_type: "driver" },
    { status: "active", archived: false, personnel_type: "specialist" },
    { status: null, archived: false, personnel_type: "driver" },
    { status: "active", archived: null, personnel_type: "driver" },
  ];
  const tables: Record<string, Record<string, unknown>[]> = {
    reference_specialists: bridges.map((bridge, index) => ({
      ...bridge, id: `bridge-${index}`, person_id: `person-${index}`, company_id: "company",
      full_name: `Historical ${index}`,
    })),
    company_people: bridges.map((_, index) => ({
      id: `person-${index}`, company_id: "company", full_name: `Canonical ${index}`,
      role_type: "driver", status: "active", deleted_at: null,
    })),
    reference_vehicles: bridges.map((_, index) => ({
      id: `vehicle-${index}`, company_id: "company", name: "KAMAZ", type: "truck", fleet_type: "truck",
      primary_responsible_personnel_id: `bridge-${index}`, is_active: true, archived: false,
    })),
    profiles: [], fields: [], warehouses: [],
  };
  const db = {
    from(table: string) {
      let fields = "";
      const filters: Array<[string, unknown]> = [];
      const query: any = {
        select(value: string) { fields = value; return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        is(key: string, value: unknown) { filters.push([key, value]); return query; },
        order() { return query; },
        then(done: (value: unknown) => unknown, failed: (reason: unknown) => unknown) {
          const data = tables[table].filter((row) => filters.every(([key, value]) => row[key] === value))
            .map((row) => Object.fromEntries(fields.split(",").map((field) => [field, row[field]])));
          return Promise.resolve({ data, error: null }).then(done, failed);
        },
      };
      return query;
    },
  };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown) => body } },
    "@/app/api/weighbridge/_auth": {
      WEIGHBRIDGE_READ_ROLES: [],
      resolveWeighbridgeSession: async () => ({ companyId: "company", supabase: db }),
      asSessionErrorResponse: () => null,
    },
    "@/lib/weighbridge/transport": transport,
  };
  const loaded = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(read("app/api/weighbridge/resources/route.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: loaded, exports: loaded.exports, console,
    require: (key: string) => {
      if (!(key in dependencies)) throw new Error(`Unexpected resource route dependency: ${key}`);
      return dependencies[key];
    },
  });
  const result = await loaded.exports.GET({});
  check("resource route accepts only active, non-archived driver bridges for current assignments", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(result.drivers.map((driver: any) => driver.assignedVehicleIds))),
      [["vehicle-0"], [], [], [], [], []]);
  });
  check("resource route keeps historical names for inactive, archived and non-driver bridges", () => {
    bridges.forEach((_, index) => assert.equal(result.driverNames[`bridge-${index}`], `Historical ${index}`));
  });
  check("resource route preserves canonical current person names", () => {
    bridges.forEach((_, index) => assert.equal(result.drivers[index].name, `Canonical ${index}`));
  });
}

checkCurrentResourceAssignmentBridges().then(() => {
  console.log(`Vehicle-driver weighbridge regression PASS: ${checks}/${checks}`);
}).catch((error) => { console.error(error); process.exitCode = 1; });
