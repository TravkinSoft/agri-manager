import { z } from "zod";

const nullableNumber = (minimum: number, maximum: number) => z.number().finite().min(minimum).max(maximum).nullable();

export const weatherProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  windEnabled: z.boolean(),
  maxWindMs: nullableNumber(0, 100),
  gustEnabled: z.boolean(),
  maxGustMs: nullableNumber(0, 150),
  precipitationEnabled: z.boolean(),
  precipitationMode: z.enum(["forbidden", "maximum"]),
  maxPrecipitationMmH: nullableNumber(0, 500),
  precipitationProbabilityEnabled: z.boolean(),
  maxPrecipitationProbabilityPct: nullableNumber(0, 100),
  temperatureEnabled: z.boolean(),
  minTemperatureC: nullableNumber(-100, 100),
  maxTemperatureC: nullableNumber(-100, 100),
  isDefault: z.boolean().default(false),
}).superRefine((value, context) => {
  const required = [
    [value.windEnabled, value.maxWindMs, "maxWindMs"],
    [value.gustEnabled, value.maxGustMs, "maxGustMs"],
    [value.precipitationEnabled && value.precipitationMode === "maximum", value.maxPrecipitationMmH, "maxPrecipitationMmH"],
    [value.precipitationProbabilityEnabled, value.maxPrecipitationProbabilityPct, "maxPrecipitationProbabilityPct"],
  ] as const;
  required.forEach(([enabled, metric, path]) => {
    if (enabled && metric == null) context.addIssue({ code: "custom", path: [path], message: "Укажите предел" });
  });
  if (value.temperatureEnabled && value.minTemperatureC == null && value.maxTemperatureC == null) {
    context.addIssue({ code: "custom", path: ["minTemperatureC"], message: "Укажите хотя бы одну границу" });
  }
  if (value.minTemperatureC != null && value.maxTemperatureC != null && value.minTemperatureC > value.maxTemperatureC) {
    context.addIssue({ code: "custom", path: ["maxTemperatureC"], message: "Максимум должен быть не ниже минимума" });
  }
});

export type WeatherProfileInput = z.infer<typeof weatherProfileInputSchema>;

export type WeatherProfile = WeatherProfileInput & {
  id: string;
  companyId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
};

export type WeatherProfileRow = {
  id: string;
  company_id: string;
  user_id: string;
  name: string;
  wind_enabled: boolean;
  max_wind_ms: number | null;
  gust_enabled: boolean;
  max_gust_ms: number | null;
  precipitation_enabled: boolean;
  precipitation_mode: "forbidden" | "maximum";
  max_precipitation_mmh: number | null;
  precipitation_probability_enabled: boolean;
  max_precipitation_probability_pct: number | null;
  temperature_enabled: boolean;
  min_temperature_c: number | null;
  max_temperature_c: number | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export function weatherProfileFromRow(row: WeatherProfileRow): WeatherProfile {
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    name: row.name,
    windEnabled: row.wind_enabled,
    maxWindMs: row.max_wind_ms,
    gustEnabled: row.gust_enabled,
    maxGustMs: row.max_gust_ms,
    precipitationEnabled: row.precipitation_enabled,
    precipitationMode: row.precipitation_mode,
    maxPrecipitationMmH: row.max_precipitation_mmh,
    precipitationProbabilityEnabled: row.precipitation_probability_enabled,
    maxPrecipitationProbabilityPct: row.max_precipitation_probability_pct,
    temperatureEnabled: row.temperature_enabled,
    minTemperatureC: row.min_temperature_c,
    maxTemperatureC: row.max_temperature_c,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function weatherProfileToRow(input: WeatherProfileInput) {
  return {
    name: input.name.trim(),
    wind_enabled: input.windEnabled,
    max_wind_ms: input.maxWindMs,
    gust_enabled: input.gustEnabled,
    max_gust_ms: input.maxGustMs,
    precipitation_enabled: input.precipitationEnabled,
    precipitation_mode: input.precipitationMode,
    max_precipitation_mmh: input.maxPrecipitationMmH,
    precipitation_probability_enabled: input.precipitationProbabilityEnabled,
    max_precipitation_probability_pct: input.maxPrecipitationProbabilityPct,
    temperature_enabled: input.temperatureEnabled,
    min_temperature_c: input.minTemperatureC,
    max_temperature_c: input.maxTemperatureC,
    is_default: input.isDefault,
  };
}

export const emptyWeatherProfile: WeatherProfileInput = {
  name: "",
  windEnabled: false,
  maxWindMs: null,
  gustEnabled: false,
  maxGustMs: null,
  precipitationEnabled: false,
  precipitationMode: "forbidden",
  maxPrecipitationMmH: null,
  precipitationProbabilityEnabled: false,
  maxPrecipitationProbabilityPct: null,
  temperatureEnabled: false,
  minTemperatureC: null,
  maxTemperatureC: null,
  isDefault: false,
};
