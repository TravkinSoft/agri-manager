import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/service";
import { isLegacyRoleAlias, normalizeRoleKey, parseCanonicalRole, type CanonicalRole } from "@/lib/auth/role-contract";

export type ServerRole = CanonicalRole;

export type ServerActorContext = {
  id: string; // profile id
  authUserId: string; // auth.users.id
  role: ServerRole;
  roleRawKey: string;
  roleIsLegacyAlias: boolean;
  companyId: string | null;
  homeCompanyId: string | null;
  contextCompanyId: string | null;
  status: string | null;
  email: string | null;
};

export class SessionAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "SessionAuthError";
    this.status = status;
  }
}

const ASSISTANT_ALLOWED_ROLES = new Set<ServerRole>([
  "global_admin",
  "company_admin",
  "agronomist",
  "director",
]);

function isAssistantAccessStrict(): boolean {
  return process.env.ASSISTANT_ACCESS_STRICT !== "0";
}

type ProfileRow = {
  id: string;
  user_id?: string | null;
  role: string | null;
  status: string | null;
  company_id: string | null;
  email?: string | null;
};

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizeRole(rawRole: unknown): ServerRole | null {
  return parseCanonicalRole(rawRole);
}

function normalizeStatus(rawStatus: unknown): string {
  return String(rawStatus || "active").trim().toLowerCase();
}

function parseBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = String(match?.[1] || "").trim();
  return token || null;
}

async function createSessionScopedClient(token: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new SessionAuthError("Supabase anon credentials are not configured", 500);
  }

  return createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function getSessionIdentity(request: NextRequest): Promise<{ userId: string; token: string; email: string | null }> {
  const token = parseBearerToken(request);
  if (!token) {
    throw new SessionAuthError("Missing authorization token", 401);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new SessionAuthError("Supabase anon credentials are not configured", 500);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user?.id) {
    throw new SessionAuthError("Invalid or expired session token", 401);
  }

  const userId = String(data.user.id || "").trim();
  if (!isUuidLike(userId)) {
    throw new SessionAuthError("Invalid session user id", 401);
  }

  const email = String(data.user.email || "").trim().toLowerCase();
  return { userId, token, email: email || null };
}

function normalizeProfileRows(rows: unknown): ProfileRow[] {
  if (!Array.isArray(rows)) return [];
  const normalized: ProfileRow[] = [];
  rows.forEach((row) => {
    const item = row as Record<string, unknown>;
    const id = String(item.id || "").trim();
    if (!isUuidLike(id)) return;
    const userId = String(item.user_id || "").trim();
    normalized.push({
      id,
      user_id: userId && isUuidLike(userId) ? userId : null,
      role: item.role == null ? null : String(item.role),
      status: item.status == null ? null : String(item.status),
      company_id: item.company_id == null ? null : String(item.company_id),
      email: item.email == null ? null : String(item.email),
    });
  });
  return normalized;
}

function profileScore(row: ProfileRow, preferredUserId: string): number {
  let score = 0;
  if (row.id === preferredUserId) score += 100;
  if (row.user_id === preferredUserId) score += 90;
  if (normalizeStatus(row.status) === "active") score += 30;
  if (normalizeRole(row.role)) score += 30;
  if (row.company_id && isUuidLike(String(row.company_id))) score += 20;
  return score;
}

function pickBestProfile(rows: ProfileRow[], preferredUserId: string): ProfileRow | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => profileScore(b, preferredUserId) - profileScore(a, preferredUserId))[0] || null;
}

