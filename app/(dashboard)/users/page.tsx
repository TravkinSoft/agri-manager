'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Shield, UserPlus, Clock, CircleCheck as CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/contexts/auth-context";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/contexts/language-context";

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

export default function UsersPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('agronomist');
  const [inviting, setInviting] = useState(false);
  const { profile } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();

  const t = (ru: string, kz: string, en: string) =>
    language === 'ru' ? ru : language === 'kz' ? kz : en;

  useEffect(() => {
    loadProfiles();
  }, [profile?.company_id]);

  const loadProfiles = async () => {
    try {
      if (!profile?.company_id) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, status, created_at')
        .eq('company_id', profile.company_id)
        .order('created_at', { ascending: false });

      if (error) {
        const missingColumn = String((error as any)?.message || "").toLowerCase().includes("full_name");
        if (!missingColumn) throw error;

        const fallbackRes = await supabase
          .from('profiles')
          .select('id, email, role, status, created_at')
          .eq('company_id', profile.company_id)
          .order('created_at', { ascending: false });

        if (fallbackRes.error) throw fallbackRes.error;

        const fallbackRows = (fallbackRes.data || []).map((row: any) => ({
          ...row,
          full_name: null,
        }));
        setProfiles(fallbackRows as Profile[]);
        return;
      }

      setProfiles((data || []) as Profile[]);
    } catch (error) {
      console.error('Error loading profiles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail || !inviteFullName || !profile?.company_id) return;
    const normalizedInviteRole = inviteRole;
    if (profile.role !== 'global_admin' && normalizedInviteRole === 'company_admin') {
      toast({
        title: 'Ошибка',
        description: 'Администратор компании не может приглашать администраторов компании.',
        variant: 'destructive',
      });
      return;
    }

    setInviting(true);
    try {
      const response = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_user_id: profile.id,
          full_name: inviteFullName.trim(),
          email: inviteEmail,
          role: normalizedInviteRole,
          company_id: profile.company_id,
        }),
      });

      let result: { error?: string; details?: unknown; success?: boolean; message?: string } = {};
      try {
        result = await response.json();
      } catch {
        throw new Error(`Server returned status ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(result.message || result.error || `Request failed with status ${response.status}`);
      }

      toast({
        title: t('Приглашение отправлено', 'Шақыру жіберілді', 'Invitation sent'),
        description: t(
          `Приглашение отправлено на ${inviteEmail}`,
          `${inviteEmail} мекенжайына шақыру жіберілді`,
          `An invitation has been sent to ${inviteEmail}`
        ),
      });

      setInviteDialogOpen(false);
      setInviteFullName('');
      setInviteEmail('');
      setInviteRole('agronomist');
      setTimeout(loadProfiles, 600);
    } catch (error: unknown) {
      const message = error instanceof Error && error.message
        ? error.message
        : t('Не удалось отправить приглашение', 'Шақыру жіберілмеді', 'Failed to send invitation');

      toast({
        title: t('Ошибка приглашения', 'Шақыру қатесі', 'Invitation failed'),
        description: message,
        variant: 'destructive',
      });
    } finally {
      setInviting(false);
    }
  };

  const getRoleBadge = (role: string) => {
    const styles = {
      global_admin: 'bg-purple-100 text-purple-800',
      company_admin: 'bg-rose-100 text-rose-800',
      agronomist: 'bg-green-100 text-green-800',
      specialist: 'bg-blue-100 text-blue-800',
      warehouse: 'bg-orange-100 text-orange-800',
      weighman: 'bg-violet-100 text-violet-800',
      fuel_operator: 'bg-cyan-100 text-cyan-800',
    } as const;

    const roleLabel =
      role === "global_admin"
        ? t("Глобальный администратор", "Жаһандық әкімші", "Global admin")
        : role === "company_admin"
          ? t("Администратор компании", "Компания әкімшісі", "Company admin")
          : role === "agronomist"
            ? t("Агроном", "Агроном", "Agronomist")
            : role === "specialist"
              ? t("Специалист", "Маман", "Specialist")
              : role === "warehouse"
                ? t("Склад", "Қойма", "Warehouse")
                : role === "weighman"
                  ? t("Весовщик", "Таразышы", "Weighman")
                  : role === "fuel_operator"
                    ? t("Заправщик", "Жанармай операторы", "Fuel operator")
                    : role;

    return (
      <Badge className={styles[role as keyof typeof styles] || 'bg-slate-100 text-slate-800'}>
        <Shield className="h-3 w-3 mr-1" />
        {roleLabel}
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    if (status === 'active') {
      return (
        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          {t('Активен', 'Белсенді', 'Active')}
        </Badge>
      );
    }
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200">
        <Clock className="h-3 w-3 mr-1" />
        {t('Ожидание', 'Күтілуде', 'Pending')}
      </Badge>
    );
  };

  if (profile?.role !== 'company_admin' && profile?.role !== 'global_admin') {
    return (
      <div>
        <PageHeader
          title={t('Пользователи', 'Пайдаланушылар', 'Users')}
          description={t(
            'Управление участниками команды и доступами',
            'Команда мүшелері мен рұқсаттарды басқару',
            'Manage team members and access permissions'
          )}
        />
        <Alert variant="destructive">
          <AlertDescription>
            {t(
              'Доступ запрещен. Страница доступна только администраторам.',
              'Қол жеткізуге тыйым салынған. Бұл бет тек әкімшілерге қолжетімді.',
              'Access denied. Only administrators can view this page.'
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('Пользователи', 'Пайдаланушылар', 'Users')}
        description={t(
          'Управление участниками команды и доступами',
          'Команда мүшелері мен рұқсаттарды басқару',
          'Manage team members and access permissions'
        )}
      >
        <Button onClick={() => setInviteDialogOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          {t('Пригласить', 'Шақыру', 'Invite User')}
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('ФИО', 'Аты-жөні', 'Full name')}</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>{t('Роль', 'Рөл', 'Role')}</TableHead>
                <TableHead>{t('Статус', 'Күй', 'Status')}</TableHead>
                <TableHead>{t('Создан', 'Құрылған', 'Created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-500">
                    {t('Загрузка пользователей...', 'Пайдаланушылар жүктелуде...', 'Loading users...')}
                  </TableCell>
                </TableRow>
              ) : profiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-500">
                    {t('Пользователи не найдены.', 'Пайдаланушылар табылмады.', 'No users found.')}
                  </TableCell>
                </TableRow>
              ) : (
                profiles.map((userProfile) => (
                  <TableRow key={userProfile.id}>
                    <TableCell className="font-medium">{userProfile.full_name || userProfile.email}</TableCell>
                    <TableCell>{userProfile.email}</TableCell>
                    <TableCell>{getRoleBadge(userProfile.role)}</TableCell>
                    <TableCell>{getStatusBadge(userProfile.status || 'pending')}</TableCell>
                    <TableCell>{new Date(userProfile.created_at).toLocaleDateString()}</TableCell>
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
            <DialogTitle>{t('Пригласить пользователя', 'Пайдаланушыны шақыру', 'Invite New User')}</DialogTitle>
            <DialogDescription>
              {t(
                'Укажите ФИО, email и роль. ФИО обязательно.',
                'Аты-жөні, email және рөлді көрсетіңіз. Аты-жөні міндетті.',
                'Provide full name, email, and role. Full name is required.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-full-name">{t('ФИО', 'Аты-жөні', 'Full name')}</Label>
              <Input
                id="invite-full-name"
                type="text"
                placeholder={t('Иванов Иван Иванович', 'Иванов Иван Иванович', 'John Smith')}
                value={inviteFullName}
                onChange={(e) => setInviteFullName(e.target.value)}
                disabled={inviting}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t('Email адрес', 'Email мекенжайы', 'Email Address')}</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">{t('Роль', 'Рөл', 'Role')}</Label>
              <Select value={inviteRole} onValueChange={setInviteRole} disabled={inviting}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agronomist">{t('Агроном', 'Агроном', 'Agronomist')}</SelectItem>
                  <SelectItem value="specialist">{t('Специалист', 'Маман', 'Specialist')}</SelectItem>
                  <SelectItem value="warehouse">{t('Склад', 'Қойма', 'Warehouse')}</SelectItem>
                  <SelectItem value="weighman">{t('Весовщик', 'Таразышы', 'Weighman')}</SelectItem>
                  <SelectItem value="fuel_operator">{t('Заправщик', 'Жанармай операторы', 'Fuel operator')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)} disabled={inviting}>
              {t('Отмена', 'Болдырмау', 'Cancel')}
            </Button>
            <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim() || !inviteFullName.trim()}>
              {inviting ? t('Отправка...', 'Жіберілуде...', 'Sending...') : t('Отправить приглашение', 'Шақыру жіберу', 'Send Invitation')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
