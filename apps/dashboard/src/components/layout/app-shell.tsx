"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export function AppShell({
  title,
  children,
  mainClassName,
}: {
  title: string;
  children: React.ReactNode;
  mainClassName?: string;
}) {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar title={title} />
        <main className={mainClassName ?? "min-h-0 flex-1 overflow-auto p-6"}>
          {children}
        </main>
      </div>
    </div>
  );
}
