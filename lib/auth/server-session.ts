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
  isImpersonating: boolean;
  impersonatedProfileId: string | null;
  impersonatedCompanyId: string | null;
  impersonatedByProfileId: string | null;
  impersonatedByAuthUserId: string | null;
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
  "warehouse_operator",
  "weighman",
  "specialist",
  "brigadier",
  "legal_operator",
  "fuel_operator",
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

type ImpersonationContextRow = {
  admin_user_id: string;
  impersonated_profile_id: string | null;
  impersonated_company_id: string | null;
};

type FastActorContextRow = {
  auth_user_id?: string | null;
  profile_id?: string | null;
  profile_user_id?: string | null;
  role?: string | null;
  status?: string | null;
  company_id?: string | null;
  email?: string | null;
  context_company_id?: string | null;
  impersonated_profile_id?: string | null;
  impersonated_company_id?: string | null;
  impersonated_role?: string | null;
  impersonated_status?: string | null;
  impersonated_email?: string | null;
};

export type ServerActorTiming = {
  cache_hit?: boolean;
  session_ms?: number;
  profile_lookup_ms?: number;
  company_resolution_ms?: number;
  global_context_ms?: number;
  impersonation_ms?: number;
  total_ms?: number;
};

type ServerActorOptions = {
  ignoreImpersonation?: boolean;
  timing?: ServerActorTiming;
};

const ACTOR_CONTEXT_CACHE_TTL_MS = 30_000;
const actorContextCache = new Map<string, { actor: ServerActorContext; expiresAt: number }>();

export function clearServerActorContextCacheForRequest(request: NextRequest): void {
  const token = parseBearerToken(request);
  if (!token) return;
  actorContextCache.delete(`actor:${token}`);
  actorContextCache.delete(`admin:${token}`);
}

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
  const normalizedUserEmail = normalizeEmail(userEmail);

  const profileCandidates = new Map<string, ProfileRow>();

  const serviceById = await supabase.from("profiles").select("*").eq("id", userId).limit(1);
  if (!serviceById.error) addCandidates(profileCandidates, normalizeProfileRows(serviceById.data));

  let allCandidates = Array.from(profileCandidates.values());
  let selected = pickBestProfile(allCandidates, userId);
  if (selected) {
    return {
      selected,
      candidates: allCandidates,
    };
  }

  const serviceResults = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", userId).limit(10),
    normalizedUserEmail
      ? supabase.from("profiles").select("*").ilike("email", normalizedUserEmail).limit(50)
      : Promise.resolve({ data: null, error: null }),
  ]);

  serviceResults.forEach((result) => {
    if (!result.error) addCandidates(profileCandidates, normalizeProfileRows(result.data));
  });

  allCandidates = Array.from(profileCandidates.values());
  selected = pickBestProfile(allCandidates, userId);
  if (selected) {
    return {
      selected,
      candidates: allCandidates,
    };
  }

  const sessionClient = await createSessionScopedClient(token);
  const rlsResults = await Promise.all([
    sessionClient.from("profiles").select("*").eq("id", userId).limit(1),
    sessionClient.from("profiles").select("*").eq("user_id", userId).limit(10),
    normalizedUserEmail
      ? sessionClient.from("profiles").select("*").ilike("email", normalizedUserEmail).limit(50)
      : Promise.resolve({ data: null, error: null }),
  ]);

  rlsResults.forEach((result) => {
    if (!result.error) addCandidates(profileCandidates, normalizeProfileRows(result.data));
  });

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

  allCandidates = Array.from(profileCandidates.values());
  selected = pickBestProfile(allCandidates, userId);
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
  if (!candidateUserIds.length) return null;

  const { data, error } = await supabase
    .from("global_admin_company_contexts")
    .select("user_id, company_id")
    .in("user_id", candidateUserIds);
  if (error || !Array.isArray(data)) return null;

  for (const userId of candidateUserIds) {
    const contextRow = data.find((row: any) => String(row?.user_id || "") === userId);
    const companyId = String((contextRow as any)?.company_id || "").trim();
    if (isUuidLike(companyId)) return companyId;
  }

  return null;
}

