const RIFF = "RIFF";
const WEBP = "WEBP";
const METADATA_CHUNKS = new Set(["EXIF", "XMP ", "ICCP"]);
const STATIC_IMAGE_CHUNKS = new Set(["VP8 ", "VP8L"]);

export const PROFILE_AVATAR_BUCKET = "profile-media";
export const PROFILE_AVATAR_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const PROFILE_AVATAR_MAX_WEBP_BYTES = 1536 * 1024;
export const PROFILE_AVATAR_MAX_EDGE = 512;

export type SanitizedAvatar = {
  bytes: Buffer;
  width: number;
  height: number;
};

function fourCc(bytes: Buffer, offset: number): string {
  return bytes.toString("ascii", offset, offset + 4);
}

function vp8xDimensions(data: Buffer): { width: number; height: number } {
  if (data.length < 10) throw new Error("Invalid VP8X header");
  return {
    width: 1 + data.readUIntLE(4, 3),
    height: 1 + data.readUIntLE(7, 3),
  };
}

function vp8Dimensions(data: Buffer): { width: number; height: number } {
  if (data.length < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
    throw new Error("Invalid VP8 frame header");
  }
  return {
    width: data.readUInt16LE(6) & 0x3fff,
    height: data.readUInt16LE(8) & 0x3fff,
  };
}

function vp8lDimensions(data: Buffer): { width: number; height: number } {
  if (data.length < 5 || data[0] !== 0x2f) throw new Error("Invalid VP8L frame header");
  return {
    width: 1 + data[1] + ((data[2] & 0x3f) << 8),
    height: 1 + (data[2] >> 6) + (data[3] << 2) + ((data[4] & 0x0f) << 10),
  };
}

function assertSafeDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Avatar dimensions are invalid");
  }
  if (width > PROFILE_AVATAR_MAX_EDGE || height > PROFILE_AVATAR_MAX_EDGE) {
    throw new Error(`Avatar dimensions must not exceed ${PROFILE_AVATAR_MAX_EDGE}x${PROFILE_AVATAR_MAX_EDGE}`);
  }
}

export function sanitizeProfileAvatarWebp(input: Uint8Array): SanitizedAvatar {
  const bytes = Buffer.from(input);
  if (bytes.length < 20 || bytes.length > PROFILE_AVATAR_MAX_WEBP_BYTES) {
    throw new Error("Avatar WebP size is invalid");
  }
  if (fourCc(bytes, 0) !== RIFF || fourCc(bytes, 8) !== WEBP) {
    throw new Error("Avatar must be a valid WebP image");
  }
  const declaredLength = bytes.readUInt32LE(4) + 8;
  if (declaredLength !== bytes.length) throw new Error("Avatar WebP container length is invalid");

  const chunks: Buffer[] = [];
  let offset = 12;
  let dimensions: { width: number; height: number } | null = null;
  let hasImage = false;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error("Avatar WebP chunk header is truncated");
    const kind = fourCc(bytes, offset);
    const size = bytes.readUInt32LE(offset + 4);
    const paddedSize = size + (size % 2);
    const end = offset + 8 + paddedSize;
    if (end > bytes.length) throw new Error("Avatar WebP chunk is truncated");
    if (kind === "ANIM" || kind === "ANMF") throw new Error("Animated avatars are not supported");

    if (!METADATA_CHUNKS.has(kind)) {
      const chunk = Buffer.from(bytes.subarray(offset, end));
      const data = chunk.subarray(8, 8 + size);
      if (kind === "VP8X") {
        dimensions ||= vp8xDimensions(data);
        data[0] &= ~(0x20 | 0x08 | 0x04);
      } else if (kind === "VP8 ") {
        dimensions ||= vp8Dimensions(data);
        hasImage = true;
      } else if (kind === "VP8L") {
        dimensions ||= vp8lDimensions(data);
        hasImage = true;
      } else if (STATIC_IMAGE_CHUNKS.has(kind)) {
        hasImage = true;
      }
      chunks.push(chunk);
    }
    offset = end;
  }

  if (offset !== bytes.length || !hasImage || !dimensions) throw new Error("Avatar WebP has no static image frame");
  assertSafeDimensions(dimensions.width, dimensions.height);

  const output = Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBP", "binary"), ...chunks]);
  output.writeUInt32LE(output.length - 8, 4);
  return { bytes: output, ...dimensions };
}

export function isOwnedAvatarPath(profileId: string, path: string | null | undefined): boolean {
  const normalizedProfileId = String(profileId || "").trim().toLowerCase();
  const normalizedPath = String(path || "").trim().toLowerCase();
  return Boolean(normalizedProfileId && normalizedPath.startsWith(`${normalizedProfileId}/`) && normalizedPath.endsWith(".webp"));
}
