import { supabase } from "@/lib/supabase/client";

export type PlatformRuntimeStatus = {
  runtime: {
    environment: "production" | "preview" | "development";
    branch: string;
    commit: string | null;
    database: "PRODUCTION" | "QA" | "LOCAL";
    season: string;
  };
  catalog: {
    products: {
      pesticides: number;
      fertilizers: number;
      additives: number;
      growthRegulators: number;
      other: number;
      total: number;
    };
    pesticideImport: {
      batchId: string;
      expected: number;
      found: number;
    };
  };
  companies: {
    total: number;
    selected: {
      id: string;
      name: string;
    } | null;
  };
  generatedAt: string;
};

const STATUS_CACHE_TTL_MS = 30_000;
let cachedStatus: { value: PlatformRuntimeStatus; expiresAt: number } | null = null;
let statusRequest: Promise<PlatformRuntimeStatus> | null = null;

export async function loadPlatformRuntimeStatus(options?: { fresh?: boolean }): Promise<PlatformRuntimeStatus> {
  if (!options?.fresh && cachedStatus && cachedStatus.expiresAt > Date.now()) {
    return cachedStatus.value;
  }
  if (!options?.fresh && statusRequest) return statusRequest;

  statusRequest = loadPlatformRuntimeStatusFromServer();
  try {
    const value = await statusRequest;
    cachedStatus = { value, expiresAt: Date.now() + STATUS_CACHE_TTL_MS };
    return value;
  } finally {
    statusRequest = null;
  }
}

async function loadPlatformRuntimeStatusFromServer(): Promise<PlatformRuntimeStatus> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error("Сессия истекла. Войдите снова.");
  }

  const response = await fetch("/api/global-admin/platform-status", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Не удалось загрузить состояние платформы");
  }
  return payload as PlatformRuntimeStatus;
}
