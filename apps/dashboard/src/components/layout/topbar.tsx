"use client";

import { Moon, PanelLeft, Sun } from "lucide-react";

import { useUiStore } from "@/stores/ui-store";

export function Topbar({ title }: { title: string }) {
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const theme = useUiStore((s) => s.theme);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded-md p-2 text-muted hover:bg-muted-bg"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
      </div>
      <button
        type="button"
        onClick={toggleTheme}
        className="rounded-md p-2 text-muted hover:bg-muted-bg"
        aria-label="Toggle theme"
      >
        {theme === "dark" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </button>
    </header>
  );
}
