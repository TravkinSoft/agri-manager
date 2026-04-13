import { PlatformLayout } from "@/components/layout/platform-layout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PlatformLayout>{children}</PlatformLayout>;
}
