"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/contexts/auth-context";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader as Loader2 } from "lucide-react";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionResolving, setSessionResolving] = useState(true);
  const { updatePassword, signOut } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const resolvedOnceRef = useRef(false);

  useEffect(() => {
    if (resolvedOnceRef.current) return;
    resolvedOnceRef.current = true;

    const resolveRecoverySession = async () => {
      const callbackError = searchParams?.get("error");
      const callbackErrorDescription = searchParams?.get("error_description");
      if (callbackError) {
        setError(callbackErrorDescription || callbackError);
        setSessionResolving(false);
        return;
      }

      const code = searchParams?.get("code");
      const tokenHash = searchParams?.get("token_hash");
      const type = searchParams?.get("type");

      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (tokenHash && type === "recovery") {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            type: "recovery",
            token_hash: tokenHash,
          });
          if (verifyError) throw verifyError;
        }
      } catch (err: any) {
        setError(err?.message || "Не удалось открыть сессию восстановления пароля.");
      } finally {
        setSessionResolving(false);
      }
    };

    void resolveRecoverySession();
  }, [searchParams]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (sessionResolving) {
      setError("Сначала дождитесь проверки ссылки восстановления.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Пароли не совпадают.");
      return;
    }

    if (password.length < 6) {
      setError("Пароль должен быть не менее 6 символов.");
      return;
    }

    setLoading(true);

    try {
      await updatePassword(password);
      await signOut();
      router.push("/auth/login?password_reset=1");
    } catch (err: any) {
      setError(err.message || "Не удалось обновить пароль.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mobile-safe-bottom mobile-safe-top flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-6">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-center text-2xl font-bold">Новый пароль</CardTitle>
          <CardDescription className="text-center">
            Укажите новый пароль для вашего аккаунта.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {sessionResolving ? (
              <Alert>
                <AlertDescription>Проверяем ссылку восстановления...</AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="password">Новый пароль</Label>
              <Input
                id="password"
                type="password"
                placeholder="Минимум 6 символов"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12"
                required
                disabled={loading || sessionResolving}
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Подтвердите пароль</Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Повторите пароль"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="h-12"
                required
                disabled={loading || sessionResolving}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="h-12 w-full" disabled={loading || sessionResolving}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Сохранить пароль
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
