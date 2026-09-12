import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canAccessPath } from "../lib/auth/role-access";
import { isOperationalReadOnlyRole, parseCanonicalRole } from "../lib/auth/role-contract";
import { canMutateFieldMap, canReadFieldMap, canWriteFieldMap } from "../lib/fields-map/access-policy";

const root = resolve(__dirname, "..");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");
const checks: string[] = [];
const check = (name: string, callback: () => void) => {
  callback();
  checks.push(name);
};

check("accountant is a canonical read-only role", () => {
  assert.equal(parseCanonicalRole("accountant"), "accountant");
  assert.equal(isOperationalReadOnlyRole("accountant"), true);
  assert.equal(isOperationalReadOnlyRole("director"), true);
  assert.equal(isOperationalReadOnlyRole("legal_operator"), true);
  assert.equal(isOperationalReadOnlyRole("agronomist"), false);
});

check("agronomist keeps the approved operational cabinet", () => {
  for (const path of ["/dashboard", "/crop-structure", "/fields-map", "/warehouses", "/weather-lab", "/traffic"]) {
    assert.equal(canAccessPath("agronomist", path), true, path);
  }
});

check("director receives summary map warehouse weather and analytics only", () => {
  for (const path of ["/dashboard", "/fields-map", "/warehouses", "/weather-lab", "/analytics"]) {
    assert.equal(canAccessPath("director", path), true, path);
  }
  for (const path of ["/crop-structure", "/traffic", "/weighbridge", "/weighbridge/history", "/settings", "/warehouses/transactions"]) {
    assert.equal(canAccessPath("director", path), false, path);
  }
});

check("accountant receives summary map warehouse analytics and ticket journal only", () => {
  const ticketId = "3f81b1de-89d1-4cf2-8d95-fde7cdb95087";
  for (const path of ["/dashboard", "/fields-map", "/warehouses", "/analytics", "/weighbridge/history", `/weighbridge/${ticketId}/print`]) {
    assert.equal(canAccessPath("accountant", path), true, path);
  }
  for (const path of ["/crop-structure", "/weather-lab", "/traffic", "/weighbridge", "/weighbridge/active", "/weighbridge/dashboard", "/settings", "/warehouses/transactions"]) {
    assert.equal(canAccessPath("accountant", path), false, path);
  }
});

check("field map is read-only for director and accountant", () => {
  for (const role of ["director", "accountant"] as const) {
    assert.equal(canReadFieldMap(role), true);
    assert.equal(canWriteFieldMap(role), false);
    assert.equal(canMutateFieldMap(role), false);
  }
});

check("server method guard covers both read-only roles", () => {
  const source = read("lib/auth/server-session.ts");
  assert.match(source, /isOperationalReadOnlyRole\(actor\.role\)/u);
  assert.match(source, /\["GET", "HEAD", "OPTIONS"\]\.includes\(request\.method\.toUpperCase\(\)\)/u);
});

check("weather allows director reads but removes profile writes", () => {
  const page = read("app/(dashboard)/weather-lab/page.tsx");
  const auth = read("app/api/weather-lab/_auth.ts");
  const ui = read("components/weather/weather-lab.tsx");
  assert.match(page, /readOnly=\{profile\.role === "director"\}/u);
  assert.match(auth, /\["global_admin", "agronomist", "director"\]\.includes\(actor\.role\)/u);
  assert.match(ui, /profileOpen && !readOnly/u);
  assert.match(ui, /if \(readOnly\) return;/u);
});

check("warehouse overview includes accountant only in read surfaces", () => {
  const helpers = read("app/api/warehouses/_helpers.ts");
  const page = read("app/(dashboard)/warehouses/page.tsx");
  const writeRoles = helpers.match(/WAREHOUSE_(?:ENTITY|STOCK)_WRITE_ROLES = \[([\s\S]*?)\] as const;/gu) || [];
  assert.match(helpers.match(/WAREHOUSE_READ_ROLES = \[([\s\S]*?)\] as const;/u)?.[0] || "", /"accountant"/u);
  assert.match(page, /\["weighman", "agronomist", "director", "accountant"\]\.includes\(role\)/u);
  writeRoles.forEach((block) => assert.doesNotMatch(block, /"director"|"accountant"/u));
});

