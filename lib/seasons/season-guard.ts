import type { SupabaseClient } from "@supabase/supabase-js";

export class SeasonGuardError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "SeasonGuardError";
    this.status = status;
  }
}

function normalizeUuid(value: unknown): string | null {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

export async function resolveOperationSeasonIdForGuard(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    seasonId?: string | null;
    cropStructureId?: string | null;
  }
): Promise<string | null> {
  const directSeasonId = normalizeUuid(params.seasonId);
  if (directSeasonId) return directSeasonId;

  const cropStructureId = normalizeUuid(params.cropStructureId);
  if (!cropStructureId) return null;

  const { data, error } = await supabase
    .from("crop_structure")
    .select("season_id")
    .eq("company_id", params.companyId)
    .eq("id", cropStructureId)
    .maybeSingle();

  if (error) throw new SeasonGuardError(error.message || "Failed to check operation season", 400);
  return normalizeUuid((data as any)?.season_id);
}

export async function assertSeasonWritableForMutation(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    seasonId?: string | null;
    actionLabel?: string;
  }
): Promise<void> {
  const seasonId = normalizeUuid(params.seasonId);
  if (!seasonId) return;

  const { data, error } = await supabase
    .from("seasons")
    .select("id,year,name,archived")
    .eq("company_id", params.companyId)
    .eq("id", seasonId)
    .maybeSingle();

  if (error) throw new SeasonGuardError(error.message || "Failed to check season", 400);
  if (!data?.id) {
    throw new SeasonGuardError("Operation season was not found. Mutation is blocked.", 409);
  }
  if (Boolean((data as any).archived)) {
    const label = params.actionLabel || "Operation mutation";
    const seasonLabel = (data as any).year || (data as any).name || "closed season";
    throw new SeasonGuardError(`${label} is blocked: season ${seasonLabel} is closed.`, 409);
  }
}
