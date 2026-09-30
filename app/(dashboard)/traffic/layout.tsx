import type { Metadata } from "next";

// Keep the fixed-scale workflow scoped to the mobile traffic screen. Browser
// accessibility settings can still override this; the rest of the ERP stays unchanged.
export const metadata: Metadata = {
  viewport: {
    width: "device-width",
    initialScale: 1,
    minimumScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
  },
};

export default function TrafficLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
