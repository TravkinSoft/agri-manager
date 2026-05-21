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
    if (contentType === "json") {
      headers["Content-Type"] = "application/json";
    }
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
        return "bg-purple-100 text-purple-800 hover:bg-purple-100";
      case "company_admin":
        return "bg-rose-100 text-rose-800 hover:bg-rose-100";
      case "agronomist":
        return "bg-green-100 text-green-800 hover:bg-green-100";
      case "director":
        return "bg-cyan-100 text-cyan-800 hover:bg-cyan-100";
      case "specialist":
        return "bg-blue-100 text-blue-800 hover:bg-blue-100";
      case "warehouse":
        return "bg-orange-100 text-orange-800 hover:bg-orange-100";
      case "weighman":
        return "bg-violet-100 text-violet-800 hover:bg-violet-100";
      case "fuel_operator":
        return "bg-sky-100 text-sky-800 hover:bg-sky-100";
      default:
        return "bg-slate-100 text-slate-800 hover:bg-slate-100";
    }
  };

  const getRoleLabel = (role?: string | null) => {
    if (role === "global_admin") return "Глобальный администратор";
    if (role === "company_admin") return "Администратор компании";
    if (role === "agronomist") return t("role_agronomist");
    if (role === "director") return "Директор";
    if (role === "specialist") return t("role_specialist");
    if (role === "warehouse") return t("role_warehouse");
    if (role === "weighman") return t("role_weighman");
    if (role === "fuel_operator") return "Оператор АЗС / ГСМ";
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
    <header className="flex h-14 items-center justify-between border-b bg-white px-3 md:h-16 md:px-6">
      <Button variant="ghost" size="icon" onClick={toggleSidebar} className="hidden hover:bg-slate-100 md:inline-flex">
        <Menu className="h-5 w-5" />
      </Button>

      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2 md:gap-4">
        {isGlobal ? (
          <div className="hidden min-w-[340px] items-center gap-2 md:flex">
            <span className="text-xs font-medium text-slate-500">
              {activeCompanyId ? "Вы в компании" : "Режим платформы"}
            </span>
            <Select value={activeCompanyId || "__none__"} onValueChange={handleSwitchCompany} disabled={switchingCompany}>
              <SelectTrigger className="h-9">
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
            {activeCompanyName ? <span className="max-w-[150px] truncate text-xs text-slate-600">{activeCompanyName}</span> : null}
          </div>
        ) : null}

        <LanguageSwitcher />
        <Button variant="ghost" size="icon" className="h-9 w-9">
          <Bell className="h-5 w-5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full">
              <User className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
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
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <SettingsIcon className="mr-2 h-4 w-4" />
              {t("settings_menu")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-red-600">
              <LogOut className="mr-2 h-4 w-4" />
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