check("ticket APIs use a narrow accountant read contract", () => {
  const auth = read("app/api/weighbridge/_auth.ts");
  const tickets = read("app/api/weighbridge/tickets/route.ts");
  const ticket = read("app/api/weighbridge/tickets/[id]/route.ts");
  const pdf = read("app/api/weighbridge/tickets/[id]/pdf/route.ts");
  const genericRead = auth.match(/WEIGHBRIDGE_READ_ROLES = \[([\s\S]*?)\] as const;/u)?.[0] || "";
  const ticketRead = auth.match(/WEIGHBRIDGE_TICKET_READ_ROLES = \[([\s\S]*?)\] as const;/u)?.[0] || "";
  assert.doesNotMatch(genericRead, /"director"|"accountant"/u);
  assert.match(ticketRead, /"director"/u);
  assert.match(ticketRead, /"accountant"/u);
  assert.match(tickets, /accountantHistoryOnly/u);
  assert.match(tickets, /historyOnly/u);
  assert.match(tickets, /\.in\("status", \["finalized", "voided"\]\)/u);
  assert.match(tickets, /ticketHistoryCursorFilter\(historyCursor\)/u);
  assert.match(tickets, /\.order\("created_at", \{ ascending: false \}\)[\s\S]*?\.order\("id", \{ ascending: false \}\)[\s\S]*?\.limit\(historyLimit \+ 1\)/u);
  assert.match(tickets, /historyNextCursor/u);
  assert.doesNotMatch(tickets, /historyOffset|historyNextOffset|\.range\(/u);
  assert.match(ticket, /actor\.role === "accountant"[\s\S]*?"finalized", "voided"/u);
  assert.match(pdf, /actor\.role === "accountant"[\s\S]*?"finalized", "voided"/u);
});

check("history is a standalone read-only page", () => {
  const page = read("app/(dashboard)/weighbridge/history/page.tsx");
  assert.doesNotMatch(page, /redirect\("\/weighbridge"\)/u);
  assert.match(page, /TicketPreviewDialog/u);
  assert.match(page, /downloadTicketPdf/u);
  assert.match(page, /listTicketHistoryPage/u);
  assert.match(page, /nextCursor/u);
  assert.match(page, /Загрузить ещё/u);
  assert.doesNotMatch(page, /createTicket|finalizeTicket|updateTicket/u);
});

check("navigation and profile menu do not expose forbidden actions", () => {
  const sidebar = read("components/layout/sidebar.tsx");
  const mobile = read("components/layout/mobile-bottom-nav.tsx");
  const header = read("components/layout/header.tsx");
  assert.match(sidebar, /const ACCOUNTANT_NAV[\s\S]*?\/weighbridge\/history/u);
  assert.match(mobile, /case "accountant"[\s\S]*?\/weighbridge\/history/u);
  assert.match(mobile, /\["agronomist", "director", "accountant"\][\s\S]*?\? 5 : 4/u);
  assert.match(header, /role === "accountant"[\s\S]*?role_accountant/u);
  assert.match(header, /canAccessPath\(profile\?\.role, "\/settings"\)/u);
});

check("harvest summary API explicitly includes accountant", () => {
  const route = read("app/api/dashboard/harvest-summary/route.ts");
  const roles = route.match(/const DASHBOARD_ROLES = \[([^\]]+)\] as const;/u)?.[0] || "";
  assert.match(roles, /"accountant"/u);
});

check("user administration exposes separate accountant and legal roles", () => {
  const page = read("app/(dashboard)/users/page.tsx");
  const inviteRoles = page.match(/const INVITE_ROLES = \[([\s\S]*?)\] as const;/u)?.[0] || "";
  assert.match(inviteRoles, /"accountant"/u);
  assert.match(page, /role === "accountant"[\s\S]*?"Бухгалтер"/u);
  assert.match(page, /role === "legal_operator"[\s\S]*?"Юрист"/u);
  assert.doesNotMatch(page, /Юрист \/ бухгалтер/u);
});

console.log(`TF2 role matrix PASS ${checks.length}/${checks.length}`);
for (const name of checks) console.log(`PASS ${name}`);
