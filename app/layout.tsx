import './globals.css';
import "maplibre-gl/dist/maplibre-gl.css";
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/toaster';
import { PublicAwareProviders } from '@/components/auth/public-aware-providers';
import { OfflineRuntime } from '@/components/offline/offline-runtime';
import { getPublicAppUrl } from '@/lib/utils/app-url';

const inter = Inter({ subsets: ['latin', 'cyrillic'] });
const metadataBase = new URL(getPublicAppUrl());

export const metadata: Metadata = {
  title: 'TravkinFlow - AI-native Agro ERP / AgriOS',
  description: 'Operational AI-native platform for fields, operations, weighbridge, warehouses, ledger and harvest flow',
  metadataBase,
  manifest: '/manifest.webmanifest',
  themeColor: '#e0b100',
  appleWebApp: {
    capable: true,
    title: 'TravkinFlow',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: '/travkin-icon.svg',
    apple: '/travkin-icon.svg',
  },
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
        <PublicAwareProviders>
          {children}
          <OfflineRuntime />
        </PublicAwareProviders>
        <Toaster />
      </body>
    </html>
  );
}
