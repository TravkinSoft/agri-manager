"use client";

const CHANNEL = "travkinflow.traffic.changed.v1";
const listeners = new Set<(companyId: string) => void>();
let channel: BroadcastChannel | null = null;

/** Only an invalidation hint. Every receiver rereads its own authorized snapshot. */
export function subscribeTrafficChanges(listener: (companyId: string) => void): () => void {
  listeners.add(listener);
  try {
    if (!channel && typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = event => {
        const companyId: unknown = event.data?.companyId;
        if (typeof companyId !== "string" || !companyId || companyId.length > 64) return;
        listeners.forEach(receive => { try { receive(companyId); } catch { /* Independent subscribers. */ } });
      };
    }
  } catch { /* Normal background refresh remains available. */ }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { channel?.close(); channel = null; }
  };
}

/** Call only after a validated server commit, never for optimistic UI intent. */
export function publishTrafficChanged(companyId: string | undefined): void {
  if (!companyId) return;
  try { channel?.postMessage({ companyId }); } catch { /* A delivered action must not become a false failure. */ }
}
