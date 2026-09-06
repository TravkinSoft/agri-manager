"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCheck, ClipboardList, PackageCheck, Scale, Settings, Sparkles, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/contexts/auth-context";
import { supabase } from "@/lib/supabase/client";
import type { UserNotification } from "@/components/notifications/notification-center";
import { cn } from "@/lib/utils";

const notificationColumns = "id,company_id,recipient_user_id,category,event_type,title,body,href,entity_type,entity_id,read_at,created_at";

function iconFor(category: UserNotification["category"]) {
  if (category === "operation") return ClipboardList;
  if (category === "warehouse") return PackageCheck;
  if (category === "weighbridge") return Scale;
  if (category === "assistant") return Sparkles;
  if (category === "traffic") return Truck;
  return Settings;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function NotificationsPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const companyId = profile?.is_impersonating
    ? profile.impersonated_company_id || profile.company_id
    : profile?.context_company_id || profile?.company_id;

  const loadNotifications = useCallback(async () => {
    if (!user?.id) return;
    let query = supabase
      .from("user_notifications")
      .select(notificationColumns)
      .eq("recipient_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (companyId) query = query.eq("company_id", companyId);
    if (profile?.role !== "global_admin") query = query.neq("category", "assistant");
    const { data, error } = await query;
    if (error) {
      console.error("Failed to load notification history", error);
    } else {
      setNotifications((data || []) as UserNotification[]);
    }
    setLoading(false);
  }, [companyId, profile?.role, user?.id]);

  useEffect(() => {
    void loadNotifications();
    const handleFocus = () => void loadNotifications();
    window.addEventListener("focus", handleFocus);
    const interval = window.setInterval(() => void loadNotifications(), 15_000);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.clearInterval(interval);
    };
  }, [loadNotifications]);

  const unreadCount = useMemo(
    () => notifications.reduce((count, item) => count + (item.read_at ? 0 : 1), 0),
    [notifications]
  );

  const markAllRead = async () => {
    if (!user?.id || unreadCount === 0) return;
    let query = supabase
      .from("user_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_user_id", user.id)
      .is("read_at", null);
    if (companyId) query = query.eq("company_id", companyId);
    if (profile?.role !== "global_admin") query = query.neq("category", "assistant");
    const { error } = await query;
    if (error) console.error("Failed to mark notification history as read", error);
    await loadNotifications();
  };

  const openNotification = async (notification: UserNotification) => {
    if (!notification.read_at && user?.id) {
      await supabase
        .from("user_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notification.id)
        .eq("recipient_user_id", user.id);
    }
    router.push(notification.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Уведомления</h1>
          <p className="mt-1 text-sm text-slate-400">
            {profile?.role === "global_admin"
              ? "События операций, склада, весовой, оборота машин и рекомендации Assist"
              : "События операций, склада, весовой и оборота машин"}
          </p>
        </div>
        <Button type="button" variant="outline" disabled={unreadCount === 0} onClick={() => void markAllRead()}>
          <CheckCheck className="mr-2 h-4 w-4" />
          Прочитать все
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-950/30">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Загрузка...</div>
        ) : notifications.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Уведомлений пока нет</div>
        ) : (
          notifications.map((notification) => {
            const Icon = iconFor(notification.category);
            return (
              <button
                key={notification.id}
                type="button"
                onClick={() => void openNotification(notification)}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-slate-800 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-slate-900/80",
                  !notification.read_at && "bg-slate-900/55"
                )}
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-yellow-400">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start gap-3">
                    <span className="min-w-0 flex-1 text-sm font-medium text-slate-100">{notification.title}</span>
                    {!notification.read_at ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-yellow-400" /> : null}
                  </span>
                  {notification.body ? <span className="mt-1 block text-sm text-slate-400">{notification.body}</span> : null}
                  <span className="mt-1.5 block text-xs text-slate-500">{dateTime(notification.created_at)}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
