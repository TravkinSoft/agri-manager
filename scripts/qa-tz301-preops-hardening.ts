import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cachedClientValue, clearClientCache, invalidateClientCache } from "@/lib/client/single-flight-cache";
import { aggregateHarvestTickets } from "@/lib/weighbridge/harvest-summary";
import { operationModeProfile } from "@/lib/weather/operation-modes";
import { evaluateOperatingHours } from "@/lib/weather/operating-window";
import { aggregateWeatherDays, findAvoidWindows } from "@/lib/weather/timeline";
import type { WeatherPoint } from "@/lib/weather/types";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
let checks = 0;
const check = async (name: string, run: () => void | Promise<void>) => {
  await run();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
};

const point = (hour: number, windMs: number, precipitationRateMmH = 0): WeatherPoint => ({
  time: new Date(Date.UTC(2026, 7, 24, hour)).toISOString(),
  temperatureC: 18,
  dewPointC: 10,
  humidityPct: 60,
  windMs,
  windBearingDeg: 180,
  gustMs: windMs + 1,
  gustBearingDeg: 185,
  precipitationProbabilityPct: precipitationRateMmH > 0 ? 80 : 0,
  precipitationRateMmH,
  precipitationType: precipitationRateMmH > 0 ? "rain" : null,
  cloudCoverPct: 20,
  cloudBaseM: 1000,
  visibilityKm: 20,
  pressureMslHpa: 1012,
  densityAltitudeM: 0,
  kp: 1,
  visibleSatellites: 20,
  estimatedSatellitesLocked: 18,
});

