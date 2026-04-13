"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Building2,
  Shield,
  Sprout,
  FlaskConical,
  Tractor,
  Truck,
} from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type NavItem = {
  href: string;
  label: string;
};

type NavGroup = {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Платформа",
    icon: Building2,
    items: [{ href: "/platform", label: "Компании" }],
  },
  {
    title: "Агрономия",
    icon: Sprout,
    items: [
      { href: "/platform/catalogs/agronomy/crops", label: "Культуры" },
      { href: "/platform/catalogs/agronomy/varieties", label: "Сорта" },
      { href: "/platform/catalogs/agronomy/seed-reproductions", label: "Репродукции семян" },
    ],
  },
  {
    title: "Агрохимия",
    icon: FlaskConical,
    items: [
      { href: "/platform/catalogs/agrochemistry/pesticides", label: "Пестициды" },
      { href: "/platform/catalogs/agrochemistry/fertilizers", label: "Удобрения" },
    ],
  },
  {
    title: "Машинный двор",
    icon: Tractor,
    items: [
      { href: "/platform/catalogs/machine-yard/machinery", label: "Техника" },
      { href: "/platform/catalogs/machine-yard/implements", label: "Оборудование / агрегаты" },
    ],
  },
  {
    title: "Автопарк",
    icon: Truck,
    items: [{ href: "/platform/catalogs/fleet", label: "Транспорт" }],
  },
];

function isItemActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/platform") return pathname === "/platform";
  return pathname.startsWith(`${href}/`);
}

export function PlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!profile?.role) return;
    if (profile.role !== "global_admin") {
      router.replace("/dashboard");
    }
  }, [loading, profile?.role, router]);

  if (loading || profile?.role !== "global_admin") {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="h-16 border-b bg-white px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-purple-700" />
          <span className="font-semibold text-slate-900">Платформа AgriManager</span>
          <Badge className="bg-purple-100 text-purple-800">Глобальный администратор</Badge>
        </div>
        <Button variant="outline" onClick={() => router.push("/dashboard")} className="gap-2">
          <ArrowLeftRight className="h-4 w-4" />
          Перейти в контекст компании
        </Button>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-6 grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-xl border bg-white p-3 h-fit space-y-3">
          {NAV_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.title} className="space-y-1">
                <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <GroupIcon className="h-4 w-4" />
                  {group.title}
                </div>
                <nav className="space-y-1">
                  {group.items.map((item) => {
                    const active = isItemActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "flex items-center rounded-lg px-3 py-2 text-sm",
                          active
                            ? "bg-purple-100 text-purple-900 font-medium"
                            : "text-slate-700 hover:bg-slate-100"
                        )}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </div>
            );
          })}
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
