import type { OperatingHour, OperatingStatus, OperatingWindow } from "@/lib/weather/operating-window";

export type DailyWeatherSummary = {
  day: string;
  bestStatus: OperatingStatus;
  bestScore: number;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  precipitationMm: number;
  maxWindMs: number | null;
};

const rank: Record<OperatingStatus, number> = { green: 4, yellow: 3, orange: 2, red: 1, gray: 0 };
const score: Record<OperatingStatus, number> = { green: 9, yellow: 7, orange: 5, red: 2, gray: 0 };

export function findAvoidWindows(hours: OperatingHour[]): OperatingWindow[] {
  const result: OperatingWindow[] = [];
  let start = -1;
  const append = (end: number) => {
    if (start < 0 || end < start) return;
    const first = hours[start];
    const last = hours[end];
    const interval = end > start
      ? Math.max(60 * 60_000, Date.parse(last.point.time) - Date.parse(hours[end - 1].point.time))
      : 60 * 60_000;
    result.push({ start: first.point.time, end: new Date(Date.parse(last.point.time) + interval).toISOString(), hours: end - start + 1 });
    start = -1;
  };
  hours.forEach((hour, index) => {
    const avoid = hour.status === "orange" || hour.status === "red";
    if (avoid && start < 0) start = index;
    if (!avoid && start >= 0) append(index - 1);
    if (index === hours.length - 1 && start >= 0) append(index);
  });
  return result;
}

export function aggregateWeatherDays(hours: OperatingHour[], timezone?: string | null): DailyWeatherSummary[] {
  const groups = new Map<string, OperatingHour[]>();
  const formatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone || undefined });
  hours.forEach((hour) => {
    const day = formatter.format(new Date(hour.point.time));
    groups.set(day, [...(groups.get(day) || []), hour]);
  });
  return Array.from(groups.entries()).slice(0, 7).map(([day, items]) => {
    const temperatures = items.map((item) => item.point.temperatureC).filter((value): value is number => value != null);
    const winds = items.map((item) => item.point.windMs).filter((value): value is number => value != null);
    const best = items.reduce<OperatingStatus>((current, item) => rank[item.status] > rank[current] ? item.status : current, "gray");
    return {
      day,
      bestStatus: best,
      bestScore: score[best],
      minTemperatureC: temperatures.length ? Math.min(...temperatures) : null,
      maxTemperatureC: temperatures.length ? Math.max(...temperatures) : null,
      precipitationMm: items.reduce((sum, item) => sum + Math.max(0, item.point.precipitationRateMmH || 0), 0),
      maxWindMs: winds.length ? Math.max(...winds) : null,
    };
  });
}
