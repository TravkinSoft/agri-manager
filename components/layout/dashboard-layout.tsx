"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { SidebarProvider } from "@/lib/contexts/sidebar-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { canAccessPath, getDefaultPathForRole } from "@/lib/auth/role-access";
import { AssistantShellProvider } from "@/components/assistant/assistant-shell-provider";
import { canUseAssistantShell } from "@/lib/assistant/shell";
import { MobileBottomNav } from "./mobile-bottom-nav";
import {
  normalizeAgronomistLastRoute,
  readAgronomistLastRoute,
  rememberAgronomistLastRoute,
} from "@/lib/auth/last-route";

const AssistantLauncher = dynamic(
  () => import("@/components/assistant/assistant-launcher").then((module) => module.AssistantLauncher),
  { ssr: false }
);
const AssistantPanel = dynamic(
  () => import("@/components/assistant/assistant-panel").then((module) => module.AssistantPanel),
  { ssr: false }
);
const AssistantDebugMonitor = dynamic(
  () => import("@/components/assistant/assistant-debug-monitor").then((module) => module.AssistantDebugMonitor),
  { ssr: false }
);

const ADJACENT_ROUTE_PREFETCH: Record<string, string[]> = {
  "/dashboard": ["/weighbridge", "/warehouses"],
  "/weighbridge": ["/warehouses", "/dashboard"],
  "/warehouses": ["/weighbridge", "/dashboard"],
  "/fields": ["/fields-map", "/crop-structure"],
  "/fields-map": ["/fields", "/crop-structure"],
  "/analytics": ["/dashboard", "/warehouses"],
};

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const agronomistRestoreProfileRef = useRef<string | null>(null);
  const isWeatherLab = pathname === "/weather-lab" || pathname?.startsWith("/weather-lab/");
  const isWeighbridge = pathname === "/weighbridge" || pathname?.startsWith("/weighbridge/");
  const isTraffic = pathname === "/traffic" || pathname?.startsWith("/traffic/") || pathname === "/fleet";
  const assistantEnabled = canUseAssistantShell(profile?.role) && !isWeatherLab && !isWeighbridge;

  useEffect(() => {
    if (loading || !profile?.role || !pathname) return;

    if (profile.role === "global_admin" && !profile.context_company_id) {
      if (!pathname.startsWith("/platform") && !pathname.startsWith("/weather-lab")) {
        router.replace("/platform");
      }
      return;
    }

    if (!canAccessPath(profile.role, pathname)) {
      router.replace(getDefaultPathForRole(profile.role));
    }
  }, [loading, profile?.role, profile?.context_company_id, pathname, router]);

  useEffect(() => {
    if (loading || profile?.role !== "agronomist" || !profile.id || !pathname) return;

    const currentRoute = normalizeAgronomistLastRoute(
      `${pathname}${window.location.search || ""}${window.location.hash || ""}`,
    );
    const firstRouteForProfile = agronomistRestoreProfileRef.current !== profile.id;
    if (firstRouteForProfile) {
      agronomistRestoreProfileRef.current = profile.id;
      if (pathname === "/dashboard") {
        const previousRoute = readAgronomistLastRoute(profile.id);
        if (previousRoute && previousRoute !== currentRoute) {
          router.replace(previousRoute);
          return;
        }
      }
    }

    if (currentRoute) rememberAgronomistLastRoute(profile.id, currentRoute);
  }, [loading, pathname, profile?.id, profile?.role, router]);

  useEffect(() => {
    if (loading || !profile?.role || !pathname) return;
    const route = Object.keys(ADJACENT_ROUTE_PREFETCH).find((candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`));
    if (!route) return;
    const targets = ADJACENT_ROUTE_PREFETCH[route].filter((target) => canAccessPath(profile.role, target));
    const prefetch = () => targets.forEach((target) => router.prefetch(target));
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(prefetch, { timeout: 1200 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(prefetch, 350);
    return () => window.clearTimeout(timer);
  }, [loading, pathname, profile?.role, router]);

  if (!loading && profile?.role && pathname && !canAccessPath(profile.role, pathname)) {
    return (
      <main className="tf-manor grid min-h-screen place-items-center bg-background p-4" role="status" aria-live="polite">
        <div className="tf-estate-document w-full max-w-md p-6 text-sm text-muted-foreground">
          Открываем доступный для вашей роли раздел…
        </div>
      </main>
    );
  }

  return (
    <SidebarProvider>
      <AssistantShellProvider>
        <div className={`travkin-shell tf-manor-shell flex ${isTraffic ? "h-[100dvh] min-h-0 overflow-hidden md:h-screen" : "min-h-screen"}`}>
          <div className="tf-desktop-sidebar hidden md:flex md:h-screen md:shrink-0">
            <Sidebar />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Header />
            <main className={`travkin-scrollbar tf-manor-workspace min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] py-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:py-4 sm:pl-[max(1rem,env(safe-area-inset-left))] sm:pr-[max(1rem,env(safe-area-inset-right))] md:py-6 md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))] ${profile?.role === "fleet_manager" ? "pb-[calc(env(safe-area-inset-bottom)+1rem)]" : "pb-[calc(env(safe-area-inset-bottom)+6.25rem)] sm:pb-[calc(env(safe-area-inset-bottom)+6.25rem)] md:pb-6"}`}>
              <div key={pathname} className={`tf-estate-page-enter ${isTraffic ? "h-full min-h-0" : ""}`}>
                {children}
              </div>
              <footer className="tf-desktop-footer mt-8 hidden border-t border-[color:var(--manor-line)] pt-3 text-center text-xs text-[color:var(--manor-text-muted)] md:block">
                Copyright © Сунгатов Айымбек
              </footer>
            </main>
          </div>
        </div>
        <MobileBottomNav />
        {assistantEnabled ? <AssistantLauncher /> : null}
        {assistantEnabled ? <AssistantPanel /> : null}
        {assistantEnabled ? <AssistantDebugMonitor /> : null}
      </AssistantShellProvider>
    </SidebarProvider>
  );
}
