"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Loader as Loader2 } from "lucide-react";
import { LanguageProvider } from "@/lib/contexts/language-context";

const ProtectedApp = dynamic<{ children: React.ReactNode }>(
  () => import("@/components/auth/protected-app").then((mod) => mod.ProtectedApp),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    ),
  }
);

const PUBLIC_MARKETING_ROUTES = new Set(["/", "/demo", "/privacy"]);

export function PublicAwareProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // This exact route has independent, server-enforced PTC authentication.
  // It never grants access to dashboard routes or the main application's session.
  if (PUBLIC_MARKETING_ROUTES.has(pathname || "") || pathname === "/traffic-operator") {
    return <LanguageProvider>{children}</LanguageProvider>;
  }

  return <ProtectedApp>{children}</ProtectedApp>;
}
