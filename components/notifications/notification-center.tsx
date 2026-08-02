"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCheck, ClipboardList, PackageCheck, Scale, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type UserNotification = {
  id: string;
  company_id: string;
  recipient_user_id: string;
  category: "operation" | "warehouse" | "weighbridge" | "system";
  event_type: string;
  title: string;
  body: string | null;
  href: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

type NotificationCenterProps = {
  userId: string;
  companyId?: string | null;
};

const selectColumns =
  "id,company_id,recipient_user_id,category,event_type,title,body,href,entity_type,entity_id,read_at,created_at" as const;

function categoryIcon(category: UserNotification["category"]) {
  if (category === "operation") return ClipboardList;
  if (category === "warehouse") return PackageCheck;
  if (category === "weighbridge") return Scale;
  return Settings;
}

function relativeTime(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
  if (absolute < 60) return formatter.format(seconds, "second");
  if (absolute < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (absolute < 86_400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (absolute < 604_800) return formatter.format(Math.round(seconds / 86_400), "day");
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(new Date(value));
}

export function NotificationCenter({ userId, companyId }: NotificationCenterProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);

  const loadNotifications = useCallback(async () => {
    if (!userId) return;
    if (runningRef.current) {
      pendingRef.current = true;
      return;
    }

    runningRef.current = true;
    try {
      let query = supabase
        .from("user_notifications")
        .select(selectColumns)
        .eq("recipient_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (companyId) query = query.eq("company_id", companyId);

      const { data, error } = await query;
      if (error) throw error;
      setNotifications((data || []) as UserNotification[]);
    } catch (error) {
      console.error("Failed to load notifications", error);
    } finally {
      runningRef.current = false;
      setLoading(false);
      if (pendingRef.current) {
        pendingRef.current = false;
        void loadNotifications();
      }
    }
  }, [companyId, userId]);

  useEffect(() => {
    setLoading(true);
    setNotifications([]);
    void loadNotifications();

    const handleFocus = () => void loadNotifications();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadNotifications();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    const interval = window.setInterval(() => void loadNotifications(), 15_000);

    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const subscribe = async () => {
      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (disposed || error || !accessToken) return;
      await supabase.realtime.setAuth(accessToken);
      if (disposed) return;

      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "user_notifications",
            filter: `recipient_user_id=eq.${userId}`,
          },
          () => void loadNotifications()
        )
        .subscribe();
    };
    void subscribe();

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [loadNotifications, userId]);

  const unreadCount = useMemo(
    () => notifications.reduce((count, item) => count + (item.read_at ? 0 : 1), 0),
    [notifications]
  );

  const markRead = async (notification: UserNotification) => {
    if (notification.read_at) return;
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((item) => (item.id === notification.id ? { ...item, read_at: readAt } : item))
    );
    const { error } = await supabase
      .from("user_notifications")
      .update({ read_at: readAt })
      .eq("id", notification.id)
      .eq("recipient_user_id", userId);
    if (error) {
      console.error("Failed to mark notification as read", error);
      void loadNotifications();
    }
  };

  const markAllRead = async () => {
    if (unreadCount === 0 || markingAll) return;
    setMarkingAll(true);
    const readAt = new Date().toISOString();
    let query = supabase
      .from("user_notifications")
      .update({ read_at: readAt })
      .eq("recipient_user_id", userId)
      .is("read_at", null);
    if (companyId) query = query.eq("company_id", companyId);
    const { error } = await query;
    if (error) console.error("Failed to mark all notifications as read", error);
    await loadNotifications();
    setMarkingAll(false);
  };

  const openNotification = async (notification: UserNotification) => {
    await markRead(notification);
    setOpen(false);
    router.push(notification.href);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-[#F3F4F6] hover:bg-[#202738] hover:text-[#F3F4F6]"
          aria-label="Уведомления"
          title="Уведомления"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 ? (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#FACC15] px-1 text-[10px] font-bold text-[#111827]">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(390px,calc(100vw-24px))] border-[#2C3446] bg-[#111722] p-0 text-[#F3F4F6]"
      >
        <div className="flex h-12 items-center justify-between border-b border-[#2C3446] px-4">
          <div className="text-sm font-semibold">Уведомления</div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-[#AAB3C2] hover:bg-[#202738] hover:text-white"
            disabled={unreadCount === 0 || markingAll}
            onClick={() => void markAllRead()}
          >
            <CheckCheck className="h-4 w-4" />
            Прочитать все
          </Button>
        </div>

        <div className="max-h-[420px] overflow-y-auto travkin-scrollbar">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-[#8B96A8]">Загрузка...</div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[#8B96A8]">Новых событий пока нет</div>
          ) : (
            notifications.map((notification) => {
              const Icon = categoryIcon(notification.category);
              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => void openNotification(notification)}
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-[#252D3C] px-4 py-3 text-left transition-colors hover:bg-[#1A2230]",
                    !notification.read_at && "bg-[#172033]"
                  )}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#364157] bg-[#20293A] text-[#FACC15]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 text-sm font-medium leading-5">{notification.title}</span>
                      {!notification.read_at ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#FACC15]" /> : null}
                    </span>
                    {notification.body ? (
                      <span className="mt-0.5 block line-clamp-2 text-xs leading-4 text-[#AAB3C2]">{notification.body}</span>
                    ) : null}
                    <span className="mt-1 block text-[11px] text-[#778196]">{relativeTime(notification.created_at)}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            router.push("/notifications");
          }}
          className="h-11 w-full border-t border-[#2C3446] text-sm font-medium text-[#D7DCE5] hover:bg-[#1A2230]"
        >
          Все уведомления
        </button>
      </PopoverContent>
    </Popover>
  );
}
