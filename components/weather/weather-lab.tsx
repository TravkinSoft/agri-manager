"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  Cloud,
  CloudRain,
  Compass,
  Gauge,
  LocateFixed,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Satellite,
  Search,
  SunMedium,
  Thermometer,
  Wind,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { formatWeatherTime, relativeWeatherAge } from "@/lib/weather/time";
import type { NormalizedWeather, WeatherLocation, WeatherPoint } from "@/lib/weather/types";

type RecentLocation = WeatherLocation & { provider?: string };
type Horizon = "24h" | "3d" | "all";
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
const LOCAL_WEATHER_PREFIX = "travkin-weather-lab:forecast:v1";
const LOCAL_CACHE_TTL_MS = 10 * 60 * 1000;

function metric(value: number | null, maximumFractionDigits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits }).format(value);
}

function signedTemperature(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${metric(value)} °C`;
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

async function authorizedJson<T>(url: string): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Сессия истекла. Войдите снова.");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${data.session.access_token}` },
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

function HourlyRow({ point, weather }: { point: WeatherPoint; weather: NormalizedWeather }) {
  const timeOptions = {
    timezone: weather.providerMeta.timezone,
    utcOffsetMinutes: weather.providerMeta.utcOffsetMinutes,
    includeDate: true,
  };
  return (
    <div className="grid grid-cols-[72px_repeat(5,minmax(74px,1fr))] items-center gap-2 border-b border-[#252D3C] px-2 py-2.5 text-xs last:border-0 md:grid-cols-[88px_repeat(5,minmax(90px,1fr))]">
      <div className="font-medium text-[#F3F4F6]">{formatWeatherTime(point.time, timeOptions)}</div>
      <div>{signedTemperature(point.temperatureC)}</div>
      <div>{metric(point.windMs)} м/с</div>
      <div>{metric(point.gustMs)} м/с</div>
      <div>{metric(point.precipitationProbabilityPct, 0)}%</div>
      <div>{point.precipitationRateMmH != null ? `${metric(point.precipitationRateMmH)} мм/ч` : "—"}</div>
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

export function WeatherLab() {
  const [selected, setSelected] = useState<RecentLocation | null>(null);
  const [weather, setWeather] = useState<NormalizedWeather | null>(null);
  const [horizon, setHorizon] = useState<Horizon>("24h");
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

  const visibleForecast = useMemo(() => {
    if (!weather) return [];
    const limit = horizon === "24h" ? 24 : horizon === "3d" ? 72 : weather.hourlyForecast.length;
    return weather.hourlyForecast.slice(0, limit);
  }, [horizon, weather]);

  const current = weather?.current || null;
  const hasThreeDays = (weather?.hourlyForecast.length || 0) >= 48;
  const hasLongerHorizon = (weather?.hourlyForecast.length || 0) > 24;

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
            <div className="mt-3 grid grid-cols-2 rounded-md border border-[#303A4D] bg-[#0E121A] p-0.5">
              <button type="button" onClick={() => setPickerMode("search")} className={cn("h-8 rounded text-xs", pickerMode === "search" ? "bg-[#E0B100] font-medium text-[#111827]" : "text-[#A8B2C2] hover:text-white")}>Поиск</button>
              <button type="button" onClick={() => setPickerMode("list")} className={cn("h-8 rounded text-xs", pickerMode === "list" ? "bg-[#E0B100] font-medium text-[#111827]" : "text-[#A8B2C2] hover:text-white")}>По списку</button>
            </div>
          </DialogHeader>

          <div className="min-h-0 touch-pan-y overscroll-contain overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:p-4">
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
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              <MetricTile label="Температура" value={signedTemperature(current.temperatureC)} icon={Thermometer} />
              <MetricTile label="Интенсивность осадков" value={current.precipitationRateMmH != null ? `${metric(current.precipitationRateMmH)} мм/ч` : "—"} icon={CloudRain} />
              <MetricTile label="Вероятность осадков" value={`${metric(current.precipitationProbabilityPct, 0)}%`} icon={Cloud} />
              <MetricTile label="Ветер" value={`${metric(current.windMs)} м/с`} icon={Wind} />
              <MetricTile label="Порывы" value={`${metric(current.gustMs)} м/с`} icon={Compass} />
            </div>
          </section>

          <section className="rounded-lg border border-[#2A3344] bg-[#121722]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#293244] p-3 sm:p-4">
              <SectionTitle icon={Wind}>Почасовой прогноз</SectionTitle>
              <div className="flex rounded-md border border-[#303A4D] bg-[#0E121A] p-0.5">
                {(["24h", ...(hasThreeDays ? ["3d"] : []), ...(hasLongerHorizon ? ["all"] : [])] as Horizon[]).map((item) => (
                  <button key={item} type="button" onClick={() => setHorizon(item)} className={cn("h-8 rounded px-3 text-xs", horizon === item ? "bg-[#E0B100] font-medium text-[#111827]" : "text-[#A8B2C2] hover:text-white")}>
                    {item === "24h" ? "24 часа" : item === "3d" ? "3 дня" : "Весь прогноз"}
                  </button>
                ))}
              </div>
            </div>
            <div className="hidden overflow-x-auto md:block">
              <div className="min-w-[690px] px-2 py-1 text-[#C7CFDB]">
                <div className="grid grid-cols-[88px_repeat(5,minmax(90px,1fr))] gap-2 border-b border-[#303A4D] px-2 py-2 text-[11px] uppercase text-[#778397]">
                  <div>Время</div><div>Температура</div><div>Ветер</div><div>Порывы</div><div>Вероятность</div><div>Осадки</div>
                </div>
                {visibleForecast.map((point) => <HourlyRow key={point.time} point={point} weather={weather} />)}
              </div>
            </div>
            <div className="space-y-2 p-3 md:hidden">
              {visibleForecast.map((point) => (
                <div key={point.time} className="rounded-md border border-[#293244] bg-[#171D29] p-3 text-xs">
                  <div className="flex items-center justify-between"><span className="font-semibold text-white">{formatWeatherTime(point.time, { timezone: weather.providerMeta.timezone, utcOffsetMinutes: weather.providerMeta.utcOffsetMinutes, includeDate: true })}</span><span className="text-base font-semibold text-white">{signedTemperature(point.temperatureC)}</span></div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[#9EABBC]"><span>Ветер {metric(point.windMs)} м/с</span><span>Порывы {metric(point.gustMs)} м/с</span><span>Вероятность {metric(point.precipitationProbabilityPct, 0)}%</span><span>{point.precipitationRateMmH != null ? `${metric(point.precipitationRateMmH)} мм/ч` : "Осадки —"}</span></div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-[#2A3344] bg-[#121722] p-3 sm:p-4">
              <SectionTitle icon={Gauge}>Дополнительно</SectionTitle>
              <div className="mt-3">
                {current.dewPointC != null ? <AdditionalMetric label="Расчётная точка росы" value={signedTemperature(current.dewPointC)} /> : null}
                {current.humidityPct != null ? <AdditionalMetric label="Относительная влажность" value={`${metric(current.humidityPct, 0)}%`} /> : null}
                {current.cloudCoverPct != null ? <AdditionalMetric label="Облачность" value={`${metric(current.cloudCoverPct, 0)}%`} /> : null}
                {current.cloudBaseM != null ? <AdditionalMetric label="Нижняя граница облаков" value={`${metric(current.cloudBaseM, 0)} м`} /> : null}
                {current.visibilityKm != null ? <AdditionalMetric label="Видимость" value={`${metric(current.visibilityKm)} км`} /> : null}
                {current.densityAltitudeM != null ? <AdditionalMetric label="Плотностная высота" value={`${metric(current.densityAltitudeM, 0)} м`} /> : null}
                {current.pressureMslHpa != null ? <AdditionalMetric label="Давление MSL" value={`${metric(current.pressureMslHpa)} hPa`} /> : null}
                {current.visibleSatellites != null ? <AdditionalMetric label="Видимые спутники" value={metric(current.visibleSatellites, 0)} /> : null}
                {current.estimatedSatellitesLocked != null ? <AdditionalMetric label="Ожидаемый захват спутников" value={metric(current.estimatedSatellitesLocked, 0)} /> : null}
                {current.kp != null ? <AdditionalMetric label="Kp" value={metric(current.kp)} /> : null}
              </div>
            </section>

            <section className="rounded-lg border border-[#2A3344] bg-[#121722] p-3 sm:p-4">
              <SectionTitle icon={SunMedium}>Солнце</SectionTitle>
              {weather.sun.length ? (
                <div className="mt-3 space-y-2">
                  {weather.sun.map((day) => (
                    <div key={`${day.date}-${day.sunrise || ""}-${day.sunset || ""}`} className="rounded-md border border-[#293244] bg-[#171D29] p-3 text-sm">
                      <div className="mb-2 font-medium text-white">{day.date}</div>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs text-[#98A4B7]"><div>Восход<div className="mt-1 text-white">{day.sunrise ? formatWeatherTime(day.sunrise, { timezone: weather.providerMeta.timezone, utcOffsetMinutes: weather.providerMeta.utcOffsetMinutes }) : "—"}</div></div><div>Полдень<div className="mt-1 text-white">{day.solarNoon ? formatWeatherTime(day.solarNoon, { timezone: weather.providerMeta.timezone, utcOffsetMinutes: weather.providerMeta.utcOffsetMinutes }) : "—"}</div></div><div>Закат<div className="mt-1 text-white">{day.sunset ? formatWeatherTime(day.sunset, { timezone: weather.providerMeta.timezone, utcOffsetMinutes: weather.providerMeta.utcOffsetMinutes }) : "—"}</div></div></div>
                    </div>
                  ))}
                </div>
              ) : <div className="mt-3 text-sm text-[#7F8A9B]">UAV Forecast не вернул данные о солнце.</div>}
            </section>
          </div>

          <details className="rounded-lg border border-[#2A3344] bg-[#10151F] p-3 text-xs text-[#909CAD]">
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
            <div className="mt-3 flex items-center gap-2"><Satellite className="h-3.5 w-3.5" /> Поля API: {weather.rawCapabilities.join(", ") || "нет"}</div>
          </details>
        </>
      ) : null}
    </div>
  );
}
