"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import {
  getOfflineQueueCount,
  offlineQueueEvents,
  readOfflineQueue,
  syncOfflineQueue,
} from "@/lib/offline/offline-queue";

type SyncState = "idle" | "syncing" | "synced" | "failed";

async function getCurrentAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Session not found for offline sync");
  }
  return {
    Authorization: `Bearer ${data.session.access_token}`,
  };
}

export function OfflineRuntime() {
  const pathname = usePathname();
  const independentTraffic = pathname === "/traffic" || pathname === "/traffic-operator" || pathname?.startsWith("/traffic-operator/");
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [lastSyncText, setLastSyncText] = useState("");

  useEffect(() => {
    if (independentTraffic) return;
    if (typeof window === "undefined") return;
    setIsOnline(navigator.onLine);
    setQueueCount(getOfflineQueueCount());

    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV !== "production") {
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
          .catch((error) => {
            console.warn("TravkinFlow service worker cleanup failed", error);
          });
        if ("caches" in window) {
          window.caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key.startsWith("travkinflow-")).map((key) => window.caches.delete(key))))
            .catch((error) => {
              console.warn("TravkinFlow cache cleanup failed", error);
            });
        }
      } else {
        navigator.serviceWorker
          .register("/sw.js", { updateViaCache: "none" })
          .then((registration) => registration.update())
          .catch((error) => {
            console.warn("TravkinFlow service worker registration failed", error);
          });
      }
    }

    const refreshQueueState = () => setQueueCount(getOfflineQueueCount());
    const handleOffline = () => {
      setIsOnline(false);
      refreshQueueState();
      setSyncState("idle");
    };
    const handleOnline = () => {
      setIsOnline(true);
      refreshQueueState();
      window.dispatchEvent(new CustomEvent("travkin:offline-sync-request"));
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener(offlineQueueEvents.changed, refreshQueueState);
    window.addEventListener("storage", refreshQueueState);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener(offlineQueueEvents.changed, refreshQueueState);
      window.removeEventListener("storage", refreshQueueState);
    };
  }, [independentTraffic]);

  useEffect(() => {
    if (independentTraffic) return;
    if (typeof window === "undefined") return;

    let syncing = false;
    const runSync = async () => {
      if (syncing || !navigator.onLine || readOfflineQueue().length === 0) return;
      syncing = true;
      setSyncState("syncing");
      try {
        const result = await syncOfflineQueue({
          getAuthHeaders: getCurrentAuthHeaders,
        });
        setQueueCount(result.remaining);
        if (result.failed > 0) {
          setSyncState("failed");
          setLastSyncText("Есть несинхронизированные действия");
        } else if (result.synced > 0) {
          setSyncState("synced");
          setLastSyncText(`Синхронизировано: ${result.synced}`);
          window.setTimeout(() => setSyncState("idle"), 4000);
        } else {
          setSyncState("idle");
        }
      } finally {
        syncing = false;
      }
    };

    const handleSyncRequest = () => void runSync();
    window.addEventListener("travkin:offline-sync-request", handleSyncRequest);
    const interval = window.setInterval(() => void runSync(), 15000);
    void runSync();

    return () => {
      window.removeEventListener("travkin:offline-sync-request", handleSyncRequest);
      window.clearInterval(interval);
    };
  }, [independentTraffic]);

  const shouldShow = !isOnline || queueCount > 0 || syncState === "syncing" || syncState === "failed" || syncState === "synced";
  if (independentTraffic || !shouldShow) return null;

  const icon = !isOnline ? (
    <CloudOff className="h-4 w-4" />
  ) : syncState === "syncing" ? (
    <RefreshCw className="h-4 w-4 animate-spin" />
  ) : (
    <Wifi className="h-4 w-4" />
  );

  const title = !isOnline
    ? "Работа оффлайн"
    : syncState === "syncing"
      ? "Синхронизация"
      : syncState === "failed"
        ? "Нужна синхронизация"
        : "Онлайн";

  const description = !isOnline
    ? queueCount > 0
      ? `Очередь действий: ${queueCount}. Сайт отправит их сам, когда появится интернет.`
      : "Просмотр доступен из кеша. Новые безопасные действия будут сохранены в очередь."
    : queueCount > 0
      ? `В очереди ${queueCount}. Проверяю связь и отправляю.`
      : lastSyncText || "Данные отправлены.";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-[80] flex justify-center px-3 md:bottom-4">
      <div className="pointer-events-auto flex max-w-[min(94vw,560px)] items-start gap-3 rounded-lg border border-slate-700 bg-[#101826]/95 px-3 py-2 text-sm text-slate-100 shadow-2xl shadow-black/40 backdrop-blur">
        <div className={!isOnline ? "mt-0.5 text-amber-300" : syncState === "failed" ? "mt-0.5 text-red-300" : "mt-0.5 text-emerald-300"}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          <div className="text-xs leading-5 text-slate-300">{description}</div>
        </div>
      </div>
    </div>
  );
}
