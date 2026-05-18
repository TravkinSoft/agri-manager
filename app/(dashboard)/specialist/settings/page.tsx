"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/lib/contexts/auth-context";

export default function SpecialistSettingsLegacyPage() {
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
        Эта страница устарела. Настройки ассистента доступны только global_admin в разделе Platform.
      </AlertDescription>
    </Alert>
  );
}

