"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { LanguageProvider } from "@/lib/contexts/language-context";
import { AuthProvider } from "@/lib/contexts/auth-context";

export function ProtectedApp({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <LanguageProvider>
        <ProtectedRoute>{children}</ProtectedRoute>
      </LanguageProvider>
    </AuthProvider>
  );
}
