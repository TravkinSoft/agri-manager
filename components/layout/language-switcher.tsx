'use client';

import { useLanguage } from '@/lib/contexts/language-context';
import { Button } from '@/components/ui/button';
import { Language } from '@/lib/i18n/translations';

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  const languages: { code: Language; label: string }[] = [
    { code: 'ru', label: 'RU' },
    { code: 'en', label: 'EN' },
    { code: 'kz', label: 'KZ' },
  ];

  return (
    <div className="flex items-center gap-0.5 rounded-xl bg-[#0B0F17]/60 p-0.5">
      {languages.map((lang) => (
        <Button
          key={lang.code}
          variant={language === lang.code ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setLanguage(lang.code)}
          aria-label={lang.label}
          className="h-8 min-w-8 rounded-lg px-2 text-xs font-medium"
        >
          {lang.label}
        </Button>
      ))}
    </div>
  );
}