async function main() {
  await check("paper reconciliation uses net-mass weighted moisture", () => {
    const aggregate = aggregateHarvestTickets([
      { net_weight_kg: 10_000, lines: [{ moisture_percent: 10 }] },
      { net_weight_kg: 30_000, lines: [{ moisture_percent: 20 }] },
      { net_weight_kg: 5_000, lines: [{ moisture_percent: null }] },
    ]);
    assert.equal(aggregate.netKg, 45_000);
    assert.equal(aggregate.trips, 3);
    assert.equal(aggregate.averageTripKg, 15_000);
    assert.equal(aggregate.averageMoisture, 17.5);
    assert.equal(aggregate.measuredMoistureTrips, 2);
  });

  await check("single-flight cache collapses duplicate client requests", async () => {
    clearClientCache();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
      return { company: "Astyk-STEM" };
    };
    const values = await Promise.all(Array.from({ length: 20 }, () => cachedClientValue("company:1", loader)));
    assert.equal(calls, 1);
    assert.equal(values.length, 20);
    invalidateClientCache("company:");
    await cachedClientValue("company:1", loader);
    assert.equal(calls, 2);
  });

  await check("weather modes produce continuous good and avoid windows", () => {
    const profile = operationModeProfile("spraying");
    const evaluated = evaluateOperatingHours([
      point(0, 2),
      point(1, 2.5),
      point(2, 3.75),
      point(3, 5, 1.2),
    ], profile, 168);
    assert.deepEqual(evaluated.map((item) => item.status), ["green", "green", "orange", "red"]);
    assert.deepEqual(findAvoidWindows(evaluated).map((item) => item.hours), [2]);
    assert.equal(aggregateWeatherDays(evaluated, "UTC")[0]?.bestStatus, "green");
  });

  const ticketRoute = read("app/api/weighbridge/tickets/route.ts");
  await check("paper duplicate key excludes weight and uses company date reference", () => {
    assert.match(ticketRoute, /external_document_no/);
    assert.match(ticketRoute, /\.gte\("created_at", dayStart\)/);
    assert.match(ticketRoute, /\.lt\("created_at", dayEnd\)/);
    assert.match(ticketRoute, /paper_trip_duplicate/);
    assert.doesNotMatch(ticketRoute, /paper_trip_duplicate[\s\S]{0,250}gross_weight_kg/);
  });

  await check("paper backfill finalizes through the existing atomic close contract", () => {
    assert.match(ticketRoute, /close_harvest_ticket_atomic/);
    assert.match(ticketRoute, /p_tare_weight_kg: backfill\.tareWeightKg/);
    assert.match(ticketRoute, /cleanupCreatedTicket/);
  });

  const weighbridgePage = read("app/(dashboard)/weighbridge/page.tsx");
  await check("fast repeat preserves context and clears volatile paper inputs", () => {
    assert.match(weighbridgePage, /paperRecordedAt: ""/);
    assert.match(weighbridgePage, /paperTareKg: ""/);
    assert.match(weighbridgePage, /externalDocumentNo: ""/);
    assert.match(weighbridgePage, /Внести рейс из бумажного журнала/);
  });

  const weatherUi = read("components/weather/weather-lab.tsx");
  await check("Weather Lab uses one continuous range timeline", () => {
    assert.match(weatherUi, /type="range"/);
    assert.match(weatherUi, /touch-pan-x/);
    assert.match(weatherUi, /operationMode/);
    assert.match(weatherUi, /findAvoidWindows/);
    assert.match(weatherUi, /aggregateWeatherDays/);
  });

  const sidebar = read("components/layout/sidebar.tsx");
  await check("primary navigation is ordered and has no machine duplicates", () => {
    const primary = sidebar.slice(sidebar.indexOf("const GLOBAL_ADMIN_NAV"), sidebar.indexOf("const COMPANY_ADMIN_NAV"));
    const expected = ["dashboard", "weather", "fields", "field_map", "crop_structure", "warehouses", "weighbridge", "fuel", "analytics", "references", "users"];
    assert.deepEqual(Array.from(primary.matchAll(/labelKey: "([^"]+)"/g), (match) => match[1]), expected);
    assert.doesNotMatch(primary, /labelKey: "(?:machines|technique)"/);
  });

  await check("legacy machine routes redirect into unified references", () => {
    assert.match(read("app/(dashboard)/machines/page.tsx"), /redirect\("\/references\?domain=machine-yard&tab=park"\)/);
    assert.match(read("app/(dashboard)/technique/page.tsx"), /redirect\("\/references\?domain=machine-yard&tab=park"\)/);
  });

  const references = read("app/(dashboard)/references/page.tsx");
  await check("unified machine reference exposes fleet and catalog tabs", () => {
    assert.match(references, /Парк компании/);
    assert.match(references, /Каталог техники/);
    assert.match(references, /getCompanyAssetReferences/);
    assert.match(references, /getGlobalMachineModels/);
    assert.match(references, /getGlobalTransportModels/);
  });

  const mobileNav = read("components/layout/mobile-bottom-nav.tsx");
  await check("mobile primary routes are one or two taps away", () => {
    assert.match(mobileNav, /mobile_more/);
    assert.match(mobileNav, /href: "\/weighbridge"/);
    assert.match(mobileNav, /href: "\/fields-map"/);
    assert.match(mobileNav, /href: "\/references"/);
    assert.match(mobileNav, /min-h-14/);
  });

  const androidGradle = read("android/app/build.gradle");
  const androidManifest = read("android/app/src/main/AndroidManifest.xml");
  const nativeRoutes = read("android/app/src/main/java/com/travkin/flow/NativeRoutePolicy.java");
  const nativeActivity = read("android/app/src/main/java/com/travkin/flow/MainActivity.java");
  await check("Android preserves Play identity and isolates debug to permanent QA", () => {
    assert.match(androidGradle, /applicationId "com\.travkin\.flow"/);
    assert.match(androidGradle, /applicationIdSuffix "\.qa"/);
    assert.match(androidGradle, /https:\/\/qa\.travkinflow\.com/);
    assert.match(androidGradle, /https:\/\/travkinflow\.com/);
  });

  await check("Android supports API 29 through current target without browser chrome", () => {
    assert.match(androidGradle, /minSdk 29/);
    assert.match(androidGradle, /targetSdk 36/);
    assert.match(androidManifest, /\.MainActivity/);
    assert.doesNotMatch(androidManifest, /TrustedWebActivity|customtabs/i);
  });

  await check("Android native contract includes lifecycle, deep links, files and session persistence", () => {
    assert.match(nativeActivity, /CookieManager/);
    assert.match(nativeActivity, /registerDefaultNetworkCallback/);
    assert.match(nativeActivity, /getOnBackPressedDispatcher/);
    assert.match(nativeActivity, /DownloadManager/);
    assert.match(nativeActivity, /ACTION_IMAGE_CAPTURE/);
    assert.match(nativeRoutes, /\/tickets/);
    assert.match(nativeRoutes, /\/warehouses/);
    assert.match(nativeRoutes, /\/fields/);
  });

  await check("Android package contains no privileged secrets", () => {
    const androidSource = [androidGradle, androidManifest, nativeRoutes, nativeActivity].join("\n");
    assert.doesNotMatch(androidSource, /service_role|SUPABASE_SERVICE|VERCEL_OIDC|OPENAI_API_KEY|DB_PASSWORD/i);
  });

  console.log(`TZ301 QA PASS: ${checks}/${checks}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
