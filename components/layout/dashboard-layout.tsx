"use client";

import { useEffect } from "react";
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

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

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

  return (
    <SidebarProvider>
      <AssistantShellProvider>
        <div className="flex min-h-screen bg-slate-50">
          <div className="hidden md:flex md:h-screen md:shrink-0">
            <Sidebar />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 p-3 pb-24 sm:p-4 md:p-6 md:pb-6">
              {children}
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
