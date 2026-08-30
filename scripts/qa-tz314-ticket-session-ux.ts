import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
let passed = 0;

function check(name: string, test: () => void) {
  test();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

const page = read("app/(dashboard)/weighbridge/page.tsx");
const paper = read("components/weighbridge/weighbridge-ticket-paper.tsx");
const printPage = read("app/(dashboard)/weighbridge/[id]/print/page.tsx");
const operatorSessionRoute = read("app/api/weighbridge/operator-session/route.ts");
const harvestPaper = paper.slice(paper.indexOf("{isHarvest ? ("), paper.indexOf(") : (", paper.indexOf("{isHarvest ? (")));
const openTickets = page.slice(page.indexOf("Открытые талоны"), page.indexOf("<ProcessingWorkspace"));
const sessionSkeleton = page.slice(page.indexOf("if (authLoading || operatorGateChecking)"), page.indexOf("if (!canView)"));

check("screen ticket is portrait-width 520px", () => {
  assert.match(paper, /max-w-\[520px\]/);
  assert.doesNotMatch(paper, /max-w-\[680px\]/);
  assert.match(page, /sm:max-w-\[540px\]/);
  assert.doesNotMatch(page, /lg:max-w-3xl/);
});

check("harvest facts keep exact mobile reading order", () => {
  const labels = ["Поле", "Культура", "Сорт", "Репродукция", "Место приёмки", "Комбайнер"];
  let cursor = -1;
  for (const label of labels) {
    const next = harvestPaper.indexOf(`label=\"${label}\"`);
    assert.ok(next > cursor, `${label} must follow the preceding harvest fact`);
    cursor = next;
  }
});

check("desktop harvest facts split agronomy from destination and operator", () => {
  assert.match(harvestPaper, /sm:grid-cols-2/);
  assert.match(harvestPaper, /contents sm:block sm:space-y-2/);
});

check("open harvest card prioritizes driver and vehicle with plate", () => {
  const driver = openTickets.indexOf("{driverName}");
  const vehicle = openTickets.indexOf("{vehicleLabel}");
  const field = openTickets.indexOf("Поле {harvestField}");
  const crop = openTickets.indexOf("{harvestIdentity ||");
  const ticketNo = openTickets.indexOf("• № {t.ticket_no}");
  assert.ok(driver >= 0 && vehicle > driver && field > vehicle && crop > field && ticketNo > crop);
  assert.match(openTickets, /snapshotVehicle = resolveTransportIdentity/);
  assert.match(openTickets, /vehicle\?\.plate \|\| snapshotVehicle\.plate/);
});

check("movement card keeps driver and vehicle above route and product", () => {
  const driver = openTickets.indexOf("{driverName}");
  const vehicle = openTickets.indexOf("{vehicleLabel}");
  const route = openTickets.indexOf("{ticketRouteSummary(t)}");
  const product = openTickets.indexOf("{productSummary(t)}", route);
  assert.ok(driver >= 0 && vehicle > driver && route > vehicle && product > route);
});

check("ticket number is secondary small text", () => {
  assert.match(openTickets, /text-\[10px\] text-slate-600[\s\S]*?• № \{t\.ticket_no\}/);
});

check("session verification uses non-modal fail-closed skeleton", () => {
  assert.match(sessionSkeleton, /aria-busy="true"/);
  assert.match(sessionSkeleton, /data-testid="weighbridge-session-skeleton"/);
  assert.doesNotMatch(sessionSkeleton, /role="dialog"|aria-modal|fixed inset-0/);
});

check("PIN dialog is deferred until session verification completes", () => {
  assert.match(page, /\(operatorGateBlocked && !operatorGateChecking\)/);
});

check("session GET reuses the canonical actor context without a redundant profile lookup", () => {
  const getHandler = operatorSessionRoute.slice(
    operatorSessionRoute.indexOf("export async function GET"),
    operatorSessionRoute.indexOf("export async function POST")
  );
  assert.match(getHandler, /getServerActorFromSession\(request\)/);
  assert.match(getHandler, /resolveCompanyForActor\(actor, requestedCompanyId\)/);
  assert.match(getHandler, /Server-Timing/);
  assert.doesNotMatch(getHandler, /resolveWeighbridgeSession/);
});

check("print paper contract remains 90 by 160 millimetres", () => {
  assert.match(printPage, /size:\s*90mm 160mm/);
});

assert.equal(passed, 10);
console.log(`TZ314 ticket/session UX regression PASS: ${passed}/10`);
