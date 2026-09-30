"use client";
import { useEffect } from "react";
import { fetchWithClientAuth } from "@/lib/supabase/client-auth";

/** Works in both ERP and standalone operator shells. The server owns identity,
 * tenant and permission checks. Telemetry never touches a working shift/PIN. */
export function OperatorPresenceSignal({ enabled, identityKey }: { enabled: boolean; identityKey: string }) {
  useEffect(() => {
    if (!enabled || !identityKey) return;
    let stopped = false, running = false, lastAttempt = 0, retryAfter = 0;
    let controller: AbortController | null = null;
    const beat = async () => {
      if (stopped || running || document.visibilityState !== "visible" || !navigator.onLine
        || Date.now() < retryAfter || Date.now() - lastAttempt < 15_000) return;
      running = true;
      lastAttempt = Date.now();
      const attempt = new AbortController();
      controller = attempt;
      const timeout = window.setTimeout(() => attempt.abort(), 8000);
      try {
        const response = await fetchWithClientAuth("/api/dashboard/presence", {
          method: "POST", credentials: "same-origin", cache: "no-store", signal: attempt.signal,
        });
        // A temporary expired session must not permanently disable presence.
        // Permission failures are still denied by the server; retry with backoff.
        retryAfter = response.status === 401 || response.status === 403 ? Date.now() + 60_000 : 0;
      } catch { /* A telemetry failure must never interrupt the operator. */ }
      finally { window.clearTimeout(timeout); running = false; }
    };
    void beat();
    const timer = window.setInterval(() => void beat(), 30_000);
    const wake = () => void beat();
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true; controller?.abort(); window.clearInterval(timer);
      window.removeEventListener("online", wake); window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [enabled, identityKey]);
  return null;
}
