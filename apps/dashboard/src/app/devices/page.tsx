"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
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
  is_hidden: boolean;
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
    queryKey: ["devices", "all"],
    queryFn: () => apiFetch<Device[]>("/devices?include_hidden=true"),
    refetchInterval: 15_000,
  });
  const tokens = useQuery({
    queryKey: ["enrollment-tokens"],
    queryFn: () => apiFetch<EnrollmentToken[]>("/enrollment-tokens"),
  });

  const visible = useMemo(
    () => (devices.data ?? []).filter((d) => !d.is_hidden),
    [devices.data],
  );
  const hidden = useMemo(
    () => (devices.data ?? []).filter((d) => d.is_hidden),
    [devices.data],
  );

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

  const setHidden = useMutation({
    mutationFn: ({ id, is_hidden }: { id: string; is_hidden: boolean }) =>
      apiFetch(`/devices/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_hidden }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
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

      <DeviceTable
        title="Devices"
        empty="No devices enrolled yet."
        devices={visible}
        names={names}
        setNames={setNames}
        rename={rename.mutate}
        setAuth={setAuth.mutate}
        onHide={(id) => setHidden.mutate({ id, is_hidden: true })}
      />

      <div className="mt-6">
        <DeviceTable
          title={`Hidden devices (${hidden.length})`}
          empty="No hidden devices."
          devices={hidden}
          names={names}
          setNames={setNames}
          rename={rename.mutate}
          setAuth={setAuth.mutate}
          onShow={(id) => setHidden.mutate({ id, is_hidden: false })}
          muted
        />
      </div>
    </AppShell>
  );
}

function DeviceTable({
  title,
  empty,
  devices,
  names,
  setNames,
  rename,
  setAuth,
  onHide,
  onShow,
  muted,
}: {
  title: string;
  empty: string;
  devices: Device[];
  names: Record<string, string>;
  setNames: Dispatch<SetStateAction<Record<string, string>>>;
  rename: (args: { id: string; name: string }) => void;
  setAuth: (args: { id: string; monitoring_authorization: string }) => void;
  onHide?: (id: string) => void;
  onShow?: (id: string) => void;
  muted?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-border bg-surface ${
        muted ? "opacity-90" : ""
      }`}
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {onShow ? (
          <p className="mt-1 text-xs text-muted">
            Hidden devices stay enrolled and keep history. Show them again any
            time. They are left out of Activity and Overview.
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">
            Hide a device to clear it from Activity without deleting history.
          </p>
        )}
      </div>
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
          {devices.map((device) => {
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
                        rename({ id: device.id, name: draft.trim() })
                      }
                    >
                      Save name
                    </button>
                    <button
                      type="button"
                      className="text-xs text-accent"
                      onClick={() =>
                        setAuth({
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
                        setAuth({
                          id: device.id,
                          monitoring_authorization: "withdrawn",
                        })
                      }
                    >
                      Withdraw
                    </button>
                    {onHide ? (
                      <button
                        type="button"
                        className="text-xs text-muted"
                        onClick={() => onHide(device.id)}
                      >
                        Hide
                      </button>
                    ) : null}
                    {onShow ? (
                      <button
                        type="button"
                        className="text-xs text-accent"
                        onClick={() => onShow(device.id)}
                      >
                        Show again
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
          {devices.length === 0 && (
            <tr>
              <td className="px-4 py-6 text-muted" colSpan={6}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
