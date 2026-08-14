import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  clearWeatherCacheForTests,
  dedupeWeatherRequest,
  getWeatherCache,
  setWeatherCache,
  weatherCacheKey,
} from "../lib/weather/cache";
import {
  getKatoLocality,
  getKatoRegions,
  getKatoSource,
  searchKatoLocalities,
} from "../lib/weather/kato-catalog";
import { clearLocationResolverCacheForTests, resolveKatoLocation } from "../lib/weather/location-resolver";
import { formatWeatherTime, relativeWeatherAge } from "../lib/weather/time";
import { normalizeUavForecastResponse } from "../lib/weather/uav-forecast";
import { normalizePercentage, roundMetric } from "../lib/weather/units";

async function main() {
  const root = resolve(__dirname, "..");
  const checks: string[] = [];
  const check = (name: string, fn: () => void) => { fn(); checks.push(name); };

  check("fraction probability converts to percent", () => assert.equal(normalizePercentage(0.35), 35));
  check("zero probability stays zero", () => assert.equal(normalizePercentage(0), 0));
  check("null probability stays null", () => assert.equal(normalizePercentage(null), null));
  check("metric rounding is deterministic", () => assert.equal(roundMetric(1.234, 2), 1.23));
  check("KATO source is official Kazakhstan statistics", () => assert.match(getKatoSource().authority, /Бюро национальной статистики/));
  check("KATO source edition is pinned", () => assert.equal(getKatoSource().publishedAt, "2026-07-17"));
  check("KATO catalog contains all regions", () => assert.equal(getKatoRegions().length, 20));
  const karagashMatches = searchKatoLocalities("Карагаш", 100);
  check("tolerant search returns same-name Karagash localities", () => assert.ok(karagashMatches.length >= 10));
  check("Karagash Tayinsha is selectable by exact KATO identity", () => assert.ok(karagashMatches.some((row) => row.code === "596033100")));
  check("Kazakh locality search is supported", () => assert.ok(searchKatoLocalities("Қарағаш", 100).some((row) => row.code === "596033100")));
  check("district and region refine search", () => assert.deepEqual(
    searchKatoLocalities("Карагаш Тайыншинский Северо Казахстанская", 100).map((row) => row.code),
    ["596033100"]
  ));
  check("KATO lookup preserves hierarchy", () => assert.equal(getKatoLocality("596033100")?.districtRu, "Тайыншинский район"));

  const location = {
    latitude: 51.1282804,
    longitude: 71.4304708,
    region: null,
    district: null,
    locality: "Астана",
    displayName: "Астана",
  };
  const providerRow = (utc: string, local: string, temperature = 12.3) => ({
    time: { utc, local, epoch_s: Math.floor(Date.parse(utc) / 1000) },
    wind_profile: [
      { altitude_m: 10, wind_speed_ms: 5, wind_bearing_deg: 270, gust_speed_ms: 7.2, gust_bearing_deg: 272, t_c: temperature },
      { altitude_m: 100, wind_speed_ms: 7, wind_bearing_deg: 275, gust_speed_ms: 9, gust_bearing_deg: 276, t_c: temperature - 1 },
    ],
    temp_c: temperature,
    wind_chill_c: 11.5,
    precip_prob_pct: 0,
    precip_intensity_mmh: 0,
    precip_type: null,
    cloud_cover_pct: 0,
    visibility_m: 15000,
    humidity_pct: 65,
    cloudbase_m: 750,
    sats: {
      gps: { count: 10, kp_count: 8.5 },
      glonass: { count: 8, kp_count: 6 },
      galileo: { count: 9, kp_count: 7 },
      beidou: { count: 5, kp_count: 4 },
    },
    weather_icon: "clear-day",
    density_altitude_m: 30,
    pressure_msl_hpa: 1012,
    kp: 3,
  });
  const raw = {
    cost: { amount: 0.1, currency: "USD" },
    current: providerRow("2026-08-13T00:00:00Z", "2026-08-13T05:00:00+05:00"),
    days: [{
      date: "2026-08-13",
      midnight: { utc: "2026-08-12T19:00:00Z", local: "2026-08-13T00:00:00+05:00", epoch_s: 0 },
      sunrise: { utc: "2026-08-12T23:15:00Z", local: "2026-08-13T04:15:00+05:00", epoch_s: 0 },
      solar_noon: { utc: "2026-08-13T07:00:00Z", local: "2026-08-13T12:00:00+05:00", epoch_s: 0 },
      sunset: { utc: "2026-08-13T14:00:00Z", local: "2026-08-13T19:00:00+05:00", epoch_s: 0 },
      rows: [
        providerRow("2026-08-13T01:00:00Z", "2026-08-13T06:00:00+05:00", 13),
        providerRow("2026-08-13T02:00:00Z", "2026-08-13T07:00:00+05:00", 14),
      ],
    }, {
      date: "2026-08-13",
      sunrise: { utc: "2026-08-12T23:15:00Z", local: "2026-08-13T04:15:00+05:00", epoch_s: 0 },
      solar_noon: { utc: "2026-08-13T07:00:00Z", local: "2026-08-13T12:00:00+05:00", epoch_s: 0 },
      sunset: { utc: "2026-08-13T14:00:00Z", local: "2026-08-13T19:00:00+05:00", epoch_s: 0 },
      rows: [],
    }],
    elevation_m: 347,
    timezone: "Asia/Almaty",
    lat: 51.1282804,
    lon: 71.4304708,
  };
  const normalized = normalizeUavForecastResponse({
    location,
    requestStartedAt: "2026-08-13T00:00:00.000Z",
    responseReceivedAt: "2026-08-13T00:00:00.250Z",
    responseTimeMs: 250,
    headers: { rateLimit: { "x-ratelimit-remaining": "99" } },
    raw,
  });

  check("official current time is parsed", () => assert.equal(normalized.current.time, "2026-08-13T00:00:00.000Z"));
  check("official metric temperature is preserved", () => assert.equal(normalized.current.temperatureC, 12.3));
  check("surface wind uses 10 meter profile", () => assert.equal(normalized.current.windMs, 5));
  check("official gust_speed_ms is parsed", () => assert.equal(normalized.current.gustMs, 7.2));
  check("zero precipitation is preserved", () => assert.equal(normalized.current.precipitationRateMmH, 0));
  check("zero cloud cover is preserved", () => assert.equal(normalized.current.cloudCoverPct, 0));
  check("visibility meters convert to kilometers", () => assert.equal(normalized.current.visibilityKm, 15));
  check("visible satellite constellations are summed", () => assert.equal(normalized.current.visibleSatellites, 32));
  check("estimated locked satellites are summed", () => assert.equal(normalized.current.estimatedSatellitesLocked, 25.5));
  check("dew point is explicitly derived", () => assert.equal(normalized.current.dewPointC, 5.9));
  check("provider timezone is retained", () => assert.equal(normalized.providerMeta.timezone, "Asia/Almaty"));
  check("offset is parsed from provider local time", () => assert.equal(normalized.providerMeta.utcOffsetMinutes, 300));
  check("provider cost metadata is retained", () => assert.equal(normalized.providerMeta.billing?.amount, "0.1"));
  check("hourly rows are flattened", () => assert.equal(normalized.hourlyForecast.length, 2));
  check("sun payload is parsed", () => assert.equal(normalized.sun[0].sunset, "2026-08-13T14:00:00.000Z"));
  check("duplicate provider sun days are shown once", () => assert.equal(normalized.sun.length, 1));

  check("IANA timezone is used", () => assert.equal(formatWeatherTime("2026-08-13T00:00:00.000Z", { timezone: "Asia/Almaty" }), "05:00"));
  check("numeric offset is used as fallback", () => assert.equal(formatWeatherTime("2026-08-13T00:00:00.000Z", { timezone: "INVALID", utcOffsetMinutes: 300 }), "05:00"));
  check("relative age is deterministic", () => assert.equal(relativeWeatherAge("2026-08-13T00:00:00.000Z", Date.parse("2026-08-13T00:04:00.000Z")), "обновлено 4 минуты назад"));

  clearWeatherCacheForTests();
  const key = weatherCacheKey(location.latitude, location.longitude);
  let providerCalls = 0;
  const loader = async () => {
    providerCalls += 1;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    return normalized;
  };
  await Promise.all(Array.from({ length: 20 }, () => dedupeWeatherRequest(key, loader)));
  check("20 concurrent opens make one provider call", () => assert.equal(providerCalls, 1));
  setWeatherCache(key, normalized, 1_000);
  check("server cache returns stored response", () => assert.equal(getWeatherCache<typeof normalized>(key)?.value.location.locality, "Астана"));
  check("cache key rounds coordinates", () => assert.equal(weatherCacheKey(51.12824, 71.43044), weatherCacheKey(51.1282, 71.4304)));

  const fixturePath = resolve(root, "scripts/fixtures/uav-forecast-astana.normalized.redacted.json");
  if (existsSync(fixturePath) && readFileSync(fixturePath, "utf8").trim()) {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    check("real redacted fixture is normalized live evidence", () => assert.equal(fixture.fixture_kind, "normalized_live_response"));
    check("real redacted fixture has current data", () => assert.ok(fixture.current?.local_time));
    check("real redacted fixture has 24 hourly rows", () => assert.equal(fixture.hourly?.length, 24));
    check("real redacted fixture timezone is usable", () => assert.equal(fixture.provider_meta?.timezone, "Asia/Almaty"));
    check("real redacted fixture contains no provider secret", () => assert.equal(JSON.stringify(fixture).includes("UAV_FORECAST_API_KEY"), false));
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{
    lat: "51.1689016",
    lon: "70.1175700",
    display_name: "Карагаш, Тайыншинский район, Северо-Казахстанская область, Казахстан",
    type: "village",
    addresstype: "village",
    address: { village: "Карагаш", county: "Тайыншинский район", state: "Северо-Казахстанская область", country_code: "kz" },
  }]), { status: 200, headers: { "Content-Type": "application/json" } });
  clearLocationResolverCacheForTests();
  try {
    const resolved = await resolveKatoLocation("596033100");
    check("resolver keeps selected KATO code", () => assert.equal(resolved.katoCode, "596033100"));
    check("resolver returns exact selected district", () => assert.equal(resolved.district, "Тайыншинский район"));
    check("resolver returns coordinates only after exact hierarchy match", () => assert.equal(resolved.longitude, 70.11757));
  } finally {
    globalThis.fetch = originalFetch;
    clearLocationResolverCacheForTests();
  }
  await assert.rejects(() => resolveKatoLocation("000000000"), /Объект КАТО не найден/);
  checks.push("resolver rejects unknown KATO identity");

  const clientSource = readFileSync(resolve(root, "components/weather/weather-lab.tsx"), "utf8");
  const forecastRoute = readFileSync(resolve(root, "app/api/weather-lab/forecast/route.ts"), "utf8");
  const locationRoute = readFileSync(resolve(root, "app/api/weather-lab/location/route.ts"), "utf8");
  const katoRoute = readFileSync(resolve(root, "app/api/weather-lab/kato/route.ts"), "utf8");
  const authSource = readFileSync(resolve(root, "app/api/weather-lab/_auth.ts"), "utf8");
  const layoutSource = readFileSync(resolve(root, "components/layout/dashboard-layout.tsx"), "utf8");
  const mobileBottomNavSource = readFileSync(resolve(root, "components/layout/mobile-bottom-nav.tsx"), "utf8");
  const providerSource = readFileSync(resolve(root, "lib/weather/uav-forecast.ts"), "utf8");
  check("client never references UAV key", () => assert.equal(clientSource.includes("UAV_FORECAST_API_KEY"), false));
  check("no public UAV key variable exists", () => assert.equal(providerSource.includes("NEXT_PUBLIC_UAV"), false));
  check("provider uses official POST endpoint", () => assert.match(providerSource, /method:\s*"POST"/));
  check("provider uses bearer authorization", () => assert.match(providerSource, /Authorization:\s*`Bearer/));
  check("provider never sends key in query", () => assert.equal(/searchParams\.set\([^,]+,\s*key\)/.test(providerSource), false));
  check("forecast API requires global admin", () => assert.match(forecastRoute, /requireWeatherLabAdmin\(request\)/));
  check("KATO API requires global admin", () => assert.match(katoRoute, /requireWeatherLabAdmin\(request\)/));
  check("location API resolves exact KATO code", () => assert.match(locationRoute, /resolveKatoLocation\(katoCode\)/));
  check("auth helper ignores impersonation", () => assert.match(authSource, /ignoreImpersonation:\s*true/));
  check("auth helper enforces global admin", () => assert.match(authSource, /actor\.role !== "global_admin"/));
  check("Weather Lab hides Assist surfaces", () => assert.match(layoutSource, /!isWeatherLab \? <AssistantLauncher/));
  check("Weather Lab hides mobile Copilot", () => assert.match(mobileBottomNavSource, /item\.kind !== "copilot"/));
  check("UI has no manual coordinate fields", () => assert.equal(/<Input[^>]+(?:lat|lon|latitude|longitude)/i.test(clientSource), false));
  check("UI removed three-field free-form location form", () => assert.equal(clientSource.includes("resolveTypedLocation"), false));
  check("UI uses compact location dialog", () => assert.match(clientSource, /\{pickerOpen \? \([\s\S]+<Dialog open onOpenChange=\{setPickerOpen\}/));
  check("UI supports official KATO search", () => assert.match(clientSource, /\/api\/weather-lab\/kato\?/));
  check("failed resolver keeps active location", () => {
    assert.match(clientSource, /catch \(requestError\) \{[\s\S]+setError\([\s\S]+finally[\s\S]+setResolvingCode/);
    assert.equal(/catch \(requestError\) \{[\s\S]{0,300}localStorage\.removeItem\(ACTIVE_KEY\)/.test(clientSource), false);
  });
  check("UI does not invent Good To Fly", () => assert.equal(/можно лететь|goodToFly/i.test(clientSource), false));
  check("derived dew point is labelled", () => assert.match(clientSource, /Расчётная точка росы/));
  check("official KATO attribution is visible", () => assert.match(clientSource, /официальный КАТО Республики Казахстан/));

  console.log(`TZ269 QA PASS: ${checks.length}/${checks.length}`);
  for (const item of checks) console.log(`PASS ${item}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
