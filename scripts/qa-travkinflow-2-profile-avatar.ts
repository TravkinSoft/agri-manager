import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateSquareCrop, profileAvatarRetryDelay } from "../lib/profile/avatar-client";
import { isOwnedAvatarPath, sanitizeProfileAvatarWebp } from "../lib/profile/avatar";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function chunk(kind: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(kind, 0, 4, "ascii");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function webp(width = 512, height = 320, extras: Buffer[] = []): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x20 | 0x08 | 0x04;
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const vp8 = Buffer.alloc(10);
  vp8[3] = 0x9d;
  vp8[4] = 0x01;
  vp8[5] = 0x2a;
  vp8.writeUInt16LE(width, 6);
  vp8.writeUInt16LE(height, 8);
  const body = Buffer.concat([chunk("VP8X", vp8x), ...extras, chunk("VP8 ", vp8)]);
  const header = Buffer.from("RIFF\0\0\0\0WEBP", "binary");
  const output = Buffer.concat([header, body]);
  output.writeUInt32LE(output.length - 8, 4);
  return output;
}

const sanitized = sanitizeProfileAvatarWebp(webp(512, 320, [
  chunk("EXIF", Buffer.from("private gps metadata")),
  chunk("XMP ", Buffer.from("private xmp metadata")),
]));
assert.equal(sanitized.width, 512);
assert.equal(sanitized.height, 320);
assert.doesNotMatch(sanitized.bytes.toString("binary"), /EXIF|XMP |private gps|private xmp/);
assert.equal(sanitized.bytes.readUInt8(20) & (0x20 | 0x08 | 0x04), 0, "metadata feature flags remain set");
assert.throws(() => sanitizeProfileAvatarWebp(webp(513, 320)), /must not exceed/);
assert.throws(() => sanitizeProfileAvatarWebp(Buffer.from("not an image")), /size|WebP/);
assert.equal(isOwnedAvatarPath("profile-id", "profile-id/123.webp"), true);
assert.equal(isOwnedAvatarPath("profile-id", "another/123.webp"), false);
assert.deepEqual(calculateSquareCrop(1200, 800), {
  sourceX: 200,
  sourceY: 0,
  sourceEdge: 800,
  outputEdge: 512,
});
assert.deepEqual([0, 1, 2, 3, 4, -1].map(profileAvatarRetryDelay), [5_000, 15_000, 60_000, 300_000, null, null]);

const route = read("app/api/profile/avatar/route.ts");
const release = read("lib/travkinflow-2/release.ts");
assert.match(release, /export const TRAVKINFLOW_2_FUNCTIONS_RELEASED = true/);
assert.match(route, /if \(!TRAVKINFLOW_2_FUNCTIONS_RELEASED\)/);
assert.match(route, /effectiveActor\.isImpersonating/);
assert.match(route, /ignoreImpersonation: true/);
assert.match(route, /candidate\.type !== "image\/webp"/);
assert.match(route, /sanitizeProfileAvatarWebp/);
assert.match(route, /randomUUID\(\)/);
assert.match(route, /upsert: false/);
assert.match(route, /createSignedUrl\(path, 60 \* 60\)/);
assert.match(route, /"Cache-Control": "private, no-store, max-age=0"/);
const signBeforeCommit = route.indexOf("const avatarUrl = await createPrivateAvatarUrl(uploadedPath)");
const profileCommit = route.indexOf('.update({ avatar_path: uploadedPath, avatar_updated_at: updatedAt })');
assert.ok(signBeforeCommit >= 0 && signBeforeCommit < profileCommit, "new object must be signed before the database pointer changes");
assert.match(route, /profileCommitAttempted && !profileCommitted/);
assert.match(route, /if \(profileError\)[\s\S]{0,220}reconciledPath !== uploadedPath/);
assert.match(route, /currentPath !== undefined && currentPath !== uploadedPath/);
assert.match(route, /remove\(\[oldPath\]\)\.catch\(\(\) => undefined\)/);
assert.match(route, /if \(error\)[\s\S]{0,220}reconciledPath !== null/);
assert.match(route, /remove\(\[path\]\)\.catch\(\(\) => undefined\)/);

const migration = read("supabase/migrations/20260909024500_profile_avatar_v1.sql");
assert.match(migration, /add column if not exists avatar_path text/);
assert.match(migration, /'profile-media'[\s\S]*false[\s\S]*array\['image\/webp'\]/);
assert.doesNotMatch(migration, /create policy/i);

const settings = read("app/(dashboard)/settings/page.tsx");
assert.match(settings, /PROFILE_AVATAR_UI_ENABLED = TRAVKINFLOW_2_FUNCTIONS_RELEASED/);
assert.match(settings, /prepareProfileAvatarWebp/);
assert.match(settings, /profile\?\.is_impersonating/);
assert.match(settings, /method: "DELETE"/);

const header = read("components/layout/header.tsx");
assert.match(header, /<ProfileAvatar/);
assert.match(header, /version=\{profile\?\.avatar_updated_at\}/);

const avatar = read("components/profile/profile-avatar.tsx");
assert.match(avatar, /PROFILE_AVATAR_UI_ENABLED = TRAVKINFLOW_2_FUNCTIONS_RELEASED/);
assert.match(avatar, /!PROFILE_AVATAR_UI_ENABLED\s*\|\|\s*!profileId/);
assert.match(avatar, /profileAvatarRetryDelay\(retryAttempt\)/);
assert.match(avatar, /setTimeout\(\(\) => void load\(\)\.catch\(\(\) => scheduleRetry\(\)\), delay\)/);

const envExample = read(".env.example");
assert.doesNotMatch(envExample, /PROFILE_AVATAR_(?:WRITE_V1|V1)/);

console.log("TRAVKINFLOW 2 PROFILE AVATAR: 41/41 PASS");
