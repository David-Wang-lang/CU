"use client";

import {
  Activity,
  AlertTriangle,
  HardDrive,
  LayoutDashboard,
  Monitor,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/employees", label: "Employees", icon: Users },
  { href: "/devices", label: "Devices", icon: Monitor },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/alerts", label: "Alerts", icon: AlertTriangle },
  { href: "/storage", label: "Storage", icon: HardDrive },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-border bg-sidebar text-sidebar-fg transition-all",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent font-semibold text-accent-fg">
          CU
        </div>
        {!collapsed && (
          <div>
            <p className="text-sm font-semibold tracking-tight">CU</p>
            <p className="text-xs text-muted">Endpoint Monitor</p>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {nav.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-accent/15 text-accent font-medium"
                  : "text-muted hover:bg-muted-bg hover:text-sidebar-fg",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
