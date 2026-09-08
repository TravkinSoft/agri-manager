"use client";

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/lib/contexts/language-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { PROFILE_AVATAR_ACCEPT, prepareProfileAvatarWebp } from "@/lib/profile/avatar-client";

type NotificationPreferences = {
  email_enabled: boolean;
  operation_updates_enabled: boolean;
  warehouse_updates_enabled: boolean;
  weighbridge_updates_enabled: boolean;
  traffic_updates_enabled: boolean;
  proactive_assist_enabled: boolean;
  proactive_assist_cadence: "events" | "twice_daily" | "daily" | "every_3_days" | "weekly";
};

const defaultPreferences: NotificationPreferences = {
  email_enabled: true,
  operation_updates_enabled: true,
  warehouse_updates_enabled: true,
  weighbridge_updates_enabled: true,
  traffic_updates_enabled: true,
  proactive_assist_enabled: true,
  proactive_assist_cadence: "events",
};

export default function SettingsPage() {
  const { language } = useLanguage();
  const { profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(defaultPreferences);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationSaving, setNotificationSaving] = useState<keyof NotificationPreferences | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const notificationOnly = profile?.role === "agronomist";
  const t = useCallback(
    (ru: string, kz: string, en: string) => language === "ru" ? ru : language === "kz" ? kz : en,
    [language],
  );

  const getAuthorization = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) {
      throw new Error(t("Сессия истекла", "Сессия аяқталды", "Session expired"));
    }
    return `Bearer ${data.session.access_token}`;
  }, [t]);

  useEffect(() => {
    const load = async () => {
      if (!profile?.company_id) {
        setNotificationsLoading(false);
        return;
      }
      setNotificationsLoading(true);
      try {
        const authorization = await getAuthorization();
        const response = await fetch(
          `/api/settings/notifications?companyId=${encodeURIComponent(profile.company_id)}`,
          { headers: { Authorization: authorization }, cache: "no-store" }
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Notification settings request failed");
        setNotificationPreferences(payload.preferences || defaultPreferences);
      } catch (error) {
        toast({
          title: t("Не удалось загрузить уведомления", "Хабарламалар жүктелмеді", "Notifications failed to load"),
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
      } finally {
        setNotificationsLoading(false);
      }
    };
    void load();
  }, [getAuthorization, profile?.company_id, t, toast]);

  const updateNotificationPreference = async <Key extends keyof NotificationPreferences>(
    key: Key,
    value: NotificationPreferences[Key]
  ) => {
    if (!profile?.company_id || notificationSaving) return;
    const previous = notificationPreferences;
    const next = { ...previous, [key]: value };
    setNotificationPreferences(next);
    setNotificationSaving(key);
    try {
      const authorization = await getAuthorization();
      const response = await fetch("/api/settings/notifications", {
        method: "PATCH",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ companyId: profile.company_id, ...next }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Notification settings update failed");
      setNotificationPreferences(payload.preferences);
      toast({
        title: t("Настройки сохранены", "Баптаулар сақталды", "Settings saved"),
      });
    } catch (error) {
      setNotificationPreferences(previous);
      toast({
        title: t("Не удалось сохранить", "Сақтау мүмкін болмады", "Failed to save"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setNotificationSaving(null);
    }
  };

  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file || avatarBusy || profile?.is_impersonating) return;
    setAvatarBusy(true);
    try {
      const prepared = await prepareProfileAvatarWebp(file);
      const authorization = await getAuthorization();
      const formData = new FormData();
      formData.set("avatar", prepared);
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { Authorization: authorization },
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Profile avatar update failed");
      await refreshProfile();
      toast({ title: t("Фото профиля обновлено", "Профиль фотосы жаңартылды", "Profile photo updated") });
    } catch (error) {
      toast({
        title: t("Не удалось обновить фото", "Фотоны жаңарту мүмкін болмады", "Photo update failed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    if (avatarBusy || profile?.is_impersonating) return;
    setAvatarBusy(true);
    try {
      const authorization = await getAuthorization();
      const response = await fetch("/api/profile/avatar", {
        method: "DELETE",
        headers: { Authorization: authorization },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Profile avatar removal failed");
      await refreshProfile();
      toast({ title: t("Фото профиля удалено", "Профиль фотосы жойылды", "Profile photo removed") });
    } catch (error) {
      toast({
        title: t("Не удалось удалить фото", "Фотоны жою мүмкін болмады", "Photo removal failed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Настройки", "Баптаулар", "Settings")}
        description={t(
          "Параметры системы и уведомлений",
          "Жүйе мен хабарлама параметрлері",
          "System and notification preferences"
        )}
      />

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList>
          <TabsTrigger value="profile">{t("Профиль", "Профиль", "Profile")}</TabsTrigger>
          {!notificationOnly ? <TabsTrigger value="general">{t("Общие", "Жалпы", "General")}</TabsTrigger> : null}
          <TabsTrigger value="notifications">{t("Уведомления", "Хабарламалар", "Notifications")}</TabsTrigger>
          {!notificationOnly ? <TabsTrigger value="security">{t("Безопасность", "Қауіпсіздік", "Security")}</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("Фото профиля", "Профиль фотосы", "Profile photo")}</CardTitle>
              <CardDescription>
                {t(
                  "Отображается в правом верхнем углу. Фото обрезается квадратом и хранится приватно.",
                  "Жоғарғы оң жақ бұрышта көрсетіледі. Фото шаршыға қиылып, жеке сақталады.",
                  "Shown in the top-right corner. The photo is square-cropped and stored privately."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <ProfileAvatar
                profileId={profile?.id}
                fullName={profile?.full_name}
                email={profile?.email}
                version={profile?.avatar_updated_at}
                className="h-20 w-20 border-slate-700"
              />
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <div className="truncate font-medium text-slate-100">{profile?.full_name || profile?.email || "—"}</div>
                  <div className="text-sm text-slate-400">JPEG, PNG или WebP · до 5 МБ · итог до 512×512</div>
                </div>
                {profile?.is_impersonating ? (
                  <p className="text-sm text-amber-200" role="status">
                    {t(
                      "Вернитесь в Global Admin, чтобы менять собственное фото.",
                      "Өз фотоңызды өзгерту үшін Global Admin режиміне оралыңыз.",
                      "Return to Global Admin to change your own photo."
                    )}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept={PROFILE_AVATAR_ACCEPT}
                      className="sr-only"
                      onChange={(event) => void handleAvatarFile(event)}
                    />
                    <Button type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarBusy}>
                      <Camera className="mr-2 h-4 w-4" />
                      {avatarBusy ? t("Обработка...", "Өңдеу...", "Processing...") : t("Выбрать фото", "Фото таңдау", "Choose photo")}
                    </Button>
                    {profile?.avatar_path ? (
                      <Button type="button" variant="outline" onClick={() => void removeAvatar()} disabled={avatarBusy}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t("Удалить", "Жою", "Remove")}
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("Данные организации", "Ұйым деректері", "Organization details")}</CardTitle>
              <CardDescription>
                {t(
                  "Измените название, адрес и контактные данные",
                  "Атауды, мекенжайды және байланыс деректерін өзгертіңіз",
                  "Update name, address and contact information"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="org-name">{t("Название организации", "Ұйым атауы", "Organization name")}</Label>
                <Input id="org-name" placeholder={t("Введите название", "Атауын енгізіңіз", "Enter organization name")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-address">{t("Адрес", "Мекенжай", "Address")}</Label>
                <Input id="org-address" placeholder={t("Введите адрес", "Мекенжайды енгізіңіз", "Enter address")} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="org-phone">{t("Телефон", "Телефон", "Phone")}</Label>
                  <Input id="org-phone" placeholder={t("Введите телефон", "Телефон енгізіңіз", "Enter phone")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-email">Email</Label>
                  <Input id="org-email" type="email" placeholder={t("Введите email", "Email енгізіңіз", "Enter email")} />
                </div>
              </div>
              <Button>{t("Сохранить изменения", "Өзгерістерді сақтау", "Save changes")}</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("Настройки уведомлений", "Хабарлама баптаулары", "Notification settings")}</CardTitle>
              <CardDescription>
                {t("Выберите, какие уведомления получать", "Қандай хабарламалар алатыныңызды таңдаңыз", "Choose what notifications you receive")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="notification-email">{t("Email уведомления", "Email хабарламалар", "Email notifications")}</Label>
                  <p className="text-sm text-slate-500">{t("Письма о важных событиях", "Маңызды оқиғалар туралы хаттар", "Emails for important events")}</p>
                </div>
                <Switch
                  id="notification-email"
                  checked={notificationPreferences.email_enabled}
                  disabled={notificationsLoading || notificationSaving !== null}
                  onCheckedChange={(checked) => void updateNotificationPreference("email_enabled", checked)}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="notification-operations">{t("Операции", "Операциялар", "Operations")}</Label>
                  <p className="text-sm text-slate-500">{t("Статусы и напоминания по операциям", "Операциялар бойынша статустар мен еске салулар", "Operation status and reminders")}</p>
                </div>
                <Switch
                  id="notification-operations"
                  checked={notificationPreferences.operation_updates_enabled}
                  disabled={notificationsLoading || notificationSaving !== null}
                  onCheckedChange={(checked) =>
                    void updateNotificationPreference("operation_updates_enabled", checked)
                  }
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="notification-warehouse">{t("Склад", "Қойма", "Warehouse")}</Label>
                  <p className="text-sm text-slate-500">{t("Выдача и подтверждение материалов", "Материалдарды беру және растау", "Issue and receipt confirmations")}</p>
                </div>
                <Switch
                  id="notification-warehouse"
                  checked={notificationPreferences.warehouse_updates_enabled}
                  disabled={notificationsLoading || notificationSaving !== null}
                  onCheckedChange={(checked) =>
                    void updateNotificationPreference("warehouse_updates_enabled", checked)
                  }
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="notification-traffic">{t("Оборот машин", "Көлік айналымы", "Vehicle turnover")}</Label>
                  <p className="text-sm text-slate-500">
                    {t("Линия, ремонт и предупреждения о простое", "Желі, жөндеу және тоқтап қалу ескертулері", "Line, repair, and idle alerts")}
                  </p>
                </div>
                <Switch
                  id="notification-traffic"
                  checked={notificationPreferences.traffic_updates_enabled}
                  disabled={notificationsLoading || notificationSaving !== null}
                  onCheckedChange={(checked) =>
                    void updateNotificationPreference("traffic_updates_enabled", checked)
                  }
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="notification-weighbridge">{t("Весовая", "Таразы", "Weighbridge")}</Label>
                  <p className="text-sm text-slate-500">
                    {t("Новые рейсы, закрытие, исправления и аннулирование талонов", "Жаңа рейстер мен талон мәртебелері", "New trips and ticket status changes")}
                  </p>
                </div>
                <Switch
                  id="notification-weighbridge"
                  checked={notificationPreferences.weighbridge_updates_enabled}
                  disabled={notificationsLoading || notificationSaving !== null}
                  onCheckedChange={(checked) =>
                    void updateNotificationPreference("weighbridge_updates_enabled", checked)
                  }
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="notification-assist">{t("Проактивный Assist", "Проактивті Assist", "Proactive Assist")}</Label>
                  <p className="text-sm text-slate-500">
                    {t("Сообщать только о важных изменениях уборки и талонов", "Егін жинау мен талондардың маңызды өзгерістері", "Important harvest and ticket changes only")}
                  </p>
                </div>
                <Switch
                  id="notification-assist"
                  checked={notificationPreferences.proactive_assist_enabled}
                  disabled={notificationsLoading || notificationSaving !== null}
                  onCheckedChange={(checked) =>
                    void updateNotificationPreference("proactive_assist_enabled", checked)
                  }
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
                <div>
                  <Label htmlFor="notification-assist-cadence">{t("Режим сводок", "Жиынтық режимі", "Summary cadence")}</Label>
                  <p className="text-sm text-slate-500">
                    {t("События приходят сразу; плановая сводка — по выбранному интервалу", "Оқиғалар бірден, жиынтық таңдалған аралықта", "Events are instant; summaries follow this cadence")}
                  </p>
                </div>
                <Select
                  value={notificationPreferences.proactive_assist_cadence}
                  disabled={
                    !notificationPreferences.proactive_assist_enabled ||
                    notificationsLoading ||
                    notificationSaving !== null
                  }
                  onValueChange={(value) =>
                    void updateNotificationPreference(
                      "proactive_assist_cadence",
                      value as NotificationPreferences["proactive_assist_cadence"]
                    )
                  }
                >
                  <SelectTrigger id="notification-assist-cadence" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="events">{t("Только события", "Тек оқиғалар", "Events only")}</SelectItem>
                    <SelectItem value="twice_daily">{t("Дважды в день", "Күніне екі рет", "Twice daily")}</SelectItem>
                    <SelectItem value="daily">{t("Раз в день", "Күніне бір рет", "Daily")}</SelectItem>
                    <SelectItem value="every_3_days">{t("Раз в 3 дня", "3 күнде бір рет", "Every 3 days")}</SelectItem>
                    <SelectItem value="weekly">{t("Раз в неделю", "Аптасына бір рет", "Weekly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("Безопасность", "Қауіпсіздік", "Security")}</CardTitle>
              <CardDescription>
                {t("Базовые параметры аккаунта", "Аккаунттың негізгі параметрлері", "Basic account configuration")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">{t("Текущий пароль", "Ағымдағы құпиясөз", "Current password")}</Label>
                <Input id="current-password" type="password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">{t("Новый пароль", "Жаңа құпиясөз", "New password")}</Label>
                <Input id="new-password" type="password" />
              </div>
              <Button>{t("Обновить пароль", "Құпиясөзді жаңарту", "Update password")}</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
