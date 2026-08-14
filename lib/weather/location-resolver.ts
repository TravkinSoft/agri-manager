import { getKatoLocality, katoNamesEquivalent } from "@/lib/weather/kato-catalog";
import type { KatoLocality } from "@/lib/weather/kato-catalog";
import type { LocationResolverResult } from "@/lib/weather/types";
import { WeatherProviderError } from "@/lib/weather/types";

type NominatimAddress = Record<string, string | undefined>;
type NominatimRow = {
  lat?: string;
  lon?: string;
  display_name?: string;
  type?: string;
  addresstype?: string;
  address?: NominatimAddress;
};

type OpenMeteoGeocodingRow = {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  country_code?: string;
};

const globalState = globalThis as typeof globalThis & {
  __travkinLocationCache?: Map<string, { value: LocationResolverResult; expiresAt: number }>;
  __travkinNominatimQueue?: Promise<void>;
  __travkinNominatimLastCall?: number;
};

const cache = globalState.__travkinLocationCache || new Map<string, { value: LocationResolverResult; expiresAt: number }>();
globalState.__travkinLocationCache = cache;

const LOCATION_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NOMINATIM_MIN_INTERVAL_MS = 1_100;
const ALLOWED_PLACE_TYPES = new Set([
  "city", "town", "village", "hamlet", "municipality", "administrative", "state", "county", "district",
]);

function cacheKey(parts: Array<string | number>): string {
  return parts.map((part) => String(part).trim().toLowerCase()).join("|");
}

function cached(key: string): LocationResolverResult | null {
  const entry = cache.get(key);
  if (!entry || Date.now() >= entry.expiresAt) return null;
  return entry.value;
}

function setCached(key: string, value: LocationResolverResult): LocationResolverResult {
  cache.set(key, { value, expiresAt: Date.now() + LOCATION_CACHE_TTL_MS });
  return value;
}

async function waitForNominatimSlot(): Promise<void> {
  const previous = globalState.__travkinNominatimQueue || Promise.resolve();
  let release: () => void = () => undefined;
  const next = new Promise<void>((resolve) => { release = resolve; });
  globalState.__travkinNominatimQueue = previous.then(() => next);
  await previous;
  const elapsed = Date.now() - (globalState.__travkinNominatimLastCall || 0);
  if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS - elapsed));
  }
  globalState.__travkinNominatimLastCall = Date.now();
  release();
}

async function fetchJson(url: URL, service: "Nominatim" | "Open-Meteo", rateLimited = false): Promise<unknown> {
  if (rateLimited) await waitForNominatimSlot();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "ru,kk;q=0.9,en;q=0.5",
        "User-Agent": "TravkinFlow-Weather-Lab/1.0 (https://travkinflow.com)",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${service} HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new WeatherProviderError("TIMEOUT", "Сервис координат не ответил вовремя", 504, `${service} timeout after 8000 ms`);
    }
    throw new WeatherProviderError("NETWORK_UNAVAILABLE", "Не удалось связаться с сервисом координат", 503, String((error as Error)?.message || error));
  } finally {
    clearTimeout(timeout);
  }
}

function localityFromAddress(address: NominatimAddress): string | null {
  return address.village || address.town || address.city || address.municipality || address.hamlet || null;
}

function districtFromAddress(address: NominatimAddress): string | null {
  return address.district || address.county || address.city_district || address.municipality || null;
}

function regionFromAddress(address: NominatimAddress): string | null {
  return address.state || address.region || null;
}

function coordinates(row: NominatimRow): { latitude: number; longitude: number } | null {
  const latitude = Number(row.lat);
  const longitude = Number(row.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (String(row.address?.country_code || "").toLowerCase() !== "kz") return null;
  return { latitude, longitude };
}

function rowMatchesKato(row: NominatimRow, locality: KatoLocality): boolean {
  const address = row.address || {};
  const actualLocality = localityFromAddress(address) || row.display_name || "";
  return (
    (katoNamesEquivalent(actualLocality, locality.nameRu) || katoNamesEquivalent(actualLocality, locality.nameKz)) &&
    (katoNamesEquivalent(districtFromAddress(address), locality.districtRu) || katoNamesEquivalent(districtFromAddress(address), locality.districtKz)) &&
    (katoNamesEquivalent(regionFromAddress(address), locality.regionRu) || katoNamesEquivalent(regionFromAddress(address), locality.regionKz))
  );
}

function katoResult(locality: KatoLocality, latitude: number, longitude: number, provider: LocationResolverResult["provider"]): LocationResolverResult {
  return {
    latitude,
    longitude,
    region: locality.regionRu,
    district: locality.districtRu,
    locality: locality.nameRu,
    displayName: [locality.nameRu, locality.districtRu, locality.regionRu].join(" · "),
    katoCode: locality.code,
    provider,
  };
}

async function searchNominatim(locality: KatoLocality): Promise<LocationResolverResult | null> {
  for (const name of [locality.nameRu, locality.nameKz]) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", [name, locality.districtRu, locality.regionRu, "Казахстан"].join(", "));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "kz");
    url.searchParams.set("limit", "10");
    const response = await fetchJson(url, "Nominatim", true);
    const rows = Array.isArray(response) ? response as NominatimRow[] : [];
    const selected = rows.find((row) => {
      const type = String(row.addresstype || row.type || "").toLowerCase();
      return ALLOWED_PLACE_TYPES.has(type) && rowMatchesKato(row, locality) && Boolean(coordinates(row));
    });
    const point = selected ? coordinates(selected) : null;
    if (point) return katoResult(locality, point.latitude, point.longitude, "KATO + OpenStreetMap Nominatim");
  }
  return null;
}

