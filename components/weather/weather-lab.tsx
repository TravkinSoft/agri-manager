"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  Cloud,
  CloudRain,
  Compass,
  LocateFixed,
  Loader2,
  MapPin,
  Navigation,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Thermometer,
  Trash2,
  Wind,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { evaluateOperatingHours, findOperatingWindows, operatingHourScore, type OperatingHour, type OperatingStatus } from "@/lib/weather/operating-window";
import { operationModeProfile, WEATHER_OPERATION_MODES, type WeatherOperationMode } from "@/lib/weather/operation-modes";
import { aggregateWeatherDays, findAvoidWindows } from "@/lib/weather/timeline";
import { emptyWeatherProfile, weatherProfileInputSchema, type WeatherProfile, type WeatherProfileInput } from "@/lib/weather/profile";
import { formatWeatherTime, relativeWeatherAge } from "@/lib/weather/time";
import type { NormalizedWeather, WeatherLocation, WeatherPoint } from "@/lib/weather/types";

type RecentLocation = WeatherLocation & { provider?: string };
type PickerMode = "search" | "list";
type KatoRegion = { code: string; nameRu: string; nameKz: string };
type KatoDistrict = KatoRegion & { regionCode: string };
type KatoLocality = {
  code: string;
  nameRu: string;
  nameKz: string;
  districtCode: string;
  districtRu: string;
  districtKz: string;
  regionCode: string;
  regionRu: string;
  regionKz: string;
};

const RECENT_KEY = "travkin-weather-lab:recent:v1";
const ACTIVE_KEY = "travkin-weather-lab:active-location:v2";
const LOCAL_WEATHER_PREFIX = "travkin-weather-lab:forecast:v2";
const LOCAL_CACHE_TTL_MS = 10 * 60 * 1000;

function metric(value: number | null, maximumFractionDigits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits }).format(value);
}

function signedTemperature(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${metric(value)} °C`;
}

function windDirection(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const normalized = ((value % 360) + 360) % 360;
  const points = ["С", "ССВ", "СВ", "ВСВ", "В", "ВЮВ", "ЮВ", "ЮЮВ", "Ю", "ЮЮЗ", "ЮЗ", "ЗЮЗ", "З", "ЗСЗ", "СЗ", "ССЗ"];
  const point = points[Math.round(normalized / 22.5) % points.length];
  return `${point} · ${Math.round(normalized)}°`;
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function localWeatherKey(location: WeatherLocation): string {
  return `${LOCAL_WEATHER_PREFIX}:${location.latitude.toFixed(3)}:${location.longitude.toFixed(3)}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function authorizedJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Сессия истекла. Войдите снова.");
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const technical = String(payload?.technicalDetails || "").trim();
    throw new Error([payload?.error || `HTTP ${response.status}`, technical].filter(Boolean).join(" · "));
  }
  return payload as T;
}

function saveRecent(location: RecentLocation): RecentLocation[] {
  const existing = readJson<RecentLocation[]>(RECENT_KEY) || [];
  const identity = `${location.latitude.toFixed(4)}:${location.longitude.toFixed(4)}`;
  const next = [location, ...existing.filter((item) => `${item.latitude.toFixed(4)}:${item.longitude.toFixed(4)}` !== identity)].slice(0, 5);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Cloud; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-[#F4F6FA]">
      <Icon className="h-4 w-4 text-[#E0B100]" />
      {children}
    </div>
  );
}

function MetricTile({ label, value, hint, icon: Icon }: { label: string; value: string; hint?: string; icon: typeof Cloud }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#2A3344] bg-[#171D29] p-3 sm:p-4">
      <div className="flex items-center gap-2 text-xs text-[#98A4B7]">
        <Icon className="h-4 w-4 text-[#E0B100]" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 whitespace-nowrap text-xl font-semibold text-[#F6F7F9] sm:text-2xl">{value}</div>
      {hint ? <div className="mt-1 truncate text-[11px] text-[#7F8A9B]">{hint}</div> : null}
    </div>
  );
}

function AdditionalMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 border-b border-[#252D3C] py-2 text-sm last:border-0">
      <span className="text-[#98A4B7]">{label}</span>
      <span className="truncate text-right font-medium text-[#F3F4F6]">{value}</span>
    </div>
  );
}

const STATUS_LABELS: Record<OperatingStatus, string> = {
  green: "Подходит",
  yellow: "Близко к пределу",
  orange: "Условно допустимо",
  red: "Не подходит",
  gray: "Недостаточно данных",
};

function profileToInput(profile: WeatherProfile): WeatherProfileInput {
  const { id: _id, companyId: _companyId, userId: _userId, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = profile;
  return input;
}

function previewProfile(input: WeatherProfileInput, existing?: WeatherProfile | null): WeatherProfile {
  return {
    ...input,
    id: existing?.id || "preview",
    companyId: existing?.companyId || "preview",
    userId: existing?.userId || "preview",
    createdAt: existing?.createdAt || new Date(0).toISOString(),
    updatedAt: existing?.updatedAt || new Date(0).toISOString(),
  };
}

function formatWeatherDay(value: string, weather: NormalizedWeather): string {
  const date = new Date(value);
  const options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", weekday: "short" };
  try {
    return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: weather.providerMeta.timezone || undefined }).format(date);
  } catch {
    return new Intl.DateTimeFormat("ru-RU", options).format(date);
  }
}