function addCandidates(target: Map<string, ProfileRow>, rows: ProfileRow[]) {
  rows.forEach((row) => {
    if (!target.has(row.id)) {
      target.set(row.id, row);
    }
  });
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

async function findProfileByIdOrEmail(params: {
  userId: string;
  userEmail: string | null;
  token: string;
}): Promise<{ selected: ProfileRow; candidates: ProfileRow[] }> {
  const { userId, userEmail, token } = params;
  const supabase = getServiceClient();
  const sessionClient = await createSessionScopedClient(token);
  const normalizedUserEmail = normalizeEmail(userEmail);

  const profileCandidates = new Map<string, ProfileRow>();
  const supportsUserIdByColumnProbe = await (async () => {
    const probe = await supabase.from("profiles").select("user_id").limit(1);
    return !probe.error;
  })();

  // Keep lookup resilient to schema drift between environments.
  // Explicit column lists can fail when an old DB is missing one column.
  const serviceById = await supabase.from("profiles").select("*").eq("id", userId).limit(1);
  if (!serviceById.error) addCandidates(profileCandidates, normalizeProfileRows(serviceById.data));

  if (supportsUserIdByColumnProbe) {
    const serviceByUserId = await supabase.from("profiles").select("*").eq("user_id", userId).limit(10);
    if (!serviceByUserId.error) addCandidates(profileCandidates, normalizeProfileRows(serviceByUserId.data));
  }

  if (normalizedUserEmail) {
    const serviceByEmail = await supabase.from("profiles").select("*").ilike("email", normalizedUserEmail).limit(50);
    if (!serviceByEmail.error) addCandidates(profileCandidates, normalizeProfileRows(serviceByEmail.data));
  }

  const rlsById = await sessionClient.from("profiles").select("*").eq("id", userId).limit(1);
  if (!rlsById.error) addCandidates(profileCandidates, normalizeProfileRows(rlsById.data));

  if (supportsUserIdByColumnProbe) {
    const rlsByUserId = await sessionClient.from("profiles").select("*").eq("user_id", userId).limit(10);
    if (!rlsByUserId.error) addCandidates(profileCandidates, normalizeProfileRows(rlsByUserId.data));
  }

  if (normalizedUserEmail) {
    const rlsByEmail = await sessionClient.from("profiles").select("*").ilike("email", normalizedUserEmail).limit(50);
    if (!rlsByEmail.error) addCandidates(profileCandidates, normalizeProfileRows(rlsByEmail.data));
  }

  // Last-resort scan for older environments where filters/aliases are inconsistent.
  if (!profileCandidates.size && normalizedUserEmail) {
    const profileScanRes = await supabase.from("profiles").select("*").limit(5000);
    if (!profileScanRes.error && Array.isArray(profileScanRes.data)) {
      const scanned = normalizeProfileRows(profileScanRes.data).filter(
        (row) => normalizeEmail(row.email) === normalizedUserEmail
      );
      addCandidates(profileCandidates, scanned);
    }
  }

  const allCandidates = Array.from(profileCandidates.values());
  const selected = pickBestProfile(allCandidates, userId);
  if (!selected) {
    throw new SessionAuthError("Profile not found for authenticated user", 403);
  }

  return {
    selected,
    candidates: allCandidates,
  };
}

function pickCompanyFromProfileCandidates(candidates: ProfileRow[]): string | null {
  const uniqueCompanyIds = Array.from(
    new Set(
      (candidates || [])
        .map((row) => String(row.company_id || "").trim())
        .filter((value) => isUuidLike(value))
    )
  );
  if (!uniqueCompanyIds.length) return null;
  if (uniqueCompanyIds.length === 1) return uniqueCompanyIds[0];

  const activeRowsWithCompany = (candidates || []).filter((row) => {
    const companyId = String(row.company_id || "").trim();
    return isUuidLike(companyId) && normalizeStatus(row.status) === "active";
  });
  const preferred = pickBestProfile(activeRowsWithCompany, "");
  if (preferred?.company_id && isUuidLike(String(preferred.company_id))) {
    return String(preferred.company_id);
  }

  return uniqueCompanyIds[0] || null;
}

async function resolveFallbackCompanyId(token: string, preferredProfileId?: string | null): Promise<string | null> {
  try {
    const sessionClient = await createSessionScopedClient(token);
    const { data: rpcValue } = await sessionClient.rpc("get_user_company_id");
    const companyId = String(rpcValue || "").trim();
    if (isUuidLike(companyId)) return companyId;

    const preferredId = String(preferredProfileId || "").trim();
    if (isUuidLike(preferredId)) {
      const preferredProfileRes = await sessionClient
        .from("profiles")
        .select("company_id")
        .eq("id", preferredId)
        .limit(1)
        .maybeSingle();
      const preferredCompanyId = String(preferredProfileRes.data?.company_id || "").trim();
      if (isUuidLike(preferredCompanyId)) return preferredCompanyId;
    }

    const profileCompanyRes = await sessionClient
      .from("profiles")
      .select("company_id")
      .not("company_id", "is", null)
      .limit(5);
    if (!profileCompanyRes.error && Array.isArray(profileCompanyRes.data) && profileCompanyRes.data.length > 0) {
      const uniqueCompanyIds = Array.from(
        new Set(
          profileCompanyRes.data
            .map((row: any) => String(row?.company_id || "").trim())
            .filter((value: string) => isUuidLike(value))
        )
      );
      if (uniqueCompanyIds.length === 1) {
        return uniqueCompanyIds[0];
      }
    }

    const singleCompanyRes = await sessionClient.from("companies").select("id").limit(2);
    if (!singleCompanyRes.error && Array.isArray(singleCompanyRes.data) && singleCompanyRes.data.length === 1) {
      const singleId = String(singleCompanyRes.data[0]?.id || "").trim();
      if (isUuidLike(singleId)) return singleId;
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveCompanyIdFromServiceProfiles(params: {
  authUserId: string;
  preferredProfileId?: string | null;
  userEmail?: string | null;
}): Promise<string | null> {
  try {
    const { authUserId, preferredProfileId, userEmail } = params;
    const supabase = getServiceClient();
    const supportsUserIdByColumnProbe = await (async () => {
      const probe = await supabase.from("profiles").select("user_id").limit(1);
      return !probe.error;
    })();

    const rowsMap = new Map<string, ProfileRow>();
    const add = (data: unknown) => addCandidates(rowsMap, normalizeProfileRows(data));
    const addByCompany = (row: ProfileRow) => {
      const companyId = String(row.company_id || "").trim();
      return isUuidLike(companyId);
    };

    const preferredId = String(preferredProfileId || "").trim();
    const queryIds = Array.from(new Set([authUserId, preferredId].filter((value) => isUuidLike(value))));

    for (const id of queryIds) {
      const byId = await supabase.from("profiles").select("*").eq("id", id).limit(2);
      if (!byId.error) add(byId.data);
    }

    if (supportsUserIdByColumnProbe && isUuidLike(authUserId)) {
      const byUserId = await supabase.from("profiles").select("*").eq("user_id", authUserId).limit(20);
      if (!byUserId.error) add(byUserId.data);
    }

    const normalizedEmail = String(userEmail || "").trim().toLowerCase();
    if (normalizedEmail) {
      const byEmail = await supabase.from("profiles").select("*").ilike("email", normalizedEmail).limit(50);
      if (!byEmail.error) add(byEmail.data);
    }

    const rows = Array.from(rowsMap.values()).filter(addByCompany);
    if (!rows.length) return null;

    const preferredRow =
      rows.find((row) => row.id === preferredId && isUuidLike(String(row.company_id || "").trim())) ||
      rows.find((row) => row.id === authUserId && isUuidLike(String(row.company_id || "").trim())) ||
      rows.find((row) => row.user_id === authUserId && isUuidLike(String(row.company_id || "").trim()));
    if (preferredRow?.company_id) return String(preferredRow.company_id);

    const uniqueCompanyIds = Array.from(
      new Set(rows.map((row) => String(row.company_id || "").trim()).filter((value) => isUuidLike(value)))
    );
    if (uniqueCompanyIds.length === 1) return uniqueCompanyIds[0];

    return uniqueCompanyIds[0] || null;
  } catch {
    return null;
  }
}

async function resolveGlobalAdminContextCompanyId(profileId: string, authUserId: string): Promise<string | null> {
  const supabase = getServiceClient();
  const candidateUserIds = Array.from(new Set([profileId, authUserId].filter((value) => isUuidLike(value))));

  for (const userId of candidateUserIds) {
    const { data: contextRow, error: contextError } = await supabase
      .from("global_admin_company_contexts")
      .select("company_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!contextError && contextRow?.company_id) {
      const companyId = String(contextRow.company_id || "").trim();
      if (isUuidLike(companyId)) return companyId;
    }
  }

  return null;
}

export async function getServerActorFromSession(request: NextRequest): Promise<ServerActorContext> {
  const { userId, token, email } = await getSessionIdentity(request);
  const profileLookup = await findProfileByIdOrEmail({ userId, userEmail: email, token });
  const profile = profileLookup.selected;

  const roleRawKey = normalizeRoleKey(profile.role);
  const normalizedRole = normalizeRole(profile.role);
  if (!normalizedRole) {
    throw new SessionAuthError("Unknown user role", 403);
  }
  const roleIsLegacy = isLegacyRoleAlias(profile.role);
  const roleIsLegacyAlias = roleIsLegacy || roleRawKey !== normalizedRole;

  const status = normalizeStatus(profile.status);
  if (status !== "active") {
    throw new SessionAuthError("Inactive user profile", 403);
  }

  let homeCompanyId = profile.company_id ? String(profile.company_id).trim() : null;
  if (!homeCompanyId || !isUuidLike(homeCompanyId)) {
    homeCompanyId = pickCompanyFromProfileCandidates(profileLookup.candidates);
  }
  if (!homeCompanyId || !isUuidLike(homeCompanyId)) {
    homeCompanyId = await resolveFallbackCompanyId(token, profile.id);
  }
  if (!homeCompanyId || !isUuidLike(homeCompanyId)) {
    homeCompanyId = await resolveCompanyIdFromServiceProfiles({
      authUserId: userId,
      preferredProfileId: profile.id,
      userEmail: email,
    });
  }

  const contextCompanyId =
    normalizedRole === "global_admin" ? await resolveGlobalAdminContextCompanyId(profile.id, userId) : null;

  return {
    id: String(profile.id),
    authUserId: userId,
    role: normalizedRole,
    roleRawKey,
    roleIsLegacyAlias,
    status,
    companyId: homeCompanyId,
    homeCompanyId,
    contextCompanyId,
    email,
  };
}

export function ensureAssistantRole(actor: ServerActorContext): void {
  if (isAssistantAccessStrict() && actor.roleIsLegacyAlias) {
    throw new SessionAuthError("Legacy role alias is not allowed for assistant access", 403);
  }
  if (!ASSISTANT_ALLOWED_ROLES.has(actor.role)) {
    throw new SessionAuthError("Assistant is not available for current role", 403);
  }
}

export function resolveCompanyForActor(actor: ServerActorContext, requestedCompanyId?: string | null): string {
  const requested = String(requestedCompanyId || "").trim();
  if (requested && !isUuidLike(requested)) {
    throw new SessionAuthError("Invalid company id in request context", 400);
  }

  if (actor.role === "global_admin") {
    const contextCompanyId =
      actor.contextCompanyId && isUuidLike(actor.contextCompanyId) ? actor.contextCompanyId : "";
    if (!contextCompanyId) {
      throw new SessionAuthError("Global admin company context is not selected", 400);
    }

    if (requested && requested !== contextCompanyId) {
      throw new SessionAuthError("Selected company does not match global admin context", 403);
    }
    return contextCompanyId;
  }

  const actorCompany = actor.companyId && isUuidLike(actor.companyId) ? actor.companyId : "";
  if (!actorCompany) {
    throw new SessionAuthError("User company context is not configured", 400);
  }

  if (requested && requested !== actorCompany) {
    throw new SessionAuthError("Company mismatch for authenticated user", 403);
  }
  return actorCompany;
}
