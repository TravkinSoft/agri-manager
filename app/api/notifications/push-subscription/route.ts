import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerActorFromSession, resolveCompanyForActor, SessionAuthError } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import { hashPushEndpoint, getWebPushPublicKey } from "@/lib/notifications/push-server";
import { sameOrigin } from "@/lib/traffic/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const companyIdSchema = z.string().uuid();
const subscriptionSchema = z.object({
  companyId: companyIdSchema,
  subscription: z.object({
    endpoint: z.string().url().max(2048).refine((value) => value.startsWith("https://")),
    keys: z.object({
      p256dh: z.string().min(40).max(512),
      auth: z.string().min(8).max(128),
    }).strict(),
  }).strict(),
}).strict();
const deleteSchema = z.object({
  companyId: companyIdSchema,
  endpoint: z.string().url().max(2048).refine((value) => value.startsWith("https://")),
}).strict();

function failed(error: unknown) {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "Некорректная подписка устройства" }, { status: 400 });
  }
  console.error("Push subscription request failed", error);
  return NextResponse.json({ error: "Не удалось изменить уведомления телефона" }, { status: 500 });
}

async function actorForCompany(request: NextRequest, companyId: string) {
  const actor = await getServerActorFromSession(request, { skipCache: true });
  if (String(actor.status || "active") !== "active") {
    throw new SessionAuthError("Неактивный пользователь", 403);
  }
  const resolvedCompanyId = resolveCompanyForActor(actor, companyId);
  if (!actor.id || actor.role === "global_admin" || actor.companyId !== resolvedCompanyId) {
    throw new SessionAuthError("Push доступен рабочему аккаунту компании", 403);
  }
  return { actor, companyId: resolvedCompanyId };
}

export async function GET(request: NextRequest) {
  try {
    const companyId = companyIdSchema.parse(request.nextUrl.searchParams.get("companyId"));
    const { actor } = await actorForCompany(request, companyId);
    const publicKey = getWebPushPublicKey();
    return NextResponse.json(
      { configured: Boolean(publicKey), publicKey, recipientUserId: actor.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failed(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = subscriptionSchema.parse(await request.json());
    const { actor, companyId } = await actorForCompany(request, input.companyId);
    if (!getWebPushPublicKey()) {
      throw new SessionAuthError("Push ещё не настроен на сервере", 503);
    }
    const endpointHash = hashPushEndpoint(input.subscription.endpoint);
    const { error } = await getServiceClient()
      .from("user_push_subscriptions")
      .upsert({
        endpoint_hash: endpointHash,
        company_id: companyId,
        recipient_user_id: actor.id,
        endpoint: input.subscription.endpoint,
        p256dh: input.subscription.keys.p256dh,
        auth: input.subscription.keys.auth,
        user_agent: String(request.headers.get("user-agent") || "").slice(0, 500) || null,
        updated_at: new Date().toISOString(),
        failure_count: 0,
      }, { onConflict: "endpoint_hash" });
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = deleteSchema.parse(await request.json());
    const { actor, companyId } = await actorForCompany(request, input.companyId);
    const { error } = await getServiceClient()
      .from("user_push_subscriptions")
      .delete()
      .eq("endpoint_hash", hashPushEndpoint(input.endpoint))
      .eq("company_id", companyId)
      .eq("recipient_user_id", actor.id);
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failed(error);
  }
}
