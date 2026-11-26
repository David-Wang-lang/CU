import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

type SetupStatus = {
  enrolled: boolean;
  daemon_install_stub: boolean;
  config_path: string;
  api_base_url: string;
  device_id: string | null;
  mock_screenshots: boolean;
};

type Step = "enroll" | "install" | "done";

export default function App() {
  const [step, setStep] = useState<Step>("enroll");
  const [apiBaseUrl, setApiBaseUrl] = useState("http://localhost:8000/api/v1");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke<SetupStatus>("get_setup_status")
      .then((s) => {
        setStatus(s);
        setApiBaseUrl(s.api_base_url);
        if (s.enrolled && s.daemon_install_stub) setStep("done");
        else if (s.enrolled) setStep("install");
      })
      .catch((err) => setError(String(err)));
  }, []);

  async function onEnroll(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<SetupStatus>("enroll_device", {
        apiBaseUrl,
        enrollmentToken: token,
      });
      setStatus(next);
      setStep("install");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onInstallDaemon() {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<SetupStatus>("install_daemon_stub_cmd");
      setStatus(next);
      setStep("done");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onFinish() {
    try {
      await invoke("quit_after_install");
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="app">
      <div className="brand">
        <div className="logo">CU</div>
        <div>
          <strong>CU Agent Setup</strong>
          <div className="muted">IT install only · closes after setup</div>
        </div>
      </div>

      <div className="card">
        {step === "enroll" && (
          <form onSubmit={onEnroll}>
            <h2 className="title">Enroll this device</h2>
            <p className="muted">
              For administrators deploying on company-owned devices. After setup
              the agent runs in the background with no employee-facing window or
              notifications.
            </p>
            <label className="field">
              <span>API base URL</span>
              <input
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Enrollment token</span>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Admin-provided token"
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Enrolling…" : "Enroll device"}
            </button>
          </form>
        )}

        {step === "install" && (
          <>
            <h2 className="title">Install background agent</h2>
            <p className="muted">
              Registers headless <code>cu-agent-daemon</code>. No tray icon, no
              status UI, no monitoring notifications. Phase 1 marks a local
              install stub; OS service registration ships in Phase 4.
            </p>
            {status?.device_id && (
              <p className="muted">Device ID: {status.device_id}</p>
            )}
            <button type="button" onClick={onInstallDaemon} disabled={busy}>
              {busy ? "Installing…" : "Install background agent"}
            </button>
          </>
        )}

        {step === "done" && (
          <>
            <h2 className="title">Setup complete</h2>
            <p className="muted">
              Config: <code>{status?.config_path}</code>. Close this window; the
              daemon runs without a UI.
            </p>
            <div className="status">
              <span>Daemon stub</span>
              <span className="pill">
                {status?.daemon_install_stub ? "registered" : "pending"}
              </span>
            </div>
            <button type="button" onClick={onFinish}>
              Finish and close
            </button>
          </>
        )}

        {error && (
          <p className="muted" style={{ marginTop: "0.75rem", color: "#f87171" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
