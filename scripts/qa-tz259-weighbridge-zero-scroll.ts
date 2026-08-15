import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatWeightKg } from "../lib/weighbridge/weight-format";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const ticketRoute = read("app/api/weighbridge/tickets/[id]/route.ts");
const combobox = read("components/weighbridge/searchable-combobox.tsx");
const printPage = read("app/(dashboard)/weighbridge/[id]/print/page.tsx");
const pdfRoute = read("app/api/weighbridge/tickets/[id]/pdf/route.ts");
const ticketPaper = read("components/weighbridge/weighbridge-ticket-paper.tsx");
const activeHarvestTabs = read("components/weighbridge/active-harvest-tabs.tsx");
const transportPicker = read("components/weighbridge/transport-driver-picker.tsx");

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

check("page title removed from primary flow", () => assert.doesNotMatch(page, />Весовые талоны</));
check("large shift blocker removed", () => assert.doesNotMatch(page, /Действия весовой заблокированы: сначала откройте смену/));
check("large reception blocker removed", () => assert.doesNotMatch(page, /Место приёмки урожая не настроено\. Обратитесь/));
check("compact mode bar replaces the attention control", () => {
  assert.doesNotMatch(page, /intakeStatusLabel|Требуется внимание/);
  assert.match(page, /aria-label="Режим весовой"/);
  assert.match(page, /overflow-x-auto overflow-y-hidden/);
});
check("secondary actions share one menu", () => assert.match(page, /aria-label="Дополнительные действия"/));
check("inventory moved into secondary menu", () => assert.match(page, /DropdownMenuItem asChild>[\s\S]*\/warehouses\/inventory/));
check("history moved into secondary menu", () => assert.match(page, /История талонов/));
check("statistics are collapsible below intake", () => {
  assert.match(page, /<details[\s\S]*className=\{`\$\{terminalPanelClass\} group`\}[\s\S]*Статистика/);
  assert.match(page, /onToggle=\{\(event\) => setStatisticsOpen\(event\.currentTarget\.open\)\}/);
});
check("harvest target is one searchable field in the intake form", () => assert.match(activeHarvestTabs, /aria-label="Поле или участок"/));
check("reception is selected once in the intake form", () => {
  assert.match(page, /Место приёмки \*/);
  assert.doesNotMatch(page, /<ActiveHarvestContextEditor/);
});
check("transport and driver use separate compact selects", () => assert.match(page, /<TransportDriverSelects/));
check("transport and driver expose separate local search", () => {
  assert.match(transportPicker, /Машина, модель или госномер/);
  assert.match(transportPicker, /Имя или фамилия водителя/);
});
check("permanent transport search input removed", () => assert.doesNotMatch(page, /aria-label="Поиск транспорта"/));
check("permanent driver search input removed", () => assert.doesNotMatch(page, /aria-label="Поиск водителя"/));
check("vehicle search includes name model and plate", () => assert.match(transportPicker, /vehicle\.name,[\s\S]*vehicle\.model,[\s\S]*vehicle\.plate/));
check("driver search includes personnel name", () => assert.match(transportPicker, /driver\.name/));
check("driver options remain personnel-based", () => assert.match(page, /roleType: WeighbridgePersonnelRole/));
check("picker search does not issue requests", () => assert.doesNotMatch(transportPicker, /fetch\(|axios|supabase/));
check("picker list scroll is bounded", () => assert.match(combobox, /max-h-60 travkin-scrollbar/));
check("field picker keyboard selection supports arrows and enter", () => assert.match(activeHarvestTabs, /ArrowDown[\s\S]*ArrowUp[\s\S]*Enter/));
check("gross grid is compact", () => assert.match(page, /md:grid-cols-\[1fr_220px\]/));
check("primary CTA says open ticket", () => assert.match(page, /"Открыть талон"/));
check("primary moisture field removed from gross flow", () => assert.doesNotMatch(page, /Влажность, % \(необязательно\)/));
check("new ticket UI has no trailer selector", () => assert.doesNotMatch(page, /form\.trailerId|Прицеп \(необязательно\)/));
check("legacy trailer remains visible", () => assert.match(ticketPaper, /trailer_name_snapshot[\s\S]*label="Прицеп"/));
check("open ticket shows awaiting tare", () => assert.match(page, /Ждёт тару/));
check("moisture saves on blur", () => assert.match(page, /onBlur=\{\(\) => void saveActiveTicketMoisture\(\)\}/));
check("moisture saves on Enter", () => assert.match(page, /event\.key !== "Enter"[\s\S]*saveActiveTicketMoisture/));
check("moisture accepts decimals", () => assert.match(page, /step="0\.1"/));
check("moisture validates 0 through 100", () => assert.match(page, /moisture < 0 \|\| moisture > 100/));
check("moisture PATCH is independent of tare", () => assert.match(ticketRoute, /const hasMoisturePatch = body\?\.moisture_percent !== undefined/));
check("moisture-only PATCH is accepted", () => assert.match(ticketRoute, /Object\.keys\(patch\)\.length === 0 && !hasMoisturePatch/));
check("tare does not erase omitted moisture", () => assert.match(ticketRoute, /if \(hasMoisturePatch && harvestLineId\)/));
check("moisture updates only one harvest line", () => assert.match(ticketRoute, /Harvest ticket must contain exactly one line/));
check("read roles retain open ticket visibility", () => assert.match(page, /canView = canOperate \|\| profile\?\.role === "agronomist"/));
check("fast-repeat field and destination remain persisted", () => assert.match(page, /pickWeighbridgeFastRepeatContext/));
check("new shift clears fast-repeat context", () => assert.match(page, /localStorage\.removeItem\(fastRepeatPersistKey\)/));
check("gross remains manual connector-compatible input", () => assert.match(page, /Брутто \/ вес \(кг\) \*/));
check("whole kilogram weights omit zero decimals", () => assert.equal(formatWeightKg("8500.000"), "8 500 кг"));
check("weight thousands use readable spaces", () => assert.equal(formatWeightKg(12600), "12 600 кг"));
check("real weight fractions remain visible", () => assert.equal(formatWeightKg(8500.125), "8 500,125 кг"));
check("weighbridge summaries share the weight formatter", () => assert.match(ticketPaper, /formatWeightKg\(ticket\.gross_weight_kg\)/));
check("print view shares the canonical ticket component", () => assert.match(printPage, /<WeighbridgeTicketPaper ticket=\{ticket\}/));
check("downloaded PDF shares the numeric formatter", () => assert.match(pdfRoute, /formatWeightNumber\(ticket\.net_weight_kg/));

assert.equal(passed, 44);
console.log(`TZ259 ${passed}/${passed} PASS`);
