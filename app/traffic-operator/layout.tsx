import type { Metadata } from "next";

// Override the ERP manifest only in this independently authenticated cabinet.
export const metadata: Metadata = {
  title: "Оборот машин — TravkinFlow",
  description: "Кабинеты комбайнёра и приёмки картофеля",
  applicationName: "Оборот машин",
  manifest: "/traffic-operator.webmanifest",
  themeColor: "#0c1118",
  // This operator-only viewport follows the requested fixed-scale workflow.
  // Browser accessibility settings may override it; do not change the ERP root.
  viewport: {
    width: "device-width",
    initialScale: 1,
    minimumScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
  },
  appleWebApp: {
    capable: true,
    title: "Оборот машин",
    statusBarStyle: "black-translucent",
  },
};

export default function TrafficOperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
