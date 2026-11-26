# Security & Privacy

## Intended use

CU monitors **company-owned** devices under organizational policy. Workforce awareness of monitoring is handled by **company policy / HR** (outside the agent). The agent itself does **not** show employee-facing monitoring UI, toasts, or “recording” notifications.

## In scope

- Authorized screen captures during approved sessions
- Aggregate keyboard activity counts (**not** typed content)
- Application-level business audit events
- Device login/logout and connectivity
- DLP policy violation events
- Administrator audit when viewing sensitive records

## Out of scope / forbidden

- Collecting passwords, tokens, or raw keystrokes
- Recording private communications content
- Public URLs for monitoring objects
- Silent/hidden agents or permission bypasses
- Hardcoded production secrets in source

## Controls (phased)

| Control | Phase |
|---------|-------|
| HTTPS for all network traffic | 7 (dev: local HTTP ok) |
| Device-specific credentials | 2 |
| Short-lived JWT + refresh rotation | 2 |
| Admin MFA (TOTP) | 2 |
| RBAC + org isolation | 2 |
| Rate limiting & input validation | 2–6 |
| Private MinIO buckets (no anonymous) | 1 (init) / 5 |
| Encryption at rest (volumes / bucket policies) | 5–7 |
| Signed installers + notarization | 7 |
| Dependency scanning in CI | 6–7 |

## Agent principles

- **CU Agent Setup** (Tauri) is an **IT-only** one-time enrollment installer — then exits.
- Continuous monitoring runs in headless **cu-agent-daemon** with **no tray, no status window, no CU notifications**.
- Do not brand or announce the monitoring service to end users via CU UI.
- Remain manageable by IT: do not hide from system management / inventory tools or bypass OS permission frameworks.
- Stop collection immediately when authorization is withdrawn.
- Prefer mock capture in development (`mock_screenshots = true` / `CU_MOCK_SCREENSHOTS=true`).
- Note: some OS capture APIs may still surface **system** privacy indicators outside CU’s control; we do not add our own, and we do not implement permission/indicator bypasses.

## Secrets

Use `.env` locally and a secrets manager in production. Rotate `SECRET_KEY`, DB passwords, MinIO keys, and device credentials on a defined schedule.
