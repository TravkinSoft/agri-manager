'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

interface Profile {
  id: string;
  full_name?: string | null;
  email: string;
  role: 'global_admin' | 'company_admin' | 'admin' | 'agronomist' | 'specialist' | 'warehouse' | 'weighman';
  company_id: string;
  home_company_id?: string | null;
  context_company_id?: string | null;
  is_owner: boolean;
  status: string;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!mounted) return;

        setUser(session?.user ?? null);

        if (session?.user) {
          await loadProfile(session.user.id);
        }
      } catch (error) {
        console.error('Error loading session:', error);
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
          if (!mounted) return;

          setUser(session?.user ?? null);

          if (session?.user) {
            await loadProfile(session.user.id);
          } else {
            setProfile(null);
          }

          if (mounted) {
            setLoading(false);
          }
        })();
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;

      const role = String(data?.role || "").toLowerCase();
      const contextCompanyId = await resolveGlobalAdminContextCompanyId(userId, role);

      if (data && data.status === 'pending') {
        await supabase
          .from('profiles')
          .update({ status: 'active' })
          .eq('id', userId);
        const effectiveCompany =
          role === "global_admin" && contextCompanyId
            ? contextCompanyId
            : await resolveEffectiveCompanyId(data.company_id);
        setProfile({
          ...data,
          status: 'active',
          home_company_id: data.company_id,
          context_company_id: contextCompanyId,
          company_id: effectiveCompany || data.company_id,
        });
      } else {
        const effectiveCompany =
          role === "global_admin" && contextCompanyId
            ? contextCompanyId
            : await resolveEffectiveCompanyId(data?.company_id);
        setProfile(
          data
            ? {
                ...data,
                home_company_id: data.company_id,
                context_company_id: contextCompanyId,
                company_id: effectiveCompany || data.company_id,
              }
            : data
        );
      }
    } catch (error) {
      console.error('Error loading profile:', error);
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

  const resolveGlobalAdminContextCompanyId = async (userId: string, role: string) => {
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
