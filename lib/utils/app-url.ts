function normalizeBaseUrl(raw: string | undefined | null): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withProtocol).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

const PRODUCTION_APP_URL = "https://agri-manager-eight.vercel.app";

export function getPublicAppUrl(): string {
  const envCandidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.INVITE_APP_URL,
  ];

  for (const candidate of envCandidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }

  const vercelUrl = normalizeBaseUrl(process.env.VERCEL_URL);
  if (vercelUrl) return vercelUrl;

  return "http://localhost:3000";
}

function getConfiguredInviteAppUrl(): string {
  const envCandidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.APP_URL,
    process.env.INVITE_APP_URL,
  ];

  for (const candidate of envCandidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }

  return PRODUCTION_APP_URL;
}

export function getInviteSetPasswordRedirectTo(): string {
  return `${getConfiguredInviteAppUrl()}/auth/set-password`;
}

export function getRequestOrigin(request: Request): string {
  const explicitEnvCandidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.INVITE_APP_URL,
  ];

  for (const candidate of explicitEnvCandidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized && !normalized.includes("localhost")) return normalized;
  }

  const xForwardedProto = request.headers.get("x-forwarded-proto");
  const xForwardedHost = request.headers.get("x-forwarded-host");
  if (xForwardedHost) {
    const normalized = normalizeBaseUrl(
      `${xForwardedProto || "https"}://${xForwardedHost}`
    );
    if (normalized) return normalized;
  }

  const fromRequest = normalizeBaseUrl(new URL(request.url).origin);
  if (fromRequest) return fromRequest;

  const fromEnv = getPublicAppUrl();
  return fromEnv || "http://localhost:3000";
}
