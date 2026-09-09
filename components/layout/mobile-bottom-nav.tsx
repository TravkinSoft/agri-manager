"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  CheckSquare,
  CloudSun,
  Droplets,
  History,
  LayoutDashboard,
  Map,
  MapPin,
  Menu,
  Package,
  Scale,
  Sprout,
  Tractor,
  Users,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/contexts/auth-context";
import { canAccessPath } from "@/lib/auth/role-access";
import type { AppRole } from "@/lib/auth/roles";
import { useLanguage } from "@/lib/contexts/language-context";
import type { TranslationKey } from "@/lib/i18n/translations";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type BottomItem = {
  labelKey: TranslationKey;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  kind: "route" | "more";
};

const MORE_ITEM: BottomItem = { labelKey: "mobile_more", icon: Menu, kind: "more" };
const DASHBOARD_ITEM: BottomItem = { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard, kind: "route" };

function getMobileRouteCandidates(role?: string | null): BottomItem[] {
  switch (role) {
    case "fleet_manager":
      return [
        { labelKey: "fleet", href: "/fleet", icon: Truck, kind: "route" },
        { labelKey: "traffic", href: "/traffic", icon: History, kind: "route" },
      ];
    case "global_admin":
      return [
        DASHBOARD_ITEM,
        { labelKey: "fields", href: "/fields", icon: MapPin, kind: "route" },
        { labelKey: "weighbridge", href: "/weighbridge", icon: Scale, kind: "route" },
        { labelKey: "weather", href: "/weather-lab", icon: CloudSun, kind: "route" },
        MORE_ITEM,
      ];
    case "company_admin":
      return [
        DASHBOARD_ITEM,
        { labelKey: "fields", href: "/fields", icon: MapPin, kind: "route" },
        { labelKey: "weighbridge", href: "/weighbridge", icon: Scale, kind: "route" },
        { labelKey: "warehouses", href: "/warehouses", icon: Package, kind: "route" },
        MORE_ITEM,
      ];
    case "agronomist":
      return [
        { labelKey: "harvest_summary", href: "/dashboard", icon: LayoutDashboard, kind: "route" },
        { labelKey: "crop_structure", href: "/crop-structure", icon: Sprout, kind: "route" },
        { labelKey: "warehouses", href: "/warehouses", icon: Package, kind: "route" },
        { labelKey: "traffic", href: "/traffic", icon: Truck, kind: "route" },
        MORE_ITEM,
      ];
    case "director":
      return [{ labelKey: "harvest_summary", href: "/dashboard", icon: LayoutDashboard, kind: "route" }];
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
        { labelKey: "traffic", href: "/weighbridge/traffic", icon: Truck, kind: "route" },
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

function getMoreRouteCandidates(role?: string | null): BottomItem[] {
  const shared: BottomItem[] = [
    { labelKey: "fleet", href: "/fleet", icon: Truck, kind: "route" },
    { labelKey: "traffic", href: "/traffic", icon: Truck, kind: "route" },
    { labelKey: "weather", href: "/weather-lab", icon: CloudSun, kind: "route" },
    { labelKey: "field_map", href: "/fields-map", icon: Map, kind: "route" },
    { labelKey: "crop_structure", href: "/crop-structure", icon: Sprout, kind: "route" },
    { labelKey: "warehouses", href: "/warehouses", icon: Package, kind: "route" },
    { labelKey: "fuel", href: "/fuel", icon: Droplets, kind: "route" },
    { labelKey: "analytics", href: "/analytics", icon: BarChart3, kind: "route" },
    { labelKey: "references", href: "/references", icon: BookOpen, kind: "route" },
    { labelKey: "users", href: "/users", icon: Users, kind: "route" },
  ];
  const normalizedRole = String(role || "") as AppRole;
  return shared.filter((item) => canAccessPath(normalizedRole, item.href || ""));
}

function isActivePath(pathname: string, href?: string): boolean {
  if (!href) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getRoleFilteredItems(role?: string | null): BottomItem[] {
  const normalizedRole = String(role || "") as AppRole;
  if (normalizedRole === "global_admin" || normalizedRole === "company_admin") {
    return getMobileRouteCandidates(role).filter(
      (item) => item.kind === "more" || canAccessPath(normalizedRole, item.href || "")
    );
  }
  const routeLimit = normalizedRole === "agronomist" ? 5 : 4;
  return getMobileRouteCandidates(role)
    .filter((item) => item.kind === "more" || canAccessPath(normalizedRole, item.href || ""))
    .slice(0, routeLimit);
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { profile } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  if (!pathname || profile?.role === "fleet_manager") return null;

  const items = getRoleFilteredItems(profile?.role);
  const moreItems = getMoreRouteCandidates(profile?.role);
  if (items.length === 0) return null;

  return (
    <nav className="tf-manor-topbar fixed inset-x-3 bottom-3 z-40 rounded-[22px] border px-2 py-1.5 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] shadow-[0_18px_42px_rgba(43,29,19,0.3)] md:hidden">
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(pathname, item.href);
          const label = t(item.labelKey);

          if (item.kind === "more") {
            return (
              <button
                key="mobile-nav-more"
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-label={label}
                className={cn(
                  "tf-manor-control relative flex min-h-12 flex-col items-center justify-center rounded-2xl px-1 py-1 text-[10px] font-medium",
                  moreOpen
                    ? "bg-[#F2D48A] text-[#2B1D13]"
                    : "text-[#D8C8AC] hover:bg-[#F8F0E2]/10 hover:text-white"
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
                "tf-manor-control relative flex min-h-12 flex-col items-center justify-center rounded-2xl px-1 py-1 text-[10px] font-medium",
                active
                  ? "bg-[#F2D48A] text-[#2B1D13]"
                  : "text-[#D8C8AC] hover:bg-[#F8F0E2]/10 hover:text-white"
              )}
            >
              {active ? <span className="absolute top-1 h-1 w-4 rounded-full bg-[#536B32]" /> : null}
              <Icon className="mb-1 h-4 w-4" />
              <span className="line-clamp-2 max-w-full text-center leading-3">{label}</span>
            </Link>
          );
        })}
      </div>
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="!bottom-0 !left-0 !top-auto !w-full !max-w-none !translate-x-0 !translate-y-0 rounded-t-2xl border-[color:var(--manor-line)] bg-[var(--manor-paper-raised)] px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-5 text-[color:var(--manor-walnut)] shadow-manor-md md:hidden">
          <DialogHeader>
            <DialogTitle className="tf-manor-heading text-left text-xl">{t("mobile_more")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {moreItems.map((item) => {
              const Icon = item.icon;
              const label = t(item.labelKey);
              return (
                <Link
                  key={item.href}
                  href={item.href || "/dashboard"}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "tf-manor-control flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-sm font-medium",
                    isActivePath(pathname, item.href)
                      ? "border-[#B98939]/65 bg-[#E8D6AE] text-[#3A281B]"
                      : "border-[color:var(--manor-line)] bg-[var(--manor-paper)] text-[color:var(--manor-walnut)] hover:bg-[var(--manor-paper-recessed)]"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 leading-5">{label}</span>
                </Link>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
