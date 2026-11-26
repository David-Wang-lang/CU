//! On-disk agent configuration shared by the install wizard and daemon.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::CoreError;

pub const CONFIG_FILE_NAME: &str = "agent.toml";
pub const APP_DIR_NAME: &str = "CU";

/// Production default is real capture. Set `CU_MOCK_SCREENSHOTS=true` for placeholders.
pub fn mock_screenshots_enabled() -> bool {
    match std::env::var("CU_MOCK_SCREENSHOTS") {
        Ok(v) => {
            let v = v.trim();
            !(v == "0" || v.eq_ignore_ascii_case("false"))
        }
        Err(_) => false,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentConfig {
    pub api_base_url: String,
    pub device_id: Option<Uuid>,
    pub client_id: Option<String>,
    /// Phase 1 placeholder — replaced by secure storage in Phase 2.
    pub client_secret: Option<String>,
    pub enrollment_token: Option<String>,
    pub mock_screenshots: bool,
    pub enrolled_at: Option<DateTime<Utc>>,
    pub daemon_install_stub: bool,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            api_base_url: std::env::var("CU_API_BASE_URL")
                .unwrap_or_else(|_| "http://localhost:8000/api/v1".to_string()),
            device_id: None,
            client_id: None,
            client_secret: None,
            enrollment_token: None,
            mock_screenshots: mock_screenshots_enabled(),
            enrolled_at: None,
            daemon_install_stub: false,
        }
    }
}

impl AgentConfig {
    pub fn is_enrolled(&self) -> bool {
        self.device_id.is_some() && self.client_id.is_some()
    }
}

/// Platform config directory:
/// - macOS: `~/Library/Application Support/CU`
/// - Windows: `%ProgramData%\CU` (falls back to data local dir)
/// - other: `~/.config/CU`
pub fn config_dir() -> Result<PathBuf, CoreError> {
    #[cfg(target_os = "macos")]
    {
        let base = dirs::home_dir()
            .ok_or_else(|| CoreError::Config("home directory not found".into()))?;
        return Ok(base.join("Library/Application Support").join(APP_DIR_NAME));
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(program_data) = std::env::var("ProgramData") {
            return Ok(PathBuf::from(program_data).join(APP_DIR_NAME));
        }
        let base = dirs::data_local_dir()
            .ok_or_else(|| CoreError::Config("local data directory not found".into()))?;
        return Ok(base.join(APP_DIR_NAME));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let base = dirs::config_dir()
            .ok_or_else(|| CoreError::Config("config directory not found".into()))?;
        Ok(base.join(APP_DIR_NAME))
    }
}

pub fn config_path() -> Result<PathBuf, CoreError> {
    Ok(config_dir()?.join(CONFIG_FILE_NAME))
}

pub fn load_config() -> Result<AgentConfig, CoreError> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AgentConfig::default());
    }
    load_config_from(&path)
}

pub fn load_config_from(path: impl AsRef<Path>) -> Result<AgentConfig, CoreError> {
    let raw = fs::read_to_string(path)?;
    let mut config: AgentConfig = toml::from_str(&raw)?;
    // Env wins over agent.toml so `CU_MOCK_SCREENSHOTS=false ./scripts/dev-all.sh` works.
    if let Ok(v) = std::env::var("CU_MOCK_SCREENSHOTS") {
        config.mock_screenshots = v != "0" && v.to_lowercase() != "false";
    }
    Ok(config)
}

pub fn save_config(config: &AgentConfig) -> Result<PathBuf, CoreError> {
    let dir = config_dir()?;
    fs::create_dir_all(&dir)?;
    let path = dir.join(CONFIG_FILE_NAME);
    save_config_to(&path, config)?;
    Ok(path)
}

pub fn save_config_to(path: impl AsRef<Path>, config: &AgentConfig) -> Result<(), CoreError> {
    if let Some(parent) = path.as_ref().parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = toml::to_string_pretty(config)?;
    fs::write(path, raw)?;
    Ok(())
}

/// Enroll with the CU API and persist device credentials locally.
pub fn enroll_local(
    api_base_url: impl Into<String>,
    enrollment_token: impl Into<String>,
) -> Result<AgentConfig, CoreError> {
    let token = enrollment_token.into();
    if token.trim().is_empty() {
        return Err(CoreError::Config("enrollment token is required".into()));
    }
    let api_base_url = api_base_url.into();
    let name = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "cu-device".into());
    let (os, os_version) = platform_info();
    let enrolled = crate::api::enroll(
        &api_base_url,
        &token,
        &name,
        os,
        &os_version,
        env!("CARGO_PKG_VERSION"),
    )?;
    let mut config = AgentConfig::default();
    config.api_base_url = api_base_url;
    config.enrollment_token = Some(token);
    config.device_id = Some(enrolled.device_id);
    config.client_id = Some(enrolled.client_id);
    config.client_secret = Some(enrolled.client_secret);
    config.mock_screenshots = mock_screenshots_enabled();
    config.enrolled_at = Some(Utc::now());
    save_config(&config)?;
    Ok(config)
}

fn platform_info() -> (&'static str, String) {
    #[cfg(target_os = "macos")]
    {
        let ver = std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "unknown".into());
        return ("macos", ver);
    }
    #[cfg(target_os = "windows")]
    {
        return ("windows", "10+".into());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        ("other", "unknown".into())
    }
}

/// Register background daemon autostart and mark install complete.
pub fn install_daemon_stub() -> Result<AgentConfig, CoreError> {
    let mut config = load_config()?;
    if !config.is_enrolled() {
        return Err(CoreError::Config(
            "device must be enrolled before installing the daemon".into(),
        ));
    }
    // Prefer sibling cu-agent-daemon next to current exe (setup), else cargo debug build.
    let daemon_bin = locate_daemon_binary()?;
    // Default: do NOT register a macOS LaunchAgent (avoids Login Items /
    // "App Background Activity" employee-visible notifications).
    let _ = crate::autostart::install_daemon_autostart(daemon_bin)?;
    config.daemon_install_stub = true;
    save_config(&config)?;
    Ok(config)
}

fn locate_daemon_binary() -> Result<PathBuf, CoreError> {
    if let Ok(exe) = std::env::current_exe() {
        if exe
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with("cu-agent-daemon"))
        {
            return Ok(exe);
        }
        if let Some(dir) = exe.parent() {
            #[cfg(target_os = "windows")]
            let candidate = dir.join("cu-agent-daemon.exe");
            #[cfg(not(target_os = "windows"))]
            let candidate = dir.join("cu-agent-daemon");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    let fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/debug/cu-agent-daemon");
    if fallback.exists() {
        return Ok(fallback);
    }
    Err(CoreError::Config(
        "cu-agent-daemon binary not found; build it with `cargo build -p cu-agent-daemon`".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn roundtrip_config_file() {
        let dir = env::temp_dir().join(format!("cu-config-{}", Uuid::new_v4()));
        let path = dir.join(CONFIG_FILE_NAME);
        let mut config = AgentConfig::default();
        config.device_id = Some(Uuid::new_v4());
        config.client_id = Some("client-1".into());
        config.mock_screenshots = true;
        save_config_to(&path, &config).expect("save");
        let loaded = load_config_from(&path).expect("load");
        assert_eq!(loaded.client_id, config.client_id);
        assert!(loaded.mock_screenshots);
        let _ = fs::remove_dir_all(dir);
    }
}
