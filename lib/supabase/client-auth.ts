import { supabase } from "@/lib/supabase/client";

const RETRY_DELAYS_MS = [0, 120, 260, 420, 800] as const;

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
        const refreshed = await supabase.auth.refreshSession().catch(() => null);
        const refreshedToken = refreshed?.data?.session?.access_token;
        if (refreshedToken) {
          return refreshedToken;
        }
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
