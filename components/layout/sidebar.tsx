"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  ChartBar as BarChart3,
  Droplets,
  FlaskConical,
  History,
  LayoutDashboard,
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
} from "lucide-react";
import { useSidebar } from "@/lib/contexts/sidebar-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TravkinLogo } from "@/components/layout/travkin-logo";

interface NavItem {
  label: string;
  href: string;
  icon: any;
}

const ADMIN_NAV: NavItem[] = [
  { label: "Панель", href: "/dashboard", icon: LayoutDashboard },
  { label: "Поля", href: "/fields", icon: MapPin },
  { label: "Кадастр и право", href: "/land-legal", icon: ScrollText },
  { label: "Структура посевов", href: "/crop-structure", icon: Sprout },
  { label: "Системы защиты и ухода", href: "/care-systems", icon: ShieldCheck },
  { label: "История полей", href: "/field-history", icon: History },
  { label: "Операции", href: "/operations", icon: Tractor },
  { label: "Склады", href: "/warehouses", icon: Package },
  { label: "Весовая Dashboard", href: "/weighbridge/dashboard", icon: LayoutDashboard },
  { label: "Машины", href: "/machines", icon: PackageSearch },
  { label: "Техника", href: "/technique", icon: Tractor },
  { label: "АЗС / ГСМ", href: "/fuel", icon: Droplets },
  { label: "Аналитика", href: "/analytics", icon: BarChart3 },
  { label: "Справочники", href: "/references", icon: BookOpen },
  { label: "Пользователи", href: "/users", icon: Users },
  { label: "Настройки", href: "/settings", icon: Settings },
  { label: "Импорт", href: "/import", icon: Upload },
];

const AGRONOMIST_NAV: NavItem[] = [
  { label: "Панель", href: "/dashboard", icon: LayoutDashboard },
  { label: "Поля", href: "/fields", icon: MapPin },
  { label: "Структура посевов", href: "/crop-structure", icon: Sprout },
  { label: "Системы защиты и ухода", href: "/care-systems", icon: ShieldCheck },
  { label: "История полей", href: "/field-history", icon: History },
  { label: "Операции", href: "/operations", icon: Tractor },
  { label: "Склады", href: "/warehouses", icon: Package },
  { label: "Техника", href: "/technique", icon: Tractor },
  { label: "Аналитика", href: "/analytics", icon: BarChart3 },
  { label: "Справочники", href: "/references", icon: BookOpen },
];

const DIRECTOR_NAV: NavItem[] = [
  { label: "Панель", href: "/dashboard", icon: LayoutDashboard },
  { label: "Поля", href: "/fields", icon: MapPin },
  { label: "Структура посевов", href: "/crop-structure", icon: Sprout },
  { label: "Системы защиты и ухода", href: "/care-systems", icon: ShieldCheck },
  { label: "История полей", href: "/field-history", icon: History },
  { label: "Операции", href: "/operations", icon: Tractor },
  { label: "Склады", href: "/warehouses", icon: Package },
  { label: "Кадастр и право", href: "/land-legal", icon: ScrollText },
  { label: "Техника", href: "/technique", icon: Tractor },
  { label: "Аналитика", href: "/analytics", icon: BarChart3 },
  { label: "Справочники", href: "/references", icon: BookOpen },
];

const WAREHOUSE_NAV: NavItem[] = [
  { label: "Панель", href: "/dashboard", icon: LayoutDashboard },
  { label: "Склады", href: "/warehouses", icon: Package },
  { label: "Инвентарь", href: "/inventory", icon: Package },
  { label: "Движение запасов", href: "/warehouses/transactions", icon: History },
  { label: "Заявки на выдачу", href: "/warehouses/requests", icon: CheckSquare },
  { label: "Складские справочники", href: "/warehouses/manage", icon: BookOpen },
];

const WAREHOUSE_OPERATOR_NAV: NavItem[] = [
  { label: "Панель", href: "/dashboard", icon: LayoutDashboard },
  { label: "Весовая", href: "/weighbridge", icon: Scale },
  { label: "Склады", href: "/warehouses", icon: Package },
  { label: "Инвентарь", href: "/inventory", icon: Package },
  { label: "Движение запасов", href: "/warehouses/transactions", icon: History },
  { label: "Заявки на выдачу", href: "/warehouses/requests", icon: CheckSquare },
];

const WEIGHMAN_NAV: NavItem[] = [
  { label: "Весовая", href: "/weighbridge", icon: Scale },
  { label: "Машины", href: "/machines", icon: PackageSearch },
  { label: "Склады", href: "/warehouses", icon: Package },
  { label: "Переработка", href: "/processing", icon: FlaskConical },
  { label: "Тара", href: "/containers", icon: PackageSearch },
  { label: "Журнал проводок", href: "/ledger", icon: ScrollText },
];

const SPECIALIST_NAV: NavItem[] = [
  { label: "Панель", href: "/dashboard", icon: LayoutDashboard },
  { label: "Мои задачи", href: "/tasks", icon: CheckSquare },
];

const BRIGADIER_NAV: NavItem[] = [
  { label: "Панель", href: "/dashboard", icon: LayoutDashboard },
  { label: "Операции", href: "/operations", icon: Tractor },
  { label: "Поля", href: "/fields", icon: MapPin },
];

const LEGAL_OPERATOR_NAV: NavItem[] = [
  { label: "Панель", href: "/dashboard", icon: LayoutDashboard },
  { label: "Кадастр и право", href: "/land-legal", icon: ScrollText },
  { label: "Поля", href: "/fields", icon: MapPin },
  { label: "Аналитика", href: "/analytics", icon: BarChart3 },
];

const FUEL_OPERATOR_NAV: NavItem[] = [{ label: "АЗС / ГСМ", href: "/fuel", icon: Droplets }];

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
            const label = item.label;
            const linkContent = (
              <Link
                key={`${item.href}-${label}`}
                href={item.href}
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
                <Tooltip key={`${item.href}-${label}`}>
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
