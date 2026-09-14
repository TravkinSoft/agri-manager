import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware, config } from "../middleware";
import { isBlockedWeighbridgeWrite, isWeighbridgePage, serviceElapsed } from "../lib/weighbridge/service-status";

for (const path of ["/weighbridge", "/weighbridge/history", "/weighbridge/ticket/123"]) assert.equal(isWeighbridgePage(path), true);
for (const path of ["/warehouses", "/ledger", "/dashboard", "/weighbridge-service", "/weighbridge-other"]) assert.equal(isWeighbridgePage(path), false);
for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
  assert.equal(isBlockedWeighbridgeWrite("/api/weighbridge/tickets/123/finalize", method, true), true);
  assert.equal(isBlockedWeighbridgeWrite("/api/weighbridge/tickets", method, false), false);
  assert.equal(isBlockedWeighbridgeWrite("/api/warehouses", method, true), false);
}
for (const method of ["GET", "HEAD", "OPTIONS"]) assert.equal(isBlockedWeighbridgeWrite("/api/weighbridge/tickets", method, true), false);
const denied = middleware(new NextRequest("https://travkinflow.com/api/weighbridge/tickets", { method: "POST" }));
assert.equal(denied.status, 503);
assert.equal(denied.headers.get("cache-control"), "no-store");
assert.equal(middleware(new NextRequest("https://travkinflow.com/weighbridge")).headers.get("x-middleware-rewrite"), "https://travkinflow.com/weighbridge-service");
assert.equal(middleware(new NextRequest("https://travkinflow.com/warehouses")).headers.get("x-middleware-next"), "1");
assert.deepEqual(config.matcher, ["/weighbridge/:path*", "/api/weighbridge/:path*"]);
assert.equal(serviceElapsed(Date.parse("2026-09-14T20:00:01Z"), "2026-09-14T18:44:00Z"), "01:16:01");
assert.equal(serviceElapsed(0, "2026-09-14T18:44:00Z"), "00:00:00");
console.log("PASS: maintenance page/API scope, read-only routes, no automatic deadline, elapsed timer");
