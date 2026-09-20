/** Deduplicate simultaneous reads only. Settled data is never cached on the server. */
export function createInFlightRead<T>(maxEntries = 32, maxJoinAgeMs = 5_000) {
  const reads = new Map<string, { startedAt: number; promise: Promise<T> }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const existing = reads.get(key);
    if (existing && Date.now() - existing.startedAt < maxJoinAgeMs) return existing.promise;
    if (!existing && reads.size >= maxEntries) return load();
    const entry = { startedAt: Date.now(), promise: Promise.resolve().then(load) };
    reads.set(key, entry);
    const remove = () => { if (reads.get(key) === entry) reads.delete(key); };
    void entry.promise.then(remove, remove);
    return entry.promise;
  };
}
