import type {
  CreateFuelIssueInput,
  CreateFuelSourceInput,
  CreateFuelTransferInput,
  FuelBootstrap,
  FuelSource,
  UpdateFuelSourceInput,
  UpsertFuelLimitInput,
} from "@/lib/types/fuel";

async function parseJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

export async function getFuelBootstrap(companyId: string, userId: string): Promise<FuelBootstrap> {
  const response = await fetch(
    `/api/fuel/bootstrap?companyId=${encodeURIComponent(companyId)}&userId=${encodeURIComponent(userId)}`,
    { method: "GET", cache: "no-store" },
  );
  const payload = await parseJsonOrThrow(response);
  return {
    sources: payload.sources || [],
    vehicles: payload.vehicles || [],
    mechanizators: payload.mechanizators || [],
    recentIssues: payload.recentIssues || [],
    recentTransfers: payload.recentTransfers || [],
    limits: payload.limits || [],
  } as FuelBootstrap;
}

export async function createFuelIssue(input: CreateFuelIssueInput): Promise<{ id: string }> {
  const response = await fetch("/api/fuel/issues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function createFuelTransfer(input: CreateFuelTransferInput): Promise<{ id: string }> {
  const response = await fetch("/api/fuel/transfers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function createFuelSource(input: CreateFuelSourceInput): Promise<{ source: FuelSource }> {
  const response = await fetch("/api/fuel/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function updateFuelSource(sourceId: string, input: UpdateFuelSourceInput): Promise<{ source: FuelSource }> {
  const response = await fetch(`/api/fuel/sources/${encodeURIComponent(sourceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function upsertFuelLimit(input: UpsertFuelLimitInput): Promise<{ id: string }> {
  const response = await fetch("/api/fuel/limits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}
