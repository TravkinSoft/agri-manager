import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { historyDay, historyPeriod, parseTicketHistoryFilters } from "../lib/weighbridge/ticket-history-filters";
import { encodeTicketHistoryCursor, decodeTicketHistoryCursor } from "../lib/weighbridge/ticket-history-cursor";

let checks = 0;
function check(name: string, task: () => void) { task(); console.log(`PASS ${++checks} ${name}`); }
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
check("Kazakhstan day does not use the machine timezone", () => {
  assert.equal(historyDay(0, new Date("2026-09-22T19:00:00Z")), "2026-09-23");
  assert.equal(historyDay(-1, new Date("2026-09-22T19:00:00Z")), "2026-09-22");
});
check("inclusive final minute becomes exclusive next-minute endpoint", () => {
  assert.deepEqual(historyPeriod("2026-09-22", "00:00", "2026-09-22", "23:59"), { from: "2026-09-21T19:00:00.000Z", to: "2026-09-22T19:00:00.000Z" });
  assert.deepEqual(historyPeriod("2026-09-22", "10:15", "2026-09-22", "10:15"), { from: "2026-09-22T05:15:00.000Z", to: "2026-09-22T05:16:00.000Z" });
});
check("invalid, empty and reversed periods never silently become all history", () => {
  for (const args of [["", "00:00", "2026-09-22", "23:59"], ["2026-02-30", "00:00", "2026-03-01", "00:00"], ["2026-09-22", "25:00", "2026-09-23", "00:00"], ["2026-09-23", "00:00", "2026-09-22", "23:59"]]) assert.throws(() => historyPeriod(...args as [string, string, string, string]));
});
check("server rejects invalid status operation UUID and date injection", () => {
  for (const query of ["historyShiftId=not-a-uuid", "historyStatus=active", "historyOperation=harvest_incoming),id.gt.0", "historyFrom=yesterday", "historyTo=2026-09-23", "historyFrom=2026-09-23T00:00:00Z&historyTo=2026-09-22T00:00:00Z"]) assert.throws(() => parseTicketHistoryFilters(new URLSearchParams(query)));
});
check("valid filters retain independent shift date operation status", () => {
  const id = "2de0d9b8-2739-436d-a7e8-bbb351eb4cc5";
  assert.deepEqual(parseTicketHistoryFilters(new URLSearchParams({ historyShiftId: id, historyStatus: "voided", historyOperation: "harvest_incoming", historyFrom: "2026-09-21T19:00:00Z" })), { shiftId: id, from: "2026-09-21T19:00:00Z", status: "voided", operation: "harvest_incoming" });
});
check("API filters apply in company scope before ordering and page limit", () => {
  const route = read("app/api/weighbridge/tickets/route.ts");
  const history = route.slice(route.indexOf("} else if (historyOnly)"), route.indexOf("const fieldIds ="));
  assert.match(history, /\.eq\("company_id", companyId\)/);
  for (const column of ["shift_id", "created_at", "op_type", "status"]) assert.ok(history.indexOf(`\"${column}\"`) < history.indexOf(".limit(historyLimit + 1)"));
  assert.match(history, /\.lt\("created_at", historyFilters.to\)/);
  assert.match(route, /parseTicketHistoryFilters\(request.nextUrl.searchParams\)/);
});
check("shift catalogue has read auth, company predicate, bounded keyset and no writes", () => {
  const route = read("app/api/weighbridge/tickets/history-shifts/route.ts");
  assert.match(route, /allowedRoles: WEIGHBRIDGE_TICKET_READ_ROLES/);
  assert.match(route, /\.eq\("company_id", companyId\)/);
  assert.match(route, /\.limit\(51\)/);
  assert.doesNotMatch(route, /getServiceClient|requireWeighbridgeOperatorSession|\.rpc\(|\.insert\(|\.update\(|\.delete\(|export async function (?:POST|PATCH|DELETE)/);
});
check("embedded history no longer increases a capped workspace limit", () => {
  const page = read("app/(dashboard)/weighbridge/page.tsx");
  assert.match(page, /<TicketHistoryPanel/);
  assert.doesNotMatch(page, /historyLimit \+ 10|const loadMoreHistory|setHistoryLimit/);
  const panel = read("components/weighbridge/ticket-history-panel.tsx");
  assert.match(panel, /cursor: nextCursor, filters, signal: controller.signal/);
  assert.match(panel, /token !== generation.current/);
  assert.match(panel, /requestRef.current\?\.abort\(\)/);
  assert.doesNotMatch(panel, /setForm|setActiveShift|refreshTickets|listWeighbridgeWorkspaceTickets|closeShift|createTicket|localStorage/);
});

async function databaseChecks() {
  const db = new PGlite();
  try {
    await db.exec(`create table tickets(id uuid primary key, company_id text, shift_id text, status text, op_type text, created_at timestamptz);
      insert into tickets select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'company','previous','finalized','harvest_incoming','2026-09-22 10:00+05'::timestamptz+n*interval '1 minute' from generate_series(1,131)n;
      insert into tickets values('00000000-0000-4000-8000-000000000132','company','previous','voided','harvest_incoming','2026-09-23 01:00+05'),('00000000-0000-4000-8000-000000000133','foreign','previous','finalized','harvest_incoming','2026-09-22 14:00+05'),('00000000-0000-4000-8000-000000000134','company','current','active','harvest_incoming','2026-09-22 14:00+05');`);
    const ids: string[] = []; let cursor: { createdAt: string; id: string } | null = null;
    while (true) {
      const params = cursor ? [cursor.createdAt, cursor.id] : [];
      const rows = (await db.query<{id:string;created_at:string}>(`select id,to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at from tickets where company_id='company' and shift_id='previous' and status in('finalized','voided') ${cursor ? "and (created_at,id)<($1::timestamptz,$2::uuid)" : ""} order by created_at desc,id desc limit 51`, params)).rows;
      const page=rows.slice(0,50);ids.push(...page.map(row=>row.id));
      if(rows.length<=50)break;
      cursor=decodeTicketHistoryCursor(encodeTicketHistoryCursor(page[page.length-1]));
    }
    check("132 previous-shift documents load exactly once over three pages", () => {assert.equal(ids.length,132);assert.equal(new Set(ids).size,132);});
    const day=historyPeriod("2026-09-22","00:00","2026-09-22","23:59");
    const count=(await db.query<{n:number}>("select count(*)::int n from tickets where company_id='company' and status in('finalized','voided') and created_at >= $1 and created_at < $2",[day.from,day.to])).rows[0].n;
    check("yesterday excludes after-midnight, foreign-company and open tickets",()=>assert.equal(count,131));
    const before=(await db.query<{status:string}>("select status from tickets where shift_id='current'")).rows[0].status;
    check("history reads leave the active ticket unchanged",()=>assert.equal(before,"active"));
  } finally { await db.close(); }
}
void databaseChecks().then(()=>console.log(`History filters PASS: ${checks} checks`)).catch(error=>{console.error(error);process.exitCode=1;});
