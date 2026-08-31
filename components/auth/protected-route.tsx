'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { Loader as Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PUBLIC_ROUTES = ["/", "/demo"];

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, authUnavailable, retryAuthBootstrap, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublicRoute = pathname?.startsWith('/auth') || PUBLIC_ROUTES.includes(pathname || "");

  useEffect(() => {
    if (!loading && !authUnavailable && !user && !isPublicRoute) {
      router.push('/auth/login');
    }
    if (!loading && user && profile && profile.status !== "active" && !isPublicRoute) {
      void signOut();
    }
  }, [user, profile, loading, authUnavailable, router, isPublicRoute, signOut]);

  if (loading && !isPublicRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (authUnavailable && !isPublicRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-5 text-center">
          <h1 className="text-base font-semibold">Не удалось подтвердить сессию</h1>
          <p className="text-sm text-muted-foreground">
            Соединение с авторизацией временно недоступно. Ваша сохранённая сессия не была удалена.
          </p>
          <Button type="button" onClick={retryAuthBootstrap}>Повторить проверку</Button>
        </div>
      </div>
    );
  }

  if (!user && !isPublicRoute) {
    return null;
  }

  if (user && profile && profile.status !== "active" && !isPublicRoute) {
    return null;
  }

  return <>{children}</>;
}