async function resolveGlobalAdminImpersonationContext(profileId: string, authUserId: string): Promise<ImpersonationContextRow | null> {
  const supabase = getServiceClient();
  const candidateUserIds = Array.from(new Set([profileId, authUserId].filter((value) => isUuidLike(value))));
  if (!candidateUserIds.length) return null;

  const { data, error } = await supabase
    .from("global_admin_impersonation_contexts")
    .select("admin_user_id,impersonated_profile_id,impersonated_company_id,updated_at")
    .in("admin_user_id", candidateUserIds)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as any;
  const adminUserId = String(row?.admin_user_id || "").trim();
  if (!isUuidLike(adminUserId)) return null;
  const impersonatedProfileId = String(row?.impersonated_profile_id || "").trim();
  const impersonatedCompanyId = String(row?.impersonated_company_id || "").trim();
  return {
    admin_user_id: adminUserId,
    impersonated_profile_id: isUuidLike(impersonatedProfileId) ? impersonatedProfileId : null,
    impersonated_company_id: isUuidLike(impersonatedCompanyId) ? impersonatedCompanyId : null,
  };
}

async function resolveProfileById(profileId: string): Promise<ProfileRow | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .limit(1);

  if (error) return null;
  const rows = normalizeProfileRows(data);
  return rows[0] || null;
}

function buildActorContextFromFastRow(params: {
  row: FastActorContextRow;
  authUserId: string;
  ignoreImpersonation?: boolean;
}): ServerActorContext | null {
  const { row, authUserId, ignoreImpersonation } = params;
  const profileId = String(row.profile_id || "").trim();
  if (!isUuidLike(profileId) || !isUuidLike(authUserId)) return null;

  const normalizedRole = normalizeRole(row.role);
  if (!normalizedRole) return null;
  const status = normalizeStatus(row.status);
  if (status !== "active") {
    throw new SessionAuthError("Inactive user profile", 403);
  }

  const roleRawKey = normalizeRoleKey(row.role);
  const roleIsLegacyAlias = isLegacyRoleAlias(row.role) || roleRawKey !== normalizedRole;
  const companyId = String(row.company_id || "").trim();
  const homeCompanyId = isUuidLike(companyId) ? companyId : null;
  const contextCompanyId = String(row.context_company_id || "").trim();

  if (normalizedRole === "global_admin" && ignoreImpersonation !== true) {
    const impersonatedProfileId = String(row.impersonated_profile_id || "").trim();
    if (isUuidLike(impersonatedProfileId)) {
      const impersonatedRole = normalizeRole(row.impersonated_role);
      const impersonatedStatus = normalizeStatus(row.impersonated_status);
      const impersonatedCompanyId = String(row.impersonated_company_id || "").trim();
      if (!impersonatedRole || impersonatedStatus !== "active" || !isUuidLike(impersonatedCompanyId)) {
        throw new SessionAuthError("Impersonation context is invalid", 403);
      }

      return {
        id: impersonatedProfileId,
        authUserId,
        role: impersonatedRole,
        roleRawKey: normalizeRoleKey(row.impersonated_role),
        roleIsLegacyAlias: isLegacyRoleAlias(row.impersonated_role),
        companyId: impersonatedCompanyId,
        homeCompanyId: impersonatedCompanyId,
        contextCompanyId: null,
        status: impersonatedStatus,
        email: normalizeEmail(row.impersonated_email),
        isImpersonating: true,
        impersonatedProfileId,
        impersonatedCompanyId,
        impersonatedByProfileId: profileId,
        impersonatedByAuthUserId: authUserId,
      };
    }
  }

  return {
    id: profileId,
    authUserId,
    role: normalizedRole,
    roleRawKey,
    roleIsLegacyAlias,
    status,
    companyId: homeCompanyId,
    homeCompanyId,
    contextCompanyId: isUuidLike(contextCompanyId) ? contextCompanyId : null,
    email: normalizeEmail(row.email),
    isImpersonating: false,
    impersonatedProfileId: null,
    impersonatedCompanyId: null,
    impersonatedByProfileId: null,
    impersonatedByAuthUserId: null,
  };
}

