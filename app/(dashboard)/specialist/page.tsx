'use client';

import { useRouter } from 'next/navigation';
import { PageHeader } from "@/components/layout/page-header";
import { PersistentChatInterface } from "@/components/specialist/persistent-chat-interface";
import { useLanguage } from "@/lib/contexts/language-context";
import { useAuth } from "@/lib/contexts/auth-context";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Settings } from "lucide-react";

export default function SpecialistPage() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const router = useRouter();

  const canManageSettings =
    profile?.role === 'admin' ||
    profile?.role === 'company_admin' ||
    profile?.role === 'global_admin' ||
    profile?.role === 'agronomist';

  if (profile?.role === 'warehouse') {
    return (
      <div>
        <PageHeader
          title={t('ai_specialist')}
          description={t('chat_placeholder')}
        />
        <Alert variant="destructive">
          <AlertDescription>
            Access denied. AI Assistant is not available for warehouse staff.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('ai_specialist')}
        description={t('chat_placeholder')}
        action={canManageSettings ? {
          label: t('settings'),
          icon: Settings,
          onClick: () => router.push('/specialist/settings'),
        } : undefined}
      />
      <PersistentChatInterface />
    </div>
  );
}
