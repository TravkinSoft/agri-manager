import { createClient, type Session } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Leave recovery PKCE codes to the page. Recovery intent is checked through
// the public getClaims API, after the one-time exchange succeeds.
const manualRecoveryCode = typeof window !== "undefined"
  && window.location.pathname === "/auth/reset-password"
  && Boolean(new URLSearchParams(window.location.search).get("code"));
export const supabase = createClient(supabaseUrl, supabaseAnonKey,
  manualRecoveryCode ? { auth: { detectSessionInUrl: false } } : undefined);

type RecoveryIdentity = { userId: string; sessionId: string };
const recoveryStorageKey = `tf-password-recovery:${new URL(supabaseUrl).host}`;
type CallbackKind = "code" | "token_hash";
type RecoveryCallback = RecoveryIdentity & { kind: CallbackKind; digest: string };
const callbackStorageKey = `${recoveryStorageKey}:callback`;

function readRecoveryCallback(): RecoveryCallback | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(callbackStorageKey) || "null");
    return (value?.kind === "code" || value?.kind === "token_hash")
      && typeof value.digest === "string" && /^[a-f0-9]{64}$/.test(value.digest)
      && typeof value.userId === "string" && value.userId
      && typeof value.sessionId === "string" && value.sessionId ? value : null;
  } catch {
    return null;
  }
}

function readRecoveryIdentity(): RecoveryIdentity | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(recoveryStorageKey) || "null");
    return typeof value?.userId === "string" && value.userId
      && typeof value?.sessionId === "string" && value.sessionId ? value : null;
  } catch {
    return null;
  }
}

// Tab-scoped UX provenance only: no passwords, access/refresh tokens or keys.
// A stored identity never grants API permissions. Each use verifies the JWT
// and the user through Supabase; application authorization remains unchanged.
let recoverySession = readRecoveryIdentity();
let recoveryCallback = readRecoveryCallback();
let recoveryGeneration = 0;
let recoveryCancellation = 0;
let pendingCallback: { kind: CallbackKind; digest: string; generation: number } | null = null;
let callbackRunning = false;

function rememberRecoveryIdentity(identity: RecoveryIdentity | null) {
  recoverySession = identity;
  try {
    if (identity) window.sessionStorage.setItem(recoveryStorageKey, JSON.stringify(identity));
    else window.sessionStorage.removeItem(recoveryStorageKey);
  } catch {
    // Storage-disabled browsers retain the guard for this page lifetime.
  }
}

function clearRecoveryProvenance() {
  recoveryGeneration++;
  pendingCallback = null;
  rememberRecoveryIdentity(null);
  recoveryCallback = null;
  try { window.sessionStorage.removeItem(callbackStorageKey); } catch { /* Tab storage may be disabled. */ }
}

export function clearPasswordRecoverySession() {
  recoveryCancellation++;
  clearRecoveryProvenance();
}

function sameIdentity(a: RecoveryIdentity | null, b: RecoveryIdentity | null) {
  return Boolean(a && b && a.userId === b.userId && a.sessionId === b.sessionId);
}

function claimsFromSession(session: Session | null) {
  try {
    const encoded = session!.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(encoded));
    return claims.sub === session?.user.id && typeof claims.session_id === "string" && claims.session_id
      ? claims : null;
  } catch {
    return null;
  }
}

function identityFromSession(session: Session | null): RecoveryIdentity | null {
  const claims = claimsFromSession(session);
  return claims ? { userId: claims.sub, sessionId: claims.session_id } : null;
}

function hasMethod(claims: unknown, method: string) {
  const amr = claims && typeof claims === "object" && "amr" in claims ? claims.amr : null;
  return Array.isArray(amr)
    && amr.some((entry: { method?: unknown } | null) => entry?.method === method);
}

function recordRecoveryEvent(session: Session | null) {
  const identity = identityFromSession(session);
  rememberRecoveryIdentity(identity);
  if (!identity || !pendingCallback || pendingCallback.generation !== recoveryGeneration) return;
  recoveryCallback = { ...identity, kind: pendingCallback.kind, digest: pendingCallback.digest };
  try { window.sessionStorage.setItem(callbackStorageKey, JSON.stringify(recoveryCallback)); } catch { /* Memory guard remains active. */ }
}