function dayKey(value: string, weather: NormalizedWeather): string {
  const date = new Date(value);
  try {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: weather.providerMeta.timezone || undefined }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatWindow(value: string, weather: NormalizedWeather, includeDate: boolean): string {
  return formatWeatherTime(value, {
    timezone: weather.providerMeta.timezone,
    utcOffsetMinutes: weather.providerMeta.utcOffsetMinutes,
    includeDate,
  });
}

function statusDot(status: OperatingStatus): string {
  return status === "green" ? "bg-emerald-400" : status === "yellow" ? "bg-amber-300" : status === "orange" ? "bg-orange-400" : status === "red" ? "bg-red-400" : "bg-slate-400";
}

function statusTrack(status: OperatingStatus): string {
  if (status === "green") return "bg-emerald-500";
  if (status === "yellow") return "bg-amber-300";
  if (status === "orange") return "bg-orange-500";
  if (status === "red") return "bg-red-600";
  return "bg-slate-600";
}

function OperatingHourDetails({ hour, weather }: { hour: OperatingHour; weather: NormalizedWeather }) {
  const point = hour.point;
  return (
    <div className="grid gap-3 border-t border-[#2A3344] px-3 py-3 text-sm sm:grid-cols-[120px_1fr] sm:px-4">
      <div>
        <div className="font-semibold text-white">{formatWindow(point.time, weather, true)}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-[#A7B2C3]"><span className={cn("h-2 w-2 rounded-full", statusDot(hour.status))} />{STATUS_LABELS[hour.status]}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#C5CEDA] sm:grid-cols-3 lg:grid-cols-7">
        <span>Температура <b className="text-white">{signedTemperature(point.temperatureC)}</b></span>
        <span>Точка росы <b className="text-white">{signedTemperature(point.dewPointC)}</b></span>
        <span>Ветер <b className="text-white">{metric(point.windMs)} м/с</b></span>
        <span>Направление <b className="text-white">{windDirection(point.windBearingDeg)}</b></span>
        <span>Порывы <b className="text-white">{metric(point.gustMs)} м/с</b></span>
        <span>Осадки <b className="text-white">{metric(point.precipitationRateMmH)} мм/ч</b></span>
        <span>Вероятность <b className="text-white">{metric(point.precipitationProbabilityPct, 0)}%</b></span>
        {hour.reasons.length ? <span className="col-span-2 mt-1 text-[#AEB8C7] sm:col-span-3 lg:col-span-7">{hour.reasons.join(" · ")}</span> : null}
      </div>
    </div>
  );
}

function CriterionRow({ label, enabled, onEnabledChange, children }: { label: string; enabled: boolean; onEnabledChange: (value: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-[#293244] py-3 last:border-0 sm:grid-cols-[150px_1fr] sm:items-center">
      <label className="flex items-center gap-2 text-sm font-medium text-white">
        <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label={`Учитывать: ${label}`} />
        {label}
      </label>
      <div className={cn("min-w-0", !enabled && "pointer-events-none opacity-45")}>{children}</div>
    </div>
  );
}

export function WeatherLab({ showTechnicalDebug = false }: { showTechnicalDebug?: boolean }) {
  const pickerScrollRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<RecentLocation | null>(null);
  const [weather, setWeather] = useState<NormalizedWeather | null>(null);
  const [resolving, setResolving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>("search");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<KatoLocality[]>([]);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [resolvingCode, setResolvingCode] = useState<string | null>(null);
  const [regions, setRegions] = useState<KatoRegion[]>([]);
  const [districts, setDistricts] = useState<KatoDistrict[]>([]);
  const [localities, setLocalities] = useState<KatoLocality[]>([]);
  const [listRegion, setListRegion] = useState<KatoRegion | null>(null);
  const [listDistrict, setListDistrict] = useState<KatoDistrict | null>(null);
  const [profiles, setProfiles] = useState<WeatherProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<WeatherProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState<WeatherProfileInput>(emptyWeatherProfile);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [selectedHourTime, setSelectedHourTime] = useState<string | null>(null);
  const [operationMode, setOperationMode] = useState<WeatherOperationMode>("general");
  const [timelineMode, setTimelineMode] = useState<"48h" | "7d">("48h");

  const loadForecast = useCallback(async (location: RecentLocation, force = false) => {
    setSelected(location);
    setError(null);
    const key = localWeatherKey(location);
    const cached = readJson<{ savedAt: number; weather: NormalizedWeather }>(key);
    if (!force && cached?.weather) {
      setWeather(cached.weather);
      if (Date.now() - cached.savedAt < LOCAL_CACHE_TTL_MS) return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        lat: String(location.latitude),
        lon: String(location.longitude),
        displayName: location.displayName,
      });
      if (location.region) params.set("region", location.region);
      if (location.district) params.set("district", location.district);
      if (location.locality) params.set("locality", location.locality);
      if (location.katoCode) params.set("katoCode", location.katoCode);
      if (force) params.set("refresh", "1");
      const payload = await authorizedJson<{ weather: NormalizedWeather }>(`/api/weather-lab/forecast?${params}`);
      setWeather(payload.weather);
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), weather: payload.weather }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось получить прогноз");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const storedRecent = readJson<RecentLocation[]>(RECENT_KEY) || [];
    const active = readJson<RecentLocation>(ACTIVE_KEY) || storedRecent[0] || null;
    if (active) void loadForecast(active);
  }, [loadForecast]);

  useEffect(() => {
    let cancelled = false;
    setProfilesLoading(true);
    void authorizedJson<{ profiles: WeatherProfile[] }>("/api/weather-lab/profiles")
      .then((payload) => {
        if (cancelled) return;
        setProfiles(payload.profiles);
        const selectedProfile = payload.profiles.find((item) => item.isDefault) || payload.profiles[0] || null;
        setActiveProfileId(selectedProfile?.id || null);
      })
      .catch((requestError) => {
        if (!cancelled) setProfileError(requestError instanceof Error ? requestError.message : "Не удалось загрузить профили");
      })
      .finally(() => {
        if (!cancelled) setProfilesLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const chooseLocation = useCallback(async (location: RecentLocation) => {
    saveRecent(location);
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(location));
    await loadForecast(location);
  }, [loadForecast]);

  const chooseKatoLocation = async (item: KatoLocality) => {
    setResolvingCode(item.code);
    setPickerError(null);
    setPickerOpen(false);
    try {
      const params = new URLSearchParams({ katoCode: item.code });
      const payload = await authorizedJson<{ location: RecentLocation }>(`/api/weather-lab/location?${params}`);
      void chooseLocation(payload.location);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось точно определить координаты выбранного объекта КАТО");
    } finally {
      setResolvingCode(null);
    }
  };

  useEffect(() => {
    if (!pickerOpen || pickerMode !== "search") return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setPickerError(null);
      try {
        const params = new URLSearchParams({ mode: "search", q: trimmed });
        const payload = await authorizedJson<{ items: KatoLocality[] }>(`/api/weather-lab/kato?${params}`);
        if (!cancelled) setSearchResults(payload.items);
      } catch (requestError) {
        if (!cancelled) setPickerError(requestError instanceof Error ? requestError.message : "Поиск КАТО недоступен");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pickerMode, pickerOpen, query]);

  const loadRegions = useCallback(async () => {
    if (regions.length) return;
    const payload = await authorizedJson<{ items: KatoRegion[] }>("/api/weather-lab/kato?mode=regions");
    setRegions(payload.items);
  }, [regions.length]);

  useEffect(() => {
    if (pickerOpen && pickerMode === "list") {
      void loadRegions().catch((requestError) => setPickerError(requestError instanceof Error ? requestError.message : "Список КАТО недоступен"));
    }
  }, [loadRegions, pickerMode, pickerOpen]);

  useEffect(() => {
    pickerScrollRef.current?.scrollTo({ top: 0 });
  }, [pickerMode, query, listRegion?.code, listDistrict?.code]);

  const chooseRegion = async (item: KatoRegion) => {
    setPickerError(null);
    setListRegion(item);
    setListDistrict(null);
    setLocalities([]);
    try {
      const params = new URLSearchParams({ mode: "districts", parent: item.code });
      const payload = await authorizedJson<{ items: KatoDistrict[] }>(`/api/weather-lab/kato?${params}`);
      setDistricts(payload.items);
      if (!payload.items.length) {
        const localityParams = new URLSearchParams({ mode: "localities", parent: item.code });
        const localityPayload = await authorizedJson<{ items: KatoLocality[] }>(`/api/weather-lab/kato?${localityParams}`);
        if (localityPayload.items.length === 1) {
          await chooseKatoLocation(localityPayload.items[0]);
          return;
        }
        setLocalities(localityPayload.items);
        setListDistrict({ ...item, regionCode: item.code });
      }
    } catch (requestError) {
      setPickerError(requestError instanceof Error ? requestError.message : "Не удалось загрузить районы");
    }
  };

  const chooseDistrict = async (item: KatoDistrict) => {
    setPickerError(null);
    setListDistrict(item);
    try {
      const params = new URLSearchParams({ mode: "localities", parent: item.code });
      const payload = await authorizedJson<{ items: KatoLocality[] }>(`/api/weather-lab/kato?${params}`);
      setLocalities(payload.items);
    } catch (requestError) {
      setPickerError(requestError instanceof Error ? requestError.message : "Не удалось загрузить населённые пункты");
    }
  };

  const useBrowserLocation = () => {
    setError(null);
    if (!navigator.geolocation) {
      setError("Браузер не поддерживает геолокацию");
      return;
    }
    setResolving(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const params = new URLSearchParams({ lat: String(coords.latitude), lon: String(coords.longitude) });
          const payload = await authorizedJson<{ location: RecentLocation }>(`/api/weather-lab/location?${params}`);
          await chooseLocation(payload.location);
        } catch (requestError) {
          setError(requestError instanceof Error ? requestError.message : "Не удалось определить местоположение");
        } finally {
          setResolving(false);
        }
      },
      (geoError) => {
        setResolving(false);
        setError(geoError.code === geoError.PERMISSION_DENIED ? "Доступ к геолокации не разрешён" : "Не удалось получить геолокацию");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60 * 1000 }
    );
  };

  const activeProfile = useMemo(
    () => profiles.find((item) => item.id === activeProfileId) || profiles.find((item) => item.isDefault) || profiles[0] || null,
    [activeProfileId, profiles]
  );
  const modeProfile = useMemo(
    () => operationMode === "custom" ? activeProfile : operationModeProfile(operationMode),
    [activeProfile, operationMode]
  );
  const evaluationProfile = profileOpen
    ? previewProfile(profileDraft, editingProfile)
    : modeProfile;
  const operatingHours = useMemo(
    () => evaluateOperatingHours(weather?.hourlyForecast || [], evaluationProfile),
    [evaluationProfile, weather?.hourlyForecast]
  );
  const extendedOperatingHours = useMemo(
    () => evaluateOperatingHours(weather?.hourlyForecast || [], evaluationProfile, 24 * 7),
    [evaluationProfile, weather?.hourlyForecast]
  );
  const operatingWindows = useMemo(() => findOperatingWindows(operatingHours), [operatingHours]);
  const avoidWindows = useMemo(() => findAvoidWindows(operatingHours), [operatingHours]);
  const dailyWeather = useMemo(
    () => aggregateWeatherDays(extendedOperatingHours, weather?.providerMeta.timezone),
    [extendedOperatingHours, weather?.providerMeta.timezone]
  );
  const nearestWindow = operatingWindows[0] || null;
  const longestWindow = operatingWindows.reduce<(typeof operatingWindows)[number] | null>((longest, item) => !longest || item.hours > longest.hours ? item : longest, null);
  const selectedHour = operatingHours.find((item) => item.point.time === selectedHourTime) || operatingHours[0] || null;
  const selectedHourIndex = Math.max(0, selectedHour ? operatingHours.findIndex((item) => item.point.time === selectedHour.point.time) : 0);
  const currentHourIndex = Math.max(0, operatingHours.reduce((nearest, hour, index) => {
    const currentDistance = Math.abs(Date.parse(operatingHours[nearest]?.point.time || hour.point.time) - Date.now());
    const candidateDistance = Math.abs(Date.parse(hour.point.time) - Date.now());
    return candidateDistance < currentDistance ? index : nearest;
  }, 0));
  const nearestWindowHours = nearestWindow
    ? operatingHours.filter((hour) => Date.parse(hour.point.time) >= Date.parse(nearestWindow.start) && Date.parse(hour.point.time) < Date.parse(nearestWindow.end))
    : [];
  const nearestWindowScore = nearestWindowHours.length
    ? Math.round(nearestWindowHours.reduce((sum, hour) => sum + operatingHourScore(hour), 0) / nearestWindowHours.length)
    : 0;
  const avoidWindow = avoidWindows[0] || null;
  const avoidReasons = avoidWindow
    ? Array.from(new Set(operatingHours
      .filter((hour) => Date.parse(hour.point.time) >= Date.parse(avoidWindow.start) && Date.parse(hour.point.time) < Date.parse(avoidWindow.end))
      .flatMap((hour) => hour.reasons))).slice(0, 3)
    : [];
  const current = weather?.current || null;

  const openProfileEditor = (profile: WeatherProfile | null = null) => {
    setEditingProfile(profile);
    setProfileDraft(profile ? profileToInput(profile) : { ...emptyWeatherProfile, name: "" });
    setProfileError(null);
    setProfileOpen(true);
  };

  const saveProfile = async () => {
    const parsed = weatherProfileInputSchema.safeParse({
      ...profileDraft,
      isDefault: editingProfile ? editingProfile.id === activeProfile?.id : profiles.length === 0,
    });
    if (!parsed.success) {
      setProfileError(parsed.error.issues[0]?.message || "Проверьте профиль");
      return;
    }
    setProfileSaving(true);
    setProfileError(null);
    try {
      const url = editingProfile ? `/api/weather-lab/profiles/${editingProfile.id}` : "/api/weather-lab/profiles";
      const payload = await authorizedJson<{ profile: WeatherProfile }>(url, {
        method: editingProfile ? "PATCH" : "POST",
        body: JSON.stringify(parsed.data),
      });
      setProfiles((currentProfiles) => editingProfile
        ? currentProfiles.map((item) => item.id === payload.profile.id ? payload.profile : item)
        : [payload.profile, ...currentProfiles]);
      if (payload.profile.isDefault || !activeProfileId) setActiveProfileId(payload.profile.id);
      setProfileOpen(false);
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : "Не удалось сохранить профиль");
    } finally {
      setProfileSaving(false);
    }
  };

  const selectProfile = async (profile: WeatherProfile) => {
    setOperationMode("custom");
    if (profile.id === activeProfileId) return;
    const previousProfiles = profiles;
    const previousActiveId = activeProfileId;
    setActiveProfileId(profile.id);
    setProfiles((items) => items.map((item) => ({ ...item, isDefault: item.id === profile.id })));
    setProfileError(null);
    try {
      const payload = await authorizedJson<{ profile: WeatherProfile }>(`/api/weather-lab/profiles/${profile.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...profileToInput(profile), isDefault: true }),
      });
      setProfiles((items) => items.map((item) => item.id === payload.profile.id ? payload.profile : item));
    } catch (requestError) {
      setProfiles(previousProfiles);
      setActiveProfileId(previousActiveId);
      setProfileError(requestError instanceof Error ? requestError.message : "Не удалось выбрать профиль");
    }
  };

  const deleteProfile = async (profile: WeatherProfile) => {
    if (!window.confirm(`Удалить профиль «${profile.name}»?`)) return;
    setProfileSaving(true);
    setProfileError(null);
    try {
      await authorizedJson(`/api/weather-lab/profiles/${profile.id}`, { method: "DELETE" });
      const remaining = profiles.filter((item) => item.id !== profile.id);
      setProfiles(remaining);
      if (activeProfileId === profile.id) setActiveProfileId(remaining[0]?.id || null);
      setProfileOpen(false);
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : "Не удалось удалить профиль");
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1560px] space-y-4 text-[#D8DEE9]">
      <header>
        <div>
          <h1 className="text-2xl font-semibold text-white sm:text-3xl">Погода</h1>
          <p className="mt-1 text-sm text-[#98A4B7]">Лаборатория реального прогноза UAV Forecast</p>
        </div>
      </header>

      <section className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-[#2A3344] bg-[#121722] p-1.5 sm:px-2 md:max-w-[360px]">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-[#1A2130]"
          aria-label="Выбрать населённый пункт"
        >
          <MapPin className="h-4 w-4 shrink-0 text-[#E0B100]" />
          <span className="min-w-0 truncate text-sm font-medium text-[#F3F4F6]">
            {selected?.displayName || "Выберите населённый пункт"}
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={useBrowserLocation}
          disabled={resolving}
          title="Моё местоположение"
          aria-label="Моё местоположение"
          className="h-9 w-9 shrink-0 text-[#B8C2D1] hover:bg-[#202839] hover:text-white"
        >
          {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => selected && void loadForecast(selected, true)}
          disabled={loading || !selected}
          title="Обновить прогноз"
          aria-label="Обновить прогноз"
          className="h-9 w-9 shrink-0 text-[#B8C2D1] hover:bg-[#202839] hover:text-white"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </section>

      {pickerOpen ? (
      <Dialog open onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[85dvh] w-[calc(100vw-24px)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-[#303A4D] bg-[#121722] p-0 text-[#D8DEE9] sm:w-full">
          <DialogHeader className="border-b border-[#293244] px-4 pb-3 pt-4 text-left">
            <DialogTitle className="text-lg text-white">Местоположение</DialogTitle>
            <DialogDescription className="sr-only">Найдите населённый пункт в официальном КАТО или выберите его по списку.</DialogDescription>
            <div className="mt-3 grid grid-cols-2 rounded-md border border-[#303A4D] bg-[#0E121A] p-0.5">
              <button type="button" onClick={() => setPickerMode("search")} className={cn("h-8 rounded text-xs", pickerMode === "search" ? "bg-[#E0B100] font-medium text-[#111827]" : "text-[#A8B2C2] hover:text-white")}>Поиск</button>
              <button type="button" onClick={() => setPickerMode("list")} className={cn("h-8 rounded text-xs", pickerMode === "list" ? "bg-[#E0B100] font-medium text-[#111827]" : "text-[#A8B2C2] hover:text-white")}>По списку</button>
            </div>
          </DialogHeader>

          <div ref={pickerScrollRef} className="min-h-0 touch-pan-y overscroll-contain overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:p-4">
            {pickerMode === "search" ? (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#788397]" />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Населённый пункт, район или область"
                    className="h-10 border-[#323C50] bg-[#0E121A] pl-9 text-[#F3F4F6]"
                  />
                  {searching ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#E0B100]" /> : null}
                </div>
                {query.trim().length < 2 ? <div className="py-8 text-center text-sm text-[#8995A7]">Введите минимум 2 символа.</div> : null}
                {query.trim().length >= 2 && !searching && !searchResults.length ? <div className="py-8 text-center text-sm text-[#8995A7]">В официальном КАТО совпадений нет.</div> : null}
                <div className="space-y-1">
                  {searchResults.map((item) => (
                    <button key={item.code} type="button" onClick={() => void chooseKatoLocation(item)} disabled={Boolean(resolvingCode)} className="flex w-full min-w-0 items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-left hover:border-[#39455B] hover:bg-[#1A2130] disabled:opacity-60">
                      <MapPin className="h-4 w-4 shrink-0 text-[#E0B100]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-white">{item.nameRu}</span>
                        <span className="block truncate text-xs text-[#8F9BAD]">
                          {item.districtCode === item.regionCode ? item.regionRu : `${item.districtRu} · ${item.regionRu}`}
                        </span>
                      </span>
                      {resolvingCode === item.code ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#E0B100]" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {listRegion ? (
                  <button type="button" onClick={() => { setListRegion(null); setListDistrict(null); }} className="mb-2 flex h-9 items-center gap-2 text-sm text-[#B7C1D0] hover:text-white">
                    <ChevronLeft className="h-4 w-4" /> Регионы
                  </button>
                ) : null}
                {listDistrict ? (
                  <button type="button" onClick={() => setListDistrict(null)} className="mb-2 flex h-9 items-center gap-2 text-sm text-[#B7C1D0] hover:text-white">
                    <ChevronLeft className="h-4 w-4" /> {listRegion?.nameRu}
                  </button>
                ) : null}
                <div className="mb-2 text-xs text-[#7F8A9B]">
                  {!listRegion ? "Выберите регион" : !listDistrict ? "Выберите район или городскую администрацию" : "Выберите населённый пункт"}
                </div>
                <div className="space-y-1">
                  {!listRegion ? regions.map((item) => (
                    <button key={item.code} type="button" onClick={() => void chooseRegion(item)} className="w-full rounded-md px-3 py-2.5 text-left text-sm text-[#E5E9F0] hover:bg-[#1A2130]">{item.nameRu}</button>
                  )) : !listDistrict ? districts.map((item) => (
                    <button key={item.code} type="button" onClick={() => void chooseDistrict(item)} className="w-full rounded-md px-3 py-2.5 text-left text-sm text-[#E5E9F0] hover:bg-[#1A2130]">{item.nameRu}</button>
                  )) : localities.map((item) => (
                    <button key={item.code} type="button" onClick={() => void chooseKatoLocation(item)} disabled={Boolean(resolvingCode)} className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm text-[#E5E9F0] hover:bg-[#1A2130] disabled:opacity-60">
                      <span className="truncate">{item.nameRu}</span>
                      {resolvingCode === item.code ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#E0B100]" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {pickerError ? <div role="alert" className="mt-3 rounded-md border border-red-900/70 bg-red-950/25 p-3 text-xs text-red-200">{pickerError}</div> : null}
          </div>
          <div className="border-t border-[#293244] px-4 py-2 text-[11px] text-[#748095]">Источник названий: официальный КАТО Республики Казахстан, редакция 17.07.2026.</div>
        </DialogContent>
      </Dialog>
      ) : null}

      {error ? (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-900/70 bg-red-950/25 p-3 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><div className="font-medium">Прогноз недоступен</div><div className="mt-1 break-words text-xs text-red-200/80">{error}</div></div>
        </div>
      ) : null}

      <section className="min-w-0 rounded-lg border border-[#2A3344] bg-[#121722] p-2.5 sm:p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-[#98A4B7]">Рабочий профиль</span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {profilesLoading ? <Loader2 className="h-4 w-4 animate-spin text-[#E0B100]" /> : null}
            {!profilesLoading && !profiles.length ? <span className="truncate text-xs text-[#7F8A9B]">Не создан</span> : null}
            {profiles.map((profile) => (
              <div key={profile.id} className="flex shrink-0 items-center rounded-md border border-[#303A4D] bg-[#0E121A] p-0.5">
                <button
                  type="button"
                  onClick={() => void selectProfile(profile)}
                  className={cn("h-8 rounded px-3 text-xs", activeProfile?.id === profile.id ? "bg-[#E0B100] font-medium text-[#111827]" : "text-[#BAC4D2] hover:bg-[#1A2130] hover:text-white")}
                >
                  {profile.name}
                </button>
                <Button type="button" variant="ghost" size="icon" onClick={() => openProfileEditor(profile)} title="Изменить профиль" aria-label={`Изменить профиль ${profile.name}`} className="h-8 w-8 text-[#8F9BAD] hover:bg-[#202839] hover:text-white">
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => openProfileEditor()} className="h-9 shrink-0 border-[#39445A] bg-transparent px-2.5 text-[#E5E9F0] hover:bg-[#202839] hover:text-white">
            <Plus className="mr-1 h-4 w-4" /> Профиль
          </Button>
        </div>
        {profileError && !profileOpen ? <div role="alert" className="mt-2 text-xs text-red-300">{profileError}</div> : null}
      </section>

      {profileOpen ? (
        <Dialog open onOpenChange={(open) => !profileSaving && setProfileOpen(open)}>
          <DialogContent className="max-h-[88dvh] w-[calc(100vw-24px)] max-w-xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-[#303A4D] bg-[#121722] p-0 text-[#D8DEE9] sm:w-full">
            <DialogHeader className="border-b border-[#293244] px-4 pb-3 pt-4 text-left">
              <DialogTitle className="text-lg text-white">{editingProfile ? "Параметры профиля" : "Новый профиль"}</DialogTitle>
              <DialogDescription className="text-xs text-[#8F9BAD]">Статус часов рассчитывается только по включённым вами критериям.</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto px-4 py-3 [scrollbar-width:thin]">
              <label className="block text-xs font-medium text-[#AEB8C7]">
                Название
                <Input value={profileDraft.name} onChange={(event) => setProfileDraft((draft) => ({ ...draft, name: event.target.value }))} maxLength={80} autoFocus className="mt-1.5 h-10 border-[#323C50] bg-[#0E121A] text-white" />
              </label>
              <div className="mt-3 rounded-lg border border-[#293244] bg-[#10151F] px-3">
                <CriterionRow label="Ветер" enabled={profileDraft.windEnabled} onEnabledChange={(windEnabled) => setProfileDraft((draft) => ({ ...draft, windEnabled }))}>
                  <label className="text-xs text-[#98A4B7]">Максимум, м/с<Input inputMode="decimal" value={profileDraft.maxWindMs ?? ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, maxWindMs: numberOrNull(event.target.value) }))} className="mt-1 h-9 border-[#323C50] bg-[#0E121A] text-white" /></label>
                </CriterionRow>
                <CriterionRow label="Порывы" enabled={profileDraft.gustEnabled} onEnabledChange={(gustEnabled) => setProfileDraft((draft) => ({ ...draft, gustEnabled }))}>
                  <label className="text-xs text-[#98A4B7]">Максимум, м/с<Input inputMode="decimal" value={profileDraft.maxGustMs ?? ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, maxGustMs: numberOrNull(event.target.value) }))} className="mt-1 h-9 border-[#323C50] bg-[#0E121A] text-white" /></label>
                </CriterionRow>
                <CriterionRow label="Осадки" enabled={profileDraft.precipitationEnabled} onEnabledChange={(precipitationEnabled) => setProfileDraft((draft) => ({ ...draft, precipitationEnabled }))}>
                  <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
                    <div className="grid grid-cols-2 rounded-md border border-[#323C50] bg-[#0E121A] p-0.5">
                      {(["forbidden", "maximum"] as const).map((mode) => <button key={mode} type="button" onClick={() => setProfileDraft((draft) => ({ ...draft, precipitationMode: mode }))} className={cn("h-8 rounded px-2 text-xs", profileDraft.precipitationMode === mode ? "bg-[#E0B100] font-medium text-[#111827]" : "text-[#A8B2C2]")}>{mode === "forbidden" ? "Запрещены" : "До предела"}</button>)}
                    </div>
                    {profileDraft.precipitationMode === "maximum" ? <label className="text-xs text-[#98A4B7]">Максимум, мм/ч<Input inputMode="decimal" value={profileDraft.maxPrecipitationMmH ?? ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, maxPrecipitationMmH: numberOrNull(event.target.value) }))} className="mt-1 h-9 border-[#323C50] bg-[#0E121A] text-white" /></label> : null}
                  </div>
                </CriterionRow>
                <CriterionRow label="Вероятность" enabled={profileDraft.precipitationProbabilityEnabled} onEnabledChange={(precipitationProbabilityEnabled) => setProfileDraft((draft) => ({ ...draft, precipitationProbabilityEnabled }))}>
                  <label className="text-xs text-[#98A4B7]">Максимум, %<Input inputMode="decimal" value={profileDraft.maxPrecipitationProbabilityPct ?? ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, maxPrecipitationProbabilityPct: numberOrNull(event.target.value) }))} className="mt-1 h-9 border-[#323C50] bg-[#0E121A] text-white" /></label>
                </CriterionRow>
                <CriterionRow label="Температура" enabled={profileDraft.temperatureEnabled} onEnabledChange={(temperatureEnabled) => setProfileDraft((draft) => ({ ...draft, temperatureEnabled }))}>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-[#98A4B7]">Минимум, °C<Input inputMode="decimal" value={profileDraft.minTemperatureC ?? ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, minTemperatureC: numberOrNull(event.target.value) }))} className="mt-1 h-9 border-[#323C50] bg-[#0E121A] text-white" /></label>
                    <label className="text-xs text-[#98A4B7]">Максимум, °C<Input inputMode="decimal" value={profileDraft.maxTemperatureC ?? ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, maxTemperatureC: numberOrNull(event.target.value) }))} className="mt-1 h-9 border-[#323C50] bg-[#0E121A] text-white" /></label>
                  </div>
                </CriterionRow>
              </div>
              {profileError ? <div role="alert" className="mt-3 rounded-md border border-red-900/70 bg-red-950/25 p-2.5 text-xs text-red-200">{profileError}</div> : null}
            </div>
            <DialogFooter className="gap-2 border-t border-[#293244] px-4 py-3 sm:space-x-0">
              {editingProfile ? <Button type="button" variant="ghost" onClick={() => void deleteProfile(editingProfile)} disabled={profileSaving} className="mr-auto text-red-300 hover:bg-red-950/40 hover:text-red-200"><Trash2 className="mr-1.5 h-4 w-4" />Удалить</Button> : null}
              <Button type="button" variant="outline" onClick={() => setProfileOpen(false)} disabled={profileSaving} className="border-[#39445A] bg-transparent text-[#D8DEE9] hover:bg-[#202839] hover:text-white">Отмена</Button>
              <Button type="button" onClick={() => void saveProfile()} disabled={profileSaving} className="bg-[#E0B100] text-[#111827] hover:bg-[#F0C400]">{profileSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Сохранить</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {!weather && !loading ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-[#303A4D] px-5 text-center">
          <Navigation className="h-8 w-8 text-[#E0B100]" />
          <div className="mt-3 font-medium text-[#F3F4F6]">Выберите населённый пункт</div>
          <div className="mt-1 max-w-md text-sm text-[#8F9BAD]">Прогноз появится после определения координат выбранного города или села.</div>
        </div>
      ) : null}

      {loading && !weather ? <div className="h-72 animate-pulse rounded-lg bg-[#171D29]" /> : null}

      {weather && current ? (
        <>
          <section className="space-y-3">
            <div className="text-xs text-[#8995A7]">
              {relativeWeatherAge(weather.updatedAt)}
              {weather.stale ? <span className="ml-2 text-amber-300">· показаны последние сохранённые данные</span> : null}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
              <MetricTile label="Температура" value={signedTemperature(current.temperatureC)} icon={Thermometer} />
              <MetricTile label="Точка росы" value={signedTemperature(current.dewPointC)} hint="расчётная" icon={Thermometer} />
              <MetricTile label="Ветер" value={`${metric(current.windMs)} м/с`} icon={Wind} />
              <MetricTile label="Направление" value={windDirection(current.windBearingDeg)} icon={Navigation} />
              <MetricTile label="Порывы" value={`${metric(current.gustMs)} м/с`} icon={Compass} />
              <MetricTile label="Осадки" value={current.precipitationRateMmH != null ? `${metric(current.precipitationRateMmH)} мм/ч` : "—"} icon={CloudRain} />
              <MetricTile label="Вероятность" value={current.precipitationProbabilityPct != null ? `${metric(current.precipitationProbabilityPct, 0)}%` : "—"} icon={Cloud} />
            </div>
          </section>

          <section className="min-w-0 overflow-hidden rounded-lg border border-[#2A3344] bg-[#121722]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#293244] p-3 sm:p-4">
              <div>
                <SectionTitle icon={Wind}>Рабочее окно</SectionTitle>
                <div className="mt-1 text-xs text-[#8995A7]">{evaluationProfile?.name || "Профиль не выбран"}</div>
              </div>
              <div className="grid grid-cols-2 rounded-md border border-[#303A4D] bg-[#0E121A] p-0.5 text-xs">
                <button type="button" onClick={() => setTimelineMode("48h")} className={cn("h-8 rounded px-3", timelineMode === "48h" ? "bg-[#E0B100] font-medium text-[#111827]" : "text-[#A8B2C2]")}>48 часов</button>
                <button type="button" onClick={() => setTimelineMode("7d")} className={cn("h-8 rounded px-3", timelineMode === "7d" ? "bg-[#E0B100] font-medium text-[#111827]" : "text-[#A8B2C2]")}>7 дней</button>
              </div>
            </div>
            <div className="border-b border-[#293244] px-3 py-2 sm:px-4">
              <div className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {WEATHER_OPERATION_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setOperationMode(mode.value)}
                    className={cn("h-9 shrink-0 rounded-md border px-3 text-xs font-medium", operationMode === mode.value ? "border-[#E0B100] bg-[#E0B100]/15 text-[#F4CF36]" : "border-[#303A4D] text-[#B2BDCC] hover:bg-[#1A2130]")}
                  >
                    {mode.label}
                  </button>
                ))}
                {activeProfile ? (
                  <button type="button" onClick={() => setOperationMode("custom")} className={cn("h-9 shrink-0 rounded-md border px-3 text-xs font-medium", operationMode === "custom" ? "border-[#E0B100] bg-[#E0B100]/15 text-[#F4CF36]" : "border-[#303A4D] text-[#B2BDCC] hover:bg-[#1A2130]")}>Мой профиль</button>
                ) : null}
              </div>
            </div>
            {timelineMode === "48h" && operatingHours.length ? (
              <>
                <div
                  ref={timelineRef}
                  className="min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  <div className="relative h-[126px] min-w-[760px] select-none" style={{ width: `${Math.max(760, operatingHours.length * 24)}px` }}>
                    <div className="absolute inset-x-0 top-0 h-5 text-[10px] font-medium uppercase text-[#8793A5]">
                      {operatingHours.map((hour, index) => {
                        const startsDay = index === 0 || dayKey(operatingHours[index - 1].point.time, weather) !== dayKey(hour.point.time, weather);
                        return startsDay ? <span key={hour.point.time} className="absolute whitespace-nowrap" style={{ left: `${(index / Math.max(1, operatingHours.length - 1)) * 100}%` }}>{formatWeatherDay(hour.point.time, weather)}</span> : null;
                      })}
                    </div>
                    <div className="absolute inset-x-0 top-8 flex h-14 overflow-hidden rounded-md border border-[#3A4354] bg-[#0C1017]">
                      {operatingHours.map((hour) => (
                        <div key={hour.point.time} title={`${formatWindow(hour.point.time, weather, true)} · ${STATUS_LABELS[hour.status]}`} className={cn("relative min-w-0 flex-1", statusTrack(hour.status))}>
                          {(hour.point.precipitationRateMmH || 0) > 0 ? (
                            <span className="absolute inset-x-0 bottom-0 bg-sky-300/90" style={{ height: `${Math.min(100, 12 + (hour.point.precipitationRateMmH || 0) * 18)}%` }} />
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <span className="pointer-events-none absolute bottom-5 top-6 z-10 w-px bg-white/65" style={{ left: `${(currentHourIndex / Math.max(1, operatingHours.length - 1)) * 100}%` }}>
                      <span className="absolute -left-4 -top-5 whitespace-nowrap text-[10px] font-semibold text-white">Сейчас</span>
                    </span>
                    <span className="pointer-events-none absolute bottom-5 top-6 z-20 w-0.5 bg-[#F4CF36]" style={{ left: `${(selectedHourIndex / Math.max(1, operatingHours.length - 1)) * 100}%` }}>
                      <span className="absolute -left-2.5 top-[34px] h-5 w-5 rounded-full border-2 border-[#111722] bg-[#F4CF36] shadow-[0_0_0_3px_rgba(244,207,54,0.25)]" />
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, operatingHours.length - 1)}
                      step={1}
                      value={selectedHourIndex}
                      onChange={(event) => setSelectedHourTime(operatingHours[Number(event.target.value)]?.point.time || null)}
                      aria-label="Выбранный час прогноза"
                      className="absolute inset-x-0 top-8 z-30 h-14 w-full cursor-ew-resize appearance-none bg-transparent opacity-0"
                    />
                    <div className="absolute inset-x-0 bottom-0 h-5 text-[10px] text-[#8995A7]">
                      {operatingHours.map((hour, index) => index % 6 === 0 ? <span key={hour.point.time} className="absolute -translate-x-1/2" style={{ left: `${(index / Math.max(1, operatingHours.length - 1)) * 100}%` }}>{formatWindow(hour.point.time, weather, false)}</span> : null)}
                    </div>
                  </div>
                </div>
                {selectedHour ? <OperatingHourDetails hour={selectedHour} weather={weather} /> : null}
              </>
            ) : null}
            {timelineMode === "7d" ? (
              <div className="p-3 sm:p-4">
                {dailyWeather.length < 7 ? <div className="mb-3 text-xs text-amber-200">Доступно {dailyWeather.length} из 7 дней в текущем ответе UAV Forecast.</div> : null}
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {dailyWeather.map((day) => (
                  <div key={day.day} className="rounded-md border border-[#293244] bg-[#171D29] p-3">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium text-white">{new Date(`${day.day}T12:00:00`).toLocaleDateString("ru-RU", { weekday: "short", day: "2-digit", month: "2-digit" })}</span><span className={cn("h-2.5 w-2.5 rounded-full", statusDot(day.bestStatus))} /></div>
                    <div className="mt-2 text-sm text-[#C5CEDA]">{signedTemperature(day.minTemperatureC)} — {signedTemperature(day.maxTemperatureC)}</div>
                    <div className="mt-1 text-xs text-[#8995A7]">Осадки {metric(day.precipitationMm)} мм · ветер до {metric(day.maxWindMs)} м/с</div>
                    <div className="mt-2 text-xs font-medium text-[#F4CF36]">Лучший индекс {day.bestScore}/10</div>
                  </div>
                  ))}
                </div>
              </div>
            ) : null}
            {!operatingHours.length ? <div className="p-6 text-center text-sm text-[#7F8A9B]">UAV Forecast не вернул почасовой ряд.</div> : null}
            <div className="grid gap-2 border-t border-[#293244] p-3 text-xs lg:grid-cols-3 sm:p-4">
              <div className="rounded-md border border-emerald-900/60 bg-emerald-950/20 p-3">
                <div className="text-emerald-200/80">Лучшее ближайшее окно</div>
                <div className="mt-1 font-medium text-white">{nearestWindow ? `${formatWindow(nearestWindow.start, weather, true)} — ${formatWindow(nearestWindow.end, weather, true)} · ${nearestWindow.hours} ч` : "В пределах 48 часов не найдено"}</div>
                {nearestWindow ? <div className="mt-2 text-emerald-200">Индекс {nearestWindowScore}/10</div> : null}
              </div>
              <div className="rounded-md border border-red-900/60 bg-red-950/20 p-3">
                <div className="text-red-200/80">Избегать</div>
                <div className="mt-1 font-medium text-white">{avoidWindow ? `${formatWindow(avoidWindow.start, weather, true)} — ${formatWindow(avoidWindow.end, weather, true)}` : "Критичных периодов не найдено"}</div>
                {avoidReasons.length ? <div className="mt-2 text-red-200">{avoidReasons.join(" · ")}</div> : null}
              </div>
              <div className="rounded-md border border-[#293244] bg-[#171D29] p-3">
                <div className="text-[#8995A7]">Самое длинное подходящее окно</div>
                <div className="mt-1 font-medium text-white">{longestWindow ? `${formatWindow(longestWindow.start, weather, true)} — ${formatWindow(longestWindow.end, weather, true)} · ${longestWindow.hours} ч` : "В пределах 48 часов не найдено"}</div>
              </div>
            </div>
          </section>

          {current.humidityPct != null || current.cloudCoverPct != null || current.cloudBaseM != null || current.pressureMslHpa != null ? (
            <details className="rounded-lg border border-[#2A3344] bg-[#121722] p-3 text-sm sm:p-4">
              <summary className="cursor-pointer font-medium text-[#D5DBE5]">Дополнительные погодные данные</summary>
              <div className="mt-3 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
                {current.humidityPct != null ? <AdditionalMetric label="Влажность воздуха" value={`${metric(current.humidityPct, 0)}%`} /> : null}
                {current.cloudCoverPct != null ? <AdditionalMetric label="Облачность" value={`${metric(current.cloudCoverPct, 0)}%`} /> : null}
                {current.cloudBaseM != null ? <AdditionalMetric label="Нижняя граница облаков" value={`${metric(current.cloudBaseM, 0)} м`} /> : null}
                {current.pressureMslHpa != null ? <AdditionalMetric label="Давление" value={`${metric(current.pressureMslHpa)} hPa`} /> : null}
              </div>
            </details>
          ) : null}

          {showTechnicalDebug ? <details className="rounded-lg border border-[#2A3344] bg-[#10151F] p-3 text-xs text-[#909CAD]">
            <summary className="cursor-pointer font-medium text-[#D5DBE5]">Служебная информация Global Admin</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div>Источник: <span className="text-white">{weather.providerMeta.provider}</span></div>
              <div>Кэш: <span className="text-white">{weather.providerMeta.cache}</span></div>
              <div>Ответ: <span className="text-white">{metric(weather.providerMeta.responseTimeMs, 0)} мс</span></div>
              <div>Точек: <span className="text-white">{weather.providerMeta.forecastPoints}</span></div>
              <div>Timezone: <span className="text-white">{weather.providerMeta.timezone || "не указана"}</span></div>
              <div>UTC offset: <span className="text-white">{weather.providerMeta.utcOffsetMinutes ?? "не указан"}</span></div>
              <div>Координаты: <span className="text-white">{weather.location.latitude.toFixed(6)}, {weather.location.longitude.toFixed(6)}</span></div>
              <div>Схема: <span className="text-white">{weather.providerMeta.schemaVersion}</span></div>
              <div>Горизонт: <span className="text-white">{weather.providerMeta.forecastHours} ч</span></div>
              <div>Высоты ветра: <span className="text-white">{weather.providerMeta.windAltitudesM.join(" / ")} м</span></div>
              <div>Стоимость вызова: <span className="text-white">{weather.providerMeta.billing ? `${weather.providerMeta.billing.amount || "—"} ${weather.providerMeta.billing.currency || ""}`.trim() : "не указана"}</span></div>
            </div>
          </details> : null}
        </>
      ) : null}
    </div>
  );
}
