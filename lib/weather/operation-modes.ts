import type { WeatherProfile } from "@/lib/weather/profile";

export type WeatherOperationMode = "general" | "spraying" | "fertilizing" | "sowing" | "harvest" | "custom";

export const WEATHER_OPERATION_MODES: Array<{ value: Exclude<WeatherOperationMode, "custom">; label: string }> = [
  { value: "general", label: "Общие работы" },
  { value: "spraying", label: "Опрыскивание" },
  { value: "fertilizing", label: "Удобрения" },
  { value: "sowing", label: "Посев" },
  { value: "harvest", label: "Уборка" },
];

const limits: Record<Exclude<WeatherOperationMode, "custom">, Pick<WeatherProfile,
  "maxWindMs" | "maxGustMs" | "precipitationMode" | "maxPrecipitationMmH" |
  "maxPrecipitationProbabilityPct" | "minTemperatureC" | "maxTemperatureC">> = {
  general: { maxWindMs: 8, maxGustMs: 12, precipitationMode: "maximum", maxPrecipitationMmH: 1, maxPrecipitationProbabilityPct: 70, minTemperatureC: -5, maxTemperatureC: 40 },
  spraying: { maxWindMs: 4, maxGustMs: 6, precipitationMode: "forbidden", maxPrecipitationMmH: null, maxPrecipitationProbabilityPct: 25, minTemperatureC: 5, maxTemperatureC: 30 },
  fertilizing: { maxWindMs: 6, maxGustMs: 9, precipitationMode: "maximum", maxPrecipitationMmH: 0.5, maxPrecipitationProbabilityPct: 50, minTemperatureC: 0, maxTemperatureC: 35 },
  sowing: { maxWindMs: 8, maxGustMs: 12, precipitationMode: "maximum", maxPrecipitationMmH: 2, maxPrecipitationProbabilityPct: 75, minTemperatureC: 0, maxTemperatureC: 35 },
  harvest: { maxWindMs: 8, maxGustMs: 12, precipitationMode: "maximum", maxPrecipitationMmH: 0.2, maxPrecipitationProbabilityPct: 40, minTemperatureC: -2, maxTemperatureC: 38 },
};

export function operationModeProfile(mode: Exclude<WeatherOperationMode, "custom">): WeatherProfile {
  const value = limits[mode];
  return {
    id: `operation-${mode}`,
    companyId: "runtime",
    userId: "runtime",
    name: WEATHER_OPERATION_MODES.find((item) => item.value === mode)?.label || mode,
    windEnabled: true,
    maxWindMs: value.maxWindMs,
    gustEnabled: true,
    maxGustMs: value.maxGustMs,
    precipitationEnabled: true,
    precipitationMode: value.precipitationMode,
    maxPrecipitationMmH: value.maxPrecipitationMmH,
    precipitationProbabilityEnabled: true,
    maxPrecipitationProbabilityPct: value.maxPrecipitationProbabilityPct,
    temperatureEnabled: true,
    minTemperatureC: value.minTemperatureC,
    maxTemperatureC: value.maxTemperatureC,
    isDefault: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}
