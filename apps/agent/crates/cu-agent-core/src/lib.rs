//! Shared CU agent logic (config, API, mock/real capture helpers).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub mod api;
pub mod autostart;
pub mod config;
pub mod mock;

pub use autostart::uninstall_daemon_autostart;
pub use config::{
    config_dir, config_path, enroll_local, install_daemon_stub, load_config, save_config,
    AgentConfig,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentIdentity {
    pub device_id: Option<Uuid>,
    pub agent_version: String,
    pub api_base_url: String,
}

impl Default for AgentIdentity {
    fn default() -> Self {
        let config = load_config().unwrap_or_default();
        Self {
            device_id: config.device_id,
            agent_version: env!("CARGO_PKG_VERSION").to_string(),
            api_base_url: config.api_base_url,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MockScreenshotMeta {
    pub id: Uuid,
    pub captured_at: DateTime<Utc>,
    pub path: String,
    pub is_mock: bool,
    /// Normalized 0–1 cursor X (top-left origin), if sampled.
    #[serde(default)]
    pub mouse_x: Option<f64>,
    /// Normalized 0–1 cursor Y (top-left origin), if sampled.
    #[serde(default)]
    pub mouse_y: Option<f64>,
    /// Bit0=left, bit1=right, bit2=middle
    #[serde(default)]
    pub mouse_buttons: Option<u8>,
    /// move | click | right_click | middle_click | drag
    #[serde(default)]
    pub mouse_action: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("toml error: {0}")]
    TomlDe(#[from] toml::de::Error),
    #[error("toml serialize error: {0}")]
    TomlSer(#[from] toml::ser::Error),
    #[error("config error: {0}")]
    Config(String),
}
