const MPH_TO_MS = 0.44704;
const KPH_TO_MS = 1 / 3.6;
const FEET_TO_METERS = 0.3048;
const MILES_TO_KM = 1.609344;
const INCHES_TO_MM = 25.4;

export function fahrenheitToCelsius(value: number): number {
  return (value - 32) * (5 / 9);
}

export function mphToMs(value: number): number {
  return value * MPH_TO_MS;
}

export function kphToMs(value: number): number {
  return value * KPH_TO_MS;
}

export function feetToMeters(value: number): number {
  return value * FEET_TO_METERS;
}

export function milesToKm(value: number): number {
  return value * MILES_TO_KM;
}

export function inchesToMm(value: number): number {
  return value * INCHES_TO_MM;
}

export function normalizePercentage(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return clamp(roundMetric(percent, 1), 0, 100);
}

export function roundMetric(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeTemperature(value: number | null, unit: string | null): number | null {
  if (value == null) return null;
  const normalizedUnit = normalizeUnit(unit);
  if (normalizedUnit === "f" || normalizedUnit === "fahrenheit") {
    return roundMetric(fahrenheitToCelsius(value), 1);
  }
  if (normalizedUnit === "k" || normalizedUnit === "kelvin") {
    return roundMetric(value - 273.15, 1);
  }
  return roundMetric(value, 1);
}

export function normalizeWind(value: number | null, unit: string | null): number | null {
  if (value == null) return null;
  const normalizedUnit = normalizeUnit(unit);
  if (["mph", "mi/h", "miles/hour"].includes(normalizedUnit)) return roundMetric(mphToMs(value), 1);
  if (["km/h", "kph", "kmh"].includes(normalizedUnit)) return roundMetric(kphToMs(value), 1);
  return roundMetric(value, 1);
}

export function normalizeAltitude(value: number | null, unit: string | null): number | null {
  if (value == null) return null;
  const normalizedUnit = normalizeUnit(unit);
  if (["ft", "feet", "foot"].includes(normalizedUnit)) return roundMetric(feetToMeters(value), 0);
  return roundMetric(value, 0);
}

export function normalizeVisibility(value: number | null, unit: string | null): number | null {
  if (value == null) return null;
  const normalizedUnit = normalizeUnit(unit);
  if (["mi", "mile", "miles"].includes(normalizedUnit)) return roundMetric(milesToKm(value), 1);
  if (["m", "meter", "meters"].includes(normalizedUnit)) return roundMetric(value / 1000, 1);
  return roundMetric(value, 1);
}

export function normalizePrecipitation(value: number | null, unit: string | null): number | null {
  if (value == null) return null;
  const normalizedUnit = normalizeUnit(unit);
  if (["in", "inch", "inches"].includes(normalizedUnit)) return roundMetric(inchesToMm(value), 2);
  if (["cm", "centimeter", "centimeters"].includes(normalizedUnit)) return roundMetric(value * 10, 2);
  return roundMetric(value, 2);
}

export function normalizePrecipitationRate(value: number | null, unit: string | null): number | null {
  if (value == null) return null;
  const normalizedUnit = normalizeUnit(unit);
  if (["in/h", "in/hr", "inch/hour", "inches/hour"].includes(normalizedUnit)) {
    return roundMetric(inchesToMm(value), 2);
  }
  return roundMetric(value, 2);
}

export function normalizeUnit(unit: string | null | undefined): string {
  return String(unit || "")
    .trim()
    .toLowerCase()
    .replace(/°/g, "")
    .replace(/\s+/g, "");
}
