"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { apiFetch } from "@/lib/api";

type AlertRow = {
  id: string;
  device_id: string | null;
  device_name: string | null;
  severity: string;
  title: string;
  message: string;
  is_resolved: boolean;
  created_at: string;
};

export default function AlertsPage() {
  const qc = useQueryClient();
  const alerts = useQuery({
    queryKey: ["alerts"],
    queryFn: () => apiFetch<AlertRow[]>("/alerts"),
    refetchInterval: 30_000,
  });
  const resolve = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/alerts/${id}/resolve`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const rows = alerts.data ?? [];
  const open = rows.filter((row) => !row.is_resolved);

  return (
    <AppShell title="Alerts">
      <p className="mb-4 text-sm text-muted">
        An alert opens when an authorized device stops checking in, and closes
        when that device checks in again.
      </p>
      {alerts.isError && (
        <p className="mb-4 text-sm text-red-500">Could not load alerts.</p>
      )}
      {alerts.isLoading ? (
        <p className="text-sm text-muted">Loading alerts…</p>
      ) : open.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
          No open alerts.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Device</th>
                <th className="px-4 py-3 font-medium">Alert</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {open.map((alert) => (
                <tr key={alert.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-muted">
                    {new Date(alert.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">{alert.device_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{alert.title}</div>
                    <div className="text-xs text-muted">{alert.message}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="text-xs text-accent"
                      onClick={() => resolve.mutate(alert.id)}
                    >
                      Resolve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
