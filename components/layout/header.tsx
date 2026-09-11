"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, LogOut, Menu, RotateCcw, Settings as SettingsIcon, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSidebar } from "@/lib/contexts/sidebar-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { TravkinLogo } from "@/components/layout/travkin-logo";
import { useLanguage } from "@/lib/contexts/language-context";
import { isGlobalAdmin } from "@/lib/auth/roles";
import { supabase } from "@/lib/supabase/client";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { cachedClientValue, invalidateClientCache } from "@/lib/client/single-flight-cache";
import type { Language } from "@/lib/i18n/translations";
import { ProfileAvatar } from "@/components/profile/profile-avatar";

const MOBILE_LANGUAGES: Array<{ code: Language; label: string }> = [
  { code: "ru", label: "RU — Русский" },
  { code: "en", label: "EN — English" },
  { code: "kz", label: "KZ — Қазақша" },
];

type CompanyContextItem = {
  id: string;
  name: string;
};

type CompanyUserContextItem = {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
};

export function Header() {
  const { toggleSidebar } = useSidebar();
  const { user, profile, signOut, setGlobalAdminCompanyContext, refreshProfile } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyContextItem[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUserContextItem[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("__none__");
  const [switchingCompany, setSwitchingCompany] = useState(false);
  const [switchingUser, setSwitchingUser] = useState(false);
  const [loadingCompanyUsers, setLoadingCompanyUsers] = useState(false);
  const [companyUsersError, setCompanyUsersError] = useState<string | null>(null);

  const isGlobal = isGlobalAdmin(profile?.role);
  const isImpersonating = Boolean(profile?.is_impersonating);
  const canUseUserSwitcher = isGlobal || isImpersonating;
  const profileContextCompanyId = profile?.context_company_id || null;
  const activeCompanyId = isGlobal && selectedCompanyId !== "__none__" ? selectedCompanyId : null;
  const activeUserCompanyId =
    isImpersonating
      ? profile?.impersonated_company_id || profile?.company_id || null
      : isGlobal
        ? activeCompanyId
        : profile?.company_id || null;
  const activeCompanyName = useMemo(
    () => companies.find((item) => item.id === activeCompanyId)?.name || null,
    [companies, activeCompanyId]
  );
  const activeUserValue = isImpersonating && profile?.id ? profile.id : "__admin__";

  const buildAuthHeaders = async (contentType: "json" | "none" = "none") => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session?.access_token) {
      throw new Error("Session expired");
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${data.session.access_token}`,
    };
    if (contentType === "json") headers["Content-Type"] = "application/json";
    return headers;
  };

  useEffect(() => {
    setSelectedCompanyId(profileContextCompanyId || "__none__");
  }, [profileContextCompanyId]);

  useEffect(() => {
    let cancelled = false;
    const loadCompanies = async () => {
      if (!isGlobal) return;
      try {
        const data = await cachedClientValue(
          `header:companies:${user?.id || "anonymous"}`,
          async () => {
            const headers = await buildAuthHeaders("none");
            const response = await fetch("/api/global-admin/companies", {
              method: "GET",
              headers,
              cache: "no-store",
            });
            if (!response.ok) throw new Error(`Companies HTTP ${response.status}`);
            return response.json();
          },
          5 * 60_000
        );
        if (cancelled) return;
        setCompanies(Array.isArray(data?.companies) ? data.companies : []);
        setSelectedCompanyId(data?.selectedCompanyId ? String(data.selectedCompanyId) : "__none__");
      } catch (error) {
        console.error("Failed to load companies for global admin:", error);
      }
    };
    void loadCompanies();
    return () => { cancelled = true; };
  }, [isGlobal, profileContextCompanyId, user?.id]);

  useEffect(() => {
    let cancelled = false;
    const loadCompanyUsers = async () => {
      if (!canUseUserSwitcher || !activeUserCompanyId) {
        setCompanyUsers([]);
        setCompanyUsersError(null);
        return;
      }

      setLoadingCompanyUsers(true);
      setCompanyUsersError(null);
      try {
        const data = await cachedClientValue(
          `header:company-users:${activeUserCompanyId}`,
          async () => {
            const headers = await buildAuthHeaders("none");
            const response = await fetch(
              `/api/global-admin/company-users?companyId=${encodeURIComponent(activeUserCompanyId)}`,
              { method: "GET", headers, cache: "no-store" }
            );
            if (!response.ok) {
              const payload = await response.json().catch(() => ({}));
              throw new Error(payload?.error || "Не удалось загрузить пользователей компании");
            }
            return response.json();
          },
          2 * 60_000
        );
        if (cancelled) return;
        setCompanyUsers(Array.isArray(data?.users) ? data.users : []);
        setCompanyUsersError(null);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load company users for header switcher:", error);
        setCompanyUsers([]);
        setCompanyUsersError(error instanceof Error ? error.message : "Не удалось загрузить пользователей компании");
      } finally {
        if (!cancelled) setLoadingCompanyUsers(false);
      }
    };

    void loadCompanyUsers();
    return () => { cancelled = true; };
  }, [canUseUserSwitcher, activeUserCompanyId]);

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    void role;
    return "border border-border bg-accent text-foreground hover:bg-accent";
  };

  const getRoleLabel = (role?: string | null) => {
    if (role === "global_admin") return t("role_global_admin");
    if (role === "company_admin") return t("role_company_admin");
    if (role === "agronomist") return t("role_agronomist");
    if (role === "director") return t("role_director");
    if (role === "specialist") return t("role_specialist");
    if (role === "warehouse") return t("role_warehouse");
    if (role === "warehouse_operator") return t("role_warehouse_operator");
    if (role === "weighman") return t("role_weighman");
    if (role === "fuel_operator") return t("role_fuel_operator");
    if (role === "brigadier") return t("role_brigadier");
    if (role === "legal_operator") return t("role_legal_operator");
    if (role === "fleet_manager") return t("role_fleet_manager");
    return role || "-";
  };

  const handleSwitchCompany = async (companyId: string) => {
    if (!user?.id || !isGlobal || switchingCompany) return;
    const nextValue = companyId || "__none__";
    if (nextValue === selectedCompanyId) return;
    const previousValue = selectedCompanyId;
    setSelectedCompanyId(nextValue);
    setCompanyUsers([]);
    setCompanyUsersError(null);
    setSwitchingCompany(true);
    try {
      const headers = await buildAuthHeaders("json");
      const response = await fetch("/api/global-admin/companies", {
        method: "POST",
        headers,
        body: JSON.stringify({ companyId: nextValue === "__none__" ? null : nextValue }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to switch company context");
      }
      const payload = await response.json().catch(() => ({}));
      const nextCompanyId = payload?.selectedCompanyId ? String(payload.selectedCompanyId) : null;
      invalidateClientCache("header:");
      setSelectedCompanyId(nextCompanyId || "__none__");
      setGlobalAdminCompanyContext(nextCompanyId);
      if (nextValue === "__none__") {
        router.replace("/platform");
        return;
      }
      const currentPath = `${window.location.pathname}${window.location.search || ""}`;
      const nextPath = window.location.pathname.startsWith("/platform") ? "/dashboard" : currentPath;
      router.replace(nextPath);
    } catch (error) {
      console.error("Company context switch failed:", error);
      setSelectedCompanyId(previousValue);
    } finally {
      setSwitchingCompany(false);
    }
  };

  const handleSwitchUser = async (profileId: string) => {
    if (!user?.id || !canUseUserSwitcher || switchingUser) return;
    if (profileId.startsWith("__") && profileId !== "__admin__") return;
    if (profileId === activeUserValue && profileId !== "__admin__") return;

    setSwitchingUser(true);
    try {
      const headers = await buildAuthHeaders("json");

      if (profileId === "__admin__") {
        if (!isImpersonating) return;
        const response = await fetch("/api/global-admin/impersonation", {
          method: "DELETE",
          headers,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || "Failed to return to global admin");
        }
        await refreshProfile();
        router.replace("/platform");
        return;
      }

      const response = await fetch("/api/global-admin/impersonation", {
        method: "POST",
        headers,
        body: JSON.stringify({ targetProfileId: profileId, reason: "Header company user switcher" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to switch user context");
      }
      await refreshProfile();
      router.replace("/dashboard");
    } catch (error) {
      console.error("User context switch failed:", error);
    } finally {
      setSwitchingUser(false);
    }
  };

  return (
    <header className="tf-manor-topbar tf-manor-header sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between border-b pb-0 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] shadow-manor-sm md:h-[calc(4rem+env(safe-area-inset-top))] md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))]">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        className="tf-manor-control tf-desktop-sidebar-toggle hidden text-[var(--estate-shell-text)] hover:bg-white/10 hover:text-white md:inline-flex"
        aria-label={t("mobile_more")}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="tf-mobile-header-brand flex min-w-0 flex-col gap-0.5 md:hidden">
        <TravkinLogo size="mobile" />
        <div className="max-w-[166px] truncate text-[10px] leading-none text-[var(--estate-shell-muted)]">
          {activeCompanyName || (isGlobal ? t("platform_mode") : getRoleLabel(profile?.role))}
        </div>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2 md:gap-4">
        {isGlobal ? (
          <div className="hidden min-w-[340px] items-center gap-2 md:flex">
            <span className="text-xs font-medium text-[var(--estate-shell-muted)]">
              {activeCompanyId ? t("company_context") : t("platform_mode")}
            </span>
            <Select value={selectedCompanyId} onValueChange={handleSwitchCompany} disabled={switchingCompany}>
              <SelectTrigger className="tf-manor-control h-9 border-[color:var(--estate-shell-line)] bg-[var(--manor-espresso-soft)] text-[var(--estate-shell-text)] focus:ring-[var(--manor-brass-soft)]">
                <SelectValue placeholder={t("select_company")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("return_to_platform")}</SelectItem>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {canUseUserSwitcher && activeUserCompanyId ? (
          <div className="hidden min-w-[280px] items-center gap-2 lg:flex">
            <span className="text-xs font-medium text-[var(--estate-shell-muted)]">Вы как</span>
            <Select
              key={`${activeUserCompanyId}:${activeUserValue}`}
              value={activeUserValue}
              onValueChange={handleSwitchUser}
              disabled={switchingUser || loadingCompanyUsers}
            >
              <SelectTrigger className="tf-manor-control h-9 border-[color:var(--estate-shell-line)] bg-[var(--manor-espresso-soft)] text-[var(--estate-shell-text)] focus:ring-[var(--manor-brass-soft)]">
                <SelectValue placeholder="Выберите пользователя" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__admin__">
                  {isImpersonating ? "Вернуться к Global Admin" : "Global Admin"}
                </SelectItem>
                {loadingCompanyUsers ? (
                  <SelectItem value="__loading_users__" disabled>
                    Загрузка пользователей...
                  </SelectItem>
                ) : null}
                {!loadingCompanyUsers && companyUsersError ? (
                  <SelectItem value="__company_users_error__" disabled>
                    Пользователи не загрузились
                  </SelectItem>
                ) : null}
                {!loadingCompanyUsers && !companyUsersError && companyUsers.length === 0 ? (
                  <SelectItem value="__company_users_empty__" disabled>
                    В компании нет активных пользователей
                  </SelectItem>
                ) : null}
                {companyUsers.map((companyUser) => (
                  <SelectItem key={companyUser.id} value={companyUser.id}>
                    {companyUser.name || companyUser.email || companyUser.id}
                    {companyUser.role ? ` · ${getRoleLabel(companyUser.role)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {isImpersonating ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="tf-manor-control h-9 max-w-[210px] shrink-0 border-[color:var(--estate-shell-line)] bg-white/5 px-2 text-[var(--estate-shell-text)] hover:bg-white/10 hover:text-white"
            onClick={() => void handleSwitchUser("__admin__")}
            disabled={switchingUser}
            aria-label={`${t("impersonation_as")} ${profile?.full_name || profile?.email || profile?.id}. ${t("return_to_global_admin")}`}
            title={t("return_to_global_admin")}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="ml-1.5 hidden truncate md:inline">
              {switchingUser ? t("returning") : profile?.full_name || profile?.email || t("return_to_global_admin")}
            </span>
          </Button>
        ) : null}

        {profile ? (
          <Badge
            variant="outline"
            className="hidden h-8 max-w-[150px] items-center truncate border-[color:var(--manor-line)]/35 bg-[var(--manor-espresso-soft)] px-2.5 text-xs font-medium text-[#E8DCC9] hover:bg-[var(--manor-espresso)] sm:inline-flex"
            title={user?.email || getRoleLabel(profile.role)}
          >
            {getRoleLabel(profile.role)}
          </Badge>
        ) : null}

        <div className="hidden md:block">
          {profile?.role !== "fleet_manager" ? <LanguageSwitcher /> : null}
        </div>
        {user ? (
          <NotificationCenter userId={user.id} companyId={activeUserCompanyId} role={profile?.role} />
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="tf-manor-control h-9 w-9 rounded-full p-0 text-[var(--estate-shell-text)] hover:bg-white/10 hover:text-white"
              aria-label={t("profile_menu")}
              title={t("profile_menu")}
            >
              <ProfileAvatar
                profileId={profile?.id}
                fullName={profile?.full_name}
                email={profile?.email || user?.email}
                version={profile?.avatar_updated_at}
                className="h-7 w-7"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[min(78dvh,38rem)] w-64 overflow-y-auto border-[color:var(--manor-line)] bg-[var(--manor-paper-raised)] text-[color:var(--manor-walnut)] shadow-manor-md">
            {isGlobal ? (
              <>
                <DropdownMenuLabel className="md:hidden">Компания</DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={switchingCompany}
                  onSelect={() => void handleSwitchCompany("__none__")}
                  className="min-h-[48px] cursor-pointer justify-between md:hidden"
                >
                  <span>Глобальная платформа</span>
                  {selectedCompanyId === "__none__" ? <Check aria-hidden className="h-4 w-4" /> : null}
                </DropdownMenuItem>
                {companies.map((company) => (
                  <DropdownMenuItem
                    key={`mobile-company-${company.id}`}
                    disabled={switchingCompany}
                    onSelect={() => void handleSwitchCompany(company.id)}
                    className="min-h-[48px] cursor-pointer justify-between md:hidden"
                  >
                    <span className="truncate">{company.name}</span>
                    {selectedCompanyId === company.id ? <Check aria-hidden className="h-4 w-4" /> : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator className="bg-[var(--manor-line)] md:hidden" />
              </>
            ) : null}
            {canUseUserSwitcher && activeUserCompanyId ? (
              <>
                <DropdownMenuLabel className="lg:hidden">Работать как</DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={switchingUser}
                  onSelect={() => void handleSwitchUser("__admin__")}
                  className="min-h-[48px] cursor-pointer justify-between lg:hidden"
                >
                  <span>Global Admin</span>
                  {activeUserValue === "__admin__" ? <Check aria-hidden className="h-4 w-4" /> : null}
                </DropdownMenuItem>
                {companyUsers.map((companyUser) => (
                  <DropdownMenuItem
                    key={`mobile-user-${companyUser.id}`}
                    disabled={switchingUser}
                    onSelect={() => void handleSwitchUser(companyUser.id)}
                    className="min-h-[48px] cursor-pointer justify-between lg:hidden"
                  >
                    <span className="truncate">{companyUser.name || companyUser.email || companyUser.id}</span>
                    {activeUserValue === companyUser.id ? <Check aria-hidden className="h-4 w-4" /> : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator className="bg-[var(--manor-line)] lg:hidden" />
              </>
            ) : null}
            <DropdownMenuLabel className="md:hidden">Язык</DropdownMenuLabel>
            {profile?.role !== "fleet_manager" && MOBILE_LANGUAGES.map((item) => (
              <DropdownMenuItem
                key={item.code}
                onClick={() => setLanguage(item.code)}
                className="min-h-[48px] cursor-pointer justify-between md:hidden"
              >
                <span>{item.label}</span>
                {language === item.code ? <Check aria-hidden className="h-4 w-4" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="bg-[var(--manor-line)] md:hidden" />
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.email}</p>
                {profile ? (
                  <Badge className={`mt-1 w-fit ${getRoleBadgeColor(profile.role)}`}>
                    <Shield className="mr-1 h-3 w-3" />
                    {getRoleLabel(profile.role)}
                  </Badge>
                ) : null}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-[var(--manor-line)]" />
            {profile?.role !== "fleet_manager" ? <DropdownMenuItem onClick={() => router.push("/settings")} className="cursor-pointer">
              <SettingsIcon className="mr-2 h-4 w-4" />
              {t("settings_menu")}
            </DropdownMenuItem> : null}
            <DropdownMenuSeparator className="bg-[var(--manor-line)]" />
            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-700 focus:bg-red-50 focus:text-red-800">
              <LogOut className="mr-2 h-4 w-4" />
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
