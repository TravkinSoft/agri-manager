import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  decodeTicketHistoryCursor,
  encodeTicketHistoryCursor,
  ticketHistoryCursorFilter,
  type TicketHistoryCursor,
} from "../lib/weighbridge/ticket-history-cursor";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

let checks = 0;
const check = (name: string, run: () => void) => {
  run();
  checks += 1;
  console.log(`PASS ${name}`);
};

type Key = { createdAt: string; id: string };

const compareDescending = (left: Key, right: Key) =>
  right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);

const afterCursor = (key: Key, cursor: TicketHistoryCursor) =>
  key.createdAt < cursor.createdAt
  || (key.createdAt === cursor.createdAt && key.id < cursor.id);

check("cursor round-trips full timestamp precision and UUID", () => {
  const encoded = encodeTicketHistoryCursor({
    created_at: "2026-09-11T08:30:00.123456+00:00",
    id: "00000000-0000-4000-8000-000000000006",
  });
  assert.deepEqual(decodeTicketHistoryCursor(encoded), {
    createdAt: "2026-09-11T08:30:00.123456+00:00",
    id: "00000000-0000-4000-8000-000000000006",
  });
});

check("cursor rejects malformed, forged, and oversized values", () => {
  const invalid = [
    "%%%",
    Buffer.from(JSON.stringify({ v: 2, createdAt: "2026-09-11T08:30:00.000Z", id: "00000000-0000-4000-8000-000000000006" })).toString("base64url"),
    Buffer.from(JSON.stringify({ v: 1, createdAt: "not-a-date", id: "00000000-0000-4000-8000-000000000006" })).toString("base64url"),
    Buffer.from(JSON.stringify({ v: 1, createdAt: "2026-09-11T08:30:00", id: "00000000-0000-4000-8000-000000000006" })).toString("base64url"),
    Buffer.from(JSON.stringify({ v: 1, createdAt: "2026-09-11T08:30:00.000Z", id: "not-a-uuid" })).toString("base64url"),
    "a".repeat(513),
  ];
  invalid.forEach((value) => assert.throws(() => decodeTicketHistoryCursor(value)));
});

check("PostgREST filter uses both halves of the compound descending key", () => {
  const cursor = {
    createdAt: "2026-09-11T08:30:00.000Z",
    id: "00000000-0000-4000-8000-000000000006",
  };
  assert.equal(
    ticketHistoryCursorFilter(cursor),
    "created_at.lt.2026-09-11T08:30:00.000Z,and(created_at.eq.2026-09-11T08:30:00.000Z,id.lt.00000000-0000-4000-8000-000000000006)"
  );
});

check("a newly inserted leading ticket cannot duplicate or skip the original next page", () => {
  const original = [
    { createdAt: "2026-09-11T08:40:00.000Z", id: "00000000-0000-4000-8000-000000000001" },
    { createdAt: "2026-09-11T08:30:00.000Z", id: "00000000-0000-4000-8000-000000000006" },
    { createdAt: "2026-09-11T08:30:00.000Z", id: "00000000-0000-4000-8000-000000000005" },
    { createdAt: "2026-09-11T08:20:00.000Z", id: "00000000-0000-4000-8000-000000000004" },
  ].sort(compareDescending);
  const firstPage = original.slice(0, 2);
  const cursor = {
    createdAt: firstPage[1].createdAt,
    id: firstPage[1].id,
  };
  const withConcurrentInsert = [
    ...original,
    { createdAt: "2026-09-11T08:50:00.000Z", id: "00000000-0000-4000-8000-000000000007" },
  ].sort(compareDescending);
  const secondPage = withConcurrentInsert.filter((key) => afterCursor(key, cursor)).slice(0, 2);

  assert.deepEqual(secondPage, original.slice(2, 4));
  assert.equal(secondPage.some((key) => firstPage.some((first) => first.id === key.id)), false);
});

check("history API uses keyset ordering while workspace and general list stay bounded", () => {
  const route = read("app/api/weighbridge/tickets/route.ts");
  assert.match(route, /ticketQuery = ticketQuery\.or\(ticketHistoryCursorFilter\(historyCursor\)\)/u);
  assert.match(route, /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)\s*\.limit\(historyLimit \+ 1\)/u);
  assert.match(route, /historyNextCursor = encodeTicketHistoryCursor\(data\[data\.length - 1\]\)/u);
  assert.doesNotMatch(route, /historyOffset|historyNextOffset|\.range\(/u);
  assert.match(route, /if \(workspace\)[\s\S]*?\.limit\(100\)/u);
  assert.match(route, /else \{[\s\S]*?\.limit\(200\)/u);
});

check("client and history page carry only the opaque cursor", () => {
  const service = read("lib/services/weighbridge.ts");
  const page = read("app/(dashboard)/weighbridge/history/page.tsx");
  assert.match(service, /options\?: \{ cursor\?: string \| null;/u);
  assert.match(service, /query\.set\("historyCursor", options\.cursor\)/u);
  assert.match(service, /nextCursor: string \| null/u);
  assert.doesNotMatch(service, /historyOffset|historyNextOffset|nextOffset/u);
  assert.match(page, /const \[nextCursor, setNextCursor\] = useState<string \| null>\(null\)/u);
  assert.match(page, /cursor: nextCursor/u);
  assert.doesNotMatch(page, /nextOffset|historyOffset/u);
});

console.log(`TF2 ticket history pagination PASS: ${checks} checks`);
