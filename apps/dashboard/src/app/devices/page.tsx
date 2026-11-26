"use client";

import { useState } from "react";
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
  registered_at: string;
};

type EnrollmentToken = {
  id: string;
  token: string;
  label: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
};

export default function DevicesPage() {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: () => apiFetch<Device[]>("/devices"),
    refetchInterval: 15_000,
  });
  const tokens = useQuery({
    queryKey: ["enrollment-tokens"],
    queryFn: () => apiFetch<EnrollmentToken[]>("/enrollment-tokens"),
  });

  const createToken = useMutation({
    mutationFn: () =>
      apiFetch<EnrollmentToken>("/enrollment-tokens", {
        method: "POST",
        body: JSON.stringify({
          label: label.trim() || "dashboard-issued",
          expires_in_days: 30,
        }),
      }),
    onSuccess: () => {
      setLabel("");
      qc.invalidateQueries({ queryKey: ["enrollment-tokens"] });
    },
  });

  const deleteToken = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/enrollment-tokens/${id}`, { method: "DELETE" }),
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

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch(`/devices/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(token);
    window.setTimeout(() => setCopied(null), 1500);
  }

  return (
    <AppShell title="Devices">
      <div className="mb-6 rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Enrollment tokens</h2>
            <p className="mt-1 text-xs text-muted">
              One token can enroll more than one PC. Delete a token to stop
              new enrollments. PCs already enrolled keep working.
            </p>
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              createToken.mutate();
            }}
          >
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label, for example Reception"
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
              disabled={createToken.isPending}
            >
              Create token
            </button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Label</th>
                <th className="py-2 pr-3 font-medium">Token</th>
                <th className="py-2 pr-3 font-medium">Expires</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(tokens.data ?? []).map((token) => (
                <tr key={token.id} className="border-t border-border">
                  <td className="py-2 pr-3">{token.label ?? "token"}</td>
                  <td className="py-2 pr-3">
                    <code className="text-xs">{token.token}</code>
                  </td>
                  <td className="py-2 pr-3 text-muted">
                    {token.expires_at
                      ? new Date(token.expires_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="text-xs text-accent"
                        onClick={() => copyToken(token.token)}
                      >
                        {copied === token.token ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-red-600"
                        onClick={() => deleteToken.mutate(token.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!tokens.isLoading && (tokens.data?.length ?? 0) === 0 && (
                <tr>
                  <td className="py-4 text-muted" colSpan={4}>
                    No tokens yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Display name</th>
              <th className="px-4 py-3 font-medium">OS</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Authorization</th>
              <th className="px-4 py-3 font-medium">Last seen</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(devices.data ?? []).map((device) => {
              const draft = names[device.id] ?? device.name;
              return (
                <tr key={device.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <input
                      value={draft}
                      onChange={(e) =>
                        setNames((current) => ({
                          ...current,
                          [device.id]: e.target.value,
                        }))
                      }
                      className="w-full min-w-40 rounded-md border border-border px-2 py-1 text-sm"
                    />
                    <div className="mt-1 text-[11px] text-muted">
                      {device.id.slice(0, 8)} · v{device.agent_version}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {device.os} {device.os_version}
                  </td>
                  <td className="px-4 py-3">{device.status}</td>
                  <td className="px-4 py-3">{device.monitoring_authorization}</td>
                  <td className="px-4 py-3 text-muted">
                    {device.last_seen_at
                      ? new Date(device.last_seen_at).toLocaleString()
                      : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="text-xs text-accent"
                        disabled={!draft.trim() || draft.trim() === device.name}
                        onClick={() =>
                          rename.mutate({ id: device.id, name: draft.trim() })
                        }
                      >
                        Save name
                      </button>
                      <button
                        type="button"
                        className="text-xs text-accent"
                        onClick={() =>
                          setAuth.mutate({
                            id: device.id,
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
                            id: device.id,
                            monitoring_authorization: "withdrawn",
                          })
                        }
                      >
                        Withdraw
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!devices.isLoading && (devices.data?.length ?? 0) === 0 && (
              <tr>
                <td className="px-4 py-6 text-muted" colSpan={6}>
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
