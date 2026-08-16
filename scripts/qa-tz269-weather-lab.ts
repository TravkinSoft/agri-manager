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
  getKatoLocalities,
  getKatoRegions,
  getKatoSource,
  searchKatoLocalities,
} from "../lib/weather/kato-catalog";
import { clearLocationResolverCacheForTests, resolveKatoLocation } from "../lib/weather/location-resolver";
import { evaluateOperatingHour, evaluateOperatingHours, findOperatingWindows } from "../lib/weather/operating-window";
import { emptyWeatherProfile, weatherProfileInputSchema, type WeatherProfile } from "../lib/weather/profile";
import { formatWeatherTime, relativeWeatherAge } from "../lib/weather/time";
import { normalizeUavForecastResponse, UAV_FORECAST_HOURS } from "../lib/weather/uav-forecast";
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
  const astanaMatches = searchKatoLocalities("Астана", 100);
  check("capital Astana is the primary exact search result", () => assert.equal(astanaMatches[0]?.code, "710000000"));
  check("capital Astana is available in list mode", () => assert.equal(getKatoLocalities("710000000")[0]?.code, "710000000"));

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
  check("provider horizon requests 48 hours", () => assert.equal(UAV_FORECAST_HOURS, 48));

  const profile = (overrides: Partial<WeatherProfile> = {}): WeatherProfile => ({
    ...emptyWeatherProfile,
    id: "profile-1",
    companyId: "company-1",
    userId: "user-1",
    name: "Опрыскивание",
    windEnabled: true,
    maxWindMs: 5,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  });
  const point = (time: string, windMs: number | null) => ({ ...normalized.current, time, windMs });
  check("green means all enabled criteria pass", () => assert.equal(evaluateOperatingHour(point("2026-08-13T01:00:00Z", 3), profile()).status, "green"));
  check("yellow starts at 80 percent of upper limit", () => assert.equal(evaluateOperatingHour(point("2026-08-13T02:00:00Z", 4), profile()).status, "yellow"));
  check("red means a configured limit is exceeded", () => assert.equal(evaluateOperatingHour(point("2026-08-13T03:00:00Z", 5.1), profile()).status, "red"));
  check("gray means required provider data is absent", () => assert.equal(evaluateOperatingHour(point("2026-08-13T04:00:00Z", null), profile()).status, "gray"));
  check("red has priority over missing secondary data", () => assert.equal(evaluateOperatingHour(
    { ...point("2026-08-13T05:00:00Z", 6), gustMs: null },
    profile({ gustEnabled: true, maxGustMs: 8 })
  ).status, "red"));
  check("profile without enabled criteria does not invent a green hour", () => assert.equal(evaluateOperatingHour(point("2026-08-13T06:00:00Z", 2), profile({ windEnabled: false, maxWindMs: null })).status, "gray"));
  check("evaluation is capped at 48 hourly rows", () => assert.equal(evaluateOperatingHours(Array.from({ length: 60 }, (_, index) => point(new Date(Date.parse("2026-08-13T00:00:00Z") + index * 3_600_000).toISOString(), 2)), profile()).length, 48));
  const windows = findOperatingWindows([
    evaluateOperatingHour(point("2026-08-13T00:00:00Z", 2), profile()),
    evaluateOperatingHour(point("2026-08-13T01:00:00Z", 2), profile()),
    evaluateOperatingHour(point("2026-08-13T04:00:00Z", 2), profile()),
    evaluateOperatingHour(point("2026-08-13T05:00:00Z", 6), profile()),
  ]);
  check("operating windows split on missing hourly rows", () => assert.deepEqual(windows.map((item) => item.hours), [2, 1]));
  check("operating window end includes the final forecast hour", () => assert.equal(windows[0]?.end, "2026-08-13T02:00:00.000Z"));
  check("enabled criterion requires its limit", () => assert.equal(weatherProfileInputSchema.safeParse({ ...emptyWeatherProfile, name: "Профиль", windEnabled: true }).success, false));
  check("all criteria may be explicitly disabled", () => assert.equal(weatherProfileInputSchema.safeParse({ ...emptyWeatherProfile, name: "Наблюдение" }).success, true));

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
    check("historical redacted fixture keeps its captured horizon", () => assert.ok(fixture.hourly?.length >= 24));
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
  const profileRouteSource = readFileSync(resolve(root, "app/api/weather-lab/profiles/route.ts"), "utf8");
  const profileItemRouteSource = readFileSync(resolve(root, "app/api/weather-lab/profiles/[id]/route.ts"), "utf8");
  const migrationSource = readFileSync(resolve(root, "supabase/migrations/20260814150503_tz269_weather_operating_profiles_v1.sql"), "utf8");
  check("client never references UAV key", () => assert.equal(clientSource.includes("UAV_FORECAST_API_KEY"), false));
  check("no public UAV key variable exists", () => assert.equal(providerSource.includes("NEXT_PUBLIC_UAV"), false));
  check("provider uses official POST endpoint", () => assert.match(providerSource, /method:\s*"POST"/));
  check("provider uses bearer authorization", () => assert.match(providerSource, /Authorization:\s*`Bearer/));
  check("provider never sends key in query", () => assert.equal(/searchParams\.set\([^,]+,\s*key\)/.test(providerSource), false));
  check("forecast API requires Weather Lab role access", () => assert.match(forecastRoute, /requireWeatherLabAccess\(request\)/));
  check("KATO API requires Weather Lab role access", () => assert.match(katoRoute, /requireWeatherLabAccess\(request\)/));
  check("location API resolves exact KATO code", () => assert.match(locationRoute, /resolveKatoLocation\(katoCode\)/));
  check("auth helper ignores impersonation", () => assert.match(authSource, /ignoreImpersonation:\s*true/));
  check("auth helper allows global admin", () => assert.match(authSource, /actor\.role !== "global_admin"/));
  check("auth helper allows agronomist", () => assert.match(authSource, /actor\.role !== "agronomist"/));
  check("shared dashboard shell does not mount Assist", () => {
    assert.equal(layoutSource.includes("AssistantLauncher"), false);
    assert.equal(layoutSource.includes("AssistantProvider"), false);
  });
  check("mobile navigation does not mount Copilot", () => {
    assert.equal(mobileBottomNavSource.includes('kind: "copilot"'), false);
    assert.equal(mobileBottomNavSource.includes("AssistantPanel"), false);
  });
  check("UI has no manual coordinate fields", () => assert.equal(/<Input[^>]+(?:lat|lon|latitude|longitude)/i.test(clientSource), false));
  check("UI shows provider wind direction", () => {
    assert.match(clientSource, /windDirection\(current\.windBearingDeg\)/);
    assert.match(clientSource, /windDirection\(point\.windBearingDeg\)/);
  });
  check("technical weather details are explicitly gated", () => {
    assert.match(clientSource, /showTechnicalDebug \? <details/);
  });
  check("UI removed three-field free-form location form", () => assert.equal(clientSource.includes("resolveTypedLocation"), false));
  check("UI uses compact location dialog", () => assert.match(clientSource, /\{pickerOpen \? \([\s\S]+<Dialog open onOpenChange=\{setPickerOpen\}/));
  check("location row is compact on desktop", () => assert.match(clientSource, /md:max-w-\[360px\]/));
  check("location results scroll without a visible scrollbar", () => {
    assert.match(clientSource, /overflow-y-auto/);
    assert.match(clientSource, /\[scrollbar-width:none\]/);
    assert.match(clientSource, /\[&::\-webkit-scrollbar\]:hidden/);
  });
  check("picker resets scroll when mode or hierarchy changes", () => assert.match(clientSource, /scrollTo\(\{ top: 0 \}\)/));
  check("region-level cities select their locality directly", () => assert.match(clientSource, /localityPayload\.items\.length === 1/));
  check("UI supports official KATO search", () => assert.match(clientSource, /\/api\/weather-lab\/kato\?/));
  check("failed resolver keeps active location", () => {
    assert.match(clientSource, /catch \(requestError\) \{[\s\S]+setError\([\s\S]+finally[\s\S]+setResolvingCode/);
    assert.equal(/catch \(requestError\) \{[\s\S]{0,300}localStorage\.removeItem\(ACTIVE_KEY\)/.test(clientSource), false);
  });
  check("UI does not invent Good To Fly", () => assert.equal(/можно лететь|goodToFly/i.test(clientSource), false));
  check("derived dew point is labelled", () => assert.match(clientSource, /Точка росы/));
  check("official KATO attribution is visible", () => assert.match(clientSource, /официальный КАТО Республики Казахстан/));
  check("48 hour operating timeline is visible", () => assert.match(clientSource, /Рабочее окно · 48 часов/));
  check("timeline supports pointer drag", () => assert.match(clientSource, /onPointerMove=\{moveTimeline\}/));
  check("timeline technical scrollbar is hidden", () => assert.match(clientSource, /overflow-x-auto[\s\S]+\[scrollbar-width:none\][\s\S]+webkit-scrollbar\]:hidden/));
  check("profile edit previews without a forecast request", () => assert.match(clientSource, /profileOpen \? previewProfile\(profileDraft/));
  check("main UI omits Kp satellites and visibility", () => {
    assert.equal(clientSource.includes("Видимые спутники"), false);
    assert.equal(clientSource.includes("Ожидаемый захват спутников"), false);
    assert.equal(clientSource.includes("Видимость"), false);
    assert.equal(clientSource.includes(">Kp<"), false);
  });
  check("profile routes require Weather Lab access", () => {
    assert.match(profileRouteSource, /requireWeatherLabAccess\(request\)/);
    assert.match(profileItemRouteSource, /requireWeatherLabAccess\(request\)/);
  });
  check("profile routes use user-scoped Supabase client", () => {
    assert.match(profileRouteSource, /getUserScopedClientFromRequest\(request\)/);
    assert.match(profileItemRouteSource, /getUserScopedClientFromRequest\(request\)/);
  });
  check("weather profiles have RLS and no anon grant", () => {
    assert.match(migrationSource, /alter table public\.weather_profiles enable row level security/);
    assert.match(migrationSource, /revoke all on table public\.weather_profiles from public, anon/);
  });
  check("weather profile ownership uses auth uid", () => assert.match(migrationSource, /user_id = \(select auth\.uid\(\)\)/));
  check("weather profile migration is additive", () => assert.equal(/\bdrop\s+(table|column)\b/i.test(migrationSource), false));

  console.log(`TZ269 QA PASS: ${checks.length}/${checks.length}`);
  for (const item of checks) console.log(`PASS ${item}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
