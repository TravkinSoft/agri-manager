import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getSessionWithBoundedRetry,
  isConfirmedInvalidSessionError,
} from "../lib/auth/session-bootstrap";

const authContextUrl = new URL("../lib/contexts/auth-context.tsx", import.meta.url);
const protectedRouteUrl = new URL("../components/auth/protected-route.tsx", import.meta.url);

async function main() {
  const authContext = await readFile(authContextUrl, "utf8");
  const protectedRoute = await readFile(protectedRouteUrl, "utf8");

  let transientCalls = 0;
  const recovered = await getSessionWithBoundedRetry(
    async () => {
      transientCalls += 1;
      if (transientCalls === 1) throw new Error("temporary network failure");
      return { data: { session: "restored" }, error: null };
    },
    { attempts: 2, retryDelayMs: 0, wait: async () => undefined },
  );
  assert.equal(transientCalls, 2);
  assert.equal(recovered.data.session, "restored");

  let invalidCalls = 0;
  await assert.rejects(
    getSessionWithBoundedRetry(
      async () => {
        invalidCalls += 1;
        throw { name: "AuthSessionMissingError" };
      },
      { attempts: 2, retryDelayMs: 0, wait: async () => undefined },
    ),
  );
  assert.equal(invalidCalls, 1);
  assert.equal(isConfirmedInvalidSessionError({ status: 401 }), true);
  assert.equal(isConfirmedInvalidSessionError(new Error("temporary network failure")), false);

  assert.match(authContext, /getSessionWithBoundedRetry\(/);
  assert.match(authContext, /setAuthUnavailable\(true\);/);
  assert.match(authContext, /if \(isConfirmedInvalidSessionError\(error\)\) \{\s*clearLocalSupabaseSession\(\);/);
  assert.match(authContext, /if \(event === "SIGNED_OUT"\) clearLocalSupabaseSession\(\);/);
  assert.doesNotMatch(
    authContext,
    /catch \(error\) \{\s*console\.error\('Error loading session:', error\);\s*clearLocalSupabaseSession\(\);/,
    "a transient session bootstrap failure must not delete local auth state",
  );

  assert.match(protectedRoute, /!loading && !authUnavailable && !user && !isPublicRoute/);
  assert.match(protectedRoute, /if \(authUnavailable && !isPublicRoute\)/);
  assert.match(protectedRoute, /Ваша сохранённая сессия не была удалена/);
  assert.match(protectedRoute, /Повторить проверку/);

  console.log("TZ315 auth bootstrap regression: PASS");
}

void main();
