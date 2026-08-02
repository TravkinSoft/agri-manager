"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, CheckSquare, History, LayoutDashboard, MapPin, Package, Scale, Tractor } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/contexts/auth-context";
import { canAccessPath } from "@/lib/auth/role-access";
import type { AppRole } from "@/lib/auth/roles";
import { useLanguage } from "@/lib/contexts/language-context";
import type { TranslationKey } from "@/lib/i18n/translations";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";

type BottomItem = {
  labelKey: TranslationKey;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  kind: "route" | "copilot";
};

const COPILOT_ITEM: BottomItem = { labelKey: "copilot", icon: Bot, kind: "copilot" };
const DASHBOARD_ITEM: BottomItem = { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard, kind: "route" };

function getMobileRouteCandidates(role?: string | null): BottomItem[] {
  switch (role) {
    case "specialist":
      return [
        { labelKey: "my_tasks", href: "/tasks", icon: CheckSquare, kind: "route" },
        DASHBOARD_ITEM,
      ];
    case "warehouse":
      return [
        { labelKey: "issue_requests", href: "/warehouses/requests", icon: CheckSquare, kind: "route" },
        { labelKey: "warehouses", href: "/warehouses", icon: Package, kind: "route" },
        { labelKey: "stock_movements", href: "/warehouses/transactions", icon: History, kind: "route" },
        DASHBOARD_ITEM,
      ];
    case "warehouse_operator":
      return [
        { labelKey: "weighbridge", href: "/weighbridge", icon: Scale, kind: "route" },
        { labelKey: "issue_requests", href: "/warehouses/requests", icon: CheckSquare, kind: "route" },
        { labelKey: "warehouses", href: "/warehouses", icon: Package, kind: "route" },
        { labelKey: "stock_movements", href: "/warehouses/transactions", icon: History, kind: "route" },
      ];
    case "weighman":
      return [
        { labelKey: "weighbridge", href: "/weighbridge", icon: Scale, kind: "route" },
        { labelKey: "warehouses", href: "/warehouses", icon: Package, kind: "route" },
        { labelKey: "ledger", href: "/ledger", icon: History, kind: "route" },
      ];
    case "fuel_operator":
      return [DASHBOARD_ITEM];
    default:
      return [
        DASHBOARD_ITEM,
        { labelKey: "fields", href: "/fields", icon: MapPin, kind: "route" },
        { labelKey: "operations", href: "/operations", icon: Tractor, kind: "route" },
        { labelKey: "warehouses", href: "/warehouses", icon: Package, kind: "route" },
      ];
  }
}

function isActivePath(pathname: string, href?: string): boolean {
  if (!href) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getRoleFilteredItems(role?: string | null): BottomItem[] {
  const normalizedRole = String(role || "") as AppRole;
  const routeItems = getMobileRouteCandidates(role)
    .filter((item) => canAccessPath(normalizedRole, item.href || ""))
    .slice(0, 4);
  return [...routeItems, COPILOT_ITEM];
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const { profile } = useAuth();
  const { enabled, isOpen, toggle } = useAssistantShell();
  const { t } = useLanguage();

  if (!pathname) return null;

  const items = getRoleFilteredItems(profile?.role);
  if (items.length === 0) return null;

  return (
    <nav className="fixed inset-x-3 bottom-3 z-40 rounded-[22px] border border-white/10 bg-[#101520]/92 px-2 py-1.5 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] shadow-[0_18px_45px_rgba(0,0,0,0.5)] backdrop-blur-xl md:hidden">
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.kind === "copilot" ? isOpen : isActivePath(pathname, item.href);
          const label = t(item.labelKey);

          if (item.kind === "copilot") {
            return (
              <button
                key="mobile-nav-copilot"
                type="button"
                onClick={toggle}
                disabled={!enabled}
                aria-label={label}
                className={cn(
                  "relative flex min-h-12 flex-col items-center justify-center rounded-2xl px-1 py-1 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-60",
                  active
                    ? "bg-[#E0B100] text-[#111827]"
                    : "text-[#A9B2C2] hover:bg-[#202738] hover:text-[#F3F4F6]"
                )}
              >
                <Icon className="mb-1 h-4 w-4" />
                <span className="max-w-full truncate">{label}</span>
              </button>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href || "/dashboard"}
              aria-label={label}
              className={cn(
                "relative flex min-h-12 flex-col items-center justify-center rounded-2xl px-1 py-1 text-[10px] font-medium",
                active
                  ? "bg-white/[0.07] text-[#E0B100]"
                  : "text-[#A9B2C2] hover:bg-[#202738] hover:text-[#F3F4F6]"
              )}
            >
              {active ? <span className="absolute top-1 h-1 w-4 rounded-full bg-[#E0B100]" /> : null}
              <Icon className="mb-1 h-4 w-4" />
              <span className="max-w-full truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
