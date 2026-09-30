type CacheEntry<T> = {
  value: T;
  confirmedAt: number;
  expiresAt: number;
};

const globalState = globalThis as typeof globalThis & {
  __travkinWeatherCache?: Map<string, CacheEntry<unknown>>;
  __travkinWeatherInflight?: Map<string, Promise<unknown>>;
  __travkinWeatherRefreshGate?: Map<string, number>;
};

const cache = globalState.__travkinWeatherCache || new Map<string, CacheEntry<unknown>>();
const inflight = globalState.__travkinWeatherInflight || new Map<string, Promise<unknown>>();
const refreshGate = globalState.__travkinWeatherRefreshGate || new Map<string, number>();

globalState.__travkinWeatherCache = cache;
globalState.__travkinWeatherInflight = inflight;
globalState.__travkinWeatherRefreshGate = refreshGate;

export const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
export const WEATHER_MANUAL_REFRESH_COOLDOWN_MS = 15 * 1000;

export function weatherCacheKey(latitude: number, longitude: number, units = "metric"): string {
  return `uav-forecast:${latitude.toFixed(3)}:${longitude.toFixed(3)}:${units}`;
}

export function getWeatherCache<T>(key: string): { value: T; confirmedAt: number; fresh: boolean } | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  return {
    value: entry.value,
    confirmedAt: entry.confirmedAt,
    fresh: Date.now() < entry.expiresAt,
  };
}

export function setWeatherCache<T>(key: string, value: T, now = Date.now()): void {
  cache.set(key, { value, confirmedAt: now, expiresAt: now + WEATHER_CACHE_TTL_MS });
}

export function canForceRefresh(key: string, now = Date.now()): boolean {
  const lastRefresh = refreshGate.get(key) || 0;
  if (now - lastRefresh < WEATHER_MANUAL_REFRESH_COOLDOWN_MS) return false;
  refreshGate.set(key, now);
  return true;
}

export async function dedupeWeatherRequest<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const request = loader().finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

export function clearWeatherCacheForTests(): void {
  cache.clear();
  inflight.clear();
  refreshGate.clear();
}
