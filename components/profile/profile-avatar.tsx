"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type ProfileAvatarProps = {
  profileId?: string | null;
  fullName?: string | null;
  email?: string | null;
  version?: string | null;
  className?: string;
};

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
    if (!profileId) {
      setAvatarUrl(null);
      return;
    }
    const controller = new AbortController();
    let refreshTimer: number | undefined;

    const load = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token || controller.signal.aborted) return;
      const response = await fetch("/api/profile/avatar", {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok || controller.signal.aborted) return;
      const payload = await response.json().catch(() => ({}));
      setAvatarUrl(typeof payload?.avatarUrl === "string" ? payload.avatarUrl : null);
      refreshTimer = window.setTimeout(() => void load(), 50 * 60 * 1000);
    };

    void load().catch(() => undefined);
    return () => {
      controller.abort();
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [profileId, version]);

  return (
    <Avatar className={cn("h-8 w-8 border border-white/10 bg-[#202738]", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" className="object-cover" /> : null}
      <AvatarFallback className="bg-[#202738] text-xs font-semibold text-slate-100">{initials}</AvatarFallback>
    </Avatar>
  );
}
