import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const migration = read("supabase/migrations/20260906202809_ptc_operational_notifications_v1.sql");
const indexes = read("supabase/migrations/20260906205107_ptc_operational_notification_indexes.sql");
const repairRoute = read("app/api/fleet/repair/route.ts");
const lineRoute = read("app/api/traffic/line/route.ts");
const cronRoute = read("app/api/cron/ptc-idle-alerts/route.ts");
const pushRoute = read("app/api/notifications/push-subscription/route.ts");
const pushServer = read("lib/notifications/push-server.ts");
const rootWorker = read("public/sw.js");
const offlineRuntime = read("components/offline/offline-runtime.tsx");
const toggle = read("components/notifications/push-notifications-toggle.tsx");
const vercel = JSON.parse(read("vercel.json")) as { crons?: Array<{ path: string; schedule: string }> };

assert.match(migration, /p_recipient_user_id = p_actor_user_id/, "actor must not receive their own immediate notification");
assert.match(migration, /lower\(profile\.role\) = 'agronomist'/, "fleet events must target agronomists");
assert.match(migration, /lower\(profile\.role\) in \('agronomist', 'fleet_manager'\)/, "idle alerts must target agronomists and fleet managers");
assert.match(migration, /interval '15 minutes'/, "15-minute idle threshold is missing");
assert.match(migration, /interval '30 minutes'/, "30-minute escalation is missing");
assert.match(migration, /alerted_15_at = null,[\s\S]*alerted_30_at = null/, "a committed load must re-arm both thresholds");
assert.match(migration, /v_changed_count := cardinality\(changed\)/, "line changes must be grouped");
assert.match(migration, /on conflict\(idempotency_key\) do nothing/, "idle notifications must be idempotent");
assert.doesNotMatch(migration, /insert into public\.ptc_idle_alert_state[\s\S]*select[\s\S]*from public\.ptc_events/i, "migration must not arm alerts from historical events");
assert.match(migration, /revoke all on public\.user_push_subscriptions from public, anon, authenticated/, "push secrets must be server-only");
assert.match(indexes, /ptc_idle_alert_last_event_idx/, "idle event foreign key needs an index");
assert.match(indexes, /user_push_subscriptions_company_idx/, "push company foreign key needs an index");

for (const [name, route] of [["repair", repairRoute], ["line", lineRoute]] as const) {
  assert.match(route, /waitUntil\(/, `${name} route must not block its response on push delivery`);
  assert.match(route, /dispatchPushNotifications/, `${name} route must dispatch push after commit`);
}
assert.match(cronRoute, /authorization[^\n]*`Bearer \$\{secret\}`/, "cron endpoint must require CRON_SECRET");
assert.match(cronRoute, /ptc_emit_idle_alerts_v1/, "cron endpoint must use the atomic idle-alert RPC");
assert.match(pushRoute, /actor\.role === "global_admin"/, "push subscriptions must bind to a real company account");
assert.match(pushRoute, /sameOrigin\(request\)/, "push subscription mutations must be same-origin");
assert.match(pushServer, /TTL: 5 \* 60/, "stale operational push must expire quickly");
assert.match(pushServer, /statusCode === 404 \|\| statusCode === 410/, "expired device subscriptions must be removed");

assert.match(rootWorker, /addEventListener\("push"/, "root service worker must display background push");
assert.match(rootWorker, /silent: false/, "notification must allow the Android channel sound");
assert.match(rootWorker, /addEventListener\("notificationclick"/, "push must open the relevant TravkinFlow screen");
assert.match(offlineRuntime, /!operatorTraffic/, "root push worker must not replace the isolated operator worker");
assert.match(toggle, /Notification\.requestPermission\(\)/, "permission must only be requested from a user action");
assert.deepEqual(vercel.crons, [{ path: "/api/cron/ptc-idle-alerts", schedule: "* * * * *" }]);

console.log("PTC operational notifications V1 contract: PASS");
