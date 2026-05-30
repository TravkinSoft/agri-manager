"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, LayoutDashboard, Map, Package, Tractor } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/contexts/auth-context";
import { canAccessPath } from "@/lib/auth/role-access";
import type { AppRole } from "@/lib/auth/roles";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";

type BottomItem = {
  label: string;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  kind: "route" | "copilot";
};

const BASE_ITEMS: BottomItem[] = [
  { label: "Панель", href: "/dashboard", icon: LayoutDashboard, kind: "route" },
  { label: "Карта", href: "/fields-map", icon: Map, kind: "route" },
  { label: "Операции", href: "/operations", icon: Tractor, kind: "route" },
  { label: "Склады", href: "/warehouses", icon: Package, kind: "route" },
  { label: "Copilot", icon: Bot, kind: "copilot" },
];

const HIDE_GLOBAL_MOBILE_NAV_PREFIXES = ["/tasks", "/warehouses/requests"];

function isActivePath(pathname: string, href?: string): boolean {
  if (!href) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getRoleFilteredItems(role?: string | null): BottomItem[] {
  const normalizedRole = String(role || "") as AppRole;
  return BASE_ITEMS.filter((item) => {
    if (item.kind === "copilot") return true;
    return canAccessPath(normalizedRole, item.href || "");
  });
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const { profile } = useAuth();
  const { enabled, isOpen, toggle } = useAssistantShell();

  if (!pathname) return null;
  if (HIDE_GLOBAL_MOBILE_NAV_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return null;
  }

  const items = getRoleFilteredItems(profile?.role);
  if (items.length === 0) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#262D3D] bg-[#11151E]/95 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-1 shadow-[0_-8px_24px_rgba(0,0,0,0.45)] backdrop-blur md:hidden">
      <div className="grid gap-1 px-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.kind === "copilot" ? isOpen : isActivePath(pathname, item.href);

          if (item.kind === "copilot") {
            return (
              <button
                key="mobile-nav-copilot"
                type="button"
                onClick={toggle}
                disabled={!enabled}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center rounded-xl px-1 py-1 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-60",
                  active
                    ? "bg-[#E0B100] text-[#111827]"
                    : "text-[#A9B2C2] hover:bg-[#202738] hover:text-[#F3F4F6]"
                )}
              >
                <Icon className="mb-1 h-4 w-4" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href || "/dashboard"}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center rounded-xl px-1 py-1 text-[10px] font-medium",
                active
                  ? "bg-[#E0B100] text-[#111827]"
                  : "text-[#A9B2C2] hover:bg-[#202738] hover:text-[#F3F4F6]"
              )}
            >
              <Icon className="mb-1 h-4 w-4" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
