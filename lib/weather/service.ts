import {
  canForceRefresh,
  dedupeWeatherRequest,
  getWeatherCache,
  setWeatherCache,
  weatherCacheKey,
} from "@/lib/weather/cache";
import { fetchUavForecast } from "@/lib/weather/uav-forecast";
import type { NormalizedWeather, WeatherLocation } from "@/lib/weather/types";
import { WeatherProviderError } from "@/lib/weather/types";

function withCacheState(value: NormalizedWeather, cache: "hit" | "miss" | "stale", stale: boolean): NormalizedWeather {
  return {
    ...value,
    stale,
    providerMeta: { ...value.providerMeta, cache },
  };
}

export async function getWeatherForLocation(params: {
  location: WeatherLocation;
  forceRefresh?: boolean;
}): Promise<NormalizedWeather> {
  const key = weatherCacheKey(params.location.latitude, params.location.longitude);
  const existing = getWeatherCache<NormalizedWeather>(key);

  if (!params.forceRefresh && existing?.fresh) return withCacheState(existing.value, "hit", false);
  if (params.forceRefresh && !canForceRefresh(key)) {
    if (existing) return withCacheState(existing.value, existing.fresh ? "hit" : "stale", !existing.fresh);
    throw new WeatherProviderError("RATE_LIMITED", "Подождите несколько секунд перед повторным обновлением", 429, "Manual refresh cooldown");
  }

  try {
    return await dedupeWeatherRequest(key, async () => {
      const fresh = await fetchUavForecast(params.location);
      setWeatherCache(key, fresh);
      return withCacheState(fresh, "miss", false);
    });
  } catch (error) {
    if (existing) return withCacheState(existing.value, "stale", true);
    throw error;
  }
}
