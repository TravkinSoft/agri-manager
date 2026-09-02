import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeWeighbridgeTransportPickerData } from "../lib/weighbridge/transport-pairing";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

check("legacy workspace cache without open assignments is safe", () => {
  const normalized = normalizeWeighbridgeTransportPickerData({
    seasonId: "season-1",
    operationalDayStartHour: 7,
    recentPairs: [{ vehicleId: "v1", driverId: "d1" }],
    latestDriverByVehicle: { v1: "d1" },
    latestVehicleByDriver: { d1: "v1" },
    fetchedAt: "2026-08-15T00:00:00.000Z",
  });
  assert.deepEqual(normalized.openAssignments, []);
  assert.equal(normalized.recentPairs.length, 1);
  assert.equal(normalized.latestDriverByVehicle.v1, "d1");
});

check("missing or corrupt transport picker payload becomes a complete safe shape", () => {
  const normalized = normalizeWeighbridgeTransportPickerData(undefined);
  assert.deepEqual(normalized, {
    seasonId: null,
    operationalDayStartHour: 7,
    recentPairs: [],
    latestDriverByVehicle: {},
    latestVehicleByDriver: {},
    openAssignments: [],
    fetchedAt: "",
  });
});

check("current open assignments survive normalization", () => {
  const normalized = normalizeWeighbridgeTransportPickerData({
    openAssignments: [{ ticketId: "t1", ticketNo: "WB-1", vehicleId: "v1", driverId: "d1" }],
  });
  assert.equal(normalized.openAssignments[0]?.ticketId, "t1");
});

check("both persisted cache and fresh HTTP data pass through the normalizer", () => {
  const page = read("app/(dashboard)/weighbridge/page.tsx");
  const service = read("lib/services/weighbridge.ts");
  assert.match(page, /setTransportPickerData\(normalizeWeighbridgeTransportPickerData\([\s\S]*cached\.transportPickerData/);
  assert.match(page, /const normalized = normalizeWeighbridgeTransportPickerData\(payload\)/);
  assert.match(service, /return normalizeWeighbridgeTransportPickerData\(await parseJsonOrThrow\(response\)\)/);
});

console.log(`TZ315 weighbridge cache shape ${passed}/${passed} PASS`);
