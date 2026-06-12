'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { Loader as Loader2 } from 'lucide-react';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user && !pathname?.startsWith('/auth')) {
      router.push('/auth/login');
    }
    if (!loading && user && profile && profile.status !== "active" && !pathname?.startsWith('/auth')) {
      void signOut();
    }
  }, [user, profile, loading, router, pathname, signOut]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user && !pathname?.startsWith('/auth')) {
    return null;
  }

  if (user && profile && profile.status !== "active" && !pathname?.startsWith('/auth')) {
    return null;
  }

  return <>{children}</>;
}
