"use client";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useLanguage } from "@/lib/contexts/language-context";

export default function SettingsPage() {
  const { language } = useLanguage();
  const t = (ru: string, kz: string, en: string) =>
    language === "ru" ? ru : language === "kz" ? kz : en;

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

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList>
          <TabsTrigger value="general">{t("Общие", "Жалпы", "General")}</TabsTrigger>
          <TabsTrigger value="notifications">{t("Уведомления", "Хабарламалар", "Notifications")}</TabsTrigger>
          <TabsTrigger value="security">{t("Безопасность", "Қауіпсіздік", "Security")}</TabsTrigger>
        </TabsList>

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
                  <Label>{t("Email уведомления", "Email хабарламалар", "Email notifications")}</Label>
                  <p className="text-sm text-slate-500">{t("Письма о важных событиях", "Маңызды оқиғалар туралы хаттар", "Emails for important events")}</p>
                </div>
                <Switch />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t("Операции", "Операциялар", "Operations")}</Label>
                  <p className="text-sm text-slate-500">{t("Статусы и напоминания по операциям", "Операциялар бойынша статустар мен еске салулар", "Operation status and reminders")}</p>
                </div>
                <Switch />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t("Склад", "Қойма", "Warehouse")}</Label>
                  <p className="text-sm text-slate-500">{t("Выдача и подтверждение материалов", "Материалдарды беру және растау", "Issue and receipt confirmations")}</p>
                </div>
                <Switch />
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
