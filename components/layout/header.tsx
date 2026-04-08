"use client";

import { Bell, User, Menu, LogOut, Settings as SettingsIcon, Shield } from "lucide-react";
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
import { useSidebar } from "@/lib/contexts/sidebar-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useRouter } from "next/navigation";

export function Header() {
  const { toggleSidebar } = useSidebar();
  const { user, profile, signOut } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-red-100 text-red-800 hover:bg-red-100';
      case 'agronomist':
        return 'bg-green-100 text-green-800 hover:bg-green-100';
      case 'specialist':
        return 'bg-blue-100 text-blue-800 hover:bg-blue-100';
      case 'warehouse':
        return 'bg-orange-100 text-orange-800 hover:bg-orange-100';
      default:
        return 'bg-slate-100 text-slate-800 hover:bg-slate-100';
    }
  };

  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-6">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        className="hover:bg-slate-100"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <div className="flex items-center gap-4">
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
                {profile && (
                  <Badge className={`w-fit mt-1 ${getRoleBadgeColor(profile.role)}`}>
                    <Shield className="h-3 w-3 mr-1" />
                    {profile.role}
                  </Badge>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push('/settings')}>
              <SettingsIcon className="h-4 w-4 mr-2" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-red-600">
              <LogOut className="h-4 w-4 mr-2" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
