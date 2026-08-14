import type {
  NormalizedWeather,
  WeatherLocation,
  WeatherPoint,
  WeatherProviderMeta,
  WeatherSun,
} from "@/lib/weather/types";
import { WeatherProviderError } from "@/lib/weather/types";
import { roundMetric } from "@/lib/weather/units";

type UnknownRecord = Record<string, unknown>;
type ProviderHeaders = { rateLimit: Record<string, string> | null };

const DEFAULT_PROVIDER_URL = "https://www.uavforecast.com/api/v1/forecast";
export const UAV_FORECAST_HOURS = 48;
export const UAV_WIND_ALTITUDES_M = [10, 100, 200] as const;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoTime(value: unknown): string | null {
  const source = record(value);
  const utc = text(source.utc);
  if (!utc || Number.isNaN(Date.parse(utc))) return null;
  return new Date(utc).toISOString();
}

function utcOffsetMinutes(value: unknown): number | null {
  const local = text(record(value).local);
  if (!local) return null;
  const match = local.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) return local.endsWith("Z") ? 0 : null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

function dewPointCelsius(temperatureC: number | null, humidityPct: number | null): number | null {
  if (temperatureC == null || humidityPct == null || humidityPct <= 0 || humidityPct > 100) return null;
  const a = 17.625;
  const b = 243.04;
  const gamma = Math.log(humidityPct / 100) + (a * temperatureC) / (b + temperatureC);
  return roundMetric((b * gamma) / (a - gamma), 1);
}

function surfaceWind(value: unknown): UnknownRecord {
  const profile = Array.isArray(value) ? value.map(record) : [];
  return profile.find((item) => finite(item.altitude_m) === 10)
    || profile.find((item) => item.altitude_m == null)
    || profile[0]
    || {};
}

function satelliteTotals(value: unknown): { visible: number | null; locked: number | null } {
  const constellations = Object.values(record(value)).map(record);
  const visibleValues = constellations.map((item) => finite(item.count)).filter((item): item is number => item != null);
  const lockedValues = constellations.map((item) => finite(item.kp_count)).filter((item): item is number => item != null);
  return {
    visible: visibleValues.length ? roundMetric(visibleValues.reduce((sum, item) => sum + item, 0), 0) : null,
    locked: lockedValues.length ? roundMetric(lockedValues.reduce((sum, item) => sum + item, 0), 1) : null,
  };
}

function parsePoint(value: unknown): WeatherPoint | null {
  const row = record(value);
  const time = isoTime(row.time);
  if (!time) return null;
  const wind = surfaceWind(row.wind_profile);
  const temperatureC = finite(row.temp_c);
  const humidityPct = finite(row.humidity_pct);
  const satellites = satelliteTotals(row.sats);

  return {
    time,
    temperatureC,
    dewPointC: dewPointCelsius(temperatureC, humidityPct),
    windMs: finite(wind.wind_speed_ms),
    windBearingDeg: finite(wind.wind_bearing_deg),
    gustMs: finite(wind.gust_speed_ms),
    gustBearingDeg: finite(wind.gust_bearing_deg),
    precipitationProbabilityPct: finite(row.precip_prob_pct),
    precipitationRateMmH: finite(row.precip_intensity_mmh),
    precipitationType: text(row.precip_type),
    cloudCoverPct: finite(row.cloud_cover_pct),
    cloudBaseM: finite(row.cloudbase_m),
    visibilityKm: finite(row.visibility_m) == null ? null : roundMetric(finite(row.visibility_m)! / 1000, 1),
    humidityPct,
    densityAltitudeM: finite(row.density_altitude_m),
    pressureMslHpa: finite(row.pressure_msl_hpa),
    visibleSatellites: satellites.visible,
    kp: finite(row.kp),
    estimatedSatellitesLocked: satellites.locked,
  };
}

function parseSun(days: unknown[]): WeatherSun[] {
  const uniqueDays = new Map<string, WeatherSun>();
  for (const value of days) {
    const day = record(value);
    const date = text(day.date);
    if (!date) continue;
    const parsed = {
      date,
      sunrise: isoTime(day.sunrise),
      solarNoon: isoTime(day.solar_noon),
      sunset: isoTime(day.sunset),
    };
    const signature = `${parsed.date}|${parsed.sunrise || ""}|${parsed.solarNoon || ""}|${parsed.sunset || ""}`;
    if (!uniqueDays.has(signature)) uniqueDays.set(signature, parsed);
  }
  return Array.from(uniqueDays.values());
}

function commercialHeaders(headers: Headers): ProviderHeaders {
  const rateLimit: Record<string, string> = {};
  headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (normalized.includes("rate") || normalized.includes("limit") || normalized.includes("quota")) {
      rateLimit[key] = value;
    }
  });
  return { rateLimit: Object.keys(rateLimit).length ? rateLimit : null };
}

function billing(value: unknown): Record<string, string> | null {
  const cost = record(value);
  const amount = finite(cost.amount);
  const currency = text(cost.currency);
  if (amount == null && !currency) return null;
  return {
    ...(amount == null ? {} : { amount: String(amount) }),
    ...(currency ? { currency } : {}),
  };
}

