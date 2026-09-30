"use client";
import { useEffect } from "react";

const WORKER_UPDATE_INTERVAL_MS = 60_000;

/** Keep the independent PWA installable through the browser, without an install panel. */
export function TrafficPwa() {
  useEffect(() => {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;
    const checkForUpdate = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      void registration?.update().catch(() => undefined);
    };
    // Specific registration wins over the existing ERP root worker. No
    // unregister-all or cache cleanup: other installed apps remain intact.
    void navigator.serviceWorker
      .register("/ptc-sw.js", {
        scope: "/traffic-operator",
        updateViaCache: "none",
      })
      .then((nextRegistration) => {
        if (cancelled) return;
        registration = nextRegistration;
        return nextRegistration.update();
      })
      // Installation is optional: registration failure must not block the cabinet.
      .catch(() => undefined);
    const timer = window.setInterval(checkForUpdate, WORKER_UPDATE_INTERVAL_MS);
    window.addEventListener("focus", checkForUpdate);
    document.addEventListener("visibilitychange", checkForUpdate);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", checkForUpdate);
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);
  return null;
}
