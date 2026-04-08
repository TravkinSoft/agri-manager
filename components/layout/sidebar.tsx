"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, MapPin, Sprout, Tractor, Warehouse, ChartBar as BarChart3, Brain, BookOpen, Users, Settings, History, Upload, SquareCheck as CheckSquare, Package } from "lucide-react";
import { useSidebar } from "@/lib/contexts/sidebar-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TranslationKey } from "@/lib/i18n/translations";

interface NavItem {
  key: TranslationKey | string;
  href: string;
  icon: any;
  roles?: string[];
}

const allNavigation: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "fields", href: "/fields", icon: MapPin, roles: ['admin', 'agronomist'] },
  { key: "crop_structure", href: "/crop-structure", icon: Sprout, roles: ['admin', 'agronomist'] },
  { key: "field_history", href: "/field-history", icon: History, roles: ['admin', 'agronomist'] },
  { key: "operations", href: "/operations", icon: Tractor, roles: ['admin', 'agronomist'] },
  { key: "My Tasks", href: "/tasks", icon: CheckSquare, roles: ['specialist'] },
  { key: "warehouses", href: "/warehouses", icon: Warehouse, roles: ['admin', 'agronomist', 'warehouse'] },
  { key: "Inventory", href: "/inventory", icon: Package, roles: ['warehouse'] },
  { key: "analytics", href: "/analytics", icon: BarChart3, roles: ['admin', 'agronomist'] },
  { key: "specialist", href: "/specialist", icon: Brain, roles: ['admin', 'agronomist', 'specialist'] },
  { key: "references", href: "/references", icon: BookOpen, roles: ['admin', 'agronomist'] },
  { key: "users", href: "/users", icon: Users, roles: ['admin'] },
  { key: "settings", href: "/settings", icon: Settings, roles: ['admin'] },
  { key: "import", href: "/import", icon: Upload, roles: ['admin', 'agronomist'] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed } = useSidebar();
  const { t } = useLanguage();
  const { profile } = useAuth();

  const navigation = allNavigation.filter(item => {
    if (!item.roles) return true;
    if (!profile) return false;
    return item.roles.includes(profile.role);
  });

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r bg-slate-50 transition-all duration-300 ease-in-out",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <div className={cn(
        "flex h-16 items-center border-b transition-all duration-300",
        isCollapsed ? "justify-center px-0" : "px-6"
      )}>
        <Sprout className="h-6 w-6 text-green-600 flex-shrink-0" />
        <span
          className={cn(
            "ml-2 text-lg font-semibold text-slate-900 whitespace-nowrap overflow-hidden transition-all duration-300",
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
            const label = typeof item.key === 'string' && item.key in t ? t(item.key as TranslationKey) : item.key;

            const linkContent = (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "flex items-center rounded-lg text-sm font-medium transition-all duration-200",
                  isCollapsed ? "justify-center px-3 py-2" : "gap-3 px-3 py-2",
                  isActive
                    ? "bg-green-100 text-green-900"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span
                  className={cn(
                    "whitespace-nowrap overflow-hidden transition-all duration-300",
                    isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                  )}
                >
                  {label}
                </span>
              </Link>
            );

            if (isCollapsed) {
              return (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>
                    {linkContent}
                  </TooltipTrigger>
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
