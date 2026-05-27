"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, LogOut, Menu, Settings as SettingsIcon, Shield, User } from "lucide-react";
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
import { useLanguage } from "@/lib/contexts/language-context";
import { isGlobalAdmin } from "@/lib/auth/roles";
import { supabase } from "@/lib/supabase/client";

type CompanyContextItem = {
  id: string;
  name: string;
};

export function Header() {
  const { toggleSidebar } = useSidebar();
  const { user, profile, signOut } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyContextItem[]>([]);
  const [switchingCompany, setSwitchingCompany] = useState(false);

  const isGlobal = isGlobalAdmin(profile?.role);
  const activeCompanyId = profile?.context_company_id || null;
  const activeCompanyName = useMemo(
    () => companies.find((item) => item.id === activeCompanyId)?.name || null,
    [companies, activeCompanyId]
  );

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
      } catch (error) {
        console.error("Failed to load companies for global admin:", error);
      }
    };
    void loadCompanies();
  }, [isGlobal, profile?.context_company_id]);

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
    if (role === "global_admin") return "Глобальный администратор";
    if (role === "company_admin") return "Администратор компании";
    if (role === "agronomist") return t("role_agronomist");
    if (role === "director") return "Директор";
    if (role === "specialist") return t("role_specialist");
    if (role === "warehouse") return t("role_warehouse");
    if (role === "warehouse_operator") return "Складской оператор";
    if (role === "weighman") return t("role_weighman");
    if (role === "fuel_operator") return "Оператор АЗС / ГСМ";
    if (role === "brigadier") return "Бригадир";
    if (role === "legal_operator") return "Юрист / бухгалтер";
    return role || "-";
  };

  const handleSwitchCompany = async (companyId: string) => {
    if (!user?.id || !isGlobal) return;
    setSwitchingCompany(true);
    try {
      const headers = await buildAuthHeaders("json");
      const response = await fetch("/api/global-admin/companies", {
        method: "POST",
        headers,
        body: JSON.stringify({ companyId: companyId === "__none__" ? null : companyId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to switch company context");
      }
      window.location.href = companyId === "__none__" ? "/platform" : "/dashboard";
    } catch (error) {
      console.error("Company context switch failed:", error);
    } finally {
      setSwitchingCompany(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#262D3D] bg-[#11151E]/95 px-3 backdrop-blur md:h-16 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        className="hidden text-[#F3F4F6] hover:bg-[#202738] hover:text-[#F3F4F6] md:inline-flex"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2 md:gap-4">
        {isGlobal ? (
          <div className="hidden min-w-[340px] items-center gap-2 md:flex">
            <span className="text-xs font-medium text-[#9CA3AF]">
              {activeCompanyId ? "Вы в компании" : "Режим платформы"}
            </span>
            <Select value={activeCompanyId || "__none__"} onValueChange={handleSwitchCompany} disabled={switchingCompany}>
              <SelectTrigger className="h-9 border-[#2C3446] bg-[#1A1F2B] text-[#F3F4F6]">
                <SelectValue placeholder="Выберите компанию" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Вернуться в платформу</SelectItem>
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

        <LanguageSwitcher />
        <Button variant="ghost" size="icon" className="h-9 w-9 text-[#F3F4F6] hover:bg-[#202738] hover:text-[#F3F4F6]">
          <Bell className="h-5 w-5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-[#F3F4F6] hover:bg-[#202738] hover:text-[#F3F4F6]"
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
