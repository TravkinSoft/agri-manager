"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/lib/contexts/auth-context";

export default function SpecialistLegacyPage() {
  const router = useRouter();
  const { profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (profile?.role === "global_admin") {
      router.replace("/platform/assistant/settings");
    }
  }, [loading, profile?.role, router]);

  if (loading || profile?.role === "global_admin") {
    return (
      <div className="flex h-48 items-center justify-center text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Перенаправление в настройки ассистента...
      </div>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertDescription>
        Доступ к этой странице закрыт. Используйте ассистента через глобальную правую панель.
      </AlertDescription>
    </Alert>
  );
}

