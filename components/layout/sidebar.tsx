"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  ChartBar as BarChart3,
  Droplets,
  History,
  LayoutDashboard,
  Map,
  MapPin,
  Package,
  PackageSearch,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Sprout,
  SquareCheck as CheckSquare,
  Tractor,
  Upload,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { useSidebar } from "@/lib/contexts/sidebar-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import type { TranslationKey } from "@/lib/i18n/translations";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TravkinLogo } from "@/components/layout/travkin-logo";

interface NavItem {
  labelKey: TranslationKey;
  href: string;
  icon: any;
}

function handleHardNavigation(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  event.preventDefault();
  const target = new URL(href, window.location.origin);
  const current = new URL(window.location.href);
  if (target.pathname === current.pathname && target.search === current.search && target.hash === current.hash) {
    return;
  }
  window.location.assign(target.href);
}

const ADMIN_NAV: NavItem[] = [
  { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "fields", href: "/fields", icon: MapPin },
  { labelKey: "field_map", href: "/fields-map", icon: Map },
  { labelKey: "land_legal", href: "/land-legal", icon: ScrollText },
  { labelKey: "crop_structure", href: "/crop-structure", icon: Sprout },
  { labelKey: "care_systems", href: "/care-systems", icon: ShieldCheck },
  { labelKey: "field_history", href: "/field-history", icon: History },
  { labelKey: "operations", href: "/operations", icon: Tractor },
  { labelKey: "warehouses", href: "/warehouses", icon: Package },
  { labelKey: "meal_thermoses", href: "/meal-thermoses", icon: UtensilsCrossed },
  { labelKey: "weighbridge", href: "/weighbridge", icon: Scale },
  { labelKey: "machines", href: "/machines", icon: PackageSearch },
  { labelKey: "technique", href: "/technique", icon: Tractor },
  { labelKey: "fuel", href: "/fuel", icon: Droplets },
  { labelKey: "analytics", href: "/analytics", icon: BarChart3 },
  { labelKey: "references", href: "/references", icon: BookOpen },
  { labelKey: "users", href: "/users", icon: Users },
  { labelKey: "settings", href: "/settings", icon: Settings },
  { labelKey: "import", href: "/import", icon: Upload },
];

const AGRONOMIST_NAV: NavItem[] = [
  { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "fields", href: "/fields", icon: MapPin },
  { labelKey: "field_map", href: "/fields-map", icon: Map },
  { labelKey: "crop_structure", href: "/crop-structure", icon: Sprout },
  { labelKey: "care_systems", href: "/care-systems", icon: ShieldCheck },
  { labelKey: "field_history", href: "/field-history", icon: History },
  { labelKey: "operations", href: "/operations", icon: Tractor },
  { labelKey: "warehouses", href: "/warehouses", icon: Package },
  { labelKey: "technique", href: "/technique", icon: Tractor },
  { labelKey: "analytics", href: "/analytics", icon: BarChart3 },
  { labelKey: "references", href: "/references", icon: BookOpen },
];

const DIRECTOR_NAV: NavItem[] = [
  { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "fields", href: "/fields", icon: MapPin },
  { labelKey: "field_map", href: "/fields-map", icon: Map },
  { labelKey: "crop_structure", href: "/crop-structure", icon: Sprout },
  { labelKey: "care_systems", href: "/care-systems", icon: ShieldCheck },
  { labelKey: "field_history", href: "/field-history", icon: History },
  { labelKey: "operations", href: "/operations", icon: Tractor },
  { labelKey: "warehouses", href: "/warehouses", icon: Package },
  { labelKey: "land_legal", href: "/land-legal", icon: ScrollText },
  { labelKey: "technique", href: "/technique", icon: Tractor },
  { labelKey: "analytics", href: "/analytics", icon: BarChart3 },
  { labelKey: "references", href: "/references", icon: BookOpen },
];

const WAREHOUSE_NAV: NavItem[] = [
  { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "warehouses", href: "/warehouses", icon: Package },
  { labelKey: "stock_movements", href: "/warehouses/transactions", icon: History },
  { labelKey: "issue_requests", href: "/warehouses/requests", icon: CheckSquare },
  { labelKey: "inventory_nav", href: "/inventory", icon: Package },
];

