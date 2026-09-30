import { getTimes } from "suncalc";
import type { NormalizedWeather, WeatherPoint } from "./types";

export type WeatherSceneState = { hour: number; wind: number; rain: number; cloud: number };
const DAY = 86400000;
const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(v) ? v : 0));
const dateAfter = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export function weatherSceneState(weather: NormalizedWeather, point: WeatherPoint): WeatherSceneState | null {
  const time = Date.parse(point.time);
  if (!Number.isFinite(time)) return null;
  // The approved renderer uses 06:00/18:00 for its solar arc. Map the provider's
  // actual sunrise and sunset onto that arc, retaining a continuous night.
  const offset = weather.providerMeta.utcOffsetMinutes ?? 300;
  let localDate = new Date(time + offset * 60000).toISOString().slice(0, 10);
  if (weather.providerMeta.timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: weather.providerMeta.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(time);
      localDate = ["year", "month", "day"].map(key => parts.find(p => p.type === key)?.value).join("-");
    } catch { /* Retain the provider's numeric offset. */ }
  }
  const events = (date: string) => {
    const sun = weather.sun.find(day => day.date.slice(0, 10) === date);
    const rise = Date.parse(sun?.sunrise || ""), set = Date.parse(sun?.sunset || "");
    if (Number.isFinite(rise) && Number.isFinite(set) && set > rise && set - rise < DAY) {
      return { rise, set, alwaysUp: false, alwaysDown: false };
    }
    const { latitude: lat, longitude: lon } = weather.location || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    // Provider events take precedence. Missing days use the selected place and
    // date, never a fixed 06:00/18:00 civil-time fallback.
    const calculated = getTimes(new Date(Date.parse(`${date}T12:00:00Z`) - offset * 60000), lat, lon);
    return { rise: calculated.sunrise?.getTime() ?? NaN, set: calculated.sunset?.getTime() ?? NaN,
      alwaysUp: !!calculated.alwaysUp, alwaysDown: !!calculated.alwaysDown };
  };
  const today = events(localDate);
  if (!today) return null;
  let hour: number;
  if (today.alwaysUp) hour = 12;
  else if (today.alwaysDown) hour = 0;
  else {
    const { rise, set } = today;
    if (!Number.isFinite(rise) || !Number.isFinite(set)) return null;
    if (time >= rise && time <= set) hour = 6 + (time - rise) / (set - rise) * 12;
    else if (time < rise) {
      const previousSet = events(dateAfter(localDate, -1))?.set ?? NaN;
      const start = Number.isFinite(previousSet) ? previousSet : set - DAY;
      hour = 18 + (time - start) / (rise - start) * 12;
    } else {
      const nextRise = events(dateAfter(localDate, 1))?.rise ?? NaN;
      const end = Number.isFinite(nextRise) ? nextRise : rise + DAY;
      hour = 18 + (time - set) / (end - set) * 12;
    }
    hour = ((hour % 24) + 24) % 24;
  }
  if (!Number.isFinite(hour)) return null;
  // Probability is not rainfall. Snow is deliberately not visualised as rain.
  const snow = /snow|снег|ice|лед/i.test(point.precipitationType || "");
  const rate = snow ? 0 : Math.max(0, point.precipitationRateMmH ?? 0);
  return { hour, wind: clamp(point.windMs ?? 0, 16), rain: clamp(Math.sqrt(rate / 10), 1), cloud: clamp((point.cloudCoverPct ?? 35) / 100, 1) };
}
