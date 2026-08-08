"use client";

import { useEffect, useMemo, useState } from "react";
import { LogOut, Menu, Settings as SettingsIcon, Shield, User } from "lucide-react";
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
  const { user, profile, signOut, setGlobalAdminCompanyContext } = useAuth();
  const { t } = useLanguage();
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
    const loadCompanies = async () => {
      if (!isGlobal) return;
      try {
        const headers = await buildAuthHeaders("none");
        const response = await fetch("/api/global-admin/companies", {
          method: "GET",
          headers,
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        setCompanies(Array.isArray(data?.companies) ? data.companies : []);
        setSelectedCompanyId(data?.selectedCompanyId ? String(data.selectedCompanyId) : "__none__");
      } catch (error) {
        console.error("Failed to load companies for global admin:", error);
      }
    };
    void loadCompanies();
  }, [isGlobal, profileContextCompanyId]);

  useEffect(() => {
    const loadCompanyUsers = async () => {
      if (!canUseUserSwitcher || !activeUserCompanyId) {
        setCompanyUsers([]);
        setCompanyUsersError(null);
        return;
      }

      setLoadingCompanyUsers(true);
      setCompanyUsersError(null);
      try {
        const headers = await buildAuthHeaders("none");
        const response = await fetch(
          `/api/global-admin/company-users?companyId=${encodeURIComponent(activeUserCompanyId)}`,
          {
            method: "GET",
            headers,
            cache: "no-store",
          }
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setCompanyUsers([]);
          setCompanyUsersError(payload?.error || "Не удалось загрузить пользователей компании");
          return;
        }
        const data = await response.json();
        setCompanyUsers(Array.isArray(data?.users) ? data.users : []);
        setCompanyUsersError(null);
      } catch (error) {
        console.error("Failed to load company users for header switcher:", error);
        setCompanyUsers([]);
        setCompanyUsersError(error instanceof Error ? error.message : "Не удалось загрузить пользователей компании");
      } finally {
        setLoadingCompanyUsers(false);
      }
    };

    void loadCompanyUsers();
  }, [canUseUserSwitcher, activeUserCompanyId]);

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "global_admin":
        return "bg-amber-200 text-amber-900 hover:bg-amber-200";
      case "company_admin":
        return "bg-sky-200 text-sky-900 hover:bg-sky-200";
      case "agronomist":
        return "bg-emerald-200 text-emerald-900 hover:bg-emerald-200";
      case "director":
        return "bg-cyan-200 text-cyan-900 hover:bg-cyan-200";
      case "specialist":
        return "bg-blue-200 text-blue-900 hover:bg-blue-200";
      case "warehouse":
      case "warehouse_operator":
        return "bg-orange-200 text-orange-900 hover:bg-orange-200";
      case "weighman":
        return "bg-violet-200 text-violet-900 hover:bg-violet-200";
      case "fuel_operator":
        return "bg-slate-300 text-slate-900 hover:bg-slate-300";
      default:
        return "bg-slate-200 text-slate-900 hover:bg-slate-200";
    }
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
      setSelectedCompanyId(nextCompanyId || "__none__");
      setGlobalAdminCompanyContext(nextCompanyId);
      if (nextValue === "__none__") {
        window.location.assign("/platform");
        return;
      }
      const currentPath = `${window.location.pathname}${window.location.search || ""}`;
      const nextPath = window.location.pathname.startsWith("/platform") ? "/dashboard" : currentPath;
      window.location.assign(nextPath);
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
        window.location.reload();
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
      window.location.reload();
    } catch (error) {
      console.error("User context switch failed:", error);
    } finally {
      setSwitchingUser(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#262D3D] bg-[#11151E]/95 px-3 backdrop-blur md:h-16 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        className="hidden text-[#F3F4F6] hover:bg-[#202738] hover:text-[#F3F4F6] md:inline-flex"
        aria-label={t("mobile_more")}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex min-w-0 flex-col gap-0.5 md:hidden">
        <TravkinLogo size="mobile" />
        <div className="max-w-[166px] truncate text-[10px] leading-none text-[#9CA3AF]">
          {activeCompanyName || (isGlobal ? t("platform_mode") : getRoleLabel(profile?.role))}
        </div>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2 md:gap-4">
        {isGlobal ? (
          <div className="hidden min-w-[340px] items-center gap-2 md:flex">
            <span className="text-xs font-medium text-[#9CA3AF]">
              {activeCompanyId ? t("company_context") : t("platform_mode")}
            </span>
            <Select value={selectedCompanyId} onValueChange={handleSwitchCompany} disabled={switchingCompany}>
              <SelectTrigger className="h-9 border-[#2C3446] bg-[#1A1F2B] text-[#F3F4F6]">
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
            {activeCompanyName ? <span className="max-w-[150px] truncate text-xs text-[#9CA3AF]">{activeCompanyName}</span> : null}
          </div>
        ) : null}

        {canUseUserSwitcher && activeUserCompanyId ? (
          <div className="hidden min-w-[280px] items-center gap-2 lg:flex">
            <span className="text-xs font-medium text-[#9CA3AF]">Вы как</span>
            <Select
              key={`${activeUserCompanyId}:${activeUserValue}`}
              value={activeUserValue}
              onValueChange={handleSwitchUser}
              disabled={switchingUser || loadingCompanyUsers}
            >
              <SelectTrigger className="h-9 border-[#2C3446] bg-[#1A1F2B] text-[#F3F4F6]">
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

        {profile ? (
          <Badge
            variant="outline"
            className="hidden h-8 max-w-[150px] items-center truncate border-[#384256] bg-[#171d29] px-2.5 text-xs font-medium text-[#CBD5E1] hover:bg-[#171d29] sm:inline-flex"
            title={user?.email || getRoleLabel(profile.role)}
          >
            {getRoleLabel(profile.role)}
          </Badge>
        ) : null}

        <LanguageSwitcher />
        {user ? <NotificationCenter userId={user.id} companyId={activeUserCompanyId} /> : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-[#F3F4F6] hover:bg-[#202738] hover:text-[#F3F4F6]"
              aria-label={t("profile_menu")}
              title={t("profile_menu")}
            >
              <User className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 border-[#2C3446] bg-[#1A1F2B] text-[#F3F4F6]">
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
            <DropdownMenuSeparator className="bg-[#2C3446]" />
            <DropdownMenuItem onClick={() => router.push("/settings")} className="cursor-pointer">
              <SettingsIcon className="mr-2 h-4 w-4" />
              {t("settings_menu")}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-[#2C3446]" />
            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-400 focus:text-red-300">
              <LogOut className="mr-2 h-4 w-4" />
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
