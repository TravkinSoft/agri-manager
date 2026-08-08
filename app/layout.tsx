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
    icon: [
      { url: '/brand/v1/icons/favicon-16-compact-v2.png', type: 'image/png', sizes: '16x16' },
      { url: '/brand/v1/icons/favicon-32-compact-v2.png', type: 'image/png', sizes: '32x32' },
    ],
    shortcut: [{ url: '/brand/v1/icons/favicon-32-compact-v2.png', type: 'image/png', sizes: '32x32' }],
    apple: [{ url: '/brand/v1/icons/apple-touch-icon-180-compact-v2.png', type: 'image/png', sizes: '180x180' }],
  },
  openGraph: {
    images: [
      {
        url: '/brand/v1/travkinflow-logo-154a0d68.png',
        width: 1055,
        height: 195,
        alt: 'TravkinFlow',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: [
      {
        url: '/brand/v1/travkinflow-logo-154a0d68.png',
        width: 1055,
        height: 195,
        alt: 'TravkinFlow',
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
