import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { weatherSceneState } from "../lib/weather/scene-state";
import type { NormalizedWeather, WeatherPoint } from "../lib/weather/types";

const point = { time: "2026-09-13T07:00:00+05:00", windMs: 4, precipitationRateMmH: 0, precipitationProbabilityPct: 100, cloudCoverPct: 80 } as WeatherPoint;
const weather = { location: { latitude: 53.85, longitude: 69.76 }, providerMeta: { timezone: "Asia/Almaty", utcOffsetMinutes: 300 }, sun: [
  { date: "2026-09-12", sunrise: "2026-09-12T06:58:00+05:00", sunset: "2026-09-12T20:03:00+05:00" },
  { date: "2026-09-13", sunrise: "2026-09-13T07:00:00+05:00", sunset: "2026-09-13T20:00:00+05:00" },
  { date: "2026-09-14", sunrise: "2026-09-14T07:02:00+05:00", sunset: "2026-09-14T19:57:00+05:00" }
] } as NormalizedWeather;
const state = (patch: Partial<WeatherPoint> = {}) => weatherSceneState(weather, { ...point, ...patch })!;
assert.equal(state().hour, 6);
assert.equal(state({ time: "2026-09-13T20:00:00+05:00" }).hour, 18);
assert.equal(state({ time: "2026-09-13T13:30:00+05:00" }).hour, 12);
assert(state({ time: "2026-09-13T19:30:00+05:00" }).hour < 18);
assert.equal(state().rain, 0, "probability must not cause rain");
assert.equal(state().cloud, .8, "cloud cover independent of rain");
assert.equal(state({ precipitationRateMmH: 10 }).rain, 1);
assert.equal(state({ precipitationRateMmH: 1 }).rain, Math.sqrt(.1));
assert.equal(state({ precipitationType: "snow", precipitationRateMmH: 8 }).rain, 0);
assert.equal(state({ windMs: 0 }).wind, 0);
assert.equal(state({ windMs: 40 }).wind, 16);
assert.equal(weatherSceneState(weather, { ...point, time: "invalid" }), null);
const fallback = { ...weather, sun: [] };
assert.notEqual(weatherSceneState(fallback, point)!.hour, 7, "missing provider sunrise must use coordinates, not civil hour");
assert.equal(weatherSceneState({ ...fallback, providerMeta: { ...weather.providerMeta, timezone: "invalid" } }, point)!.hour, weatherSceneState(fallback, point)!.hour);
assert.notEqual(weatherSceneState({ ...fallback, location: { ...weather.location, longitude: 52 } }, point)!.hour, weatherSceneState(fallback, point)!.hour, "longitude changes the sun");
const summer = weatherSceneState(fallback, { ...point, time: "2026-06-21T06:00:00+05:00" })!.hour;
const winter = weatherSceneState(fallback, { ...point, time: "2026-12-21T06:00:00+05:00" })!.hour;
assert(summer > 6 && summer < 18 && winter < 6, "same civil hour must be day in summer, night in winter");
assert.equal(weatherSceneState({ ...fallback, location: { ...weather.location, latitude: NaN } }, point), null);
assert.equal(state({ time: "2026-09-14T07:02:00+05:00" }).hour, 6, "selected date's sunrise");
assert.equal(state({ time: "2026-09-14T19:57:00+05:00" }).hour, 18);
const start = Date.parse("2026-09-12T20:03:00+05:00"), end = Date.parse("2026-09-13T07:00:00+05:00");
assert(Math.abs(state({ time: new Date((start + end) / 2).toISOString() }).hour) < 1e-8, "night uses previous sunset and today's sunrise");
const a = state({ time: "2026-09-13T23:59:59+05:00" }).hour;
const b = state({ time: "2026-09-14T00:00:01+05:00" }).hour;
assert(Math.abs(b - a) < .001, "no discontinuity when provider day changes");
for (const hour of [0, 1, 2, 3, 4]) {
  const phase = state({ time: `2026-09-13T0${hour}:00:00+05:00` }).hour;
  assert(phase > 18 || phase < 6, "01:00–02:00 stays night");
}
// Exercise the exact generated runtime helper at intermediate tween frames.
const code = readFileSync(new URL("../public/weather-scene/approved-road-v1/scene.js", import.meta.url), "utf8");
const helper = code.match(/function setHour\(value\)\{[\s\S]*?\n\}/)?.[0];
assert(helper, "runtime must contain circular interpolation");
const runtime = runInNewContext(`let hour=23.6,targetHour=hour,hourFrom=hour,hourChanged=0;${helper};({setHour,tick(t){hour=hourFrom+(targetHour-hourFrom)*t;return ((hour%24)+24)%24;}})`, { performance: { now: () => 0 } });
for (let cycle = 0; cycle < 5; cycle++) {
  for (const target of [.4, 23.6, .8, 23.9]) {
    runtime.setHour(target);
    for (const t of [.1, .25, .5, .75, 1]) {
      const phase = runtime.tick(t);
      assert(phase > 23 || phase < 1, `night scrub passed through day: ${phase}`);
    }
  }
}
runtime.setHour(.4); runtime.tick(.4); runtime.setHour(23.7);
assert(runtime.tick(.5) > 23 || runtime.tick(.5) < 1, "reversal during an unfinished tween");
console.log("Weather scene: solar dates, coordinate fallback, seasons, night continuity and 100 intermediate midnight frames passed");
