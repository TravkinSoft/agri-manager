"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MailCheck, RotateCcw } from "lucide-react";
import { useAuth } from "@/lib/contexts/auth-context";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const CODE_TTL_SECONDS = 60;

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function formatSeconds(value: number) {
  return `${Math.max(0, Math.ceil(value))} сек`;
}

export default function RegisterPage() {
  const router = useRouter();
  const { signUp, verifySignupCode, resendSignupCode } = useAuth();
  const [step, setStep] = useState<"form" | "verify">("form");
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (step !== "verify") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const secondsSinceSent = codeSentAt ? (now - codeSentAt) / 1000 : 0;
  const secondsLeft = codeSentAt ? Math.max(0, CODE_TTL_SECONDS - secondsSinceSent) : 0;
  const canResend = step === "verify" && (!codeSentAt || secondsSinceSent >= CODE_TTL_SECONDS);
  const codeExpired = step === "verify" && Boolean(codeSentAt) && secondsLeft <= 0;

  const startCodeTimer = () => {
    setCodeSentAt(Date.now());
    setNow(Date.now());
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const nextCompanyName = normalizeText(companyName);
    const nextFullName = normalizeText(fullName);
    const nextEmail = normalizedEmail;

    if (!nextCompanyName || !nextFullName || !nextEmail) {
      setError("Заполните название компании, ФИО и email.");
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
      await signUp({
        email: nextEmail,
        password,
        fullName: nextFullName,
        companyName: nextCompanyName,
      });

      setEmail(nextEmail);
      setCompanyName(nextCompanyName);
      setFullName(nextFullName);
      setCode("");
      setStep("verify");
      startCodeTimer();
      setSuccess("Код подтверждения отправлен на указанную почту.");
    } catch (signupError: any) {
      setError(signupError?.message || "Не удалось создать компанию.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const nextCode = code.trim();
    if (!nextCode) {
      setError("Введите код из письма.");
      return;
    }
    if (codeExpired) {
      setError("Код истёк. Отправьте новый код.");
      return;
    }

    setLoading(true);
    try {
      await verifySignupCode(normalizedEmail, nextCode);
      setSuccess("Email подтверждён. Теперь войдите с вашим email и паролем.");
      window.setTimeout(() => router.push("/auth/login?registered=1"), 900);
    } catch (verifyError: any) {
      setError("Код неверный или истёк. Проверьте письмо или запросите новый код через 60 секунд.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setError("");
    setSuccess("");
    setResending(true);
    try {
      await resendSignupCode(normalizedEmail);
      setCode("");
      startCodeTimer();
      setSuccess("Новый код отправлен на почту.");
    } catch (resendError: any) {
      setError(resendError?.message || "Не удалось отправить код повторно.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="mobile-safe-bottom mobile-safe-top flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-6">
      <Card className="w-full max-w-lg shadow-xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-center text-2xl font-bold">
            {step === "verify" ? "Подтверждение email" : "Регистрация компании"}
          </CardTitle>
          <CardDescription className="text-center">
            {step === "verify"
              ? `Введите код, который пришёл на ${normalizedEmail}.`
              : "Первый пользователь компании получает роль администратора компании."}
          </CardDescription>
        </CardHeader>

        {step === "form" ? (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {success ? (
                <Alert>
                  <AlertDescription>{success}</AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="company-name">Название компании</Label>
                <Input
                  id="company-name"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder='ТОО "Агро..."'
                  className="h-12"
                  disabled={loading}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="full-name">ФИО</Label>
                <Input
                  id="full-name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Иванов Иван Иванович"
                  className="h-12"
                  disabled={loading}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  className="h-12"
                  disabled={loading}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Пароль</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-12"
                  disabled={loading}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Подтверждение пароля</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="h-12"
                  disabled={loading}
                  required
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="h-12 w-full" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Создать компанию
              </Button>
              <div className="text-center text-sm text-slate-600">
                Уже есть аккаунт?{" "}
                <Link href="/auth/login" className="font-medium text-blue-600 hover:underline">
                  Войти
                </Link>
              </div>
            </CardFooter>
          </form>
        ) : (
          <form onSubmit={handleVerify}>
            <CardContent className="space-y-4">
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {success ? (
                <Alert>
                  <AlertDescription>{success}</AlertDescription>
                </Alert>
              ) : null}

              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <div className="flex items-center gap-2 font-medium">
                  <MailCheck className="h-4 w-4" />
                  Код действует 1 минуту
                </div>
                <div className="mt-1 text-blue-800">
                  {codeExpired ? "Срок кода истёк." : `Осталось: ${formatSeconds(secondsLeft)}`}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-code">Код подтверждения</Label>
                <Input
                  id="signup-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="Введите код из письма"
                  className="h-12 text-center text-lg tracking-[0.3em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  disabled={loading}
                  required
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="h-12 w-full" disabled={loading || codeExpired}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Подтвердить email
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full"
                disabled={!canResend || resending}
                onClick={handleResend}
              >
                {resending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                {canResend ? "Отправить код заново" : `Повторно через ${formatSeconds(secondsLeft)}`}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full"
                disabled={loading || resending}
                onClick={() => {
                  setStep("form");
                  setError("");
                  setSuccess("");
                }}
              >
                Изменить данные регистрации
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
