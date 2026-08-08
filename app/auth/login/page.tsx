"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader as Loader2 } from "lucide-react";
import { TravkinLogo } from "@/components/layout/travkin-logo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const infoMessage =
    searchParams?.get("registered") === "1"
      ? "Email подтверждён. Теперь войдите с вашим email и паролем."
      : searchParams?.get("password_reset") === "1"
        ? "Пароль обновлён. Войдите с новым паролем."
        : searchParams?.get("invite_setup") === "1"
          ? "Регистрация завершена. Войдите с email и новым паролем."
          : "";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { defaultPath } = await signIn(email, password);
      router.push(defaultPath);
    } catch (err: any) {
      setError(err.message || "Неверный email или пароль");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mobile-safe-bottom mobile-safe-top flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-6">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="space-y-1">
          <TravkinLogo size="large" className="mx-auto mb-4" />
          <CardTitle className="text-center text-2xl font-bold">Вход</CardTitle>
          <CardDescription className="text-center">Введите email и пароль</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {infoMessage && !error ? (
              <Alert>
                <AlertDescription>{infoMessage}</AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-12"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                placeholder="Введите пароль"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12"
                required
                disabled={loading}
              />
            </div>
            <div className="flex justify-end">
              <Link href="/auth/forgot-password" className="text-sm text-blue-600 hover:underline">
                Забыли пароль?
              </Link>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <Button type="submit" className="h-12 w-full" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Войти
            </Button>
            <div className="text-center text-sm text-slate-600">
              Нет аккаунта?{" "}
              <Link href="/auth/register" className="font-medium text-blue-600 hover:underline">
                Зарегистрироваться
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
