'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { Loader as Loader2 } from 'lucide-react';

const PUBLIC_ROUTES = ["/", "/demo"];

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublicRoute = pathname?.startsWith('/auth') || PUBLIC_ROUTES.includes(pathname || "");

  useEffect(() => {
    if (!loading && !user && !isPublicRoute) {
      router.push('/auth/login');
    }
    if (!loading && user && profile && profile.status !== "active" && !isPublicRoute) {
      void signOut();
    }
  }, [user, profile, loading, router, isPublicRoute, signOut]);

  if (loading && !isPublicRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
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
