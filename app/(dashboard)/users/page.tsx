"use client";

import { useEffect, useState } from "react";
import { Clock, Shield, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/contexts/language-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { supabase } from "@/lib/supabase/client";

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

const INVITE_ROLES = [
  "agronomist",
  "director",
  "legal_operator",
  "specialist",
  "warehouse",
  "warehouse_operator",
  "weighman",
  "fuel_operator",
  "brigadier",
] as const;

const ROLE_BADGE_CLASS: Record<string, string> = {
  global_admin: "bg-purple-100 text-purple-800",
  company_admin: "bg-rose-100 text-rose-800",
  agronomist: "bg-green-100 text-green-800",
  director: "bg-indigo-100 text-indigo-800",
  legal_operator: "bg-amber-100 text-amber-800",
  specialist: "bg-blue-100 text-blue-800",
  warehouse: "bg-orange-100 text-orange-800",
  warehouse_operator: "bg-orange-100 text-orange-800",
  weighman: "bg-violet-100 text-violet-800",
  fuel_operator: "bg-cyan-100 text-cyan-800",
  brigadier: "bg-emerald-100 text-emerald-800",
};

export default function UsersPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteFullName, setInviteFullName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<(typeof INVITE_ROLES)[number]>("agronomist");
  const [inviting, setInviting] = useState(false);
  const [impersonatingProfileId, setImpersonatingProfileId] = useState<string | null>(null);

  const t = (ru: string, kz: string, en: string) =>
    language === "ru" ? ru : language === "kz" ? kz : en;

  const roleLabel = (role: string) => {
    if (role === "global_admin") return t("Глобальный администратор", "Жаһанды әкімші", "Global admin");
    if (role === "company_admin") return t("Администратор компании", "Компания әкімшісі", "Company admin");
    if (role === "agronomist") return t("Агроном", "Агроном", "Agronomist");
    if (role === "director") return t("Директор", "Директор", "Director");
    if (role === "legal_operator") return t("Юрист / бухгалтер", "Заң мен бухгалтер", "Legal operator");
    if (role === "specialist") return t("Специалист", "Маман", "Specialist");
    if (role === "warehouse") return t("Склад", "Қойма", "Warehouse");
    if (role === "warehouse_operator") return t("Оператор склада", "Қойма операторы", "Warehouse operator");
    if (role === "weighman") return t("Весовщик", "Таразышы", "Weighman");
    if (role === "fuel_operator") return t("Оператор ГСМ", "Жанармай операторы", "Fuel operator");
    if (role === "brigadier") return t("Бригадир", "Бригадир", "Brigadier");
    return role;
  };

  const isAdmin = profile?.role === "company_admin" || profile?.role === "global_admin";
  const isGlobalAdmin = profile?.role === "global_admin";

  const loadProfiles = async () => {
    if (!profile?.company_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,email,role,status,created_at")
        .eq("company_id", profile.company_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setProfiles((data || []) as ProfileRow[]);
    } catch (error) {
      console.error("Failed to load users:", error);
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProfiles();
  }, [profile?.company_id]);

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteFullName.trim() || !profile?.company_id) return;
    setInviting(true);
    try {
      const response = await fetch("/api/invite-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor_user_id: profile.id,
          full_name: inviteFullName.trim(),
          email: inviteEmail.trim(),
          role: inviteRole,
          company_id: profile.company_id,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);

      toast({
        title: t("Приглашение отправлено", "Шақыру жіберілді", "Invitation sent"),
        description: t(`Ссылка отправлена на ${inviteEmail.trim()}`, `${inviteEmail.trim()} мекенжайына жіберілді`, `Sent to ${inviteEmail.trim()}`),
      });
      setInviteDialogOpen(false);
      setInviteFullName("");
      setInviteEmail("");
      setInviteRole("agronomist");
      await loadProfiles();
    } catch (error: any) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error?.message || t("Не удалось отправить приглашение", "Шақыру жіберілмеді", "Failed to send invite"),
        variant: "destructive",
      });
    } finally {
      setInviting(false);
    }
  };

  const handleImpersonate = async (targetProfileId: string) => {
    setImpersonatingProfileId(targetProfileId);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token) throw new Error("Session expired");
      const response = await fetch("/api/global-admin/impersonation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({
          targetProfileId,
          reason: "Global admin switched from users page",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      window.location.href = "/dashboard";
    } catch (error: any) {
      setImpersonatingProfileId(null);
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error?.message || t("Не удалось запустить impersonation", "Impersonation басталмады", "Failed to start impersonation"),
        variant: "destructive",
      });
    }
  };

  if (!isAdmin) {
    return (
      <div>
        <PageHeader
          title={t("Пользователи", "Пайдаланушылар", "Users")}
          description={t("Управление командой и доступами", "Команда мен рұқсаттарды басқару", "Manage team and permissions")}
        />
        <Alert variant="destructive">
          <AlertDescription>
            {t("Доступ запрещен. Раздел только для администраторов.", "Қолжетім жоқ. Бұл бөлім тек әкімшілерге.", "Access denied. Admins only.")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("Пользователи", "Пайдаланушылар", "Users")}
        description={t("Управление командой и доступами", "Команда мен рұқсаттарды басқару", "Manage team and permissions")}
      >
        <Button onClick={() => setInviteDialogOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          {t("Пригласить", "Шақыру", "Invite")}
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ФИО", "Аты-жөні", "Full name")}</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>{t("Роль", "Рөлі", "Role")}</TableHead>
                <TableHead>{t("Статус", "Күй", "Status")}</TableHead>
                <TableHead>{t("Создан", "Құрылған", "Created")}</TableHead>
                {isGlobalAdmin ? <TableHead>{t("Impersonation", "Impersonation", "Impersonation")}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={isGlobalAdmin ? 6 : 5} className="text-center text-slate-500">
                    {t("Загрузка...", "Жүктелуде...", "Loading...")}
                  </TableCell>
                </TableRow>
              ) : profiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isGlobalAdmin ? 6 : 5} className="text-center text-slate-500">
                    {t("Пользователи не найдены.", "Пайдаланушылар табылмады.", "No users found.")}
                  </TableCell>
                </TableRow>
              ) : (
                profiles.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.full_name || row.email}</TableCell>
                    <TableCell>{row.email}</TableCell>
                    <TableCell>
                      <Badge className={ROLE_BADGE_CLASS[row.role] || "bg-slate-100 text-slate-800"}>
                        <Shield className="mr-1 h-3 w-3" />
                        {roleLabel(row.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.status === "active" ? (
                        <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">Active</Badge>
                      ) : (
                        <Badge className="border-amber-200 bg-amber-100 text-amber-800">
                          <Clock className="mr-1 h-3 w-3" />
                          Pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{new Date(row.created_at).toLocaleDateString()}</TableCell>
                    {isGlobalAdmin ? (
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleImpersonate(row.id)}
                          disabled={row.id === profile.id || row.role === "global_admin" || impersonatingProfileId === row.id}
                        >
                          {impersonatingProfileId === row.id ? "Входим..." : "Войти как"}
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Пригласить пользователя", "Пайдаланушыны шақыру", "Invite user")}</DialogTitle>
            <DialogDescription>
              {t("Укажите ФИО, email и роль.", "Аты-жөні, email және рөлін көрсетіңіз.", "Provide full name, email and role.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-full-name">{t("ФИО", "Аты-жөні", "Full name")}</Label>
              <Input
                id="invite-full-name"
                value={inviteFullName}
                onChange={(event) => setInviteFullName(event.target.value)}
                disabled={inviting}
                placeholder={t("Иванов Иван", "Иванов Иван", "John Smith")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                disabled={inviting}
                placeholder="user@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">{t("Роль", "Рөлі", "Role")}</Label>
              <Select
                value={inviteRole}
                onValueChange={(value) => setInviteRole(value as (typeof INVITE_ROLES)[number])}
                disabled={inviting}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITE_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {roleLabel(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)} disabled={inviting}>
              {t("Отмена", "Болдырмау", "Cancel")}
            </Button>
            <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim() || !inviteFullName.trim()}>
              {inviting ? t("Отправка...", "Жіберілуде...", "Sending...") : t("Отправить приглашение", "Шақыру жіберу", "Send invite")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
