"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, User, Menu, LogOut, Settings as SettingsIcon, Shield } from "lucide-react";
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

  useEffect(() => {
    const loadCompanies = async () => {
      if (!user?.id || !isGlobal) return;
      try {
        const response = await fetch(`/api/global-admin/companies?userId=${encodeURIComponent(user.id)}`);
        if (!response.ok) return;
        const data = await response.json();
        setCompanies(Array.isArray(data?.companies) ? data.companies : []);
      } catch (error) {
        console.error("Failed to load companies for global admin:", error);
      }
    };
    void loadCompanies();
  }, [user?.id, isGlobal]);

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
      case "admin":
        return "bg-rose-100 text-rose-800 hover:bg-rose-100";
      case "agronomist":
        return "bg-green-100 text-green-800 hover:bg-green-100";
      case "specialist":
        return "bg-blue-100 text-blue-800 hover:bg-blue-100";
      case "warehouse":
        return "bg-orange-100 text-orange-800 hover:bg-orange-100";
      case "weighman":
        return "bg-violet-100 text-violet-800 hover:bg-violet-100";
      default:
        return "bg-slate-100 text-slate-800 hover:bg-slate-100";
    }
  };

  const getRoleLabel = (role?: string | null) => {
    if (role === "global_admin") return "Глобальный администратор";
    if (role === "company_admin" || role === "admin") return "Администратор компании";
    if (role === "agronomist") return t("role_agronomist");
    if (role === "specialist") return t("role_specialist");
    if (role === "warehouse") return t("role_warehouse");
    if (role === "weighman") return t("role_weighman");
    return role || "-";
  };

  const handleSwitchCompany = async (companyId: string) => {
    if (!user?.id || !isGlobal) return;
    setSwitchingCompany(true);
    try {
      const response = await fetch("/api/global-admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, companyId: companyId === "__none__" ? null : companyId }),
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
    <header className="flex h-16 items-center justify-between border-b bg-white px-6">
      <Button variant="ghost" size="icon" onClick={toggleSidebar} className="hover:bg-slate-100">
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex items-center gap-4">
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
            {activeCompanyName ? <span className="text-xs text-slate-600 truncate max-w-[150px]">{activeCompanyName}</span> : null}
          </div>
        ) : null}

        <LanguageSwitcher />
        <Button variant="ghost" size="icon">
          <Bell className="h-5 w-5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <User className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.email}</p>
                {profile ? (
                  <Badge className={`w-fit mt-1 ${getRoleBadgeColor(profile.role)}`}>
                    <Shield className="h-3 w-3 mr-1" />
                    {getRoleLabel(profile.role)}
                  </Badge>
                ) : null}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <SettingsIcon className="h-4 w-4 mr-2" />
              {t("settings_menu")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-red-600">
              <LogOut className="h-4 w-4 mr-2" />
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
