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

export default function SetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionResolving, setSessionResolving] = useState(true);
  const { updatePassword, user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const resolvedOnceRef = useRef(false);

  const fixedEmail = useMemo(() => user?.email || profile?.email || '', [user?.email, profile?.email]);
  const fixedRole = useMemo(
    () => profile?.role || String(user?.user_metadata?.role || ''),
    [profile?.role, user?.user_metadata?.role]
  );

  useEffect(() => {
    if (resolvedOnceRef.current) return;
    resolvedOnceRef.current = true;

    const resolveInviteSession = async () => {
      const callbackError = searchParams.get('error');
      const callbackErrorDescription = searchParams.get('error_description');
      if (callbackError) {
        setError(callbackErrorDescription || callbackError);
        setSessionResolving(false);
        return;
      }

      const code = searchParams.get('code');
      const tokenHash = searchParams.get('token_hash');
      const type = searchParams.get('type');

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type && (type === 'invite' || type === 'recovery')) {
          const { error } = await supabase.auth.verifyOtp({
            type,
            token_hash: tokenHash,
          });
          if (error) throw error;
        }
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

    if (!user) {
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
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to set password');
    } finally {
      setLoading(false);
    }
  };

  if (!authLoading && !sessionResolving && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center">Invite Link Required</CardTitle>
            <CardDescription className="text-center">
              Open this page from your invitation email link.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button className="w-full" onClick={() => router.push('/auth/login')}>
              Go to Login
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Set Password</CardTitle>
          <CardDescription className="text-center">
            Complete your invited account setup
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
                <AlertDescription>Preparing invite session...</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={fixedEmail} readOnly disabled />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Input value={fixedRole || 'assigned by admin'} readOnly disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={loading || authLoading || sessionResolving || !user}>
              {(loading || authLoading || sessionResolving) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Set Password
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