async function geocodingCandidates(locality: KatoLocality): Promise<OpenMeteoGeocodingRow[]> {
  const found = new Map<string, OpenMeteoGeocodingRow>();
  for (const name of [locality.nameRu, locality.nameKz]) {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", name);
    url.searchParams.set("count", "100");
    url.searchParams.set("language", "ru");
    url.searchParams.set("format", "json");
    url.searchParams.set("countryCode", "KZ");
    const response = await fetchJson(url, "Open-Meteo");
    const rows = Array.isArray((response as { results?: unknown[] })?.results)
      ? (response as { results: OpenMeteoGeocodingRow[] }).results
      : [];
    for (const row of rows) {
      if (
        String(row.country_code || "").toUpperCase() === "KZ" &&
        (katoNamesEquivalent(row.name, locality.nameRu) || katoNamesEquivalent(row.name, locality.nameKz)) &&
        Number.isFinite(Number(row.latitude)) &&
        Number.isFinite(Number(row.longitude))
      ) {
        found.set(`${Number(row.latitude).toFixed(5)}:${Number(row.longitude).toFixed(5)}`, row);
      }
    }
  }
  return Array.from(found.values());
}

async function reverseNominatim(latitude: number, longitude: number): Promise<NominatimRow> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "13");
  url.searchParams.set("layer", "address");
  return await fetchJson(url, "Nominatim", true) as NominatimRow;
}

async function searchOpenMeteo(locality: KatoLocality): Promise<LocationResolverResult | null> {
  const candidates = await geocodingCandidates(locality);
  for (const candidate of candidates) {
    const latitude = Number(candidate.latitude);
    const longitude = Number(candidate.longitude);
    const reverse = await reverseNominatim(latitude, longitude);
    const address = reverse.address || {};
    const districtMatches = katoNamesEquivalent(districtFromAddress(address), locality.districtRu) || katoNamesEquivalent(districtFromAddress(address), locality.districtKz);
    const regionMatches = katoNamesEquivalent(regionFromAddress(address), locality.regionRu) || katoNamesEquivalent(regionFromAddress(address), locality.regionKz);
    if (districtMatches && regionMatches) {
      return katoResult(locality, latitude, longitude, "KATO + Open-Meteo/OSM resolver");
    }
  }
  return null;
}

export async function resolveKatoLocation(katoCode: string): Promise<LocationResolverResult> {
  const locality = getKatoLocality(katoCode);
  if (!locality) throw new WeatherProviderError("LOCATION_NOT_FOUND", "Объект КАТО не найден", 404, `Unknown KATO code: ${katoCode}`);
  const key = cacheKey(["kato", locality.code]);
  const hit = cached(key);
  if (hit) return hit;

  const selected = await searchNominatim(locality) || await searchOpenMeteo(locality);
  if (!selected) {
    throw new WeatherProviderError(
      "LOCATION_NOT_FOUND",
      `Не удалось точно определить координаты: ${locality.nameRu} · ${locality.districtRu} · ${locality.regionRu}`,
      404,
      `No exact coordinate match for KATO ${locality.code}`
    );
  }
  return setCached(key, selected);
}

export async function reverseKazakhstanLocation(latitude: number, longitude: number): Promise<LocationResolverResult> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new WeatherProviderError("LOCATION_NOT_FOUND", "Некорректные координаты геолокации", 400);
  }
  const key = cacheKey(["reverse", latitude.toFixed(4), longitude.toFixed(4)]);
  const hit = cached(key);
  if (hit) return hit;
  const row = await reverseNominatim(latitude, longitude);
  const address = row.address || {};
  if (String(address.country_code || "").toLowerCase() !== "kz") {
    throw new WeatherProviderError("LOCATION_NOT_FOUND", "Местоположение вне Казахстана или не найдено", 404);
  }
  const locality = localityFromAddress(address);
  const district = districtFromAddress(address);
  const region = regionFromAddress(address);
  const displayParts = [locality, district, region].filter((value, index, values) => value && values.indexOf(value) === index);
  return setCached(key, {
    latitude,
    longitude,
    region,
    district,
    locality,
    displayName: displayParts.length ? displayParts.join(" · ") : String(row.display_name || "Казахстан"),
    katoCode: null,
    provider: "Device geolocation + OpenStreetMap Nominatim",
  });
}

export function clearLocationResolverCacheForTests(): void {
  cache.clear();
}
