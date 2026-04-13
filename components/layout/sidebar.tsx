"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  MapPin,
  Sprout,
  Tractor,
  ChartBar as BarChart3,
  Brain,
  BookOpen,
  Users,
  Settings,
  History,
  Upload,
  SquareCheck as CheckSquare,
  Package,
  Scale,
  FlaskConical,
  PackageSearch,
  ScrollText,
} from "lucide-react";
import { useSidebar } from "@/lib/contexts/sidebar-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TranslationKey, translations } from "@/lib/i18n/translations";

interface NavItem {
  key: TranslationKey | string;
  href: string;
  icon: any;
}

const ADMIN_NAV: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "fields", href: "/fields", icon: MapPin },
  { key: "crop_structure", href: "/crop-structure", icon: Sprout },
  { key: "field_history", href: "/field-history", icon: History },
  { key: "operations", href: "/operations", icon: Tractor },
  { key: "warehouses", href: "/warehouses", icon: Package },
  { key: "Весовая Dashboard", href: "/weighbridge/dashboard", icon: LayoutDashboard },
  { key: "Машины", href: "/machines", icon: PackageSearch },
  { key: "Техника", href: "/technique", icon: Tractor },
  { key: "analytics", href: "/analytics", icon: BarChart3 },
  { key: "specialist", href: "/specialist", icon: Brain },
  { key: "references", href: "/references", icon: BookOpen },
  { key: "users", href: "/users", icon: Users },
  { key: "settings", href: "/settings", icon: Settings },
  { key: "import", href: "/import", icon: Upload },
];

const AGRONOMIST_NAV: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "fields", href: "/fields", icon: MapPin },
  { key: "crop_structure", href: "/crop-structure", icon: Sprout },
  { key: "field_history", href: "/field-history", icon: History },
  { key: "operations", href: "/operations", icon: Tractor },
  { key: "warehouses", href: "/warehouses", icon: Package },
  { key: "Весовая Dashboard", href: "/weighbridge/dashboard", icon: LayoutDashboard },
  { key: "Техника", href: "/technique", icon: Tractor },
  { key: "analytics", href: "/analytics", icon: BarChart3 },
  { key: "specialist", href: "/specialist", icon: Brain },
  { key: "references", href: "/references", icon: BookOpen },
];

const WAREHOUSE_NAV: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "warehouses", href: "/warehouses", icon: Package },
  { key: "inventory_nav", href: "/inventory", icon: Package },
  { key: "stock_movements", href: "/warehouses/transactions", icon: History },
  { key: "issue_requests", href: "/warehouses/requests", icon: CheckSquare },
  { key: "warehouse_catalogs", href: "/warehouses/manage", icon: BookOpen },
];

const WEIGHMAN_NAV: NavItem[] = [
  { key: "Весовая Dashboard", href: "/weighbridge/dashboard", icon: LayoutDashboard },
  { key: "Машины", href: "/machines", icon: PackageSearch },
  { key: "Весовая / операции", href: "/weighbridge", icon: Scale },
  { key: "Переработка", href: "/processing", icon: FlaskConical },
  { key: "Тара", href: "/containers", icon: PackageSearch },
  { key: "Журнал проводок", href: "/ledger", icon: ScrollText },
];

const SPECIALIST_NAV: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "specialist", href: "/specialist", icon: Brain },
  { key: "my_tasks", href: "/tasks", icon: CheckSquare },
];

function getNavigationByRole(role?: string | null): NavItem[] {
  if (role === "global_admin" || role === "company_admin" || role === "admin") return ADMIN_NAV;
  if (role === "agronomist") return AGRONOMIST_NAV;
  if (role === "warehouse") return WAREHOUSE_NAV;
  if (role === "weighman") return WEIGHMAN_NAV;
  if (role === "specialist") return SPECIALIST_NAV;
  return [];
}

export function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed } = useSidebar();
  const { t } = useLanguage();
  const { profile } = useAuth();
  const navigation = getNavigationByRole(profile?.role);

  const isTranslationKey = (key: string): key is TranslationKey => key in translations.ru;

  return (
    <div className={cn("flex h-full flex-col border-r bg-slate-50 transition-all duration-300 ease-in-out", isCollapsed ? "w-16" : "w-64")}>
      <div className={cn("flex h-16 items-center border-b transition-all duration-300", isCollapsed ? "justify-center px-0" : "px-6")}>
        <Sprout className="h-6 w-6 text-green-600 flex-shrink-0" />
        <span className={cn("ml-2 text-lg font-semibold text-slate-900 whitespace-nowrap overflow-hidden transition-all duration-300", isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100")}>AgriManager</span>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        <TooltipProvider delayDuration={0}>
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            const label = typeof item.key === "string" && isTranslationKey(item.key) ? t(item.key) : item.key;
            const linkContent = (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "flex items-center rounded-lg text-sm font-medium transition-all duration-200",
                  isCollapsed ? "justify-center px-3 py-2" : "gap-3 px-3 py-2",
                  isActive ? "bg-green-100 text-green-900" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className={cn("whitespace-nowrap overflow-hidden transition-all duration-300", isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100")}>
                  {label}
                </span>
              </Link>
            );

            if (isCollapsed) {
              return (
                <Tooltip key={item.key}>
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
