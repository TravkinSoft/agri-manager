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
  { label: "Весовая Dashboard", href: "/weighbridge/dashboard", icon: LayoutDashboard },
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
  { label: "Весовая Dashboard", href: "/weighbridge/dashboard", icon: LayoutDashboard },
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
  { label: "Склады", href: "/warehouses", icon: Package },
  { label: "Инвентарь", href: "/inventory", icon: Package },
  { label: "Движение запасов", href: "/warehouses/transactions", icon: History },
  { label: "Заявки на выдачу", href: "/warehouses/requests", icon: CheckSquare },
];

const WEIGHMAN_NAV: NavItem[] = [
  { label: "Весовая Dashboard", href: "/weighbridge/dashboard", icon: LayoutDashboard },
  { label: "Машины", href: "/machines", icon: PackageSearch },
  { label: "Весовая / операции", href: "/weighbridge", icon: Scale },
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
        "flex h-full flex-col border-r bg-slate-50 transition-all duration-300 ease-in-out",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center border-b transition-all duration-300",
          isCollapsed ? "justify-center px-0" : "px-6"
        )}
      >
        <Sprout className="h-6 w-6 flex-shrink-0 text-green-600" />
        <span
          className={cn(
            "ml-2 overflow-hidden whitespace-nowrap text-lg font-semibold text-slate-900 transition-all duration-300",
            isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
          )}
        >
          AgriManager
        </span>
      </div>

      <nav className="flex-1 space-y-1 p-4">
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
                  isActive ? "bg-green-100 text-green-900" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
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
    </div>
  );
}
