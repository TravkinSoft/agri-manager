"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  ChartBar as BarChart3,
  CheckSquare,
  Droplets,
  LayoutDashboard,
  MapPin,
  Package,
  ScrollText,
  Scale,
  Tractor,
} from "lucide-react";

type BottomItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

const ADMIN_ITEMS: BottomItem[] = [
  { label: "Главная", href: "/dashboard", icon: LayoutDashboard },
  { label: "Поля", href: "/fields", icon: MapPin },
  { label: "Операции", href: "/operations", icon: Tractor },
  { label: "Склады", href: "/warehouses", icon: Package },
  { label: "Кадастр", href: "/land-legal", icon: ScrollText },
];

const AGRONOMIST_ITEMS: BottomItem[] = [
  { label: "Главная", href: "/dashboard", icon: LayoutDashboard },
  { label: "Поля", href: "/fields", icon: MapPin },
  { label: "Операции", href: "/operations", icon: Tractor },
  { label: "Склады", href: "/warehouses", icon: Package },
  { label: "Отчёты", href: "/analytics", icon: BarChart3 },
];

const WAREHOUSE_ITEMS: BottomItem[] = [
  { label: "Главная", href: "/dashboard", icon: LayoutDashboard },
  { label: "Весовая", href: "/weighbridge", icon: Scale },
  { label: "Склады", href: "/warehouses", icon: Package },
  { label: "Заявки", href: "/warehouses/requests", icon: CheckSquare },
  { label: "Остатки", href: "/inventory", icon: BarChart3 },
];

const WEIGHMAN_ITEMS: BottomItem[] = [
  { label: "Весовая", href: "/weighbridge", icon: Scale },
  { label: "Склады", href: "/warehouses", icon: Package },
  { label: "Проводки", href: "/ledger", icon: ScrollText },
];

const SPECIALIST_ITEMS: BottomItem[] = [
  { label: "Главная", href: "/dashboard", icon: LayoutDashboard },
  { label: "Задачи", href: "/tasks", icon: CheckSquare },
];

const BRIGADIER_ITEMS: BottomItem[] = [
  { label: "Главная", href: "/dashboard", icon: LayoutDashboard },
  { label: "Операции", href: "/operations", icon: Tractor },
  { label: "Поля", href: "/fields", icon: MapPin },
];

const LEGAL_ITEMS: BottomItem[] = [
  { label: "Главная", href: "/dashboard", icon: LayoutDashboard },
  { label: "Кадастр", href: "/land-legal", icon: ScrollText },
  { label: "Поля", href: "/fields", icon: MapPin },
  { label: "Отчёты", href: "/analytics", icon: BarChart3 },
];

const FUEL_ITEMS: BottomItem[] = [{ label: "ГСМ", href: "/fuel", icon: Droplets }];

const HIDE_GLOBAL_MOBILE_NAV_PREFIXES = ["/tasks", "/warehouses/requests"];

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getItemsByRole(role?: string | null): BottomItem[] {
  if (role === "global_admin" || role === "company_admin" || role === "director") return ADMIN_ITEMS;
  if (role === "agronomist") return AGRONOMIST_ITEMS;
  if (role === "warehouse" || role === "warehouse_operator") return WAREHOUSE_ITEMS;
  if (role === "weighman") return WEIGHMAN_ITEMS;
  if (role === "specialist") return SPECIALIST_ITEMS;
  if (role === "brigadier") return BRIGADIER_ITEMS;
  if (role === "legal_operator") return LEGAL_ITEMS;
  if (role === "fuel_operator") return FUEL_ITEMS;
  return ADMIN_ITEMS;
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const { profile } = useAuth();

  if (!pathname) return null;
  if (HIDE_GLOBAL_MOBILE_NAV_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return null;
  }

  const items = getItemsByRole(profile?.role);
  if (items.length === 0) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#262D3D] bg-[#11151E]/95 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-1 shadow-[0_-8px_24px_rgba(0,0,0,0.45)] backdrop-blur md:hidden">
      <div className="grid gap-1 px-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
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
