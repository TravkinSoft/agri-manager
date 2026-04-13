'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Language, translations, TranslationKey } from '@/lib/i18n/translations';
import { supabase } from '@/lib/supabase/client';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('ru');
  const [initialized, setInitialized] = useState(false);

  const isLanguage = (value: unknown): value is Language =>
    value === 'ru' || value === 'en' || value === 'kz';

  useEffect(() => {
    const init = async () => {
      const saved = localStorage.getItem('language');
      if (isLanguage(saved)) {
        setLanguageState(saved);
      }

      const cookieMatch =
        typeof document !== 'undefined'
          ? document.cookie.match(/(?:^|;\s*)language=(ru|en|kz)(?:;|$)/)
          : null;
      if (!saved && cookieMatch?.[1] && isLanguage(cookieMatch[1])) {
        setLanguageState(cookieMatch[1]);
      }

      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      if (userId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('preferred_language')
          .eq('id', userId)
          .maybeSingle();
        const preferred = profile?.preferred_language;
        if (isLanguage(preferred)) {
          setLanguageState(preferred);
          localStorage.setItem('language', preferred);
          document.cookie = `language=${preferred}; path=/; max-age=31536000; samesite=lax`;
        }
      }
      setInitialized(true);
    };

    init();
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('language', lang);
    document.cookie = `language=${lang}; path=/; max-age=31536000; samesite=lax`;
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (!initialized) return;
    const sync = async () => {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      if (!userId) return;
      await supabase
        .from('profiles')
        .update({ preferred_language: language })
        .eq('id', userId);
    };
    sync();
  }, [language, initialized]);

  const t = (key: TranslationKey): string => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
