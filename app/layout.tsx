import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/toaster';
import { LanguageProvider } from '@/lib/contexts/language-context';
import { AuthProvider } from '@/lib/contexts/auth-context';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { getPublicAppUrl } from '@/lib/utils/app-url';

const inter = Inter({ subsets: ['latin', 'cyrillic'] });
const metadataBase = new URL(getPublicAppUrl());

export const metadata: Metadata = {
  title: 'AgriManager - Agricultural Management System',
  description: 'Comprehensive agricultural management platform for modern farming',
  metadataBase,
  openGraph: {
    images: [
      {
        url: 'https://bolt.new/static/og_default.png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: [
      {
        url: 'https://bolt.new/static/og_default.png',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className={inter.className}>
        <AuthProvider>
          <LanguageProvider>
            <ProtectedRoute>
              {children}
            </ProtectedRoute>
            <Toaster />
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
