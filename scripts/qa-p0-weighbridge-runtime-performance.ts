import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("app/(dashboard)/weighbridge/page.tsx", "utf8");
const ticketRoute = readFileSync("app/api/weighbridge/tickets/[id]/route.ts", "utf8");
const harvestBatchRoute = readFileSync("app/api/weighbridge/harvest-batches/route.ts", "utf8");

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
};

check("fallback poll refreshes only compact transport assignments", () => {
  const start = page.indexOf("const refreshLiveData = async");
  const end = page.indexOf("useLiveRefresh({", start);
  const refresh = page.slice(start, end);
  assert.match(refresh, /if \(isResourcePoll\) \{[\s\S]*?tasks\.push\(refreshTransportPickerData\(\)\)/);
  assert.doesNotMatch(refresh, /const transportResourcesChanged = isResourcePoll/);
  assert.match(refresh, /cropStructureChanged && !transportResourcesChanged/);
});

check("realtime bursts are coalesced and fallback polling is reduced", () => {
  const start = page.indexOf("useLiveRefresh({", page.indexOf("const refreshLiveData = async"));
  const end = page.indexOf("});", start) + 3;
  const config = page.slice(start, end);
  assert.match(config, /intervalMs:\s*60_000/);
  assert.match(config, /debounceMs:\s*1_000/);
  assert.match(config, /minRefreshIntervalMs:\s*10_000/);
});

check("same-key invalidation queues one trailing forced harvest refresh", () => {
  const start = page.indexOf("const refreshHarvestBatches = async");
  const end = page.indexOf("const selectImpurityWarehouse", start);
  const refresh = page.slice(start, end);
  assert.match(page, /harvestBatchesTrailingRefreshRef = useRef<\{ requestKey: string; warehouseId: string \} \| null>\(null\)/);
  assert.match(
    refresh,
    /harvestBatchesRequestRef\.current && harvestBatchesRequestKeyRef\.current === requestKey[\s\S]*?if \(options\.force\)[\s\S]*?harvestBatchesTrailingRefreshRef\.current = \{ requestKey, warehouseId \}/
  );
  assert.match(
    refresh,
    /const wasCurrentRequest = harvestBatchesRequestRef\.current === request;[\s\S]*?if \(wasCurrentRequest\) harvestBatchesRequestRef\.current = null;[\s\S]*?const trailingRefresh = harvestBatchesTrailingRefreshRef\.current;/
  );
  assert.match(
    refresh,
    /harvestBatchesTrailingRefreshRef\.current = null;[\s\S]*?void refreshHarvestBatches\(\{[\s\S]*?force: true,[\s\S]*?warehouseId: trailingRefresh\.warehouseId/
  );
  const warehouseSwitch = page.slice(end, page.indexOf("const refreshBootstrap", end));
  assert.match(warehouseSwitch, /harvestBatchesTrailingRefreshRef\.current = null;/);
});

check("successful finalize trusts the canonical response without a second GET", () => {
  const start = page.indexOf("const responseTicket =", page.indexOf("const closeTicket"));
  const end = page.indexOf("if (!isCanonicallyClosed(canonicalTicket))", start);
  const reconcile = page.slice(start, end);
  const responseCheck = reconcile.indexOf("isCanonicallyClosed(responseTicket)");
  const fallbackGet = reconcile.indexOf("getTicketDetails(closingTicket.id");
  assert.ok(responseCheck >= 0 && fallbackGet > responseCheck);
  assert.match(reconcile, /!finalizeResponse\?\.refresh_required[\s\S]*?!finalizeResponse\?\.idempotent_replay[\s\S]*?isCanonicallyClosed\(responseTicket\)/);
  assert.match(reconcile, /if \(!canonicalTicket\) \{[\s\S]*?getTicketDetails/);
});

check("shared impurity gross edits are blocked on the server", () => {
  assert.match(ticketRoute, /ticket\.op_type === "weighbridge_impurities" && patch\.gross_weight_kg !== undefined/);
  assert.match(ticketRoute, /weighbridge_shared_impurity_groups/);
  assert.match(ticketRoute, /SHARED_IMPURITY_GROSS_EDIT_REQUIRES_REOPEN/);
  assert.match(ticketRoute, /status:\s*409/);
});

check("shared impurity editor is hidden and guarded in the client", () => {
  assert.match(page, /activeTicket\.impurity_source_scope\?\.allocation_mode === "unresolved_total"/);
  assert.match(page, /activeTicket\.impurity_source_scope\?\.allocation_mode !== "unresolved_total"[\s\S]*?onSelect=\{openActiveTicketEditor\}/);
});

check("ticket detail timing includes all enrichers", () => {
  const sharedEnricher = ticketRoute.indexOf("await enrichSharedImpurityScopes");
  const timingFinalized = ticketRoute.indexOf("timing.dbMs = Date.now() - dbStartedAt", sharedEnricher);
  assert.ok(sharedEnricher >= 0 && timingFinalized > sharedEnricher);
  assert.match(ticketRoute.slice(timingFinalized), /Server-Timing/);
});

check("harvest batch reads expose slow-route timing", () => {
  assert.match(harvestBatchRoute, /\[weighbridge\/harvest-batches\] slow read/);
  assert.match(harvestBatchRoute, /Server-Timing/);
  assert.match(harvestBatchRoute, /aggregate;dur=/);
});

console.log(`P0 weighbridge runtime performance ${passed}/${passed} PASS`);
