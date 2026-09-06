"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, BellOff, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type PushState = "checking" | "unsupported" | "off" | "on" | "denied" | "working" | "error";

type PushNotificationsToggleProps = {
  companyId?: string | null;
  role?: string | null;
};

function urlBase64ToBytes(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function authHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Session expired");
  return {
    Authorization: `Bearer ${data.session.access_token}`,
    "Content-Type": "application/json",
  };
}

export function PushNotificationsToggle({ companyId, role }: PushNotificationsToggleProps) {
  const [state, setState] = useState<PushState>("checking");
  const [message, setMessage] = useState("");
  const eligible = Boolean(companyId) && ["agronomist", "fleet_manager", "company_admin"].includes(String(role || ""));

  const inspect = useCallback(async () => {
    if (!eligible || typeof window === "undefined") return setState("unsupported");
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return setState("unsupported");
    }
    if (Notification.permission === "denied") return setState("denied");
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      const subscription = await registration.pushManager.getSubscription();
      setState(subscription ? "on" : "off");
    } catch {
      setState("error");
    }
  }, [eligible]);

  useEffect(() => {
    void inspect();
  }, [inspect]);

  if (state === "checking" || state === "unsupported") return null;

  const toggle = async () => {
    if (!companyId || state === "working") return;
    setState("working");
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      const existing = await registration.pushManager.getSubscription();
      const headers = await authHeaders();
      if (existing) {
        const response = await fetch("/api/notifications/push-subscription", {
          method: "DELETE",
          cache: "no-store",
          credentials: "include",
          headers,
          body: JSON.stringify({ companyId, endpoint: existing.endpoint }),
        });
        if (!response.ok) throw new Error("unsubscribe failed");
        await existing.unsubscribe();
        setState("off");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const configResponse = await fetch(
        `/api/notifications/push-subscription?companyId=${encodeURIComponent(companyId)}`,
        { method: "GET", cache: "no-store", credentials: "include", headers },
      );
      const config = await configResponse.json().catch(() => ({}));
      if (!configResponse.ok || !config?.configured || !config?.publicKey) {
        throw new Error("push is not configured");
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(String(config.publicKey)),
      });
      const response = await fetch("/api/notifications/push-subscription", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers,
        body: JSON.stringify({ companyId, subscription: subscription.toJSON() }),
      });
      if (!response.ok) {
        await subscription.unsubscribe().catch(() => undefined);
        throw new Error("subscription save failed");
      }
      setState("on");
    } catch (error) {
      console.error("Push notification toggle failed", error);
      setMessage("Не удалось включить. Проверьте разрешения Android.");
      setState("error");
    }
  };

  const denied = state === "denied";
  const enabled = state === "on";
  return (
    <div className="border-t border-[#2C3446] px-3 py-2">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={denied || state === "working"}
        className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-[#CBD5E1] hover:bg-[#1A2230] disabled:cursor-default disabled:opacity-70"
      >
        {state === "working" ? (
          <Loader2 className="h-4 w-4 animate-spin text-[#FACC15]" />
        ) : enabled ? (
          <BellRing className="h-4 w-4 text-emerald-400" />
        ) : (
          <BellOff className="h-4 w-4 text-[#FACC15]" />
        )}
        <span>
          {denied
            ? "Уведомления запрещены в настройках Android"
            : enabled
              ? "Уведомления телефона включены"
              : "Включить уведомления на телефоне"}
        </span>
      </button>
      {message ? <div className="px-2 pb-1 text-[11px] text-rose-300">{message}</div> : null}
    </div>
  );
}
