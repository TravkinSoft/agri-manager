"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { weatherSceneState } from "@/lib/weather/scene-state";
import { formatWeatherTime } from "@/lib/weather/time";
import type { NormalizedWeather, WeatherPoint } from "@/lib/weather/types";

export function WeatherPanorama({ weather, point }: { weather: NormalizedWeather; point: WeatherPoint }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const state = useMemo(() => weatherSceneState(weather, point), [weather, point]);
  const send = useCallback(() => {
    if (state) frame.current?.contentWindow?.postMessage({ type: "tf-weather-scene", ...state, active, paused }, window.location.origin);
  }, [state, active, paused]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPaused(media.matches);
    const change = () => setPaused(media.matches);
    media.addEventListener("change", change);
    const observer = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting));
    if (frame.current) observer.observe(frame.current);
    return () => { media.removeEventListener("change", change); observer.disconnect(); };
  }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "tf-weather-ready") send();
      if (event.data?.type === "tf-weather-failed") setFailed(true);
    };
    window.addEventListener("message", receive);
    send();
    return () => window.removeEventListener("message", receive);
  }, [send]);
  return (
    <div className="overflow-hidden border-b border-border" data-weather-panorama="approved-road-v1">
      <div className="relative aspect-[21/9] bg-card">
        <iframe ref={frame} src="/weather-scene/approved-road-v1/index.html" title="Пейзаж по выбранному часу прогноза" loading="lazy" onLoad={send} className="absolute inset-0 h-full w-full border-0" />
        <div className="absolute left-3 top-3 rounded-md bg-black/50 px-2.5 py-1.5 text-xs text-white backdrop-blur-md">
          {formatWeatherTime(point.time, { ...weather.providerMeta, includeDate: true })}
        </div>
        <button type="button" onClick={() => setPaused(p => !p)} aria-label={paused ? "Продолжить анимацию погоды" : "Приостановить анимацию погоды"} aria-pressed={paused} className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-md bg-black/50 text-white backdrop-blur-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
      </div>
      {failed ? <p role="status" className="px-3 py-2 text-xs text-muted-foreground">Анимация недоступна в этом браузере. Прогноз ниже продолжает работать.</p> : null}
    </div>
  );
}
