//! OS autostart registration for the headless daemon.
//!
//! macOS LaunchAgents appear under Login Items and trigger an
//! "App Background Activity" system notification. For employee-facing
//! company devices we **do not** register a LaunchAgent by default —
//! IT / MDM should start the daemon without Login Items UI.
//! Set `CU_INSTALL_LAUNCH_AGENT=true` only when you intentionally want
//! a user-visible Login Item.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

use crate::config::config_dir;
use crate::CoreError;

const MACOS_LABEL: &str = "com.cu.agent.daemon";

/// Install autostart. On macOS this is a no-op unless `CU_INSTALL_LAUNCH_AGENT=true`.
pub fn install_daemon_autostart(daemon_bin: PathBuf) -> Result<PathBuf, CoreError> {
    #[cfg(target_os = "macos")]
    {
        let want = std::env::var("CU_INSTALL_LAUNCH_AGENT")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if !want {
            // Ensure any previously installed agent is removed so notifications stop.
            let _ = uninstall_macos_launch_agent();
            let marker = config_dir()?.join("autostart.disabled");
            fs::write(
                &marker,
                format!(
                    "LaunchAgent not installed (avoids Login Items / background-activity alerts).\n\
                     Start the daemon via IT/MDM or `./scripts/dev-all.sh`.\n\
                     Binary: {}\n\
                     To force a Login Item: CU_INSTALL_LAUNCH_AGENT=true\n",
                    daemon_bin.display()
                ),
            )?;
            return Ok(marker);
        }
        return install_macos_launch_agent(daemon_bin);
    }
    #[cfg(target_os = "windows")]
    {
        return install_windows_stub(daemon_bin);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = daemon_bin;
        let marker = config_dir()?.join("autostart.stub");
        fs::write(&marker, b"unsupported platform stub\n")?;
        Ok(marker)
    }
}

/// Remove LaunchAgent / disable file so macOS stops advertising background activity.
pub fn uninstall_daemon_autostart() -> Result<(), CoreError> {
    #[cfg(target_os = "macos")]
    {
        uninstall_macos_launch_agent()?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn uninstall_macos_launch_agent() -> Result<(), CoreError> {
    let home = dirs::home_dir().ok_or_else(|| CoreError::Config("no home".into()))?;
    let agents = home.join("Library/LaunchAgents");
    let plist_path = agents.join(format!("{MACOS_LABEL}.plist"));
    let disabled = agents.join(format!("{MACOS_LABEL}.plist.disabled"));

    if plist_path.exists() {
        let _ = Command::new("launchctl")
            .args(["unload", "-w"])
            .arg(&plist_path)
            .status();
    }
    let _ = Command::new("launchctl")
        .args(["remove", MACOS_LABEL])
        .status();

    let _ = fs::remove_file(&plist_path);
    let _ = fs::remove_file(&disabled);
    Ok(())
}

#[cfg(target_os = "macos")]
fn install_macos_launch_agent(daemon_bin: PathBuf) -> Result<PathBuf, CoreError> {
    let home = dirs::home_dir().ok_or_else(|| CoreError::Config("no home".into()))?;
    let agents = home.join("Library/LaunchAgents");
    fs::create_dir_all(&agents)?;
    let plist_path = agents.join(format!("{MACOS_LABEL}.plist"));
    let log_dir = config_dir()?;
    fs::create_dir_all(&log_dir)?;
    let stdout = log_dir.join("daemon.stdout.log");
    let stderr = log_dir.join("daemon.stderr.log");
    let bin = daemon_bin.display().to_string();
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{MACOS_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{bin}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{stdout}</string>
  <key>StandardErrorPath</key><string>{stderr}</string>
</dict>
</plist>
"#,
        stdout = stdout.display(),
        stderr = stderr.display(),
    );
    fs::write(&plist_path, plist)?;
    let _ = Command::new("launchctl")
        .args(["unload", "-w"])
        .arg(&plist_path)
        .status();
    let _ = Command::new("launchctl")
        .args(["load", "-w"])
        .arg(&plist_path)
        .status();
    Ok(plist_path)
}

#[cfg(target_os = "windows")]
fn install_windows_stub(daemon_bin: PathBuf) -> Result<PathBuf, CoreError> {
    let marker = config_dir()?.join("windows-autostart.stub");
    fs::write(
        &marker,
        format!(
            "Schedule `{}` via MDM / Windows Service in production packaging.\n",
            daemon_bin.display()
        ),
    )?;
    Ok(marker)
}
