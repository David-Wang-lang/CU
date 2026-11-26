# CU Agent

Two binaries:

| Binary | Role |
|--------|------|
| **CU Agent Setup** (Tauri) | IT-only install / enrollment — then exits (no employee UI) |
| **cu-agent-daemon** (Rust) | Headless background monitoring — no UI window |

Continuous monitoring does **not** run inside Tauri. Production packages (Phase 7) wrap both in MSI/PKG/DMG.

## Setup wizard (Tauri)

```bash
pnpm --filter @cu/agent setup:dev
# or
pnpm --filter @cu/agent tauri:dev
```

Writes `agent.toml` under:

- macOS: `~/Library/Application Support/CU/agent.toml`
- Windows: `%ProgramData%\CU\agent.toml`

## Headless daemon

```bash
# After enrollment via Setup
cd apps/agent
cargo run -p cu-agent-daemon
# or
pnpm --filter @cu/agent daemon:run
```

Phase 1 loop: heartbeat stub + mock screenshot tick. Real capture and OS autostart are Phase 4.

## Tests

```bash
cd apps/agent
cargo test -p cu-agent-core
cargo check -p cu-agent-daemon
cargo check -p cu-agent
```