const WAREHOUSE_OPERATOR_NAV = WAREHOUSE_NAV;

const WEIGHMAN_NAV: NavItem[] = [
  { labelKey: "weighbridge", href: "/weighbridge", icon: Scale },
  { labelKey: "machines", href: "/machines", icon: PackageSearch },
  { labelKey: "containers", href: "/containers", icon: PackageSearch },
  { labelKey: "ledger", href: "/ledger", icon: ScrollText },
];

const SPECIALIST_NAV: NavItem[] = [
  { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "my_tasks", href: "/tasks", icon: CheckSquare },
];

const BRIGADIER_NAV: NavItem[] = [
  { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "operations", href: "/operations", icon: Tractor },
  { labelKey: "fields", href: "/fields", icon: MapPin },
  { labelKey: "field_map", href: "/fields-map", icon: Map },
  { labelKey: "meal_thermoses", href: "/meal-thermoses", icon: UtensilsCrossed },
];

const LEGAL_OPERATOR_NAV: NavItem[] = [
  { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "land_legal", href: "/land-legal", icon: ScrollText },
  { labelKey: "fields", href: "/fields", icon: MapPin },
  { labelKey: "field_map", href: "/fields-map", icon: Map },
  { labelKey: "analytics", href: "/analytics", icon: BarChart3 },
];

const FUEL_OPERATOR_NAV: NavItem[] = [{ labelKey: "fuel", href: "/fuel", icon: Droplets }];

function getNavigationByRole(role?: string | null): NavItem[] {
  if (role === "global_admin" || role === "company_admin") return ADMIN_NAV;
  if (role === "agronomist") return AGRONOMIST_NAV;
  if (role === "director") return DIRECTOR_NAV;
  if (role === "warehouse") return WAREHOUSE_NAV;
  if (role === "warehouse_operator") return WAREHOUSE_OPERATOR_NAV;
  if (role === "weighman") return WEIGHMAN_NAV;
  if (role === "specialist") return SPECIALIST_NAV;
  if (role === "brigadier") return BRIGADIER_NAV;
  if (role === "legal_operator") return LEGAL_OPERATOR_NAV;
  if (role === "fuel_operator") return FUEL_OPERATOR_NAV;
  return [];
}

export function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed } = useSidebar();
  const { profile } = useAuth();
  const { t } = useLanguage();
  const navigation = getNavigationByRole(profile?.role);

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r border-[#262D3D] bg-[#11151E] text-[#F3F4F6] transition-all duration-300 ease-in-out",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center border-b border-[#262D3D] transition-all duration-300",
          isCollapsed ? "justify-center px-0" : "px-4"
        )}
      >
        <TravkinLogo compact={isCollapsed} />
      </div>

      <nav className="travkin-scrollbar flex-1 space-y-1 overflow-y-auto p-3">
        <TooltipProvider delayDuration={0}>
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            const label = t(item.labelKey);
            const linkContent = (
              <Link
                key={`${item.href}-${item.labelKey}`}
                href={item.href}
                onClick={(event) => handleHardNavigation(event, item.href)}
                className={cn(
                  "flex items-center rounded-lg text-sm font-medium transition-all duration-200",
                  isCollapsed ? "justify-center px-3 py-2" : "gap-3 px-3 py-2",
                  isActive
                    ? "bg-[#E0B100] text-[#111827] shadow-[0_0_0_1px_rgba(224,177,0,0.25)]"
                    : "text-[#C7CDD8] hover:bg-[#202738] hover:text-[#F3F4F6]"
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span
                  className={cn(
                    "overflow-hidden whitespace-nowrap transition-all duration-300",
                    isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                  )}
                >
                  {label}
                </span>
              </Link>
            );

            if (isCollapsed) {
              return (
                <Tooltip key={`${item.href}-${item.labelKey}`}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right" className="font-medium">
                    {label}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return linkContent;
          })}
        </TooltipProvider>
      </nav>

      {!isCollapsed ? (
        <div className="border-t border-[#262D3D] px-4 py-3 text-[11px] text-[#7F8A9B]">
          Copyright © Сунгатов Айымбек
        </div>
      ) : null}
    </div>
  );
}
