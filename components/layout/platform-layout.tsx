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
import { useLanguage } from "@/lib/contexts/language-context";
import type { TranslationKey } from "@/lib/i18n/translations";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type NavItem = {
  href: string;
  labelKey: TranslationKey;
};

type NavGroup = {
  titleKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    titleKey: "platform",
    icon: Building2,
    items: [{ href: "/platform", labelKey: "companies" }],
  },
  {
    titleKey: "copilot",
    icon: Brain,
    items: [{ href: "/platform/assistant/settings", labelKey: "assistant_settings" }],
  },
  {
    titleKey: "agronomy",
    icon: Sprout,
    items: [
      { href: "/platform/catalogs/agronomy/crops", labelKey: "crops" },
      { href: "/platform/catalogs/agronomy/varieties", labelKey: "varieties" },
      { href: "/platform/catalogs/agronomy/seed-reproductions", labelKey: "seed_reproductions" },
    ],
  },
  {
    titleKey: "agrochemistry",
    icon: FlaskConical,
    items: [
      { href: "/platform/catalogs/agrochemistry/pesticides", labelKey: "pesticides" },
      { href: "/platform/catalogs/agrochemistry/fertilizers", labelKey: "fertilizers" },
      { href: "/platform/catalogs/agrochemistry/growth-regulators", labelKey: "growth_regulators" },
      { href: "/platform/catalogs/agrochemistry/pesticide-categories", labelKey: "pesticide_categories" },
      { href: "/platform/catalogs/agrochemistry/active-ingredients", labelKey: "active_ingredients" },
    ],
  },
  {
    titleKey: "machine_yard",
    icon: Tractor,
    items: [
      { href: "/platform/catalogs/machine-yard/agricultural-machinery", labelKey: "agricultural_machinery" },
      { href: "/platform/catalogs/machine-yard/implements", labelKey: "implements" },
    ],
  },
  {
    titleKey: "fleet",
    icon: Truck,
    items: [{ href: "/platform/catalogs/fleet", labelKey: "transport" }],
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
  const { t } = useLanguage();

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
      <header className="flex min-h-16 flex-col items-stretch justify-between gap-3 border-b bg-white px-3 py-3 sm:flex-row sm:items-center sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Shield className="h-5 w-5 text-purple-700" />
          <span className="font-semibold text-slate-900">{t("platform_agri_manager")}</span>
          <Badge className="bg-purple-100 text-purple-800">{t("role_global_admin")}</Badge>
        </div>
        <Button variant="outline" onClick={() => router.push("/dashboard")} className="w-full gap-2 sm:w-auto">
          <ArrowLeftRight className="h-4 w-4" />
          {t("enter_company_context")}
        </Button>
      </header>
      <div className="grid w-full grid-cols-1 gap-4 px-3 py-4 sm:px-6 sm:py-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="h-fit space-y-3 rounded-xl border bg-white p-3">
          {NAV_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.titleKey} className="space-y-1">
                <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <GroupIcon className="h-4 w-4" />
                  {t(group.titleKey)}
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
                        {t(item.labelKey)}
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
