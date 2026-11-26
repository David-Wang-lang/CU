"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { apiFetch, clearTokens } from "@/lib/api";

type Me = {
  email: string;
  full_name: string;
  role: string;
  organization_id: string;
  mfa_enabled: boolean;
};

type MfaSetup = {
  secret: string;
  otpauth_url: string;
  mfa_enabled: boolean;
};

export default function SettingsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<MfaSetup | null>(null);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/auth/me"),
  });

  const startSetup = useMutation({
    mutationFn: () => apiFetch<MfaSetup>("/auth/mfa/setup", { method: "POST" }),
    onSuccess: (data) => setSetup(data),
  });

  const enable = useMutation({
    mutationFn: () =>
      apiFetch("/auth/mfa/enable", {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
    onSuccess: () => {
      setCode("");
      setSetup(null);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const disable = useMutation({
    mutationFn: (password: string) =>
      apiFetch("/auth/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ password, code }),
      }),
    onSuccess: () => {
      setCode("");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  return (
    <AppShell title="Settings">
      <div className="max-w-lg space-y-4 rounded-lg border border-border bg-surface p-4 text-sm">
        <p>
          <span className="text-muted">Admin:</span> {me.data?.full_name} (
          {me.data?.email})
        </p>
        <p>
          <span className="text-muted">Role:</span> {me.data?.role}
        </p>
        <p>
          <span className="text-muted">MFA:</span>{" "}
          {me.data?.mfa_enabled ? "Enabled" : "Disabled"}
        </p>

        <div className="border-t border-border pt-4">
          <h2 className="mb-2 font-semibold">Authenticator MFA</h2>
          {!me.data?.mfa_enabled ? (
            <>
              <button
                type="button"
                className="rounded-md bg-accent px-3 py-1.5 text-accent-fg"
                onClick={() => startSetup.mutate()}
              >
                Set up MFA
              </button>
              {setup && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted break-all">
                    Secret: <code>{setup.secret}</code>
                  </p>
                  <p className="text-xs text-muted break-all">
                    otpauth: {setup.otpauth_url}
                  </p>
                  <input
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                    placeholder="Enter 6-digit code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5"
                    onClick={() => enable.mutate()}
                  >
                    Enable MFA
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2"
                placeholder="Current MFA code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5"
                onClick={() => {
                  const password = window.prompt("Confirm password") || "";
                  if (password) disable.mutate(password);
                }}
              >
                Disable MFA
              </button>
            </div>
          )}
        </div>

        <p className="text-muted">
          Screenshot views are audit-logged. Retention and cleanup are on the
          Storage page. Rate limiting is enabled on the API (120 req/min default).
        </p>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2"
          onClick={() => {
            clearTokens();
            router.replace("/login");
          }}
        >
          Sign out
        </button>
      </div>
    </AppShell>
  );
}
