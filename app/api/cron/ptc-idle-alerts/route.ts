import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { dispatchPushNotifications } from "@/lib/notifications/push-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IdleAlertRow = {
  notification_id: string;
  event_key: string;
};

export async function GET(request: NextRequest) {
  const secret = String(process.env.CRON_SECRET || "");
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getServiceClient();
    const { data, error } = await db.rpc("ptc_emit_idle_alerts_v1", {
      p_now: new Date().toISOString(),
    });
    if (error) throw error;
    const rows = (data || []) as IdleAlertRow[];
    const ids = Array.from(new Set(rows.map((row) => row.notification_id).filter(Boolean)));
    const push = ids.length
      ? await dispatchPushNotifications(db, { notificationIds: ids })
      : { configured: Boolean(process.env.WEB_PUSH_VAPID_PUBLIC_KEY), notifications: 0, subscriptions: 0, sent: 0, removed: 0, failed: 0 };
    return NextResponse.json(
      { ok: true, notificationsCreated: ids.length, push },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("PTC idle alert cron failed", error);
    return NextResponse.json({ error: "PTC idle alert check failed" }, { status: 500 });
  }
}
