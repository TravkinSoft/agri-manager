"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { LanguageProvider } from "@/lib/contexts/language-context";
import { AuthProvider, useAuth } from "@/lib/contexts/auth-context";

function AccountLanguage({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  return <LanguageProvider forcedLanguage={profile?.role === "fleet_manager" ? "ru" : undefined}>
    <ProtectedRoute>{children}</ProtectedRoute>
  </LanguageProvider>;
}

export function ProtectedApp({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AccountLanguage>{children}</AccountLanguage>
    </AuthProvider>
  );
}
