"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CheckCircle2,
  Clock,
  Copy,
  Link as LinkIcon,
  Mail,
  RotateCw,
  Shield,
  UserPlus,
  UserX,
} from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/contexts/language-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { supabase } from "@/lib/supabase/client";
import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  status: string | null;
  created_at: string;
  updated_at: string | null;
}

type UserAction = "revoke_invite" | "deactivate_user" | "reactivate_user";

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
  "mechanic_operator",
  "vegetable_brigadier",
] as const;

const ROLE_BADGE_CLASS: Record<string, string> = {
  global_admin: "bg-purple-100 text-purple-800 border-purple-200",
  company_admin: "bg-rose-100 text-rose-800 border-rose-200",
  agronomist: "bg-green-100 text-green-800 border-green-200",
  director: "bg-indigo-100 text-indigo-800 border-indigo-200",
  legal_operator: "bg-amber-100 text-amber-800 border-amber-200",
  specialist: "bg-blue-100 text-blue-800 border-blue-200",
  warehouse: "bg-orange-100 text-orange-800 border-orange-200",
  warehouse_operator: "bg-orange-100 text-orange-800 border-orange-200",
  weighman: "bg-violet-100 text-violet-800 border-violet-200",
  fuel_operator: "bg-cyan-100 text-cyan-800 border-cyan-200",
  brigadier: "bg-emerald-100 text-emerald-800 border-emerald-200",
  mechanic_operator: "bg-green-100 text-green-800 border-green-200",
  vegetable_brigadier: "bg-amber-100 text-amber-800 border-amber-200",
};

function normalizeStatus(status: string | null | undefined) {
  return String(status || "active").trim().toLowerCase();
}

