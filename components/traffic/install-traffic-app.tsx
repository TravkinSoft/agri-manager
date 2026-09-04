"use client";
import { useEffect } from "react";

/** Keep the independent PWA installable through the browser, without an install panel. */
export function TrafficPwa() {
  useEffect(() => {
    if (window.isSecureContext && "serviceWorker" in navigator) {
      // Specific registration wins over the existing ERP root worker. No
      // unregister-all or cache cleanup: other installed apps remain intact.
      void navigator.serviceWorker
        .register("/ptc-sw.js", {
          scope: "/traffic-operator",
          updateViaCache: "none",
        })
        .then((registration) => registration.update())
        // Installation is optional: registration failure must not block the cabinet.
        .catch(() => undefined);
    }
  }, []);
  return null;
}
