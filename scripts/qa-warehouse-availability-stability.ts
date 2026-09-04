import assert from "node:assert/strict";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { ScopedReadResource, readErrorMessage } from "../lib/utils/scoped-read-resource";

let checks = 0;
async function test(name: string, run: () => void | Promise<void>) { await run(); checks++; console.log(`PASS ${name}`); }
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
// Node 24 runtime; this repository still pins @types/node 20.6 (old Timer[] API).
function enableRuntimeTimers() {
  const timers = mock.timers as unknown as { enable(options: { apis: string[] }): void };
  timers.enable({ apis: ["setTimeout", "Date"] });
}

async function main() {
await test("100 view/focus events join ONE pending read without abort", async () => {
  const r = new ScopedReadResource<number>(); const task = deferred<number>(); let calls = 0; let signal!: AbortSignal;
  const loader = (s: AbortSignal) => { calls++; signal = s; return task.promise; };
  const first = r.request(loader);
  for (let i = 0; i < 100; i++) assert.equal(r.request(loader), first);
  await settle(); assert.equal(calls, 1); assert.equal(signal.aborted, false);
  task.resolve(116599); await first; assert.equal(r.getSnapshot().data, 116599); r.cancel();
});
await test("100 warm tab switches reuse successful payload", async () => {
  const r = new ScopedReadResource<number>(); let calls = 0;
  const loader = async () => { calls++; return 8000; }; await r.request(loader);
  for (let i = 0; i < 100; i++) await r.request(loader);
  assert.equal(calls, 1); assert.equal(r.getSnapshot().data, 8000); r.cancel();
});
await test("TTL revalidation retains last visible stock", async () => {
  let now = 1000; const r = new ScopedReadResource<number>(30000, 30000, () => now);
  await r.request(async () => 8000); now += 30001;
  const next = deferred<number>(); const request = r.request(() => next.promise);
  assert.equal(r.getSnapshot().data, 8000); assert.equal(r.getSnapshot().loading, true);
  next.resolve(9000); await request; assert.equal(r.getSnapshot().data, 9000); r.cancel();
});
await test("100 actual invalidations coalesce into ONE follow-up", async () => {
  const r = new ScopedReadResource<number>(); const a = deferred<number>(); const b = deferred<number>(); const signals: AbortSignal[] = [];
  const loader = (s: AbortSignal) => { signals.push(s); return signals.length === 1 ? a.promise : b.promise; };
  const first = r.request(loader); await settle();
  for (let i = 0; i < 100; i++) void r.request(loader, true);
  assert.equal(signals[0].aborted, false); a.resolve(1); await first; await settle();
  assert.equal(signals.length, 2); assert.equal(r.getSnapshot().data, 1);
  b.resolve(2); await settle(); assert.equal(r.getSnapshot().data, 2); r.cancel();
});
for (const fails of [false, true]) await test(`scope cancellation ignores late ${fails ? "error" : "payload"}`, async () => {
  const r = new ScopedReadResource<number>(); const old = deferred<number>(); let signal!: AbortSignal;
  const pending = r.request((s) => { signal = s; return old.promise; }); await settle(); r.cancel();
  assert.equal(signal.aborted, true); await r.request(async () => 2);
  if (fails) old.reject(new Error("old scope")); else old.resolve(999);
  await pending; await settle(); assert.equal(r.getSnapshot().data, 2); assert.equal(r.getSnapshot().error, null); r.cancel();
});
await test("independent actors/tenants cannot share a payload", async () => {
  const a = new ScopedReadResource<number>(); const b = new ScopedReadResource<number>();
  await a.request(async () => 999); assert.equal(b.getSnapshot().data, null); await b.request(async () => 3);
  assert.equal(a.getSnapshot().data, 999); assert.equal(b.getSnapshot().data, 3); a.cancel(); b.cancel();
});
await test("slow ticket beyond old ten seconds is not aborted", async () => {
  enableRuntimeTimers();
  try {
    const r = new ScopedReadResource<number>(); const task = deferred<number>(); let signal!: AbortSignal;
    const pending = r.request((s) => { signal = s; return task.promise; }); await settle();
    mock.timers.tick(11000); await settle(); assert.equal(signal.aborted, false); assert.equal(r.getSnapshot().loading, true);
    task.resolve(15000); await pending; assert.equal(r.getSnapshot().data, 15000); r.cancel();
  } finally { mock.timers.reset(); }
});
await test("deadline exposes clear error; retry works; late result ignored", async () => {
  enableRuntimeTimers();
  try {
    const r = new ScopedReadResource<number>(); const task = deferred<number>(); const pending = r.request(() => task.promise); await settle();
    mock.timers.tick(30001); await pending; assert.equal(r.getSnapshot().error?.name, "TimeoutError");
    assert.match(readErrorMessage(r.getSnapshot().error!, "Талон"), /сервер не ответил вовремя.*Повторите/);
    task.resolve(999); await settle(); assert.equal(r.getSnapshot().data, null);
    await r.request(async () => 15000, true); assert.equal(r.getSnapshot().data, 15000); assert.equal(r.getSnapshot().error, null); r.cancel();
  } finally { mock.timers.reset(); }
});
await test("failure never auto-loops despite queued invalidation", async () => {
  const r = new ScopedReadResource<number>(); const task = deferred<number>(); let calls = 0;
  const loader = () => { calls++; return task.promise; }; const pending = r.request(loader); void r.request(loader, true); await settle();
  task.reject(new Error("HTTP 503")); await pending; await settle(); assert.equal(calls, 1); assert.equal(r.getSnapshot().loading, false); r.cancel();
});
await test("background error retains last stock but explicitly reports failure", async () => {
  const r = new ScopedReadResource<number>(); await r.request(async () => 116599);
  await r.request(async () => { throw new Error("HTTP 503"); }, true);
  assert.equal(r.getSnapshot().data, 116599); assert.match(r.getSnapshot().error!.message, /503/); r.cancel();
});
const page = readFileSync("app/(dashboard)/warehouses/page.tsx", "utf8");
const component = readFileSync("components/warehouses/stock-availability.tsx", "utf8");
const preview = readFileSync("components/weighbridge/ticket-preview-dialog.tsx", "utf8");
const route = readFileSync("app/api/warehouses/balances/route.ts", "utf8");
await test("availability stays mounted on tab changes", () => {
  assert.match(page, /hidden=\{selectedView !== "availability"\}/);
  assert.doesNotMatch(page, /isAgronomist && selectedView === "availability" && profile/);
  assert.doesNotMatch(page, /loading \?[^\n]*: <StockAvailability/);
});
await test("cache keys include actual and effective actor, tenant, language", () => {
  assert.match(component, /\$\{userId\}:\$\{actorScope\}:\$\{companyId\}:\$\{language\}/);
  assert.match(page, /actorScope=\{`\$\{profile.id\}:\$\{profile.role\}`\}/);
});
await test("generic poll does not invalidate; hidden panel does not launch reads", () => {
  assert.match(page, /if \(event\?\.source === "realtime" \|\| event\?\.source === "online"\) setDetailRevision/);
  assert.match(component, /if \(!active\) return/); assert.match(component, /resource.request/);
});
await test("preview retry is human-readable, actor-scoped and not a ten-second abort", () => {
  assert.doesNotMatch(preview, /ticketPreviewCache|10_000|reason.message/);
  assert.match(preview, /readErrorMessage\(error, "Талон"\)/); assert.match(preview, />Повторить</);
  assert.match(preview, /profile\?\.id.*profile\?\.company_id.*profile\?\.role.*ticketId/);
});
await test("balances uses complete referenced scope and phase metrics", () => {
  assert.match(route, /Array.from\(referencedProductIds\)/);
  assert.doesNotMatch(route, /warehouseId \? Array.from\(referencedProductIds\) : undefined/);
  assert.match(route, /Server-Timing/); assert.match(route, /timing.catalog/);
});
console.log(`Warehouse availability stability PASS: ${checks}/${checks}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
