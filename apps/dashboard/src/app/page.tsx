"use client";

import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { apiFetch } from "@/lib/api";

type Overview = {
  employees: number;
  devices: number;
  online_devices: number;
  offline_devices: number;
  authorized_sessions: number;
  alerts: number;
  screenshots: number;
};

export default function OverviewPage() {
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: () => apiFetch<Overview>("/overview"),
    refetchInterval: 15_000,
  });

  const cards = [
    { label: "Employees", value: overview.data?.employees },
    { label: "Devices", value: overview.data?.devices },
    { label: "Online", value: overview.data?.online_devices },
    { label: "Offline", value: overview.data?.offline_devices },
    { label: "Authorized", value: overview.data?.authorized_sessions },
    { label: "Alerts", value: overview.data?.alerts },
    { label: "Screenshots", value: overview.data?.screenshots },
  ];

  return (
    <AppShell title="Overview">
      {overview.isError && (
        <p className="mb-4 text-sm text-red-500">{String(overview.error)}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <p className="text-sm text-muted">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              {overview.isLoading ? "…" : (card.value ?? "—")}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted">
        Screenshot playback is time-lapse of authorized captures, not continuous
        video. Open Activity for Screenshot or Video (30‑min clip) review.
      </p>
    </AppShell>
  );
}
