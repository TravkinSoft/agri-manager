import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import webPush, { type PushSubscription } from "web-push";

type NotificationRow = {
  id: string;
  recipient_user_id: string;
  title: string;
  body: string | null;
  href: string;
};

type SubscriptionRow = {
  endpoint_hash: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  recipient_user_id: string;
  failure_count: number;
};

export type PushDispatchResult = {
  configured: boolean;
  notifications: number;
  subscriptions: number;
  sent: number;
  removed: number;
  failed: number;
};

function pushConfiguration() {
  const subject = String(process.env.WEB_PUSH_VAPID_SUBJECT || "mailto:support@travkinflow.com").trim();
  const publicKey = String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim();
  if (!publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}

export function getWebPushPublicKey(): string | null {
  return pushConfiguration()?.publicKey || null;
}

export function hashPushEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

function asPushSubscription(row: SubscriptionRow): PushSubscription {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

export async function dispatchPushNotifications(
  db: SupabaseClient,
  selector: { notificationIds?: string[]; eventKey?: string },
): Promise<PushDispatchResult> {
  const configuration = pushConfiguration();
  const empty: PushDispatchResult = {
    configured: Boolean(configuration),
    notifications: 0,
    subscriptions: 0,
    sent: 0,
    removed: 0,
    failed: 0,
  };
  if (!configuration) return empty;

  const ids = Array.from(new Set((selector.notificationIds || []).filter(Boolean)));
  let notificationQuery = db
    .from("user_notifications")
    .select("id,recipient_user_id,title,body,href")
    .eq("category", "traffic");
  if (ids.length > 0) {
    notificationQuery = notificationQuery.in("id", ids);
  } else if (selector.eventKey) {
    notificationQuery = notificationQuery.contains("metadata", { event_key: selector.eventKey });
  } else {
    return empty;
  }

  const notificationResult = await notificationQuery;
  if (notificationResult.error) throw notificationResult.error;
  const notifications = (notificationResult.data || []) as NotificationRow[];
  if (notifications.length === 0) return empty;

  const recipients = Array.from(new Set(notifications.map((item) => item.recipient_user_id)));
  const subscriptionsResult = await db
    .from("user_push_subscriptions")
    .select("endpoint_hash,endpoint,p256dh,auth,recipient_user_id,failure_count")
    .in("recipient_user_id", recipients);
  if (subscriptionsResult.error) throw subscriptionsResult.error;
  const subscriptions = (subscriptionsResult.data || []) as SubscriptionRow[];

  webPush.setVapidDetails(configuration.subject, configuration.publicKey, configuration.privateKey);
  const result: PushDispatchResult = {
    configured: true,
    notifications: notifications.length,
    subscriptions: subscriptions.length,
    sent: 0,
    removed: 0,
    failed: 0,
  };

  const byRecipient = new Map<string, SubscriptionRow[]>();
  for (const subscription of subscriptions) {
    const current = byRecipient.get(subscription.recipient_user_id) || [];
    current.push(subscription);
    byRecipient.set(subscription.recipient_user_id, current);
  }

  for (const notification of notifications) {
    const payload = JSON.stringify({
      id: notification.id,
      title: notification.title,
      body: notification.body || "Откройте TravkinFlow для подробностей.",
      href: notification.href || "/traffic",
    });
    for (const subscription of byRecipient.get(notification.recipient_user_id) || []) {
      try {
        await webPush.sendNotification(asPushSubscription(subscription), payload, {
          TTL: 5 * 60,
          urgency: "high",
          timeout: 3_000,
        });
        result.sent += 1;
        await db
          .from("user_push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq("endpoint_hash", subscription.endpoint_hash);
      } catch (error) {
        const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          result.removed += 1;
          await db
            .from("user_push_subscriptions")
            .delete()
            .eq("endpoint_hash", subscription.endpoint_hash);
        } else {
          result.failed += 1;
          await db
            .from("user_push_subscriptions")
            .update({ failure_count: Math.max(0, subscription.failure_count || 0) + 1 })
            .eq("endpoint_hash", subscription.endpoint_hash);
          console.warn("Traffic push delivery failed", {
            notificationId: notification.id,
            endpointHash: subscription.endpoint_hash,
            statusCode,
          });
        }
      }
    }
  }

  return result;
}
