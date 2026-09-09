"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/lib/supabase/client";
import { profileAvatarRetryDelay } from "@/lib/profile/avatar-client";
import { cn } from "@/lib/utils";

type ProfileAvatarProps = {
  profileId?: string | null;
  fullName?: string | null;
  email?: string | null;
  version?: string | null;
  className?: string;
};

const PROFILE_AVATAR_UI_ENABLED = process.env.NEXT_PUBLIC_PROFILE_AVATAR_V1 === "1";

function avatarInitials(fullName?: string | null, email?: string | null): string {
  const nameParts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (nameParts.length > 0) {
    return nameParts.slice(0, 2).map((part) => Array.from(part)[0] || "").join("").toLocaleUpperCase("ru-RU");
  }
  const emailName = String(email || "").split("@")[0].trim();
  return (Array.from(emailName)[0] || "?").toLocaleUpperCase("ru-RU");
}

export function ProfileAvatar({ profileId, fullName, email, version, className }: ProfileAvatarProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const initials = useMemo(() => avatarInitials(fullName, email), [email, fullName]);

  useEffect(() => {
    if (!PROFILE_AVATAR_UI_ENABLED || !profileId) {
      setAvatarUrl(null);
      return;
    }
    const controller = new AbortController();
    let refreshTimer: number | undefined;
    let retryAttempt = 0;

    const schedule = (delay: number) => {
      if (controller.signal.aborted) return;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void load().catch(() => scheduleRetry()), delay);
    };

    const scheduleRetry = () => {
      const delay = profileAvatarRetryDelay(retryAttempt);
      if (delay == null) return;
      retryAttempt += 1;
      schedule(delay);
    };

    const load = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (controller.signal.aborted) return;
      if (error || !data.session?.access_token) {
        scheduleRetry();
        return;
      }
      const response = await fetch("/api/profile/avatar", {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        scheduleRetry();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      setAvatarUrl(typeof payload?.avatarUrl === "string" ? payload.avatarUrl : null);
      retryAttempt = 0;
      schedule(50 * 60 * 1000);
    };

    void load().catch(() => scheduleRetry());
    return () => {
      controller.abort();
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [profileId, version]);

  return (
    <Avatar className={cn("h-8 w-8 border border-border bg-muted", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" className="object-cover" /> : null}
      <AvatarFallback className="bg-muted text-xs font-semibold text-foreground">{initials}</AvatarFallback>
    </Avatar>
  );
}
