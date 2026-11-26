"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, setTokens } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin123!");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tokens = await apiFetch<{
        access_token: string | null;
        refresh_token: string | null;
        mfa_required?: boolean;
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          mfa_code: mfaCode || null,
        }),
      });
      if (tokens.mfa_required) {
        setMfaRequired(true);
        return;
      }
      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error("Login failed");
      }
      setTokens(tokens.access_token, tokens.refresh_token);
      router.replace("/");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-6"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent font-semibold text-accent-fg">
            CU
          </div>
          <div>
            <h1 className="text-lg font-semibold">CU Admin</h1>
            <p className="text-sm text-muted">Sign in to continue</p>
          </div>
        </div>
        <label className="mb-3 block text-sm">
          <span className="text-muted">Email</span>
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />
        </label>
        <label className="mb-4 block text-sm">
          <span className="text-muted">Password</span>
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>
        {mfaRequired && (
          <label className="mb-4 block text-sm">
            <span className="text-muted">Authenticator code</span>
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              inputMode="numeric"
              required
            />
          </label>
        )}
        {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-fg"
        >
          {busy ? "Signing in…" : mfaRequired ? "Verify MFA" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
