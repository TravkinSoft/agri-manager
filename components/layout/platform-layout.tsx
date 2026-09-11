"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Brain,
  Building2,
  Sprout,
  FlaskConical,
  Tractor,
  Database,
  Settings,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import type { TranslationKey } from "@/lib/i18n/translations";
import { Button } from "@/components/ui/button";
import { TravkinLogo } from "@/components/layout/travkin-logo";
import {
  loadPlatformRuntimeStatus,
  type PlatformRuntimeStatus,
} from "@/lib/platform/platform-status-client";

type NavItem = {
  href: string;
  labelKey?: TranslationKey;
  label?: string;
  code?: string;
};

type NavGroup = {
  titleKey: TranslationKey;
  title?: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    titleKey: "platform",
    title: "Система",
    icon: Building2,
    items: [
      { href: "/platform", label: "Обзор", code: "SYS-00" },
      { href: "/platform#companies", labelKey: "companies", code: "CTL-01" },
      { href: "/platform/catalogs/counterparties", label: "Контрагенты", code: "CTL-02" },
    ],
  },
  {
    titleKey: "copilot",
    title: "Знания",
    icon: Brain,
    items: [
      { href: "/platform/knowledge/intake", label: "Проверка препаратов", code: "KNO-01" },
      { href: "/platform/assistant/settings", labelKey: "assistant_settings", code: "KNO-02" },
    ],
  },
  {
    titleKey: "agronomy",
    icon: Sprout,
    items: [
      { href: "/platform/catalogs/agronomy/crops", labelKey: "crops", code: "AGR-01" },
      { href: "/platform/catalogs/agronomy/varieties", labelKey: "varieties", code: "AGR-02" },
      { href: "/platform/catalogs/agronomy/seed-originators", labelKey: "seed_originators", code: "AGR-03" },
      { href: "/platform/catalogs/agronomy/seed-reproductions", labelKey: "seed_reproductions", code: "AGR-04" },
      { href: "/platform/catalogs/agronomy/seeds", labelKey: "seeds", code: "AGR-05" },
      { href: "/platform/catalogs/agronomy/diseases", labelKey: "diseases", code: "AGR-06" },
      { href: "/platform/catalogs/agronomy/pests", labelKey: "pests", code: "AGR-07" },
      { href: "/platform/catalogs/agronomy/weeds", labelKey: "weeds", code: "AGR-08" },
    ],
  },
  {
    titleKey: "agrochemistry",
    icon: FlaskConical,
    items: [
      { href: "/platform/catalogs/agrochemistry/pesticides", labelKey: "pesticides", code: "CHM-01" },
      { href: "/platform/catalogs/agrochemistry/fertilizers", labelKey: "fertilizers", code: "CHM-02" },
      { href: "/platform/catalogs/agrochemistry/pesticide-categories", labelKey: "pesticide_categories", code: "CHM-05" },
      { href: "/platform/catalogs/agrochemistry/active-ingredients", labelKey: "active_ingredients", code: "CHM-06" },
    ],
  },
  {
    titleKey: "machine_yard",
    title: "Техника",
    icon: Tractor,
    items: [
      { href: "/platform/catalogs/machine-yard/agricultural-machinery", labelKey: "agricultural_machinery", code: "MCH-01" },
      { href: "/platform/catalogs/machine-yard/implements", labelKey: "implements", code: "MCH-02" },
    ],
  },
  {
    titleKey: "fleet",
    icon: Database,
    items: [{ href: "/platform/catalogs/fleet", labelKey: "transport", code: "FLT-01" }],
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
  const [runtimeStatus, setRuntimeStatus] = useState<PlatformRuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!profile?.role) return;
    if (profile.role !== "global_admin") {
      router.replace("/dashboard");
    }
  }, [loading, profile?.role, router]);

  useEffect(() => {
    if (loading || profile?.role !== "global_admin") return;
    let active = true;
    void loadPlatformRuntimeStatus()
      .then((status) => {
        if (!active) return;
        setRuntimeStatus(status);
        setRuntimeError(false);
      })
      .catch(() => {
        if (!active) return;
        setRuntimeStatus(null);
        setRuntimeError(true);
      });
    return () => {
      active = false;
    };
  }, [loading, profile?.role]);

  if (loading || profile?.role !== "global_admin") {
    return (
      <main className="tf-manor grid min-h-screen place-items-center bg-background p-4" role="status" aria-live="polite">
        <div className="tf-estate-document w-full max-w-md p-6 text-sm text-muted-foreground">
          Проверяем доступ и открываем рабочий раздел…
        </div>
      </main>
    );
  }

  const environment = runtimeStatus?.runtime.environment || (runtimeError ? "error" : "loading");
  const branch = runtimeStatus?.runtime.branch || (runtimeError ? "unknown" : "loading");
  const database = runtimeStatus?.runtime.database || (runtimeError ? "unknown" : "loading");
  const season = runtimeStatus?.runtime.season || "2026";
  const selectedCompany = runtimeStatus?.companies.selected || null;

  return (
    <div className="travkin-shell tf-manor-shell min-h-screen">
      <header className="tf-manor-topbar border-b text-[var(--estate-shell-text)] shadow-[0_8px_28px_rgba(30,33,25,0.14)]">
        <div className="flex min-h-10 flex-col gap-2 px-3 py-2 text-[11px] sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <TravkinLogo size="mobile" />
            <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em]">
              ГЛОБАЛЬНАЯ КОНСОЛЬ
            </span>
            <span className="border border-[var(--estate-shell-line)] bg-white/5 px-2 py-0.5 font-mono uppercase text-[var(--estate-shell-muted)]">
              внутренний доступ администратора
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-[10px] uppercase text-[var(--estate-shell-muted)]">
            <span className="border border-slate-400/25 px-2 py-0.5">env:{environment}</span>
            <span className="border border-slate-400/25 px-2 py-0.5">db:{database}</span>
            <span className="border border-slate-400/25 px-2 py-0.5">branch:{branch}</span>
            <span className="border border-slate-400/25 px-2 py-0.5">role:global_admin</span>
            <span className="border border-slate-400/25 px-2 py-0.5">season:{season}</span>
            <span className="max-w-[240px] truncate border border-slate-400/25 px-2 py-0.5">route:{pathname}</span>
          </div>
        </div>
      </header>
      <div
        className={cn(
          "border-b px-4 py-1.5 font-mono text-[11px]",
          selectedCompany
            ? "border-emerald-800/30 bg-emerald-50 text-emerald-900"
            : "border-amber-700/30 bg-amber-50 text-amber-900"
        )}
        role="status"
      >
        {selectedCompany
          ? `Контекст компании: ${selectedCompany.name}`
          : "Компания не выбрана. Сначала выберите компанию на главной странице платформы."}
      </div>
      <div className="grid w-full grid-cols-1 gap-3 px-3 py-3 sm:px-4 lg:grid-cols-[268px_minmax(0,1fr)]">
        <aside className="tf-manor-panel h-fit max-h-[42vh] overflow-y-auto rounded-md lg:max-h-none lg:overflow-visible">
          <div className="border-b border-[color:var(--manor-line)] bg-[var(--manor-paper-recessed)] px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--manor-espresso)]">
            Дерево консоли
          </div>
          <div className="space-y-2 p-2">
          {NAV_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.titleKey} className="overflow-hidden rounded-md border border-[color:var(--manor-line)] bg-[var(--manor-paper-raised)]">
                <div className="flex items-center gap-2 border-b border-[color:var(--manor-line)] bg-[var(--manor-paper-recessed)] px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--manor-text-muted)]">
                  <GroupIcon className="h-3.5 w-3.5" />
                  {group.title || t(group.titleKey)}
                </div>
                <nav className="py-1">
                  {group.items.map((item) => {
                    const active = isItemActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "grid grid-cols-[58px_minmax(0,1fr)] items-center border-l-2 px-2 py-1 text-[12px] leading-5",
                          active
                            ? "border-primary bg-accent font-semibold text-foreground"
                            : "border-transparent text-foreground hover:bg-accent/55",
                        )}
                      >
                        <span className="font-mono text-[10px] text-[color:var(--manor-text-muted)]">{item.code || "NODE"}</span>
                        <span className="truncate">├ {item.labelKey ? t(item.labelKey) : item.label}</span>
                      </Link>
                    );
                  })}
                </nav>
              </div>
            );
          })}
          <div className="rounded-md border border-[color:var(--manor-line)] bg-[var(--manor-paper-recessed)] p-2 text-[11px] leading-5 text-[color:var(--manor-text-muted)]">
            <div className="flex items-center gap-1 font-mono font-semibold uppercase text-[color:var(--manor-espresso)]">
              <Settings className="h-3.5 w-3.5" />
              Системные заметки
            </div>
            <div className="mt-1 grid gap-0.5 font-mono">
              <span>Движок знаний: V0</span>
              <span>Паспорт продукта: V1</span>
              <span>RLS: draft ожидает</span>
              <span>Среда: {environment}</span>
              <span>База: {database}</span>
              <span>Ветка: {branch}</span>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => router.push("/dashboard")}
            className="tf-manor-control h-10 w-full justify-start gap-2 border-[color:var(--manor-line)] bg-[var(--manor-paper-raised)] px-2 text-[12px] text-[color:var(--manor-olive-deep)] hover:bg-[var(--manor-brass-soft)]"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            {t("enter_company_context")}
          </Button>
          </div>
        </aside>
        <main className="tf-manor-panel min-w-0 rounded-md p-3 sm:p-5">
          <div key={pathname} className="tf-estate-page-enter">{children}</div>
        </main>
      </div>
    </div>
  );
}
