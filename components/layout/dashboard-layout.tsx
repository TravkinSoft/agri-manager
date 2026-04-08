"use client";

import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { SidebarProvider } from "@/lib/contexts/sidebar-context";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto bg-slate-50 p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
