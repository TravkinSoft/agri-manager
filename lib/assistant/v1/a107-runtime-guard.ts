export const A107_ALLOWED_BRANCH_REF = "gsglkmudcwkdetqtocae";
export const A107_ALLOWED_SUPABASE_HOSTNAME = "gsglkmudcwkdetqtocae.supabase.co";

const FORBIDDEN_CREDENTIAL_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_ADMIN_KEY",
  "SUPABASE_ADMIN_TOKEN",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_MANAGEMENT_API_TOKEN",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
  "DIRECT_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "PGHOST",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
] as const;

export type A107RuntimeGuardResult = {
  allowedHostname: typeof A107_ALLOWED_SUPABASE_HOSTNAME;
  nextPublicHostname: typeof A107_ALLOWED_SUPABASE_HOSTNAME;
  serverHostname: typeof A107_ALLOWED_SUPABASE_HOSTNAME;
  branchRef: typeof A107_ALLOWED_BRANCH_REF;
  serviceRoleLoaded: false;
  databaseCredentialsLoaded: false;
};

export class A107RuntimeGuardError extends Error {
  code = "A107_RUNTIME_GUARD_FAILED" as const;

  constructor(message: string) {
    super(message);
    this.name = "A107RuntimeGuardError";
  }
}

function requiredValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = String(env[name] || "").trim();
  if (!value) {
    throw new A107RuntimeGuardError(`${name} is required`);
  }
  return value;
}

function parseAllowedSupabaseUrl(rawUrl: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new A107RuntimeGuardError(`${name} is not a valid URL`);
  }

  if (parsed.protocol !== "https:") {
    throw new A107RuntimeGuardError(`${name} must use https`);
  }
  if (parsed.hostname !== A107_ALLOWED_SUPABASE_HOSTNAME) {
    throw new A107RuntimeGuardError(`${name} hostname is not allowed`);
  }
  return parsed;
}

export function isExactA107SupabaseUrl(rawUrl: unknown): boolean {
  const value = String(rawUrl || "").trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === A107_ALLOWED_SUPABASE_HOSTNAME;
  } catch {
    return false;
  }
}

export function assertA107RuntimeGuard(
  env: NodeJS.ProcessEnv = process.env
): A107RuntimeGuardResult {
  const nextPublicUrl = parseAllowedSupabaseUrl(
    requiredValue(env, "NEXT_PUBLIC_SUPABASE_URL"),
    "NEXT_PUBLIC_SUPABASE_URL"
  );
  const serverUrl = parseAllowedSupabaseUrl(
    requiredValue(env, "SUPABASE_URL"),
    "SUPABASE_URL"
  );

  if (nextPublicUrl.hostname !== serverUrl.hostname) {
    throw new A107RuntimeGuardError("Supabase hostnames do not match");
  }
  if (requiredValue(env, "A107_BRANCH_REF") !== A107_ALLOWED_BRANCH_REF) {
    throw new A107RuntimeGuardError("A107_BRANCH_REF is not allowed");
  }

  for (const name of FORBIDDEN_CREDENTIAL_NAMES) {
    if (String(env[name] || "").trim()) {
      throw new A107RuntimeGuardError(`${name} must not be loaded`);
    }
  }

  return {
    allowedHostname: A107_ALLOWED_SUPABASE_HOSTNAME,
    nextPublicHostname: A107_ALLOWED_SUPABASE_HOSTNAME,
    serverHostname: A107_ALLOWED_SUPABASE_HOSTNAME,
    branchRef: A107_ALLOWED_BRANCH_REF,
    serviceRoleLoaded: false,
    databaseCredentialsLoaded: false,
  };
}

export function assertA107RuntimeGuardWhenConfigured(
  env: NodeJS.ProcessEnv = process.env
): A107RuntimeGuardResult | null {
  if (!String(env.A107_BRANCH_REF || "").trim()) return null;
  return assertA107RuntimeGuard(env);
}
