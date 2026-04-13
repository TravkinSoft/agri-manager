"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { SidebarProvider } from "@/lib/contexts/sidebar-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { canAccessPath, getDefaultPathForRole } from "@/lib/auth/role-access";

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
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto bg-slate-50 p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
