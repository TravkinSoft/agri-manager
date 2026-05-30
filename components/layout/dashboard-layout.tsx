"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { SidebarProvider } from "@/lib/contexts/sidebar-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { canAccessPath, getDefaultPathForRole } from "@/lib/auth/role-access";
import { AssistantShellProvider } from "@/components/assistant/assistant-shell-provider";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { AssistantDebugMonitor } from "@/components/assistant/assistant-debug-monitor";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [stoppingImpersonation, setStoppingImpersonation] = useState(false);

  useEffect(() => {
    if (loading || !profile?.role || !pathname) return;

    if (profile.role === "global_admin" && !profile.context_company_id) {
      if (!pathname.startsWith("/platform")) {
        router.replace("/platform");
      }
      return;
    }

    if (!canAccessPath(profile.role, pathname)) {
      router.replace(getDefaultPathForRole(profile.role));
    }
  }, [loading, profile?.role, profile?.context_company_id, pathname, router]);

  if (!loading && profile?.role && pathname && !canAccessPath(profile.role, pathname)) {
    return null;
  }

  const stopImpersonation = async () => {
    setStoppingImpersonation(true);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token) throw new Error("Session expired");
      const response = await fetch("/api/global-admin/impersonation", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to stop impersonation");
      }
      window.location.href = "/platform";
    } catch (error) {
      console.error("Failed to stop impersonation:", error);
      setStoppingImpersonation(false);
    }
  };

  return (
    <SidebarProvider>
      <AssistantShellProvider>
        <div className="travkin-shell flex min-h-screen bg-transparent">
          <div className="hidden md:flex md:h-screen md:shrink-0">
            <Sidebar />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            {profile?.is_impersonating ? (
              <div className="flex items-center justify-between gap-2 border-b border-amber-700/50 bg-amber-900/40 px-4 py-2 text-xs text-amber-100 md:px-6">
                <div className="truncate">
                  Вы вошли как <span className="font-semibold">{profile.full_name || profile.email || profile.id}</span> (
                  {profile.role}). Все действия логируются.
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 border-amber-500/50 bg-[#1A1F2B] text-amber-100 hover:bg-[#202738]"
                  onClick={() => void stopImpersonation()}
                  disabled={stoppingImpersonation}
                >
                  {stoppingImpersonation ? "Возврат..." : "Вернуться в global_admin"}
                </Button>
              </div>
            ) : null}
            <main className="travkin-scrollbar flex-1 overflow-x-hidden overflow-y-auto bg-transparent p-3 pb-[calc(env(safe-area-inset-bottom)+6rem)] sm:p-4 md:p-6 md:pb-6">
              {children}
              <footer className="mt-8 border-t border-[#262D3D] pt-3 text-center text-xs text-[#7F8A9B]">
                Copyright © Сунгатов Айымбек
              </footer>
            </main>
          </div>
        </div>
        <MobileBottomNav />
        <AssistantLauncher />
        <AssistantPanel />
        <AssistantDebugMonitor />
      </AssistantShellProvider>
    </SidebarProvider>
  );
}
