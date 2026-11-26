"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { apiFetch } from "@/lib/api";

type Device = {
  id: string;
  name: string;
  os: string;
  os_version: string;
  agent_version: string;
  status: string;
  monitoring_authorization: string;
  last_seen_at: string | null;
};

type EnrollmentToken = {
  id: string;
  token: string;
  label: string | null;
  is_active: boolean;
};

export default function DevicesPage() {
  const qc = useQueryClient();
  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: () => apiFetch<Device[]>("/devices"),
    refetchInterval: 10_000,
  });
  const tokens = useQuery({
    queryKey: ["enrollment-tokens"],
    queryFn: () => apiFetch<EnrollmentToken[]>("/enrollment-tokens"),
  });

  const createToken = useMutation({
    mutationFn: () =>
      apiFetch<EnrollmentToken>("/enrollment-tokens", {
        method: "POST",
        body: JSON.stringify({ label: "dashboard-issued", expires_in_days: 30 }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["enrollment-tokens"] }),
  });

  const setAuth = useMutation({
    mutationFn: ({
      id,
      monitoring_authorization,
    }: {
      id: string;
      monitoring_authorization: string;
    }) =>
      apiFetch(`/devices/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ monitoring_authorization }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  return (
    <AppShell title="Devices">
      <div className="mb-6 rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Enrollment tokens</h2>
          <button
            type="button"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
            onClick={() => createToken.mutate()}
          >
            Create token
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {(tokens.data ?? []).slice(0, 5).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted-bg px-2 py-1 text-xs">{t.token}</code>
              <span className="text-muted">{t.label ?? "token"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Paste a token into CU Agent Setup. Newest seed/default token is listed
          first after create.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">OS</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Authorization</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(devices.data ?? []).map((d) => (
              <tr key={d.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <div>{d.name}</div>
                  <div className="text-xs text-muted">v{d.agent_version}</div>
                </td>
                <td className="px-4 py-3">
                  {d.os} {d.os_version}
                </td>
                <td className="px-4 py-3">{d.status}</td>
                <td className="px-4 py-3">{d.monitoring_authorization}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-accent"
                      onClick={() =>
                        setAuth.mutate({
                          id: d.id,
                          monitoring_authorization: "authorized",
                        })
                      }
                    >
                      Authorize
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted"
                      onClick={() =>
                        setAuth.mutate({
                          id: d.id,
                          monitoring_authorization: "withdrawn",
                        })
                      }
                    >
                      Withdraw
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!devices.isLoading && (devices.data?.length ?? 0) === 0 && (
              <tr>
                <td className="px-4 py-6 text-muted" colSpan={5}>
                  No devices enrolled yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
