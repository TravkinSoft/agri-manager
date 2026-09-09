import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const localRequire = createRequire(import.meta.url);
const clientAuthSource = readFileSync("lib/supabase/client-auth.ts", "utf8");
const weighbridgeSource = readFileSync("lib/services/weighbridge.ts", "utf8");
const invalidSession = { error: "Invalid or expired session token" };

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function authHarness(options?: {
  initialToken?: string;
  refreshedToken?: string;
  refreshError?: Error;
  blockRefresh?: boolean;
  emptyRefresh?: boolean;
}) {
  let currentToken = options?.initialToken || "stale-token";
  let getSessionCalls = 0;
  let refreshCalls = 0;
  const refreshGate = deferred<void>();
  const queuedResponses: Array<Response | Promise<Response>> = [];
  const requests: Array<{ input: RequestInfo | URL; init: RequestInit }> = [];

  const supabase = {
    auth: {
      getSession: async () => {
        getSessionCalls += 1;
        return { data: { session: currentToken ? { access_token: currentToken } : null }, error: null };
      },
      refreshSession: async () => {
        refreshCalls += 1;
        if (options?.blockRefresh) await refreshGate.promise;
        if (options?.refreshError) {
          return { data: { session: null }, error: options.refreshError };
        }
        if (options?.emptyRefresh) {
          return { data: { session: null }, error: null };
        }
        currentToken = options?.refreshedToken || "fresh-token";
        return { data: { session: { access_token: currentToken } }, error: null };
      },
    },
  };

  const loaded = { exports: {} as Record<string, (...args: any[]) => any> };
  vm.runInNewContext(ts.transpileModule(clientAuthSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: loaded,
    exports: loaded.exports,
    Headers,
    Response,
    URL,
    setTimeout,
    require: (name: string) => name === "@/lib/supabase/client"
      ? { supabase }
      : localRequire(name),
    fetch: (input: RequestInfo | URL, init: RequestInit) => {
      requests.push({ input, init });
      const response = queuedResponses.shift();
      assert.ok(response, `response ${requests.length} is queued`);
      return Promise.resolve(response);
    },
  });

  return {
    api: loaded.exports,
    requests,
    queue: (...responses: Array<Response | Promise<Response>>) => queuedResponses.push(...responses),
    refreshGate,
    refreshCalls: () => refreshCalls,
    getSessionCalls: () => getSessionCalls,
    setCurrentToken: (value: string) => { currentToken = value; },
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function header(init: RequestInit, name: string) {
  return new Headers(init.headers).get(name);
}

async function verifyClientAuthRecovery() {
  const stableKey = "11111111-1111-4111-8111-111111111111";
  const body = JSON.stringify({ ticket: "fixture" });

  const fresh = authHarness();
  fresh.queue(jsonResponse({ ok: true }));
  const freshResponse = await fresh.api.fetchWithClientAuth("/api/fixture", {
    method: "POST",
    credentials: "include",
    headers: { "Idempotency-Key": stableKey },
    body,
  }, "json");
  assert.equal(freshResponse.status, 200);
  assert.equal(fresh.requests.length, 1);
  assert.equal(fresh.refreshCalls(), 0);
  assert.equal(header(fresh.requests[0].init, "Authorization"), "Bearer stale-token");
  assert.equal(header(fresh.requests[0].init, "Content-Type"), "application/json");
  assert.equal(header(fresh.requests[0].init, "Idempotency-Key"), stableKey);
  assert.equal(fresh.requests[0].init.body, body);
  assert.equal(fresh.requests[0].init.credentials, "include");

  const recovered = authHarness({ refreshedToken: "replacement-token" });
  recovered.queue(jsonResponse(invalidSession, 401), jsonResponse({ ok: true }));
  const recoveredResponse = await recovered.api.fetchWithClientAuth("/api/fixture", {
    method: "POST",
    credentials: "include",
    headers: { "Idempotency-Key": stableKey },
    body,
  }, "json");
  assert.equal(recoveredResponse.status, 200);
  assert.equal(recovered.refreshCalls(), 1);
  assert.equal(recovered.requests.length, 2);
  assert.equal(header(recovered.requests[0].init, "Authorization"), "Bearer stale-token");
  assert.equal(header(recovered.requests[1].init, "Authorization"), "Bearer replacement-token");
  for (const request of recovered.requests) {
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.body, body);
    assert.equal(request.init.credentials, "include");
    assert.equal(header(request.init, "Idempotency-Key"), stableKey);
  }

  const bounded = authHarness();
  bounded.queue(jsonResponse(invalidSession, 401), jsonResponse(invalidSession, 401));
  const boundedResponse = await bounded.api.fetchWithClientAuth("/api/fixture", { method: "POST", body }, "json");
  assert.equal(boundedResponse.status, 401);
  assert.equal(bounded.requests.length, 2);
  assert.equal(bounded.refreshCalls(), 1);

  for (const [status, error] of [[401, "Unauthorized"], [403, "Forbidden"], [422, "Invalid input"], [500, "Failure"]] as const) {
    const unrelated = authHarness();
    unrelated.queue(jsonResponse({ error }, status));
    const unrelatedResponse = await unrelated.api.fetchWithClientAuth("/api/fixture");
    assert.equal(unrelatedResponse.status, status);
    assert.equal(unrelated.requests.length, 1);
    assert.equal(unrelated.refreshCalls(), 0);
  }

  const failedRefresh = authHarness({ refreshError: new Error("refresh rejected") });
  failedRefresh.queue(jsonResponse(invalidSession, 401));
  const preservedResponse = await failedRefresh.api.fetchWithClientAuth("/api/fixture", { method: "POST", body }, "json");
  assert.equal(preservedResponse.status, 401);
  assert.deepEqual(await preservedResponse.json(), invalidSession);
  assert.equal(failedRefresh.requests.length, 1);
  assert.equal(failedRefresh.refreshCalls(), 1);

  const emptyRefresh = authHarness({ emptyRefresh: true });
  emptyRefresh.queue(jsonResponse(invalidSession, 401));
  const emptyRefreshResponse = await emptyRefresh.api.fetchWithClientAuth("/api/fixture", { method: "POST", body }, "json");
  assert.equal(emptyRefreshResponse.status, 401);
  assert.equal(emptyRefresh.requests.length, 1);
  assert.equal(emptyRefresh.refreshCalls(), 1);

  const concurrent = authHarness({ refreshedToken: "shared-token", blockRefresh: true });
  concurrent.queue(
    jsonResponse(invalidSession, 401),
    jsonResponse(invalidSession, 401),
    jsonResponse({ request: 1 }),
    jsonResponse({ request: 2 }),
  );
  const first = concurrent.api.fetchWithClientAuth("/api/one");
  const second = concurrent.api.fetchWithClientAuth("/api/two");
  for (let attempt = 0; attempt < 10 && concurrent.refreshCalls() === 0; attempt += 1) await flush();
  assert.equal(concurrent.refreshCalls(), 1);
  concurrent.refreshGate.resolve();
  const concurrentResponses = await Promise.all([first, second]);
  assert.deepEqual(concurrentResponses.map((response) => response.status), [200, 200]);
  assert.equal(concurrent.requests.length, 4);
  assert.equal(concurrent.refreshCalls(), 1);
  assert.equal(header(concurrent.requests[2].init, "Authorization"), "Bearer shared-token");
  assert.equal(header(concurrent.requests[3].init, "Authorization"), "Bearer shared-token");

  const concurrentFailure = authHarness({ refreshError: new Error("refresh rejected"), blockRefresh: true });
  concurrentFailure.queue(jsonResponse(invalidSession, 401), jsonResponse(invalidSession, 401));
  const failedFirst = concurrentFailure.api.fetchWithClientAuth("/api/one");
  const failedSecond = concurrentFailure.api.fetchWithClientAuth("/api/two");
  for (let attempt = 0; attempt < 10 && concurrentFailure.refreshCalls() === 0; attempt += 1) await flush();
  assert.equal(concurrentFailure.refreshCalls(), 1);
  concurrentFailure.refreshGate.resolve();
  const failureResponses = await Promise.all([failedFirst, failedSecond]);
  assert.deepEqual(failureResponses.map((response) => response.status), [401, 401]);
  assert.equal(concurrentFailure.requests.length, 2);
  assert.equal(concurrentFailure.refreshCalls(), 1);

  const alreadyRenewed = authHarness();
  const firstResponse = deferred<Response>();
  alreadyRenewed.queue(firstResponse.promise, jsonResponse({ ok: true }));
  const alreadyRenewedRequest = alreadyRenewed.api.fetchWithClientAuth("/api/fixture");
  await flush();
  alreadyRenewed.setCurrentToken("renewed-elsewhere");
  firstResponse.resolve(jsonResponse(invalidSession, 401));
  assert.equal((await alreadyRenewedRequest).status, 200);
  assert.equal(alreadyRenewed.refreshCalls(), 0);
  assert.equal(header(alreadyRenewed.requests[1].init, "Authorization"), "Bearer renewed-elsewhere");

  const aborted = authHarness();
  const abortedFirstResponse = deferred<Response>();
  aborted.queue(abortedFirstResponse.promise);
  const controller = new AbortController();
  const abortedRequest = aborted.api.fetchWithClientAuth("/api/fixture", { signal: controller.signal });
  await flush();
  controller.abort();
  abortedFirstResponse.resolve(jsonResponse(invalidSession, 401));
  assert.equal((await abortedRequest).status, 401);
  assert.equal(aborted.requests.length, 1);
  assert.equal(aborted.refreshCalls(), 0);

  const abortedDuringRefresh = authHarness({ blockRefresh: true });
  abortedDuringRefresh.queue(jsonResponse(invalidSession, 401));
  const refreshController = new AbortController();
  const abortedDuringRequest = abortedDuringRefresh.api.fetchWithClientAuth("/api/fixture", { signal: refreshController.signal });
  for (let attempt = 0; attempt < 10 && abortedDuringRefresh.refreshCalls() === 0; attempt += 1) await flush();
  assert.equal(abortedDuringRefresh.refreshCalls(), 1);
  refreshController.abort();
  abortedDuringRefresh.refreshGate.resolve();
  assert.equal((await abortedDuringRequest).status, 401);
  assert.equal(abortedDuringRefresh.requests.length, 1);
}

async function verifyWeighbridgeIntegration() {
  const calls: Array<{ input: RequestInfo | URL; init: RequestInit; contentType: string }> = [];
  const loaded = { exports: {} as Record<string, (...args: any[]) => any> };
  vm.runInNewContext(ts.transpileModule(weighbridgeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: loaded,
    exports: loaded.exports,
    Response,
    URLSearchParams,
    require: (name: string) => {
      if (name === "@/lib/supabase/client-auth") return {
        buildClientAuthHeaders: async () => ({ Authorization: "Bearer fixture" }),
        fetchWithClientAuth: async (input: RequestInfo | URL, init: RequestInit, contentType: string) => {
          calls.push({ input, init, contentType });
          return jsonResponse({ ok: true });
        },
      };
      if (name === "@/lib/utils/qa-data") return { hasQaDataMarker: () => false };
      if (name === "@/lib/weighbridge/transport-pairing") return { normalizeWeighbridgeTransportPickerData: (value: unknown) => value };
      return localRequire(name);
    },
  });

  const createKey = "22222222-2222-4222-8222-222222222222";
  await loaded.exports.createTicket({ operation_type: "harvest" }, [], [], createKey);
  assert.equal(calls[0].input, "/api/weighbridge/tickets");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(header(calls[0].init, "Idempotency-Key"), createKey);
  assert.equal(calls[0].contentType, "json");

  const finalizeKey = "33333333-3333-4333-8333-333333333333";
  await loaded.exports.finalizeTicket("ticket-a", "actor-a", {
    tare_weight_kg: 6900,
    idempotency_key: finalizeKey,
  });
  assert.equal(calls[1].input, "/api/weighbridge/tickets/ticket-a/finalize");
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.credentials, "include");
  assert.equal(header(calls[1].init, "Idempotency-Key"), finalizeKey);
  assert.equal(calls[1].contentType, "json");
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), {
    tare_weight_kg: 6900,
    idempotency_key: finalizeKey,
  });

  await loaded.exports.patchTicket("ticket-b", "actor-a", {
    tare_weight_kg: 6900,
    status: "ready_to_close",
  });
  assert.equal(calls[2].input, "/api/weighbridge/tickets/ticket-b");
  assert.equal(calls[2].init.method, "PATCH");
  assert.equal(calls[2].contentType, "json");
  assert.deepEqual(JSON.parse(String(calls[2].init.body)), {
    tare_weight_kg: 6900,
    status: "ready_to_close",
  });

  const pageSource = readFileSync("app/(dashboard)/weighbridge/page.tsx", "utf8");
  assert.match(pageSource, /await patchTicketWithTareConfirmation\([\s\S]*?finalizeResponse = await finalizeTicket\(/);
}

async function main() {
  await verifyClientAuthRecovery();
  await verifyWeighbridgeIntegration();
  console.log("P0 client session refresh regression: PASS");
}

void main();