async function resolveActorContextFromSessionFastPath(params: {
  token: string;
  ignoreImpersonation?: boolean;
}): Promise<ServerActorContext | null> {
  try {
    const sessionClient = await createSessionScopedClient(params.token);
    const { data, error } = await sessionClient.rpc("resolve_actor_context_from_session_v1");
    if (error || !Array.isArray(data) || data.length === 0) return null;

    const row = data[0] as FastActorContextRow;
    const authUserId = String(row.auth_user_id || "").trim();
    return buildActorContextFromFastRow({
      row,
      authUserId,
      ignoreImpersonation: params.ignoreImpersonation,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) throw error;
    return null;
  }
}

async function resolveActorContextFastPath(params: {
  userId: string;
  email: string | null;
  ignoreImpersonation?: boolean;
}): Promise<ServerActorContext | null> {
  try {
    const { userId, email, ignoreImpersonation } = params;
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("resolve_actor_context_v1", {
      p_auth_user_id: userId,
      p_email: email,
    });
    if (error || !Array.isArray(data) || data.length === 0) return null;

    const row = data[0] as FastActorContextRow;
    return buildActorContextFromFastRow({ row, authUserId: userId, ignoreImpersonation });
  } catch (error) {
    if (error instanceof SessionAuthError) throw error;
    return null;
  }
}

export async function getServerActorFromSession(
  request: NextRequest,
  options?: ServerActorOptions
): Promise<ServerActorContext> {
  const totalStarted = Date.now();
  const cacheToken = parseBearerToken(request);
  const cacheKey = cacheToken ? `${options?.ignoreImpersonation === true ? "admin" : "actor"}:${cacheToken}` : null;
  if (cacheKey) {
    const cached = actorContextCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (options?.timing) {
        options.timing.cache_hit = true;
        options.timing.session_ms = 0;
        options.timing.profile_lookup_ms = 0;
        options.timing.company_resolution_ms = 0;
        options.timing.global_context_ms = 0;
        options.timing.impersonation_ms = 0;
        options.timing.total_ms = Date.now() - totalStarted;
      }
      return cached.actor;
    }
    actorContextCache.delete(cacheKey);
  }

  if (cacheToken) {
    const sessionFastPathStarted = Date.now();
    const sessionFastActor = await resolveActorContextFromSessionFastPath({
      token: cacheToken,
      ignoreImpersonation: options?.ignoreImpersonation,
    });
    if (sessionFastActor) {
      if (options?.timing) {
        options.timing.session_ms = 0;
        options.timing.profile_lookup_ms = Date.now() - sessionFastPathStarted;
        options.timing.company_resolution_ms = 0;
        options.timing.global_context_ms = 0;
        options.timing.impersonation_ms = 0;
        options.timing.total_ms = Date.now() - totalStarted;
      }
      if (cacheKey) {
        actorContextCache.set(cacheKey, { actor: sessionFastActor, expiresAt: Date.now() + ACTOR_CONTEXT_CACHE_TTL_MS });
      }
      return sessionFastActor;
    }
  }

  const sessionStarted = Date.now();
  const { userId, token, email } = await getSessionIdentity(request);
  if (options?.timing) options.timing.session_ms = Date.now() - sessionStarted;

  const fastPathStarted = Date.now();
  const fastActor = await resolveActorContextFastPath({
    userId,
    email,
    ignoreImpersonation: options?.ignoreImpersonation,
  });
  if (fastActor) {
    if (options?.timing) {
      options.timing.profile_lookup_ms = Date.now() - fastPathStarted;
      options.timing.company_resolution_ms = 0;
      options.timing.global_context_ms = 0;
      options.timing.impersonation_ms = 0;
      options.timing.total_ms = Date.now() - totalStarted;
    }
    if (cacheKey) {
      actorContextCache.set(cacheKey, { actor: fastActor, expiresAt: Date.now() + ACTOR_CONTEXT_CACHE_TTL_MS });
    }
    return fastActor;
  }

  const profileStarted = Date.now();
  const profileLookup = await findProfileByIdOrEmail({ userId, userEmail: email, token });
  if (options?.timing) options.timing.profile_lookup_ms = Date.now() - profileStarted;
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

  const companyStarted = Date.now();
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
  if (options?.timing) options.timing.company_resolution_ms = Date.now() - companyStarted;

  const globalContextStarted = Date.now();
  const contextPromise =
    normalizedRole === "global_admin"
      ? resolveGlobalAdminContextCompanyId(profile.id, userId).finally(() => {
          if (options?.timing) options.timing.global_context_ms = Date.now() - globalContextStarted;
        })
      : Promise.resolve(null);
  const impersonationStarted = Date.now();
  const impersonationPromise =
    normalizedRole === "global_admin" && options?.ignoreImpersonation !== true
      ? resolveGlobalAdminImpersonationContext(profile.id, userId).finally(() => {
          if (options?.timing) options.timing.impersonation_ms = Date.now() - impersonationStarted;
        })
      : Promise.resolve(null);
  const [contextCompanyId, impersonationContext] = await Promise.all([contextPromise, impersonationPromise]);
  if (options?.timing && normalizedRole !== "global_admin") options.timing.global_context_ms = 0;
  if (options?.timing && (normalizedRole !== "global_admin" || options?.ignoreImpersonation === true)) {
    options.timing.impersonation_ms = 0;
  }

  if (normalizedRole === "global_admin" && options?.ignoreImpersonation !== true) {
    const impersonatedProfileId = String(impersonationContext?.impersonated_profile_id || "").trim();
    if (isUuidLike(impersonatedProfileId)) {
      const impersonatedProfile = await resolveProfileById(impersonatedProfileId);
      const impersonatedRole = normalizeRole(impersonatedProfile?.role);
      const impersonatedStatus = normalizeStatus(impersonatedProfile?.status);
      const impersonatedCompanyId = String(impersonatedProfile?.company_id || "").trim();
      if (!impersonatedProfile || !impersonatedRole || impersonatedStatus !== "active" || !isUuidLike(impersonatedCompanyId)) {
        throw new SessionAuthError("Impersonation context is invalid", 403);
      }

      if (options?.timing) options.timing.total_ms = Date.now() - totalStarted;
      const actor = {
        id: impersonatedProfileId,
        authUserId: userId,
        role: impersonatedRole,
        roleRawKey: normalizeRoleKey(impersonatedProfile.role),
        roleIsLegacyAlias: isLegacyRoleAlias(impersonatedProfile.role),
        companyId: impersonatedCompanyId,
        homeCompanyId: impersonatedCompanyId,
        contextCompanyId: null,
        status: impersonatedStatus,
        email: normalizeEmail(impersonatedProfile.email),
        isImpersonating: true,
        impersonatedProfileId,
        impersonatedCompanyId: impersonationContext?.impersonated_company_id || impersonatedCompanyId,
        impersonatedByProfileId: String(profile.id),
        impersonatedByAuthUserId: userId,
      };
      if (cacheKey) {
        actorContextCache.set(cacheKey, { actor, expiresAt: Date.now() + ACTOR_CONTEXT_CACHE_TTL_MS });
      }
      return actor;
    }
  }

  if (options?.timing) options.timing.total_ms = Date.now() - totalStarted;
  const actor = {
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
    isImpersonating: false,
    impersonatedProfileId: null,
    impersonatedCompanyId: null,
    impersonatedByProfileId: null,
    impersonatedByAuthUserId: null,
  };
  if (cacheKey) {
    actorContextCache.set(cacheKey, { actor, expiresAt: Date.now() + ACTOR_CONTEXT_CACHE_TTL_MS });
  }
  return actor;
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
