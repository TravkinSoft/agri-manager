import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isRealVehiclePlate, transportPickerLabel } from "../lib/weighbridge/transport";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
let passed = 0;
const check = (name: string, test: () => void) => {
  test();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
};

const warehouse = read("app/(dashboard)/warehouses/manage/page.tsx");
const weighbridge = read("app/(dashboard)/weighbridge/page.tsx");
const operatorRoute = read("app/api/weighbridge/operator-session/route.ts");
const finalizeRoute = read("app/api/weighbridge/tickets/[id]/finalize/route.ts");
const paper = read("components/weighbridge/weighbridge-ticket-paper.tsx");
const preview = read("components/weighbridge/ticket-preview-dialog.tsx");
const sw = read("public/sw.js");
const offlineRuntime = read("components/offline/offline-runtime.tsx");

check("warehouse rows do not wait for secondary data", () => {
  assert.match(warehouse, /setWarehouses\(warehousesData\)[\s\S]*?setLoading\(false\)[\s\S]*?Promise\.allSettled/);
});
check("products have independent loading state", () => assert.match(warehouse, /productsLoading && products\.length === 0/));
check("products have visible independent error", () => assert.match(warehouse, /productsLoadError[\s\S]*?role="alert"/));
check("requests have a bounded timeout", () => assert.match(warehouse, /REQUEST_TIMEOUT_MS = 12_000/));
check("confirmed warehouse rows are cached", () => assert.match(warehouse, /warehouseManageCache\.set\(cacheKey/));

check("service worker caches static assets only", () => assert.doesNotMatch(sw, /PAGE_CACHE/));
check("navigation HTML is never stored", () => {
  const navigationBranch = sw.slice(sw.indexOf('if (request.mode === "navigate")'), sw.indexOf("if (isKnownStaticAsset"));
  assert.doesNotMatch(navigationBranch, /cache\.put\(request/);
});
check("old TravkinFlow caches are deleted", () => assert.match(sw, /key\.startsWith\("travkinflow-"\)/));
check("service worker update bypasses HTTP cache", () => assert.match(offlineRuntime, /updateViaCache: "none"/));

const operatorPost = operatorRoute.slice(operatorRoute.indexOf("export async function POST"));
check("PIN success path has no second session-state RPC", () => {
  assert.doesNotMatch(operatorPost, /weighbridge_operator_session_state_v1/);
});
check("PIN response exposes safe server timing", () => assert.match(operatorPost, /Server-Timing/));
check("PIN response is normalized as an active canonical session", () => {
  assert.match(operatorPost, /unlocked:\s*true/);
  assert.match(operatorPost, /session_expires_at:\s*payload\.session_expires_at\s*\?\?\s*payload\.expires_at/);
});
check("PIN UI no longer starts full bootstrap after success", () => {
  const submit = weighbridge.slice(weighbridge.indexOf("const submitOperatorAction"), weighbridge.indexOf("const lockOperatorAction"));
  assert.doesNotMatch(submit, /refreshBootstrap|refreshTickets/);
});
check("PIN button has compact progress spinner", () => assert.match(weighbridge, /Loader2[\s\S]*?Проверка\.\.\./));

check("real Kazakhstan plate is accepted", () => assert.equal(isRealVehiclePlate("247 AP 15"), true));
check("OSV source row placeholder is rejected", () => assert.equal(isRealVehiclePlate("OSV-ROW-00412"), false));
check("IMPORT placeholder is rejected", () => assert.equal(isRealVehiclePlate("IMPORT-9271"), false));
check("numeric model series is rejected as a plate", () => assert.equal(isRealVehiclePlate("45142-011"), false));
check("empty plate is rejected", () => assert.equal(isRealVehiclePlate(""), false));
check("KAMAZ label hides series", () => {
  assert.equal(transportPickerLabel({ name: "KAMAZ 45142-011", model: "45142-011", plate: "247AP15" }), "KAMAZ · 247 AP 15");
});
check("GAZ without real plate shows brand only", () => {
  assert.equal(transportPickerLabel({ name: "Транспорт", model: "GAZ 53", plate: "OSV-ROW-53" }), "GAZ 53");
});

check("ticket paper combines vehicle and plate", () => assert.match(paper, /vehicleDisplay = transportPickerLabel/));
check("ticket paper has no separate plate fact", () => assert.doesNotMatch(paper, /<Fact label="Госномер"/));
check("missing harvest identity is omitted", () => {
  assert.doesNotMatch(paper, /Сорт" value=\{variety \|\|/);
  assert.doesNotMatch(paper, /Репродукция" value=\{reproduction \|\|/);
});
check("tare editor is inside canonical paper", () => assert.match(paper, /aria-label="Тара, кг"/));
check("moisture editor is inside canonical paper", () => assert.match(paper, /Влажность, %:/));
check("net remains prominent inside canonical paper", () => assert.match(paper, /displayedNetKg[\s\S]*?Нетто/));
check("ticket actions use compact menu", () => assert.match(weighbridge, /aria-label="Действия с талоном"/));
check("void reason appears only after action", () => assert.match(weighbridge, /onSelect=\{\(\) => setVoidReasonOpen\(true\)\}/));
check("close action has double click protection", () => assert.match(weighbridge, /disabled=\{finalizing \|\| !closingTare/));
check("ticket preview caches loaded snapshots", () => assert.match(preview, /ticketPreviewCache/));
check("ticket preview performs one bounded cold request", () => assert.match(preview, /getTicketDetails\(ticketId, undefined, \{ signal: controller\.signal \}\)/));

check("finalize reuses loaded harvest closure rows", () => assert.match(finalizeRoute, /syncHarvestBatchMoisture\(supabase, companyId, id, harvestClosureState\?\.lines/));
check("finalize post-RPC independent work runs concurrently", () => assert.match(finalizeRoute, /await Promise\.all\(\[[\s\S]*?finalized_by_person_id[\s\S]*?syncHarvestBatchMoisture/));
check("finalize emits stage timing", () => assert.match(finalizeRoute, /finalize_rpc;dur=/));
check("successful finalize reconciles in background without full bootstrap", () => {
  const successBlock = weighbridge.match(/await finalizeTicket\(activeTicket\.id, profile\.id\);[\s\S]*?\} catch/)?.[0] || "";
  assert.doesNotMatch(successBlock, /refreshBootstrap\(/);
  assert.match(successBlock, /setTimeout\([\s\S]*?refreshLiveData/);
});

assert.equal(passed, 36);
console.log(`TZ278 regression PASS: ${passed}/36`);
