import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dashboard = readFileSync(resolve(root, "components/dashboard/harvest-dashboard.tsx"), "utf8");
const trafficApi = readFileSync(resolve(root, "app/api/traffic/route.ts"), "utf8");
const trafficServer = readFileSync(resolve(root, "lib/traffic/server.ts"), "utf8");
const layout = readFileSync(resolve(root, "components/layout/dashboard-layout.tsx"), "utf8");
const warehouses = readFileSync(resolve(root, "app/(dashboard)/warehouses/page.tsx"), "utf8");

assert.match(trafficServer, /includeOpenCombineShift = includeAnalytics/);
assert.match(trafficApi, /actor\.role === "agronomist", true\)/);
assert.match(dashboard, /shiftIsOpen \? "Live" : "Offline"/);
assert.doesNotMatch(dashboard, /Смена не открыта|PTC загружается/);

assert.match(dashboard, /selectedPartyStockKg \/ 1000 \/ hectares/);
assert.match(dashboard, /enteredHectares > 0 \? enteredHectares : fieldHectares/);
assert.match(dashboard, />Калькулятор урожайности<\/h3>/);

assert.match(dashboard, /group === "offline" \? null/);
assert.match(dashboard, /group === "empty" && !shiftIsOpen \? "0 мин"/);
assert.match(dashboard, /const days = Math\.floor\(minutes \/ 1_440\)/);
for (const label of ["Пустая машина", "Загруженная машина", "Машина разгружается", "Машина на ремонте"]) {
  assert.match(dashboard, new RegExp(label));
}

assert.match(dashboard, /Оборот машин · \{trafficVehicles\.filter/);
assert.doesNotMatch(dashboard, />Последние рейсы|>Размещение|PotatoDriverSummary/);
assert.match(layout, /isDashboard \|\| isWarehouses \? "pt-1\.5 sm:pt-2 md:pt-3"/);
assert.match(warehouses, /<div className="space-y-3">/);

console.log("Dashboard live compact PASS");
