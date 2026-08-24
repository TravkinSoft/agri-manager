type CacheEntry = {
  value?: unknown;
  expiresAt: number;
  request?: Promise<unknown>;
};

const entries = new Map<string, CacheEntry>();

export async function cachedClientValue<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = 60_000
): Promise<T> {
  const now = Date.now();
  const current = entries.get(key);
  if (current?.value !== undefined && current.expiresAt > now) {
    return current.value as T;
  }
  if (current?.request) return current.request as Promise<T>;

  const request = loader()
    .then((value) => {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .catch((error) => {
      entries.delete(key);
      throw error;
    });

  entries.set(key, {
    value: current?.value,
    expiresAt: current?.expiresAt || 0,
    request,
  });
  return request;
}

export function invalidateClientCache(prefix: string): void {
  for (const key of Array.from(entries.keys())) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

export function clearClientCache(): void {
  entries.clear();
}
