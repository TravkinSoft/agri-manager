'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader as Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

const SESSION_RETRY_DELAYS_MS = [0, 120, 260, 500, 900] as const;

function readAuthHashParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.hash.replace(/^#/, ''));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInviteSessionUser(): Promise<User | null> {
  for (const delay of SESSION_RETRY_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return data.session.user;
  }
  return null;
}

export default function SetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionResolving, setSessionResolving] = useState(true);
  const [resolvedUser, setResolvedUser] = useState<User | null>(null);
  const { updatePassword, activateCurrentProfile, user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const resolvedOnceRef = useRef(false);
  const effectiveUser = user || resolvedUser;

  const fixedEmail = useMemo(
    () => effectiveUser?.email || profile?.email || '',
    [effectiveUser?.email, profile?.email]
  );
  const fixedRole = useMemo(
    () => profile?.role || String(effectiveUser?.user_metadata?.role || ''),
    [profile?.role, effectiveUser?.user_metadata?.role]
  );

  useEffect(() => {
    if (resolvedOnceRef.current) return;
    resolvedOnceRef.current = true;

    const resolveInviteSession = async () => {
      const hashParams = readAuthHashParams();
      const callbackError = searchParams?.get('error') || hashParams.get('error');
      const callbackErrorDescription = searchParams?.get('error_description') || hashParams.get('error_description');
      if (callbackError) {
        setError(callbackErrorDescription || callbackError);
        setSessionResolving(false);
        return;
      }

      const code = searchParams?.get('code');
      const tokenHash = searchParams?.get('token_hash');
      const type = searchParams?.get('type') || hashParams.get('type');
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');

      try {
        let sessionUser: User | null = null;
        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          sessionUser = data.session?.user || null;
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        } else if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          sessionUser = data.session?.user || null;
        } else if (tokenHash && type && (type === 'invite' || type === 'recovery')) {
          const { data, error } = await supabase.auth.verifyOtp({
            type,
            token_hash: tokenHash,
          });
          if (error) throw error;
          sessionUser = data.session?.user || null;
        }

        setResolvedUser(sessionUser || (await waitForInviteSessionUser()));
      } catch (err: any) {
        setError(err?.message || 'Failed to resolve invite session');
      } finally {
        setSessionResolving(false);
      }
    };

    void resolveInviteSession();
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!effectiveUser) {
      setError('Invite session is missing or expired. Please open your invite link again.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      await updatePassword(password);
      await activateCurrentProfile();
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      router.push('/auth/login?invite_setup=1');
    } catch (err: any) {
      setError(err.message || 'Failed to set password');
    } finally {
      setLoading(false);
    }
  };

  if (!authLoading && !sessionResolving && !effectiveUser) {
    return (
      <div className="mobile-safe-bottom mobile-safe-top flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-6">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center">Нужна ссылка приглашения</CardTitle>
            <CardDescription className="text-center">
              Откройте страницу из письма-приглашения. Если письмо не открывается, попросите администратора переотправить приглашение или скопировать ссылку активации.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button className="h-12 w-full" onClick={() => router.push('/auth/login')}>
              Перейти ко входу
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="mobile-safe-bottom mobile-safe-top flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-6">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Завершить регистрацию</CardTitle>
          <CardDescription className="text-center">
            Придумайте пароль для приглашённого аккаунта
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {(authLoading || sessionResolving) && (
              <Alert>
                <AlertDescription>Подготавливаем ссылку приглашения...</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={fixedEmail} readOnly disabled className="h-12 text-base" />
            </div>
            <div className="space-y-2">
              <Label>Роль</Label>
              <Input value={fixedRole === 'mechanic_operator' ? 'Механизатор' : fixedRole === 'vegetable_brigadier' ? 'Бригадир овощной' : fixedRole || 'Назначена администратором'} readOnly disabled className="h-12 text-base" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                placeholder="Минимум 6 символов"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 text-base"
                required
                minLength={6}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Подтвердите пароль</Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Повторите пароль"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-12 text-base"
                required
                disabled={loading}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="h-12 w-full" disabled={loading || authLoading || sessionResolving || !effectiveUser}>
              {(loading || authLoading || sessionResolving) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить пароль
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