export function normalizeUavForecastResponse(params: {
  raw: unknown;
  location: WeatherLocation;
  requestStartedAt: string;
  responseReceivedAt: string;
  responseTimeMs: number;
  headers?: ProviderHeaders;
}): NormalizedWeather {
  const raw = record(params.raw);
  if (!Object.keys(raw).length || raw.cost_only === true) {
    throw new WeatherProviderError("INVALID_PROVIDER_RESPONSE", "UAV Forecast вернул ответ без прогноза", 502, "Missing forecast payload");
  }

  const current = parsePoint(raw.current);
  if (!current) {
    throw new WeatherProviderError("INVALID_PROVIDER_RESPONSE", "UAV Forecast вернул некорректные текущие условия", 502, "Missing current.time.utc");
  }

  const days = Array.isArray(raw.days) ? raw.days : [];
  const hourly = days
    .flatMap((value) => {
      const rows = record(value).rows;
      return Array.isArray(rows) ? rows : [];
    })
    .map(parsePoint)
    .filter((item): item is WeatherPoint => item != null)
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));

  const timezone = text(raw.timezone);
  const meta: WeatherProviderMeta = {
    provider: "UAV Forecast",
    schemaVersion: "official-v1",
    timezone,
    utcOffsetMinutes: utcOffsetMinutes(record(raw.current).time),
    units: {
      temperature: "°C",
      wind: "m/s",
      precipitationRate: "mm/h",
      visibility: "m",
      altitude: "m",
      pressure: "hPa",
    },
    forecastPoints: hourly.length,
    availableUntil: hourly.at(-1)?.time || null,
    requestStartedAt: params.requestStartedAt,
    responseReceivedAt: params.responseReceivedAt,
    responseTimeMs: roundMetric(params.responseTimeMs, 0),
    cache: "miss",
    rateLimit: params.headers?.rateLimit || null,
    billing: billing(raw.cost),
    forecastHours: UAV_FORECAST_HOURS,
    windAltitudesM: [...UAV_WIND_ALTITUDES_M],
  };

  return {
    location: {
      ...params.location,
      latitude: finite(raw.lat) ?? params.location.latitude,
      longitude: finite(raw.lon) ?? params.location.longitude,
    },
    current,
    hourlyForecast: hourly,
    sun: parseSun(days),
    providerMeta: meta,
    rawCapabilities: [
      "cloudbase_m", "density_altitude_m", "humidity_pct", "kp", "precip_intensity_mmh",
      "precip_prob_pct", "pressure_msl_hpa", "satellite constellations", "visibility_m", "wind_profile",
    ],
    updatedAt: params.responseReceivedAt,
    stale: false,
  };
}

function safeTechnicalResponse(status: number, body: string): string {
  const withoutSecrets = body
    .replace(/(api[_-]?key|authorization|token)["']?\s*[:=]\s*["']?[^\s,"'}]+/gi, "$1=[REDACTED]")
    .slice(0, 500);
  return `Provider HTTP ${status}${withoutSecrets ? `: ${withoutSecrets}` : ""}`;
}

async function requestProvider(url: URL, key: string, body: string): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "User-Agent": "TravkinFlow-Weather-Lab/1.0",
        },
        body,
        signal: controller.signal,
        cache: "no-store",
      });
      if (response.status < 500 || attempt === 1) return response;
    } catch (error) {
      lastError = error;
      if (attempt === 1) break;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if ((lastError as Error)?.name === "AbortError") {
    throw new WeatherProviderError("TIMEOUT", "UAV Forecast не ответил вовремя", 504, "Provider timeout after 10000 ms");
  }
  throw new WeatherProviderError("NETWORK_UNAVAILABLE", "Нет связи с UAV Forecast", 503, String((lastError as Error)?.message || lastError || "Network request failed"));
}

export async function fetchUavForecast(location: WeatherLocation): Promise<NormalizedWeather> {
  const key = String(process.env.UAV_FORECAST_API_KEY || "").trim();
  if (!key) {
    throw new WeatherProviderError("NOT_CONFIGURED", "UAV Forecast API key пока не настроен", 503, "UAV_FORECAST_API_KEY is missing");
  }

  const url = new URL(String(process.env.UAV_FORECAST_API_URL || DEFAULT_PROVIDER_URL).trim());
  const payload = JSON.stringify({
    lat: location.latitude,
    lon: location.longitude,
    forecast_hours: UAV_FORECAST_HOURS,
    wind_altitudes_m: [...UAV_WIND_ALTITUDES_M],
    use_realtime_precip: true,
    include_gps: true,
    include_glonass: true,
    include_galileo: true,
    include_beidou: true,
    gps_elevation_mask: 10,
    kp_source: "auto",
  });
  const requestStartedAt = new Date().toISOString();
  const started = Date.now();
  const response = await requestProvider(url, key, payload);
  const responseReceivedAt = new Date().toISOString();

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const details = safeTechnicalResponse(response.status, body);
    if (response.status === 401 || response.status === 403) throw new WeatherProviderError("AUTH_INVALID", "UAV Forecast отклонил API key", 502, details);
    if (response.status === 402) throw new WeatherProviderError("BALANCE_EXHAUSTED", "Баланс UAV Forecast закончился", 502, details);
    if (response.status === 429) throw new WeatherProviderError("RATE_LIMITED", "UAV Forecast временно ограничил запросы", 429, details);
    throw new WeatherProviderError("PROVIDER_UNAVAILABLE", "UAV Forecast сейчас недоступен", 502, details);
  }

  const raw = await response.json().catch(() => {
    throw new WeatherProviderError("INVALID_PROVIDER_RESPONSE", "UAV Forecast вернул некорректный ответ", 502, "Response is not valid JSON");
  });
  return normalizeUavForecastResponse({
    raw,
    location,
    requestStartedAt,
    responseReceivedAt,
    responseTimeMs: Date.now() - started,
    headers: commercialHeaders(response.headers),
  });
}
