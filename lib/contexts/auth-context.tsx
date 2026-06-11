'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { normalizeRoleKey, parseCanonicalRole, type CanonicalRole } from "@/lib/auth/role-contract";

interface Profile {
  id: string;
  full_name?: string | null;
  email: string;
  role: CanonicalRole;
  role_raw_key?: string;
  role_is_legacy_alias?: boolean;
  company_id: string | null;
  home_company_id?: string | null;
  context_company_id?: string | null;
  is_owner: boolean;
  status: string;
  is_impersonating?: boolean;
  impersonated_profile_id?: string | null;
  impersonated_company_id?: string | null;
  impersonated_by_profile_id?: string | null;
  impersonated_by_auth_user_id?: string | null;
  preferred_language?: 'ru' | 'kz' | 'en' | null;
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (payload: {
    email: string;
    password: string;
    fullName: string;
    companyName: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const AUTH_REQUEST_TIMEOUT_MS = 8000;
const AUTH_PROFILE_TIMEOUT_MS = 15000;
const AUTH_BOOT_TIMEOUT_MS = 10000;

function withAuthTimeout<T>(promise: Promise<T>, label: string, timeoutMs = AUTH_REQUEST_TIMEOUT_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function clearLocalSupabaseSession() {
  try {
    void supabase.auth.signOut({ scope: "local" }).catch(() => {});
  } catch {
    // The app must recover even if Supabase auth storage is already broken.
  }

  try {
    if (typeof window === "undefined") return;
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("sb-") && key.includes("auth-token")) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage can be unavailable in private or restricted browser contexts.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    const bootWatchdog = window.setTimeout(() => {
      if (!mounted) return;
      setLoading(false);
    }, AUTH_BOOT_TIMEOUT_MS);

    const initializeAuth = async () => {
      try {
        const { data: { session } } = await withAuthTimeout(supabase.auth.getSession(), "Supabase session");

        if (!mounted) return;

        setUser(session?.user ?? null);

        if (session?.user) {
          try {
            await withAuthTimeout(
              loadProfile(session.user.id, session.user.email || null),
              "Profile load",
              AUTH_PROFILE_TIMEOUT_MS
            );
          } catch (profileError) {
            console.error("Error loading profile:", profileError);
            if (mounted) setProfile(null);
          }
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error('Error loading session:', error);
        clearLocalSupabaseSession();
        if (mounted) {
          setUser(null);
          setProfile(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        (async () => {
          try {
            if (!mounted) return;

            setUser(session?.user ?? null);

            if (session?.user) {
              try {
                await withAuthTimeout(
                  loadProfile(session.user.id, session.user.email || null),
                  "Profile load",
                  AUTH_PROFILE_TIMEOUT_MS
                );
              } catch (profileError) {
                console.error("Error loading profile after auth state change:", profileError);
                if (mounted) setProfile(null);
              }
            } else {
              setProfile(null);
            }
          } catch (error) {
            console.error("Error handling auth state:", error);
            if (!mounted) return;
            setUser(session?.user ?? null);
            setProfile(null);
          } finally {
            if (mounted) {
              setLoading(false);
            }
          }
        })();
      }
    );

    return () => {
      mounted = false;
      window.clearTimeout(bootWatchdog);
      subscription.unsubscribe();
    };
  }, []);

  const loadProfile = async (userId: string, userEmail?: string | null) => {
    try {
      const profileMap = new Map<string, any>();
      const addRows = (rows: any[]) => {
        rows.forEach((row) => {
          if (!row?.id) return;
          if (!profileMap.has(String(row.id))) {
            profileMap.set(String(row.id), row);
          }
        });
      };

      const byId = await supabase.from("profiles").select("*").eq("id", userId).limit(1);
      if (byId.error) throw byId.error;
      if (Array.isArray(byId.data)) addRows(byId.data);

      const userIdProbe = await supabase.from("profiles").select("user_id").limit(1);
      if (!userIdProbe.error) {
        const byUserId = await supabase.from("profiles").select("*").eq("user_id", userId).limit(10);
        if (!byUserId.error && Array.isArray(byUserId.data)) addRows(byUserId.data);
      }

      const normalizedEmail = String(userEmail || "").trim().toLowerCase();
      if (normalizedEmail) {
        const byEmail = await supabase.from("profiles").select("*").ilike("email", normalizedEmail).limit(20);
        if (!byEmail.error && Array.isArray(byEmail.data)) addRows(byEmail.data);
      }

      const candidates = Array.from(profileMap.values());
      if (!candidates.length) {
        setProfile(null);
        return;
      }

      const profileScore = (row: any) => {
        const status = String(row?.status || "active").toLowerCase();
        const role = parseCanonicalRole(row?.role);
        const companyId = String(row?.company_id || "").trim();
        let score = 0;
        if (String(row?.id || "") === userId) score += 100;
        if (String(row?.user_id || "") === userId) score += 90;
        if (status === "active") score += 30;
        if (role) score += 30;
        if (companyId) score += 20;
        return score;
      };

      const data = [...candidates].sort((a, b) => profileScore(b) - profileScore(a))[0];

      const normalizedRole = parseCanonicalRole(data.role);
      if (!normalizedRole) {
        console.error("Unknown profile role, access denied by default:", data.role);
        setProfile(null);
        return;
      }
      const contextCompanyId = await resolveGlobalAdminContextCompanyId(userId, normalizedRole);
      const actorContext = await resolveActorContextFromServer();
      const actor = actorContext?.actor || null;
      const displayProfile = await resolveDisplayProfileForActor(data, actor);

      if (data.status === 'pending') {
        await supabase
          .from('profiles')
          .update({ status: 'active' })
          .eq('id', userId);
        const effectiveCompany =
          actor?.companyId ||
          (normalizedRole === "global_admin" && contextCompanyId
            ? contextCompanyId
            : await resolveEffectiveCompanyId(data.company_id));
        const effectiveRole = parseCanonicalRole(actor?.role) || normalizedRole;
        const effectiveRoleRawKey = normalizeRoleKey(actor?.role || displayProfile.role || data.role);
        const effectiveProfileId = String(actor?.id || data.id || "").trim() || data.id;
        setProfile({
          ...displayProfile,
          id: effectiveProfileId,
          role: effectiveRole,
          role_raw_key: effectiveRoleRawKey,
          role_is_legacy_alias: effectiveRoleRawKey !== effectiveRole,
          status: 'active',
          home_company_id: data.company_id,
          context_company_id: actor?.contextCompanyId || contextCompanyId,
          company_id: effectiveCompany || data.company_id,
          is_impersonating: Boolean(actor?.isImpersonating),
          impersonated_profile_id: actor?.impersonatedProfileId || null,
          impersonated_company_id: actor?.impersonatedCompanyId || null,
          impersonated_by_profile_id: actor?.impersonatedByProfileId || null,
          impersonated_by_auth_user_id: actor?.impersonatedByAuthUserId || null,
        });
      } else {
        const effectiveCompany =
          actor?.companyId ||
          (normalizedRole === "global_admin" && contextCompanyId
            ? contextCompanyId
            : await resolveEffectiveCompanyId(data?.company_id));
        const effectiveRole = parseCanonicalRole(actor?.role) || normalizedRole;
        const effectiveRoleRawKey = normalizeRoleKey(actor?.role || displayProfile.role || data.role);
        const effectiveProfileId = String(actor?.id || data.id || "").trim() || data.id;
        setProfile(
          {
            ...displayProfile,
            id: effectiveProfileId,
            role: effectiveRole,
            role_raw_key: effectiveRoleRawKey,
            role_is_legacy_alias: effectiveRoleRawKey !== effectiveRole,
            home_company_id: data.company_id,
            context_company_id: actor?.contextCompanyId || contextCompanyId,
            company_id: effectiveCompany || data.company_id,
            is_impersonating: Boolean(actor?.isImpersonating),
            impersonated_profile_id: actor?.impersonatedProfileId || null,
            impersonated_company_id: actor?.impersonatedCompanyId || null,
            impersonated_by_profile_id: actor?.impersonatedByProfileId || null,
            impersonated_by_auth_user_id: actor?.impersonatedByAuthUserId || null,
          }
        );
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      setProfile(null);
    }
  };

  const resolveDisplayProfileForActor = async (baseProfile: any, actor?: { id?: string; isImpersonating?: boolean } | null) => {
    const actorProfileId = String(actor?.id || "").trim();
    const baseProfileId = String(baseProfile?.id || "").trim();
    if (!actor?.isImpersonating || !actorProfileId || actorProfileId === baseProfileId) {
      return baseProfile;
    }

    try {
      const { data: actorProfile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", actorProfileId)
        .maybeSingle();
      if (error || !actorProfile?.id) return baseProfile;
      return actorProfile;
    } catch {
      return baseProfile;
    }
  };

  const resolveEffectiveCompanyId = async (fallbackCompanyId: string | null | undefined) => {
    try {
      const { data, error } = await supabase.rpc("get_user_company_id");
      if (error) return fallbackCompanyId || null;
      return (data as string | null) || fallbackCompanyId || null;
    } catch {
      return fallbackCompanyId || null;
    }
  };

  const resolveGlobalAdminContextCompanyId = async (userId: string, role: CanonicalRole) => {
    if (role !== "global_admin") return null;
    try {
      const { data, error } = await supabase
        .from("global_admin_company_contexts")
        .select("company_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return null;
      return (data?.company_id as string | null) || null;
    } catch {
      return null;
    }
  };

  const resolveActorContextFromServer = async (): Promise<{
    actor?: {
      id?: string;
      role?: string;
      companyId?: string | null;
      contextCompanyId?: string | null;
      isImpersonating?: boolean;
      impersonatedProfileId?: string | null;
      impersonatedCompanyId?: string | null;
      impersonatedByProfileId?: string | null;
      impersonatedByAuthUserId?: string | null;
    };
  } | null> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token) return null;
      const response = await fetch("/api/auth/actor", {
        method: "GET",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: "no-store",
      });
      if (!response.ok) return null;
      return (await response.json()) as any;
    } catch {
      return null;
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
  };

  const signUp = async (payload: {
    email: string;
    password: string;
    fullName: string;
    companyName: string;
  }) => {
    const { email, password, fullName, companyName } = payload;
    const normalizedFullName = String(fullName || "").trim().replace(/\s+/g, " ");
    const normalizedCompanyName = String(companyName || "").trim().replace(/\s+/g, " ");

    if (!normalizedFullName || !normalizedCompanyName) {
      throw new Error("Full name and company name are required");
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: "company_admin",
          full_name: normalizedFullName,
          company_name: normalizedCompanyName,
        },
      },
    });

    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    router.push('/auth/login');
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    if (error) throw error;
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) throw error;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signIn,
        signUp,
        signOut,
        resetPassword,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
