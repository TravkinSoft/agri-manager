import { supabase } from "@/lib/supabase/client";

const RETRY_DELAYS_MS = [0, 120, 260, 420, 800] as const;
const INVALID_OR_EXPIRED_SESSION_MESSAGE = "Invalid or expired session token";

let refreshInFlight: Promise<string> | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveClientAccessToken(): Promise<string> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay > 0) {
      await sleep(delay);
    }

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (token) {
        return token;
      }

      // Force a refresh on early attempts: hydration races are common right after page load.
      if (attempt <= 2) {
        const refreshedToken = await refreshClientAccessToken().catch(() => null);
        if (refreshedToken) return refreshedToken;
      }
    } catch (error) {
      lastError = error;
    }
  }

  const details =
    lastError instanceof Error && lastError.message
      ? `: ${lastError.message}`
      : "";
  throw new Error(`Missing authorization token${details}`);
}

export async function refreshClientAccessToken(rejectedAccessToken?: string): Promise<string> {
  if (rejectedAccessToken) {
    const current = await supabase.auth.getSession().catch(() => null);
    const currentToken = current?.data?.session?.access_token;
    if (currentToken && currentToken !== rejectedAccessToken) {
      return currentToken;
    }
  }

  if (refreshInFlight) return refreshInFlight;

  const refreshOperation = (async () => {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) throw refreshed.error;

    const token = refreshed.data.session?.access_token;
    if (!token) throw new Error("Missing authorization token after refresh");
    return token;
  })();
  refreshInFlight = refreshOperation;

  try {
    return await refreshOperation;
  } finally {
    if (refreshInFlight === refreshOperation) refreshInFlight = null;
  }
}

async function isInvalidOrExpiredSessionResponse(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  const payload = await response.clone().json().catch(() => null);
  return payload?.error === INVALID_OR_EXPIRED_SESSION_MESSAGE;
}

export async function fetchWithClientAuth(
  input: RequestInfo | URL,
  init: RequestInit = {},
  contentType: "json" | "none" = "none",
): Promise<Response> {
  const rejectedToken = await resolveClientAccessToken();

  const send = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (contentType === "json" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(input, { ...init, headers });
  };

  const firstResponse = await send(rejectedToken);
  if (!(await isInvalidOrExpiredSessionResponse(firstResponse))) {
    return firstResponse;
  }
  if (init.signal?.aborted) return firstResponse;

  const refreshedToken = await refreshClientAccessToken(rejectedToken).catch(() => null);
  if (!refreshedToken || init.signal?.aborted) return firstResponse;

  return send(refreshedToken);
}

export async function buildClientAuthHeaders(contentType: "json" | "none" = "none"): Promise<Record<string, string>> {
  const token = await resolveClientAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (contentType === "json") {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}
