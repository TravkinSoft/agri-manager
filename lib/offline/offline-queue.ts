export type OfflineQueueStatus = "pending" | "syncing" | "failed";

export interface OfflineQueueItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  description: string;
  url: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  authRequired?: boolean;
  attempts: number;
  status: OfflineQueueStatus;
  lastError?: string | null;
}

const STORAGE_KEY = "travkinflow:offline-queue:v1";
const CHANGE_EVENT = "travkin:offline-queue-changed";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = "offline") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emitQueueChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function readOfflineQueue(): OfflineQueueItem[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === "object" && typeof item.id === "string");
  } catch {
    return [];
  }
}

export function writeOfflineQueue(items: OfflineQueueItem[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  emitQueueChanged();
}

export function getOfflineQueueCount() {
  return readOfflineQueue().filter((item) => item.status !== "syncing").length;
}

export function enqueueOfflineRequest(input: {
  description: string;
  url: string;
  method: OfflineQueueItem["method"];
  headers?: Record<string, string>;
  body?: unknown;
  authRequired?: boolean;
  idempotencyKey?: string;
}) {
  const queue = readOfflineQueue();
  const existing = input.idempotencyKey
    ? queue.find((item) => item.headers?.["Idempotency-Key"] === input.idempotencyKey)
    : null;
  if (existing) return existing;

  const timestamp = nowIso();
  const item: OfflineQueueItem = {
    id: createId("queue"),
    createdAt: timestamp,
    updatedAt: timestamp,
    description: input.description,
    url: input.url,
    method: input.method,
    headers: input.headers,
    body: input.body,
    authRequired: input.authRequired ?? true,
    attempts: 0,
    status: "pending",
    lastError: null,
  };
  writeOfflineQueue([...queue, item]);
  return item;
}

export async function syncOfflineQueue(options: {
  getAuthHeaders?: () => Promise<Record<string, string>>;
  onItemSynced?: (item: OfflineQueueItem) => void;
}) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { synced: 0, failed: 0, remaining: getOfflineQueueCount() };
  }

  let queue = readOfflineQueue();
  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    if (item.status === "syncing") continue;

    const startedAt = nowIso();
    queue = readOfflineQueue().map((candidate) =>
      candidate.id === item.id ? { ...candidate, status: "syncing", updatedAt: startedAt } : candidate
    );
    writeOfflineQueue(queue);

    try {
      const authHeaders = item.authRequired && options.getAuthHeaders ? await options.getAuthHeaders() : {};
      const response = await fetch(item.url, {
        method: item.method,
        headers: {
          ...(item.headers || {}),
          ...authHeaders,
        },
        body: item.body == null ? undefined : JSON.stringify(item.body),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Sync failed with HTTP ${response.status}`);
      }

      queue = readOfflineQueue().filter((candidate) => candidate.id !== item.id);
      writeOfflineQueue(queue);
      synced += 1;
      options.onItemSynced?.(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      queue = readOfflineQueue().map((candidate) =>
        candidate.id === item.id
          ? {
              ...candidate,
              attempts: candidate.attempts + 1,
              status: "failed",
              updatedAt: nowIso(),
              lastError: message,
            }
          : candidate
      );
      writeOfflineQueue(queue);
      failed += 1;
      break;
    }
  }

  return { synced, failed, remaining: getOfflineQueueCount() };
}

export const offlineQueueEvents = {
  changed: CHANGE_EVENT,
};
