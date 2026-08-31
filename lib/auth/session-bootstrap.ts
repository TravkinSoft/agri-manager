export const AUTH_BOOT_MAX_ATTEMPTS = 2;
export const AUTH_BOOT_RETRY_DELAY_MS = 250;

export function isConfirmedInvalidSessionError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const candidate = error as { name?: unknown; status?: unknown; code?: unknown; message?: unknown };
  const name = String(candidate.name || "");
  const status = Number(candidate.status || 0);
  const code = String(candidate.code || "").toLowerCase();
  const message = String(candidate.message || "").toLowerCase();

  return (
    name === "AuthSessionMissingError" ||
    status === 401 ||
    status === 403 ||
    code.includes("refresh_token_not_found") ||
    /invalid refresh token|refresh token not found|session missing|invalid jwt|jwt expired/.test(message)
  );
}

type SessionLookupResult = { error?: unknown };
type Wait = (milliseconds: number) => Promise<void>;

const defaultWait: Wait = (milliseconds) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

export async function getSessionWithBoundedRetry<T extends SessionLookupResult>(
  getSession: () => Promise<T>,
  options: {
    attempts?: number;
    retryDelayMs?: number;
    wait?: Wait;
  } = {},
) {
  const attempts = options.attempts ?? AUTH_BOOT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? AUTH_BOOT_RETRY_DELAY_MS;
  const wait = options.wait ?? defaultWait;
  let lastTransientError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await getSession();
      if (!result.error || isConfirmedInvalidSessionError(result.error)) return result;
      lastTransientError = result.error;
    } catch (error) {
      if (isConfirmedInvalidSessionError(error)) throw error;
      lastTransientError = error;
    }

    if (attempt + 1 < attempts) {
      await wait(retryDelayMs);
    }
  }

  throw (lastTransientError instanceof Error ? lastTransientError : new Error("Supabase session temporarily unavailable"));
}