// Do not call Auth methods inside this listener (the SDK holds its auth lock).
// Decoding here only correlates a public SDK event; it never validates a JWT.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY"
    || (event === "SIGNED_IN" && pendingCallback?.kind === "code"
      && hasMethod(claimsFromSession(session), "recovery"))) {
    // Record consumption before delayed JWT/user checks, so reload does not
    // replay a used callback. This receipt is never a validation result.
    recordRecoveryEvent(session);
  } else if (event === "SIGNED_OUT" || event === "USER_UPDATED") {
    clearPasswordRecoverySession();
  } else if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED")
    && !sameIdentity(recoverySession, identityFromSession(session))) {
    clearRecoveryProvenance();
  }
});

async function callbackDigest(kind: CallbackKind, value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}:${value}`));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function withRecoveryCallback(kind: CallbackKind, value: string, run: () => Promise<void>) {
  // Lock before any await. SDK serialization does not protect our pending
  // digest; rejecting another helper must not invalidate the active callback.
  if (callbackRunning) throw new Error("Проверка ссылки восстановления уже выполняется. Дождитесь завершения.");
  callbackRunning = true;
  const cancellation = recoveryCancellation;
  try {
    // Restore notifications must finish before arming this exchange's receipt.
    await supabase.auth.initialize();
    const generation = recoveryGeneration;
    const digest = await callbackDigest(kind, value);
    if (cancellation !== recoveryCancellation || generation !== recoveryGeneration) {
      throw new Error("Сессия восстановления изменилась. Запросите новую ссылку.");
    }
    pendingCallback = { kind, digest, generation };
    await run();
    if (generation !== recoveryGeneration) throw new Error("Сессия восстановления изменилась. Запросите новую ссылку.");
  } catch (error) {
    clearPasswordRecoverySession();
    throw error;
  } finally {
    pendingCallback = null;
    callbackRunning = false;
  }
}

export async function exchangePasswordRecoveryCode(code: string): Promise<void> {
  await withRecoveryCallback("code", code, async () => {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    if (!data.session) throw new Error("Сессия восстановления отсутствует. Запросите новую ссылку.");
    // Public getClaims verifies the exact JWT. PKCE recovery intent comes from
    // signed AMR; the early decoded event is only reload bookkeeping.
    const { data: verified, error: claimsError } = await supabase.auth.getClaims(data.session.access_token);
    if (claimsError) throw claimsError;
    const claims = verified?.claims;
    if (!claims || claims.sub !== data.session.user.id || !claims.session_id || !hasMethod(claims, "recovery")) {
      throw new Error("Это не ссылка восстановления пароля. Запросите новую ссылку.");
    }
    // A signout/update while validation was pending must not recreate proof.
    if (pendingCallback?.generation !== recoveryGeneration) throw new Error("Сессия восстановления изменилась.");
    rememberRecoveryIdentity({ userId: claims.sub, sessionId: claims.session_id });
  });
}

export async function verifyPasswordRecoveryToken(tokenHash: string): Promise<void> {
  await withRecoveryCallback("token_hash", tokenHash, async () => {
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (error) throw error;
  });
}

export async function resumePasswordRecoveryCallback(kind: CallbackKind, value: string): Promise<boolean> {
  const receipt = recoveryCallback;
  if (!receipt || receipt.kind !== kind || receipt.digest !== await callbackDigest(kind, value)) return false;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session || !sameIdentity(receipt, identityFromSession(data.session))) return false;
  if (!await isPasswordRecoverySession(data.session)) return false;
  // An OTP marker cannot resume a PKCE callback without signed recovery AMR.
  if (kind === "code") {
    const { data: verified, error: claimsError } = await supabase.auth.getClaims(data.session.access_token);
    if (claimsError || !hasMethod(verified?.claims, "recovery")) return false;
  }
  return recoveryCallback === receipt && sameIdentity(recoverySession, receipt);
}

export async function isPasswordRecoverySession(session: Session | null): Promise<boolean> {
  if (!session) return false;
  try {
    // Initialization may restore/refresh a session or schedule PASSWORD_RECOVERY.
    await supabase.auth.initialize();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const { data, error } = await supabase.auth.getClaims(session.access_token);
    if (error || !data || data.claims.sub !== session.user.id || !data.claims.session_id
      || (!hasMethod(data.claims, "recovery") && !hasMethod(data.claims, "otp"))) return false;
    const identity = { userId: data.claims.sub, sessionId: data.claims.session_id };
    if (!sameIdentity(recoverySession, identity)) return false;
    const { data: userData, error: userError } = await supabase.auth.getUser(session.access_token);
    if (userError || userData.user?.id !== identity.userId) return false;
    const { data: current, error: currentError } = await supabase.auth.getSession();
    return !currentError && current.session?.access_token === session.access_token
      && sameIdentity(recoverySession, identity);
  } catch {
    // getClaims in the pinned SDK throws for expiry and malformed tokens.
    return false;
  }
}
