export type DashboardSnapshot<T> = { scope: string; data: T; savedAt: number };

/** Tab-memory only: never persist business data to disk or share it across logins. */
export function createDashboardSnapshotCache(ttlMs = 120_000, maxEntries = 12) {
  const entries = new Map<string, DashboardSnapshot<unknown>>();
  return {
    read<T>(key: string, scope: string, now = Date.now()): DashboardSnapshot<T> | null {
      const entry = entries.get(key);
      if (!entry || entry.scope !== scope) return null;
      if (now - entry.savedAt >= ttlMs) { entries.delete(key); return null; }
      return entry as DashboardSnapshot<T>;
    },
    write<T>(key: string, snapshot: DashboardSnapshot<T>) {
      entries.delete(key);
      entries.set(key, snapshot);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    },
    clear() { entries.clear(); },
  };
}

export const dashboardSnapshots = createDashboardSnapshotCache();
