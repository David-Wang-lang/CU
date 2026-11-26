"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { apiFetch } from "@/lib/api";

type StorageAnalytics = {
  total_bytes: number;
  used_bytes: number;
  available_bytes: number | null;
  screenshot_count: number;
  by_device: {
    device_id: string;
    device_name: string;
    screenshot_count: number;
    bytes: number;
  }[];
  daily_growth_bytes: number;
  estimated_30d_bytes: number;
  retention_days: number;
  cleanup: {
    ran_at: string | null;
    next_scheduled: string | null;
    deleted_records: number;
    deleted_files: number;
  };
};

type Retention = {
  retention_days: number;
  custom_days: number | null;
  options: number[];
};

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export default function StoragePage() {
  const qc = useQueryClient();
  const [confirmCleanup, setConfirmCleanup] = useState("");
  const analytics = useQuery({
    queryKey: ["storage-analytics"],
    queryFn: () => apiFetch<StorageAnalytics>("/storage/analytics"),
    refetchInterval: 20_000,
  });
  const retention = useQuery({
    queryKey: ["retention"],
    queryFn: () => apiFetch<Retention>("/retention"),
  });

  const updateRetention = useMutation({
    mutationFn: (days: number) =>
      apiFetch("/retention", {
        method: "PUT",
        body: JSON.stringify({
          retention_days: retention.data?.options.includes(days) ? days : 5,
          custom_days: retention.data?.options.includes(days) ? null : days,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["retention"] });
      qc.invalidateQueries({ queryKey: ["storage-analytics"] });
    },
  });

  const cleanup = useMutation({
    mutationFn: () => apiFetch("/retention/cleanup", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["storage-analytics"] }),
  });

  const a = analytics.data;

  return (
    <AppShell title="Storage">
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="Used" value={a ? fmtBytes(a.used_bytes) : "…"} />
        <Card label="Screenshots" value={a?.screenshot_count ?? "…"} />
        <Card
          label="Daily growth"
          value={a ? fmtBytes(a.daily_growth_bytes) : "…"}
        />
        <Card
          label="Est. 30-day"
          value={a ? fmtBytes(a.estimated_30d_bytes) : "…"}
        />
      </div>

      <div className="mb-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">Retention policy</h2>
        <div className="flex flex-wrap gap-2">
          {(retention.data?.options ?? [3, 5, 7, 15, 30, 60, 90]).map((d) => {
            const active =
              (retention.data?.custom_days ?? retention.data?.retention_days) ===
              d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => updateRetention.mutate(d)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  active
                    ? "bg-accent text-accent-fg"
                    : "border border-border text-muted"
                }`}
              >
                {d} day{d === 1 ? "" : "s"}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted">
          Current effective retention:{" "}
          {a?.retention_days ?? retention.data?.retention_days ?? "—"} days.
          Screenshots older than that are deleted. 3 or 5 days is the usual
          choice. Cleanup runs hourly in the API process (and via Celery when
          Redis is available).
        </p>
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-800">
            Run cleanup now deletes screenshots older than the selected
            retention. This cannot be undone.
          </p>
          <label className="mt-3 block text-xs text-red-900">
            Type DELETE to confirm
            <input
              value={confirmCleanup}
              onChange={(e) => setConfirmCleanup(e.target.value)}
              className="mt-1 w-full max-w-xs rounded-md border border-red-200 bg-white px-2 py-1.5 text-sm text-foreground"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            onClick={() => {
              cleanup.mutate();
              setConfirmCleanup("");
            }}
            disabled={cleanup.isPending || confirmCleanup !== "DELETE"}
          >
            {cleanup.isPending ? "Deleting…" : "Delete expired screenshots"}
          </button>
        </div>
        {a?.cleanup?.ran_at && (
          <p className="mt-2 text-xs text-muted">
            Last cleanup: {new Date(a.cleanup.ran_at).toLocaleString()} ·
            deleted {a.cleanup.deleted_records} records /{" "}
            {a.cleanup.deleted_files} files
            {a.cleanup.next_scheduled
              ? ` · next ~ ${new Date(a.cleanup.next_scheduled).toLocaleString()}`
              : ""}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Device</th>
              <th className="px-4 py-3 font-medium">Screenshots</th>
              <th className="px-4 py-3 font-medium">Storage</th>
            </tr>
          </thead>
          <tbody>
            {(a?.by_device ?? []).map((d) => (
              <tr key={d.device_id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">{d.device_name}</td>
                <td className="px-4 py-3">{d.screenshot_count}</td>
                <td className="px-4 py-3">{fmtBytes(d.bytes)}</td>
              </tr>
            ))}
            {(a?.by_device?.length ?? 0) === 0 && (
              <tr>
                <td className="px-4 py-6 text-muted" colSpan={3}>
                  No storage usage yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