export default function UsersPage() {
  const { profile, refreshProfile } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { language } = useLanguage();

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const profilesGeneration = useRef(0);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteFullName, setInviteFullName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<(typeof INVITE_ROLES)[number]>("agronomist");
  const [inviting, setInviting] = useState(false);
  const [invitePerson, setInvitePerson] = useState("");
  const [invitePeople, setInvitePeople] = useState<Array<{ id: string; full_name: string }>>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const trafficInvite = inviteRole === "mechanic_operator" || inviteRole === "vegetable_brigadier";
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [impersonatingProfileId, setImpersonatingProfileId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ row: ProfileRow; action: UserAction } | null>(null);
  const [setupLink, setSetupLink] = useState("");
  const [setupLinkDialogOpen, setSetupLinkDialogOpen] = useState(false);

  const t = (ru: string, kz: string, en: string) =>
    language === "ru" ? ru : language === "kz" ? kz : en;

  const roleLabel = (role: string) => {
    if (role === "global_admin") return t("Глобальный администратор", "Жаһандық әкімші", "Global admin");
    if (role === "company_admin") return t("Администратор компании", "Компания әкімшісі", "Company admin");
    if (role === "agronomist") return t("Агроном", "Агроном", "Agronomist");
    if (role === "director") return t("Директор", "Директор", "Director");
    if (role === "legal_operator") return t("Юрист / бухгалтер", "Заң және бухгалтер", "Legal operator");
    if (role === "specialist") return t("Специалист", "Маман", "Specialist");
    if (role === "warehouse") return t("Склад", "Қойма", "Warehouse");
    if (role === "warehouse_operator") return t("Оператор склада", "Қойма операторы", "Warehouse operator");
    if (role === "weighman") return t("Весовщик", "Таразышы", "Weighman");
    if (role === "fuel_operator") return t("Оператор ГСМ", "Жанармай операторы", "Fuel operator");
    if (role === "brigadier") return t("Бригадир", "Бригадир", "Brigadier");
    if (role === "mechanic_operator") return t("Механизатор", "Механизатор", "Machine operator");
    if (role === "vegetable_brigadier") return t("Бригадир овощной", "Көкөніс бригадирі", "Vegetable foreman");
    return role;
  };

  const statusMeta = (statusRaw: string | null | undefined) => {
    const status = normalizeStatus(statusRaw);
    if (status === "active") {
      return {
        label: t("Активен", "Белсенді", "Active"),
        description: t("Может входить и работать в системе", "Жүйеге кіріп жұмыс істей алады", "Can sign in"),
        className: "border-emerald-200 bg-emerald-100 text-emerald-800",
        icon: CheckCircle2,
      };
    }
    if (status === "pending") {
      return {
        label: t("Ожидает активации", "Растауды күтеді", "Pending"),
        description: t("Письмо отправлено, пароль ещё не задан", "Хат жіберілді, құпиясөз әлі қойылмаған", "Invite not accepted"),
        className: "border-amber-200 bg-amber-100 text-amber-800",
        icon: Clock,
      };
    }
    if (status === "revoked") {
      return {
        label: t("Приглашение отозвано", "Шақыру қайтарылды", "Revoked"),
        description: t("Старые ссылки больше не должны активировать доступ", "Ескі сілтемелер қолжетімділік бермеуі керек", "Invite revoked"),
        className: "border-slate-300 bg-slate-200 text-slate-700",
        icon: Ban,
      };
    }
    if (status === "inactive" || status === "disabled") {
      return {
        label: t("Отключён", "Өшірілген", "Disabled"),
        description: t("Сотрудник сохранён для истории, вход закрыт", "Тарих үшін сақталған, кіру жабық", "Access disabled"),
        className: "border-red-200 bg-red-100 text-red-800",
        icon: UserX,
      };
    }
    return {
      label: status || t("Неизвестно", "Белгісіз", "Unknown"),
      description: t("Нестандартный статус", "Стандартты емес күй", "Custom status"),
      className: "border-slate-200 bg-slate-100 text-slate-800",
      icon: Shield,
    };
  };

  const isAdmin = profile?.role === "company_admin" || profile?.role === "global_admin";
  const isGlobalAdmin = profile?.role === "global_admin";
  const activeCompanyId = profile?.context_company_id || profile?.company_id || null;

  useEffect(() => {
    if (!inviteDialogOpen || !trafficInvite || !activeCompanyId) return;
    let cancelled = false;
    setPeopleLoading(true);
    setPeopleError("");
    setInvitePerson("");
    void (async () => {
      try {
        const headers = await buildClientAuthHeaders();
        const response = await fetch(`/api/invite-user?company_id=${encodeURIComponent(activeCompanyId)}`, { headers, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не удалось загрузить сотрудников");
        if (!cancelled) setInvitePeople(payload.people);
      } catch (error) {
        if (!cancelled) { setInvitePeople([]); setPeopleError(error instanceof Error ? error.message : "Не удалось загрузить сотрудников"); }
      } finally { if (!cancelled) setPeopleLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [inviteDialogOpen, trafficInvite, activeCompanyId]);

  const summary = useMemo(() => {
    const counts = { active: 0, pending: 0, inactive: 0, revoked: 0 };
    profiles.forEach((row) => {
      const status = normalizeStatus(row.status);
      if (status === "pending") counts.pending += 1;
      else if (status === "revoked") counts.revoked += 1;
      else if (status === "inactive" || status === "disabled") counts.inactive += 1;
      else counts.active += 1;
    });
    return counts;
  }, [profiles]);

  const formatDate = (value: string | null | undefined) => {
    if (!value) return "—";
    return new Date(value).toLocaleDateString("ru-RU");
  };

  const loadProfiles = async () => {
    const generation = ++profilesGeneration.current;
    setProfiles([]);
    if (!activeCompanyId) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const headers = await buildClientAuthHeaders();
      const response = await fetch(`/api/users?company_id=${encodeURIComponent(activeCompanyId)}`, { headers, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить пользователей");
      if (generation !== profilesGeneration.current) return;
      setProfiles((payload.profiles || []) as ProfileRow[]);
    } catch (error) {
      if (generation !== profilesGeneration.current) return;
      console.error("Failed to load users:", error);
      setProfiles([]);
      toast({
        title: t("Не удалось загрузить пользователей", "Пайдаланушылар жүктелмеді", "Failed to load users"),
        description: error instanceof Error ? error.message : t("Обновите страницу и повторите попытку.", "Бетті жаңартып қайталаңыз.", "Refresh and retry."),
        variant: "destructive",
      });
    } finally {
      if (generation === profilesGeneration.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadProfiles();
  }, [activeCompanyId]);

  const postUserAction = async (row: ProfileRow, action: string) => {
    const headers = await buildClientAuthHeaders("json");
    const response = await fetch(`/api/users/${row.id}`, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({ action }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    return payload;
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteFullName.trim() || !activeCompanyId || !profile?.id) return;
    if (trafficInvite && (!invitePerson || peopleLoading || peopleError)) return;
    setInviting(true);
    try {
      const headers = await buildClientAuthHeaders("json");
      const response = await fetch("/api/invite-user", {
        method: "POST",
        headers,
        body: JSON.stringify({
          actor_user_id: profile.id,
          full_name: inviteFullName.trim(),
          email: inviteEmail.trim(),
          role: inviteRole,
          company_id: activeCompanyId,
          ...(trafficInvite ? { person_id: invitePerson === "new" ? null : invitePerson, create_person: invitePerson === "new" } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);

      toast({
        title: t("Приглашение отправлено", "Шақыру жіберілді", "Invitation sent"),
        description: t(
          `Если письмо не придёт, используйте «Переотправить» или «Скопировать ссылку» в строке пользователя.`,
          `Хат келмесе, пайдаланушы жолындағы қайта жіберу немесе сілтемені көшіру әрекетін қолданыңыз.`,
          `If email does not arrive, use resend or copy setup link in the user row.`
        ),
      });
      setInviteDialogOpen(false);
      setInviteFullName("");
      setInviteEmail("");
      setInviteRole("agronomist");
      setInvitePerson("");
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

  const resendInvite = async (row: ProfileRow) => {
    const key = `${row.id}:resend`;
    setBusyKey(key);
    try {
      const payload = await postUserAction(row, "resend_invite");
      toast({
        title: t("Приглашение переотправлено", "Шақыру қайта жіберілді", "Invite resent"),
        description:
          payload?.method === "recovery"
            ? t("Отправлена ссылка установки пароля для уже созданного auth-пользователя.", "Құпиясөз орнату сілтемесі жіберілді.", "Password setup link sent.")
            : t("Отправлено новое письмо-приглашение.", "Жаңа шақыру хаты жіберілді.", "New invite email sent."),
      });
      await loadProfiles();
    } catch (error: any) {
      toast({
        title: t("Не удалось переотправить", "Қайта жіберілмеді", "Resend failed"),
        description: error?.message || t("Проверьте email и настройки Supabase SMTP.", "Email және SMTP баптауларын тексеріңіз.", "Check email and SMTP settings."),
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const copySetupLink = async (row: ProfileRow) => {
    const key = `${row.id}:link`;
    setBusyKey(key);
    try {
      const payload = await postUserAction(row, "create_invite_link");
      const link = String(payload?.action_link || "");
      if (!link) throw new Error("Setup link was not returned");
      setSetupLink(link);
      setSetupLinkDialogOpen(true);
      try {
        await navigator.clipboard.writeText(link);
        toast({
          title: t("Ссылка скопирована", "Сілтеме көшірілді", "Link copied"),
          description: t("Передайте её сотруднику только по доверенному каналу.", "Оны қызметкерге тек сенімді арнамен жіберіңіз.", "Share it only through a trusted channel."),
        });
      } catch {
        toast({
          title: t("Ссылка создана", "Сілтеме жасалды", "Link created"),
          description: t("Скопируйте её из открытого окна.", "Оны ашылған терезеден көшіріңіз.", "Copy it from the dialog."),
        });
      }
    } catch (error: any) {
      toast({
        title: t("Не удалось создать ссылку", "Сілтеме жасалмады", "Failed to create link"),
        description: error?.message || t("Повторите позже.", "Кейін қайталаңыз.", "Try again later."),
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction) return;
    const { row, action } = confirmAction;
    const key = `${row.id}:${action}`;
    setBusyKey(key);
    try {
      await postUserAction(row, action);
      setConfirmAction(null);
      await loadProfiles();
      toast({
        title:
          action === "revoke_invite"
            ? t("Приглашение отозвано", "Шақыру қайтарылды", "Invite revoked")
            : action === "deactivate_user"
              ? t("Доступ отключён", "Қолжетімділік өшірілді", "Access disabled")
              : t("Доступ восстановлен", "Қолжетімділік қалпына келтірілді", "Access restored"),
      });
    } catch (error: any) {
      toast({
        title: t("Действие не выполнено", "Әрекет орындалмады", "Action failed"),
        description: error?.message || t("Повторите позже.", "Кейін қайталаңыз.", "Try again later."),
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
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
      await refreshProfile();
      router.replace("/dashboard");
    } catch (error: any) {
      setImpersonatingProfileId(null);
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error?.message || t("Не удалось войти как пользователь", "Пайдаланушы ретінде кіру мүмкін болмады", "Failed to impersonate user"),
        variant: "destructive",
      });
    }
  };

  const renderActions = (row: ProfileRow) => {
    const status = normalizeStatus(row.status);
    const isSelf = row.id === profile?.id;
    const isGlobal = row.role === "global_admin";
    const busy = (suffix: string) => busyKey === `${row.id}:${suffix}`;

    return (
      <div className="flex flex-wrap items-center gap-2">
        {status === "pending" ? (
          <>
            <Button size="sm" variant="outline" onClick={() => void resendInvite(row)} disabled={busy("resend")}>
              <RotateCw className="mr-1 h-3.5 w-3.5" />
              {busy("resend") ? t("Отправка...", "Жіберілуде...", "Sending...") : t("Переотправить", "Қайта жіберу", "Resend")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void copySetupLink(row)} disabled={busy("link")}>
              <LinkIcon className="mr-1 h-3.5 w-3.5" />
              {t("Ссылка", "Сілтеме", "Link")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-red-300 text-red-700 hover:bg-red-50"
              onClick={() => setConfirmAction({ row, action: "revoke_invite" })}
              disabled={busy("revoke_invite")}
            >
              <Ban className="mr-1 h-3.5 w-3.5" />
              {t("Отозвать", "Қайтару", "Revoke")}
            </Button>
          </>
        ) : null}

        {status === "active" && !isSelf && !isGlobal ? (
          <Button
            size="sm"
            variant="outline"
            className="border-red-300 text-red-700 hover:bg-red-50"
            onClick={() => setConfirmAction({ row, action: "deactivate_user" })}
            disabled={busy("deactivate_user")}
          >
            <UserX className="mr-1 h-3.5 w-3.5" />
            {t("Отключить", "Өшіру", "Disable")}
          </Button>
        ) : null}

        {(status === "inactive" || status === "disabled") && !isSelf ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmAction({ row, action: "reactivate_user" })}
            disabled={busy("reactivate_user")}
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            {t("Включить", "Қосу", "Enable")}
          </Button>
        ) : null}

        {isGlobalAdmin && status === "active" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleImpersonate(row.id)}
            disabled={isSelf || isGlobal || impersonatingProfileId === row.id}
          >
            {impersonatingProfileId === row.id ? t("Входим...", "Кіруде...", "Switching...") : t("Войти как", "Ретінде кіру", "Sign in as")}
          </Button>
        ) : null}
      </div>
    );
  };

  const confirmText = (() => {
    if (!confirmAction) return null;
    const name = confirmAction.row.full_name || confirmAction.row.email;
    if (confirmAction.action === "revoke_invite") {
      return {
        title: t("Отозвать приглашение?", "Шақыруды қайтару керек пе?", "Revoke invite?"),
        body: t(
          `Пользователь ${name} не сможет активировать доступ по старой ссылке. Если приглашение нужно снова, создайте новое.`,
          `${name} ескі сілтеме арқылы қолжетімділік ала алмайды.`,
          `${name} will not be able to activate access with the old link.`
        ),
        action: t("Отозвать", "Қайтару", "Revoke"),
      };
    }
    if (confirmAction.action === "deactivate_user") {
      return {
        title: t("Отключить сотрудника?", "Қызметкерді өшіру керек пе?", "Disable user?"),
        body: t(
          `Аккаунт ${name} останется в истории операций, склада и весовой, но вход будет закрыт.`,
          `${name} тарихта сақталады, бірақ кіру жабылады.`,
          `${name} stays in history, but sign-in will be blocked.`
        ),
        action: t("Отключить", "Өшіру", "Disable"),
      };
    }
    return {
      title: t("Включить сотрудника?", "Қызметкерді қосу керек пе?", "Enable user?"),
      body: t(
        `Пользователь ${name} снова сможет войти в систему.`,
        `${name} жүйеге қайта кіре алады.`,
        `${name} will be able to sign in again.`
      ),
      action: t("Включить", "Қосу", "Enable"),
    };
  })();

  if (!isAdmin) {
    return (
      <div>
        <PageHeader
          title={t("Пользователи", "Пайдаланушылар", "Users")}
          description={t("Управление командой и доступами", "Команда мен рұқсаттарды басқару", "Manage team and permissions")}
        />
        <Alert variant="destructive">
          <AlertDescription>
            {t("Доступ запрещён. Раздел только для администраторов.", "Қолжетім жоқ. Бөлім тек әкімшілерге.", "Access denied. Admins only.")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("Пользователи", "Пайдаланушылар", "Users")}
        description={t("Управление командой, приглашениями и доступами", "Команда, шақырулар және рұқсаттар", "Manage team, invites and access")}
      >
        <Button onClick={() => setInviteDialogOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          {t("Пригласить", "Шақыру", "Invite")}
        </Button>
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase text-slate-500">{t("Активные", "Белсенді", "Active")}</div>
            <div className="mt-1 text-2xl font-semibold">{summary.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase text-slate-500">{t("Ожидают", "Күтуде", "Pending")}</div>
            <div className="mt-1 text-2xl font-semibold">{summary.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase text-slate-500">{t("Отключены", "Өшірілген", "Disabled")}</div>
            <div className="mt-1 text-2xl font-semibold">{summary.inactive}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase text-slate-500">{t("Отозваны", "Қайтарылған", "Revoked")}</div>
            <div className="mt-1 text-2xl font-semibold">{summary.revoked}</div>
          </CardContent>
        </Card>
      </div>

      <Alert className="border-amber-300 bg-amber-50 text-amber-950">
        <Mail className="h-4 w-4" />
        <AlertDescription>
          {t(
            "Если письмо не пришло: сначала нажмите «Переотправить». Если почта всё равно молчит, нажмите «Ссылка» и передайте сотруднику ссылку активации вручную. Уволенных сотрудников не удаляем и не перекидываем на нового человека: отключаем доступ, чтобы история операций осталась честной.",
            "Хат келмесе: алдымен қайта жіберіңіз. Егер бәрібір келмесе, сілтемені көшіріп қызметкерге қолмен беріңіз. Жұмыстан кеткендерді жоймаймыз: тарих сақталуы үшін қолжетімділікті өшіреміз.",
            "If email does not arrive, resend first. If delivery still fails, copy the setup link and share it manually. Do not reuse old accounts for new employees; disable access to preserve history."
          )}
        </AlertDescription>
      </Alert>

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
                <TableHead>{t("Обновлён", "Жаңартылған", "Updated")}</TableHead>
                <TableHead>{t("Действия", "Әрекеттер", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-500">
                    {t("Загрузка...", "Жүктелуде...", "Loading...")}
                  </TableCell>
                </TableRow>
              ) : profiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-500">
                    {t("Пользователи не найдены.", "Пайдаланушылар табылмады.", "No users found.")}
                  </TableCell>
                </TableRow>
              ) : (
                profiles.map((row) => {
                  const meta = statusMeta(row.status);
                  const StatusIcon = meta.icon;
                  return (
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
                        <div className="space-y-1">
                          <Badge className={meta.className}>
                            <StatusIcon className="mr-1 h-3 w-3" />
                            {meta.label}
                          </Badge>
                          <div className="text-xs text-slate-500">{meta.description}</div>
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(row.created_at)}</TableCell>
                      <TableCell>{formatDate(row.updated_at)}</TableCell>
                      <TableCell>{renderActions(row)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("Пригласить пользователя", "Пайдаланушыны шақыру", "Invite user")}</DialogTitle>
            <DialogDescription>
              {t("Укажите ФИО, email и роль. До активации пользователь будет в статусе «Ожидает».", "Аты-жөні, email және рөлін көрсетіңіз.", "Provide full name, email and role.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-full-name">{t("ФИО", "Аты-жөні", "Full name")}</Label>
              <Input
                id="invite-full-name"
                className="min-h-[48px] text-base"
                value={inviteFullName}
                onChange={(event) => setInviteFullName(event.target.value)}
                disabled={inviting || (trafficInvite && !!invitePerson && invitePerson !== "new")}
                placeholder={t("Например: Иванов Иван", "Мысалы: Иванов Иван", "John Smith")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                className="min-h-[48px] text-base"
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
                <SelectTrigger id="invite-role" className="min-h-[48px] text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITE_ROLES.map((role) => (
                    <SelectItem key={role} value={role} className="min-h-[48px] text-base">
                      {roleLabel(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {trafficInvite ? (
              <div className="space-y-2">
                <Label htmlFor="invite-person">Сотрудник компании</Label>
                <select id="invite-person" value={invitePerson} disabled={inviting || peopleLoading || !!peopleError}
                  className="min-h-[48px] w-full min-w-0 rounded-md border bg-background px-3 text-base"
                  onChange={(event) => {
                    setInvitePerson(event.target.value);
                    const person = invitePeople.find((item) => item.id === event.target.value);
                    if (person) setInviteFullName(person.full_name);
                  }}>
                  <option value="">{peopleLoading ? "Загружаем сотрудников…" : "Выберите сотрудника"}</option>
                  {invitePeople.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
                  <option value="new">Новый сотрудник — создать запись по указанному ФИО</option>
                </select>
                <p className="text-sm text-muted-foreground">Письмо активирует единый аккаунт TravkinFlow. Роль открывает только кабинет PTC, без весовой. Если человек уже есть в персонале, выберите его — новую запись создавать не нужно.</p>
                {peopleError ? <p role="alert" className="text-sm text-red-500">{peopleError}. Закройте и откройте приглашение для повтора.</p> : null}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button className="min-h-[48px]" type="button" variant="outline" onClick={() => setInviteDialogOpen(false)} disabled={inviting}>
              {t("Отмена", "Болдырмау", "Cancel")}
            </Button>
            <Button className="min-h-[48px]" onClick={handleInvite} disabled={inviting || !inviteEmail.trim() || !inviteFullName.trim() || (trafficInvite && (!invitePerson || peopleLoading || !!peopleError))}>
              {inviting ? t("Отправка...", "Жіберілуде...", "Sending...") : t("Отправить приглашение", "Шақыру жіберу", "Send invite")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={setupLinkDialogOpen} onOpenChange={setSetupLinkDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("Ссылка активации", "Активация сілтемесі", "Setup link")}</DialogTitle>
            <DialogDescription>
              {t("Это секретная одноразовая ссылка. Передавайте её только сотруднику и только по доверенному каналу.", "Бұл құпия сілтеме.", "This is a sensitive setup link. Share it only through a trusted channel.")}
            </DialogDescription>
          </DialogHeader>
          <Input value={setupLink} readOnly onFocus={(event) => event.currentTarget.select()} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(setupLink)}
            >
              <Copy className="mr-2 h-4 w-4" />
              {t("Скопировать", "Көшіру", "Copy")}
            </Button>
            <Button type="button" onClick={() => setSetupLinkDialogOpen(false)}>
              {t("Готово", "Дайын", "Done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmAction)} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmText?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmText?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busyKey)}>{t("Отмена", "Болдырмау", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void executeConfirmedAction()}
              disabled={Boolean(busyKey)}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {confirmText?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
