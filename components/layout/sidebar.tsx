"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  ChartBar as BarChart3,
  CloudSun,
  Droplets,
  LayoutDashboard,
  Map,
  MapPin,
  Package,
  Scale,
  Settings,
  Sprout,
  SquareCheck as CheckSquare,
  Tractor,
  Users,
  History,
  ScrollText,
} from "lucide-react";
import { useSidebar } from "@/lib/contexts/sidebar-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import type { TranslationKey } from "@/lib/i18n/translations";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TravkinLogo } from "@/components/layout/travkin-logo";
import { SystemHealthBadge } from "@/components/operations/system-health-badge";

interface NavItem {
  labelKey: TranslationKey;
  href: string;
  icon: any;
}

const GLOBAL_ADMIN_NAV: NavItem[] = [
  { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "weather", href: "/weather-lab", icon: CloudSun },
  { labelKey: "fields", href: "/fields", icon: MapPin },
  { labelKey: "field_map", href: "/fields-map", icon: Map },
  { labelKey: "crop_structure", href: "/crop-structure", icon: Sprout },
  { labelKey: "warehouses", href: "/warehouses", icon: Package },
  { labelKey: "weighbridge", href: "/weighbridge", icon: Scale },
  { labelKey: "fuel", href: "/fuel", icon: Droplets },
  { labelKey: "analytics", href: "/analytics", icon: BarChart3 },
  { labelKey: "references", href: "/references", icon: BookOpen },
  { labelKey: "users", href: "/users", icon: Users },
];

const COMPANY_ADMIN_NAV: NavItem[] = [
  { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "fields", href: "/fields", icon: MapPin },
  { labelKey: "crop_structure", href: "/crop-structure", icon: Sprout },
  { labelKey: "operations", href: "/operations", icon: Tractor },
  { labelKey: "warehouses", href: "/warehouses", icon: Package },
  { labelKey: "weighbridge", href: "/weighbridge", icon: Scale },
  { labelKey: "analytics", href: "/analytics", icon: BarChart3 },
  { labelKey: "references", href: "/references", icon: BookOpen },
  { labelKey: "users", href: "/users", icon: Users },
  { labelKey: "settings", href: "/settings", icon: Settings },
];

const AGRONOMIST_NAV: NavItem[] = [
  { labelKey: "harvest_summary", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "crop_structure", href: "/crop-structure", icon: Sprout },
  { labelKey: "warehouses", href: "/warehouses", icon: Package },
  { labelKey: "tickets_nav", href: "/tickets", icon: Scale },
  { labelKey: "weather", href: "/weather-lab", icon: CloudSun },
];

const DIRECTOR_NAV: NavItem[] = [
  { labelKey: "harvest_summary", href: "/dashboard", icon: LayoutDashboard },
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
  { labelKey: "warehouses", href: "/warehouses", icon: Package },
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
];

const LEGAL_OPERATOR_NAV: NavItem[] = [
  { labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "fields", href: "/fields", icon: MapPin },
  { labelKey: "analytics", href: "/analytics", icon: BarChart3 },
];

const FUEL_OPERATOR_NAV: NavItem[] = [{ labelKey: "dashboard", href: "/dashboard", icon: LayoutDashboard }];

function getNavigationByRole(role?: string | null): NavItem[] {
  if (role === "global_admin") return GLOBAL_ADMIN_NAV;
  if (role === "company_admin") return COMPANY_ADMIN_NAV;
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
                prefetch={["/weighbridge", "/warehouses", "/ledger"].includes(item.href) ? true : undefined}
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

      {["global_admin", "company_admin"].includes(String(profile?.role || "")) ? (
        <SystemHealthBadge collapsed={isCollapsed} />
      ) : null}

      {!isCollapsed ? (
        <div className="border-t border-[#262D3D] px-4 py-3 text-[11px] text-[#7F8A9B]">
          Copyright © Сунгатов Айымбек
        </div>
      ) : null}
    </div>
  );
}
