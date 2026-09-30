export type WeatherValue = number | null;

export type WeatherPoint = {
  time: string;
  temperatureC: WeatherValue;
  dewPointC: WeatherValue;
  windMs: WeatherValue;
  windBearingDeg: WeatherValue;
  gustMs: WeatherValue;
  gustBearingDeg: WeatherValue;
  precipitationProbabilityPct: WeatherValue;
  precipitationRateMmH: WeatherValue;
  precipitationType: string | null;
  cloudCoverPct: WeatherValue;
  cloudBaseM: WeatherValue;
  visibilityKm: WeatherValue;
  humidityPct: WeatherValue;
  densityAltitudeM: WeatherValue;
  pressureMslHpa: WeatherValue;
  visibleSatellites: WeatherValue;
  kp: WeatherValue;
  estimatedSatellitesLocked: WeatherValue;
};

export type WeatherSun = {
  date: string;
  sunrise: string | null;
  solarNoon: string | null;
  sunset: string | null;
};

export type WeatherLocation = {
  latitude: number;
  longitude: number;
  region: string | null;
  district: string | null;
  locality: string | null;
  displayName: string;
  katoCode?: string | null;
};

export type WeatherProviderMeta = {
  provider: "UAV Forecast";
  schemaVersion: string;
  timezone: string | null;
  utcOffsetMinutes: number | null;
  units: Record<string, string>;
  forecastPoints: number;
  availableUntil: string | null;
  requestStartedAt: string;
  responseReceivedAt: string;
  responseTimeMs: number;
  cache: "hit" | "miss" | "stale";
  rateLimit: Record<string, string> | null;
  billing: Record<string, string> | null;
  forecastHours: number;
  windAltitudesM: number[];
};

export type NormalizedWeather = {
  location: WeatherLocation;
  current: WeatherPoint;
  hourlyForecast: WeatherPoint[];
  sun: WeatherSun[];
  providerMeta: WeatherProviderMeta;
  rawCapabilities: string[];
  updatedAt: string;
  stale: boolean;
};

export type LocationResolverResult = WeatherLocation & {
  provider:
    | "KATO + OpenStreetMap Nominatim"
    | "KATO + Open-Meteo/OSM resolver"
    | "Device geolocation + OpenStreetMap Nominatim";
};

export type WeatherErrorCode =
  | "AUTH_INVALID"
  | "BALANCE_EXHAUSTED"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "LOCATION_NOT_FOUND"
  | "TIMEOUT"
  | "INVALID_PROVIDER_RESPONSE"
  | "NETWORK_UNAVAILABLE"
  | "NOT_CONFIGURED";

export class WeatherProviderError extends Error {
  code: WeatherErrorCode;
  status: number;
  technicalDetails: string;

  constructor(code: WeatherErrorCode, message: string, status: number, technicalDetails = "") {
    super(message);
    this.name = "WeatherProviderError";
    this.code = code;
    this.status = status;
    this.technicalDetails = technicalDetails;
  }
}
