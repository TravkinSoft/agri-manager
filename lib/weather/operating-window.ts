import type { WeatherProfile } from "@/lib/weather/profile";
import type { WeatherPoint } from "@/lib/weather/types";

export type OperatingStatus = "green" | "yellow" | "orange" | "red" | "gray";

export type OperatingHour = {
  point: WeatherPoint;
  status: OperatingStatus;
  reasons: string[];
};

export type OperatingWindow = {
  start: string;
  end: string;
  hours: number;
};

type Finding = { status: Exclude<OperatingStatus, "green">; reason: string };

function upperLimit(value: number | null, limit: number | null, label: string): Finding | null {
  if (limit == null) return { status: "gray", reason: `${label}: предел не настроен` };
  if (value == null) return { status: "gray", reason: `${label}: нет данных` };
  if (value > limit) return { status: "red", reason: `${label} выше предела ${limit}` };
  if (limit > 0 && value >= limit * 0.92) return { status: "orange", reason: `${label} почти у предела ${limit}` };
  if (limit > 0 && value >= limit * 0.75) return { status: "yellow", reason: `${label} близко к пределу ${limit}` };
  return null;
}

function temperatureFinding(value: number | null, minimum: number | null, maximum: number | null): Finding | null {
  if (value == null) return { status: "gray", reason: "Температура: нет данных" };
  if (minimum == null && maximum == null) return { status: "gray", reason: "Температура: границы не настроены" };
  if (minimum != null && value < minimum) return { status: "red", reason: `Температура ниже ${minimum} °C` };
  if (maximum != null && value > maximum) return { status: "red", reason: `Температура выше ${maximum} °C` };
  const margin = minimum != null && maximum != null ? Math.max(1, (maximum - minimum) * 0.2) : 2;
  if (minimum != null && value <= minimum + margin * 0.4) return { status: "orange", reason: `Температура почти у минимума ${minimum} °C` };
  if (maximum != null && value >= maximum - margin * 0.4) return { status: "orange", reason: `Температура почти у максимума ${maximum} °C` };
  if (minimum != null && value <= minimum + margin) return { status: "yellow", reason: `Температура близко к минимуму ${minimum} °C` };
  if (maximum != null && value >= maximum - margin) return { status: "yellow", reason: `Температура близко к максимуму ${maximum} °C` };
  return null;
}

export function evaluateOperatingHour(point: WeatherPoint, profile: WeatherProfile | null): OperatingHour {
  if (!profile) return { point, status: "gray", reasons: ["Выберите или создайте профиль"] };
  if (!profile.windEnabled
    && !profile.gustEnabled
    && !profile.precipitationEnabled
    && !profile.precipitationProbabilityEnabled
    && !profile.temperatureEnabled) {
    return { point, status: "gray", reasons: ["В профиле не включены критерии"] };
  }
  const findings: Finding[] = [];

  if (profile.windEnabled) {
    const finding = upperLimit(point.windMs, profile.maxWindMs, "Ветер");
    if (finding) findings.push(finding);
  }
  if (profile.gustEnabled) {
    const finding = upperLimit(point.gustMs, profile.maxGustMs, "Порывы");
    if (finding) findings.push(finding);
  }
  if (profile.precipitationEnabled) {
    if (point.precipitationRateMmH == null) {
      findings.push({ status: "gray", reason: "Осадки: нет данных" });
    } else if (profile.precipitationMode === "forbidden") {
      if (point.precipitationRateMmH > 0) findings.push({ status: "red", reason: "Прогнозируются осадки" });
    } else {
      const finding = upperLimit(point.precipitationRateMmH, profile.maxPrecipitationMmH, "Осадки");
      if (finding) findings.push(finding);
    }
  }
  if (profile.precipitationProbabilityEnabled) {
    const finding = upperLimit(point.precipitationProbabilityPct, profile.maxPrecipitationProbabilityPct, "Вероятность осадков");
    if (finding) findings.push(finding);
  }
  if (profile.temperatureEnabled) {
    const finding = temperatureFinding(point.temperatureC, profile.minTemperatureC, profile.maxTemperatureC);
    if (finding) findings.push(finding);
  }

  const status: OperatingStatus = findings.some((item) => item.status === "red")
    ? "red"
    : findings.some((item) => item.status === "gray")
      ? "gray"
      : findings.some((item) => item.status === "orange")
        ? "orange"
        : findings.some((item) => item.status === "yellow")
          ? "yellow"
          : "green";
  return { point, status, reasons: findings.map((item) => item.reason) };
}

export function evaluateOperatingHours(points: WeatherPoint[], profile: WeatherProfile | null, limit = 48): OperatingHour[] {
  return points.slice(0, limit).map((point) => evaluateOperatingHour(point, profile));
}

export function operatingHourScore(hour: OperatingHour): number {
  if (hour.status === "green") return 9;
  if (hour.status === "yellow") return 7;
  if (hour.status === "orange") return 5;
  if (hour.status === "red") return 2;
  return 0;
}

export function findOperatingWindows(hours: OperatingHour[]): OperatingWindow[] {
  const windows: OperatingWindow[] = [];
  let startIndex = -1;
  const appendWindow = (endIndex: number) => {
    if (startIndex < 0 || endIndex < startIndex) return;
    const first = hours[startIndex];
    const last = hours[endIndex];
    if (first && last) {
      const intervalMs = endIndex > startIndex
        ? Math.max(1, Date.parse(last.point.time) - Date.parse(hours[endIndex - 1].point.time))
        : 60 * 60_000;
      windows.push({
        start: first.point.time,
        end: new Date(Date.parse(last.point.time) + intervalMs).toISOString(),
        hours: endIndex - startIndex + 1,
      });
    }
    startIndex = -1;
  };

  hours.forEach((hour, index) => {
    const previous = hours[index - 1];
    const continuous = !previous || Date.parse(hour.point.time) - Date.parse(previous.point.time) <= 90 * 60_000;
    if (startIndex >= 0 && (!continuous || hour.status !== "green")) appendWindow(index - 1);
    if (hour.status === "green" && startIndex < 0) startIndex = index;
    if (index === hours.length - 1 && startIndex >= 0) appendWindow(index);
  });
  return windows;
}
