import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import {
  PROFILE_AVATAR_BUCKET,
  PROFILE_AVATAR_MAX_SOURCE_BYTES,
  PROFILE_AVATAR_MAX_WEBP_BYTES,
  isOwnedAvatarPath,
  sanitizeProfileAvatarWebp,
} from "@/lib/profile/avatar";

export const runtime = "nodejs";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function assertWriteEnabled() {
  if (process.env.PROFILE_AVATAR_WRITE_V1 !== "1") {
    throw new SessionAuthError("Profile photo changes are temporarily disabled", 503);
  }
}

function fail(error: unknown): NextResponse {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE_HEADERS });
  }
  const message = error instanceof Error ? error.message : "Profile avatar request failed";
  const isValidation = /avatar|webp|image|animated|dimension|file/i.test(message);
  return NextResponse.json(
    { error: isValidation ? message : "Profile avatar request failed" },
    { status: isValidation ? 400 : 500, headers: PRIVATE_HEADERS },
  );
}

async function resolveEditableActor(request: NextRequest) {
  const effectiveActor = await getServerActorFromSession(request);
  if (effectiveActor.isImpersonating) {
    throw new SessionAuthError("Return to Global Admin before changing a profile photo", 403);
  }
  const physicalActor = await getServerActorFromSession(request, { ignoreImpersonation: true });
  if (physicalActor.id !== effectiveActor.id || physicalActor.authUserId !== effectiveActor.authUserId) {
    throw new SessionAuthError("Profile identity changed during the request", 409);
  }
  return physicalActor;
}

async function loadAvatarPath(profileId: string): Promise<string | null> {
  const admin = getServiceClient();
  const { data, error } = await admin.from("profiles").select("avatar_path").eq("id", profileId).maybeSingle();
  if (error) throw new Error("Profile avatar lookup failed");
  const path = String(data?.avatar_path || "").trim();
  return path || null;
}

async function createPrivateAvatarUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const admin = getServiceClient();
  const { data, error } = await admin.storage.from(PROFILE_AVATAR_BUCKET).createSignedUrl(path, 60 * 60);
  if (error) throw new Error("Profile avatar URL creation failed");
  return data.signedUrl;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const path = await loadAvatarPath(actor.id);
    return NextResponse.json(
      { avatarUrl: await createPrivateAvatarUrl(path), updated: Boolean(path) },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  let uploadedPath: string | null = null;
  try {
    assertWriteEnabled();
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > PROFILE_AVATAR_MAX_SOURCE_BYTES + 256 * 1024) {
      throw new SessionAuthError("Avatar file is too large", 413);
    }
    const actor = await resolveEditableActor(request);
    const formData = await request.formData();
    const candidate = formData.get("avatar");
    if (!(candidate instanceof File)) throw new SessionAuthError("Avatar file is required", 400);
    if (candidate.type !== "image/webp") throw new SessionAuthError("Avatar must be converted to WebP", 400);
    if (candidate.size < 20 || candidate.size > PROFILE_AVATAR_MAX_WEBP_BYTES) {
      throw new SessionAuthError("Avatar WebP file is too large", 413);
    }

    const sanitized = sanitizeProfileAvatarWebp(new Uint8Array(await candidate.arrayBuffer()));
    const admin = getServiceClient();
    const oldPath = await loadAvatarPath(actor.id);
    uploadedPath = `${actor.id}/${Date.now()}-${randomUUID()}.webp`;
    const { error: uploadError } = await admin.storage.from(PROFILE_AVATAR_BUCKET).upload(
      uploadedPath,
      sanitized.bytes,
      { contentType: "image/webp", cacheControl: "3600", upsert: false },
    );
    if (uploadError) throw new Error("Profile avatar upload failed");

    const updatedAt = new Date().toISOString();
    const { error: profileError } = await admin
      .from("profiles")
      .update({ avatar_path: uploadedPath, avatar_updated_at: updatedAt })
      .eq("id", actor.id);
    if (profileError) throw new Error("Profile avatar update failed");

    if (oldPath && oldPath !== uploadedPath && isOwnedAvatarPath(actor.id, oldPath)) {
      await admin.storage.from(PROFILE_AVATAR_BUCKET).remove([oldPath]);
    }
    return NextResponse.json(
      {
        avatarUrl: await createPrivateAvatarUrl(uploadedPath),
        updatedAt,
        width: sanitized.width,
        height: sanitized.height,
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (uploadedPath) {
      await getServiceClient().storage.from(PROFILE_AVATAR_BUCKET).remove([uploadedPath]).catch(() => undefined);
    }
    return fail(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertWriteEnabled();
    const actor = await resolveEditableActor(request);
    const admin = getServiceClient();
    const path = await loadAvatarPath(actor.id);
    const updatedAt = new Date().toISOString();
    const { error } = await admin
      .from("profiles")
      .update({ avatar_path: null, avatar_updated_at: updatedAt })
      .eq("id", actor.id);
    if (error) throw new Error("Profile avatar removal failed");
    if (path && isOwnedAvatarPath(actor.id, path)) {
      await admin.storage.from(PROFILE_AVATAR_BUCKET).remove([path]);
    }
    return NextResponse.json({ avatarUrl: null, updatedAt }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return fail(error);
  }
}
