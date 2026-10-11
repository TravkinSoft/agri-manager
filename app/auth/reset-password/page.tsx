"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/contexts/auth-context";
import { supabase, isPasswordRecoverySession, exchangePasswordRecoveryCode, verifyPasswordRecoveryToken, resumePasswordRecoveryCallback, clearPasswordRecoverySession } from "@/lib/supabase/client";
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
  const [sessionReady, setSessionReady] = useState(false);
  const { updatePassword, signOut } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const resolvedOnceRef = useRef(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (resolvedOnceRef.current) return;
    resolvedOnceRef.current = true;

    const resolveRecoverySession = async () => {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const callbackError = searchParams?.get("error") || hashParams.get("error");
      const callbackErrorDescription = searchParams?.get("error_description") || hashParams.get("error_description");
      if (callbackError) {
        clearPasswordRecoverySession();
        setError(callbackErrorDescription || callbackError);
        setSessionResolving(false);
        return;
      }

      const code = searchParams?.get("code");
      const tokenHash = searchParams?.get("token_hash");
      const type = searchParams?.get("type");

      try {
        if (code) {
          if (!await resumePasswordRecoveryCallback("code", code)) await exchangePasswordRecoveryCode(code);
        } else if (tokenHash) {
          if (type !== "recovery") {
            throw new Error("Это не ссылка восстановления пароля. Запросите новую ссылку.");
          }
          if (!await resumePasswordRecoveryCallback("token_hash", tokenHash)) await verifyPasswordRecoveryToken(tokenHash);
        }

        // getSession waits for SDK initialization, including implicit recovery
        // links whose URL fragment has already been consumed by the client.
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session || !await isPasswordRecoverySession(sessionData.session)) {
          throw new Error("Ссылка восстановления отсутствует или истекла. Запросите новую ссылку.");
        }
        // The early SDK-event receipt handles interrupted reload. Remove URL
        // material only after full validation succeeds.
        if (code || tokenHash) {
          const url = new URL(window.location.href);
          for (const parameter of ["code", "token_hash", "type"]) url.searchParams.delete(parameter);
          url.hash = "";
          window.history.replaceState(window.history.state, "", url.toString());
        }
        setSessionReady(true);
      } catch (err: any) {
        clearPasswordRecoverySession();
        setError(err?.message || "Не удалось открыть сессию восстановления пароля.");
      } finally {
        setSessionResolving(false);
      }
    };

    void resolveRecoverySession();
  }, [searchParams]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setError("");

    if (sessionResolving) {
      setError("Сначала дождитесь проверки ссылки восстановления.");
      return;
    }

    if (!sessionReady) {
      setError("Сессия восстановления недействительна. Запросите новую ссылку.");
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

    submittingRef.current = true;
    setLoading(true);

    try {
      const { data: currentSession, error: currentSessionError } = await supabase.auth.getSession();
      if (currentSessionError) throw currentSessionError;
      if (!currentSession.session || !await isPasswordRecoverySession(currentSession.session)) {
        setSessionReady(false);
        throw new Error("Сессия восстановления недействительна. Запросите новую ссылку.");
      }
      await updatePassword(password);
      clearPasswordRecoverySession();
      setSessionReady(false);
      await signOut();
      router.push("/auth/login?password_reset=1");
    } catch (err: any) {
      setError(err.message || "Не удалось обновить пароль.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="mobile-safe-bottom mobile-safe-top flex min-h-screen items-center justify-center bg-background px-4 py-6">
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
            {!sessionResolving && !sessionReady ? (
              <Link href="/auth/forgot-password" className="block text-sm underline underline-offset-4">
                Запросить ссылку восстановления
              </Link>
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
                disabled={loading || sessionResolving || !sessionReady}
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
                disabled={loading || sessionResolving || !sessionReady}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="h-12 w-full" disabled={loading || sessionResolving || !sessionReady}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Сохранить пароль
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
