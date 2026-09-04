import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  nextState,
  visibleVehicles,
  stateAge,
  type TrafficVehicle,
  type TrafficRole,
  type TrafficState,
} from "../lib/traffic/model";
import {
  newCredential,
  newToken,
  tokenHash,
  hashPassword,
  verifyPassword,
  SESSION_SECONDS,
} from "../lib/traffic/credentials";
import { canAccessPath } from "../lib/auth/role-access";

async function main() {
  let checks = 0;
  const check = (actual: unknown, expected: unknown) => {
    assert.deepEqual(actual, expected);
    checks++;
  };
  const permitted = {
    "harvester:empty": "loaded",
    "receiver:loaded": "unloading",
    "receiver:unloading": "empty",
  };
  for (const role of ["manager", "harvester", "receiver"] as TrafficRole[])
    for (const state of ["empty", "loaded", "unloading"] as TrafficState[])
      check(
        nextState(role, state),
        permitted[`${role}:${state}` as keyof typeof permitted] ?? null,
      );
  const vehicles = ["loaded", "unloading", "empty"].map((state, index) => ({
    vehicle_id: String(index),
    name: "Test truck",
    plate: "TEST-" + index,
    driver: null,
    state,
    version: index,
    cycle: 1,
    assigned: true,
    since: "2026-09-04T10:00:00Z",
  })) as TrafficVehicle[];
  check(
    visibleVehicles(vehicles, "harvester").map((v) => v.state),
    ["empty", "loaded", "unloading"],
  );
  check(
    visibleVehicles(vehicles, "receiver").map((v) => v.state),
    ["loaded", "unloading"],
  );
  check(
    visibleVehicles(
      [...vehicles, { ...vehicles[0], assigned: false }],
      "manager",
    ).length,
    3,
  );
  check(
    vehicles.map((v) => v.state),
    ["loaded", "unloading", "empty"],
  );
  check(
    stateAge("2026-09-04T10:00:00Z", Date.parse("2026-09-04T10:15:00Z")),
    "15 мин",
  );
  check(
    stateAge("2026-09-04T10:00:00Z", Date.parse("2026-09-04T11:05:00Z")),
    "1 ч 5 мин",
  );
  check(
    stateAge("2026-09-04T10:00:00Z", Date.parse("2026-09-04T09:50:00Z")),
    "только что",
  );
  for (const role of ["agronomist", "company_admin", "global_admin"] as const)
    check(canAccessPath(role, "/traffic"), true);
  for (const role of [
    "weighman",
    "warehouse",
    "warehouse_operator",
    "specialist",
    "director",
    "brigadier",
  ] as const)
    check(canAccessPath(role, "/traffic"), false);
  const credential = newCredential();
  check(/^ptc-[a-f0-9]{10}$/.test(credential.login), true);
  check(credential.password.length, 16);
  check(credential.password !== newCredential().password, true);
  const hash = await hashPassword(credential.password);
  check(hash.length, 161);
  check(await verifyPassword(credential.password, hash), true);
  check(await verifyPassword("wrong", hash), false);
  check(await verifyPassword(credential.password, "invalid"), false);
  check((await hashPassword(credential.password)) !== hash, true);
  const token = newToken();
  check(token.length, 43);
  check(tokenHash(token).length, 64);
  check(tokenHash(token) !== token, true);
  check(SESSION_SECONDS, 43200);
  const server = readFileSync("lib/traffic/server.ts", "utf8"),
    operator = readFileSync("app/api/traffic/operator/route.ts", "utf8"),
    hook = readFileSync("components/traffic/use-traffic.ts", "utf8");
  check(server.includes("assertActorAccess"), true);
  check(
    /role\s*===\s*"manager"\s*\?\s*db\s*\.from\("ptc_events"\)/.test(server),
    true,
  );
  check(
    operator.includes('error.code==="23505"') ||
      operator.includes('error.code === "23505"'),
    true,
  );
  check(hook.includes('"pageshow"'), true);
  check(/document.visibilityState\s*!==\s*"hidden"/.test(hook), true);
  for (const file of [
    "lib/traffic/server.ts",
    "app/api/traffic/route.ts",
    "app/api/traffic/operator/route.ts",
    "app/api/traffic/session/route.ts",
  ]) {
    check(
      /from\s+["'][^"']*(?:weighbridge|ledger|inventory)/i.test(
        readFileSync(file, "utf8"),
      ),
      false,
    );
  }
  console.log(
    `PTC model/auth/client contract PASS: ${checks} assertions. No remote calls.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
