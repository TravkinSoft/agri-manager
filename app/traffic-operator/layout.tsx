import type { Metadata } from "next";

// Override the ERP manifest only in this independently authenticated cabinet.
export const metadata: Metadata = {
  title: "Оборот машин — TravkinFlow",
  description: "Кабинеты комбайнёра и приёмки картофеля",
  applicationName: "Оборот машин",
  manifest: "/traffic-operator.webmanifest",
  themeColor: "#0c1118",
  viewport: { width: "device-width", initialScale: 1, viewportFit: "cover" },
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
