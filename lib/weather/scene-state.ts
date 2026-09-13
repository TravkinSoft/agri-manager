import type { NormalizedWeather, WeatherPoint } from "./types";

export type WeatherSceneState = { hour: number; wind: number; rain: number; cloud: number };
const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

export function weatherSceneState(weather: NormalizedWeather, point: WeatherPoint): WeatherSceneState | null {
  const time = Date.parse(point.time);
  if (!Number.isFinite(time)) return null;
  // The approved renderer uses 06:00/18:00 for its solar arc. Map the provider's
  // actual sunrise and sunset onto that arc, retaining a continuous night.
  let localDate = new Date(time + (weather.providerMeta.utcOffsetMinutes ?? 300) * 60000).toISOString().slice(0, 10);
  if (weather.providerMeta.timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: weather.providerMeta.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(time);
      localDate = ["year", "month", "day"].map(key => parts.find(p => p.type === key)?.value).join("-");
    } catch { /* Retain the provider's numeric offset. */ }
  }
  const sun = weather.sun.find((day) => day.date.slice(0, 10) === localDate);
  const rise = Date.parse(sun?.sunrise || ""), set = Date.parse(sun?.sunset || "");
  let hour: number;
  if (Number.isFinite(rise) && Number.isFinite(set) && set > rise && set - rise < 86400000) {
    const day = set - rise, night = 86400000 - day;
    hour = time < rise ? 6 - (rise - time) / night * 12
      : time <= set ? 6 + (time - rise) / day * 12 : 18 + (time - set) / night * 12;
    hour = ((hour % 24) + 24) % 24;
  } else {
    const date = new Date(time + (weather.providerMeta.utcOffsetMinutes ?? 300) * 60000);
    hour = date.getUTCHours() + date.getUTCMinutes() / 60;
    if (weather.providerMeta.timezone) {
      try {
        const parts = new Intl.DateTimeFormat("en-GB", { timeZone: weather.providerMeta.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(time);
        hour = Number(parts.find(p => p.type === "hour")?.value) + Number(parts.find(p => p.type === "minute")?.value) / 60;
      } catch { /* Retain the provider's numeric UTC offset. */ }
    }
  }
  // Probability is not rainfall. Snow is deliberately not visualised as rain.
  const snow = /snow|снег|ice|лед/i.test(point.precipitationType || "");
  const rate = snow ? 0 : Math.max(0, point.precipitationRateMmH ?? 0);
  return { hour, wind: clamp(point.windMs ?? 0, 16), rain: clamp(Math.sqrt(rate / 10), 1), cloud: clamp((point.cloudCoverPct ?? 35) / 100, 1) };
}
