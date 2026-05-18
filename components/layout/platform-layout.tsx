"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Brain,
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
    title: "Ассистент",
    icon: Brain,
    items: [{ href: "/platform/assistant/settings", label: "Настройки ассистента" }],
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
      { href: "/platform/catalogs/agrochemistry/growth-regulators", label: "Регуляторы роста" },
      { href: "/platform/catalogs/agrochemistry/pesticide-categories", label: "Категории пестицидов" },
      { href: "/platform/catalogs/agrochemistry/active-ingredients", label: "Действующие вещества" },
    ],
  },
  {
    title: "Машинный двор",
    icon: Tractor,
    items: [
      { href: "/platform/catalogs/machine-yard/agricultural-machinery", label: "Сельхозмашины (самоходные)" },
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
      <header className="flex h-16 items-center justify-between border-b bg-white px-6">
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
      <div className="grid w-full grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="h-fit space-y-3 rounded-xl border bg-white p-3">
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
                          active ? "bg-purple-100 font-medium text-purple-900" : "text-slate-700 hover:bg-slate-100",
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
