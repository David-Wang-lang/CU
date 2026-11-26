//! CU Agent Setup — IT-only install/enrollment (not the monitoring runtime; no employee UI).

use serde::Serialize;
use tauri::AppHandle;

use cu_agent_core::config::{
    config_path, enroll_local, install_daemon_stub, load_config, AgentConfig,
};

#[derive(Debug, Serialize)]
struct SetupStatus {
    enrolled: bool,
    daemon_install_stub: bool,
    config_path: String,
    api_base_url: String,
    device_id: Option<String>,
    mock_screenshots: bool,
}

fn to_status(config: &AgentConfig) -> Result<SetupStatus, String> {
    Ok(SetupStatus {
        enrolled: config.is_enrolled(),
        daemon_install_stub: config.daemon_install_stub,
        config_path: config_path().map_err(|e| e.to_string())?.display().to_string(),
        api_base_url: config.api_base_url.clone(),
        device_id: config.device_id.map(|id| id.to_string()),
        mock_screenshots: config.mock_screenshots,
    })
}

#[tauri::command]
fn get_setup_status() -> Result<SetupStatus, String> {
    let config = load_config().map_err(|e| e.to_string())?;
    to_status(&config)
}

#[tauri::command]
async fn enroll_device(
    api_base_url: String,
    enrollment_token: String,
) -> Result<SetupStatus, String> {
    // reqwest::blocking starts its own runtime. Calling it on Tauri's async
    // worker panics, and the release profile aborts the process (window vanishes).
    tauri::async_runtime::spawn_blocking(move || {
        let config = enroll_local(api_base_url, enrollment_token).map_err(|e| e.to_string())?;
        to_status(&config)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn write_config(api_base_url: String) -> Result<SetupStatus, String> {
    let mut config = load_config().map_err(|e| e.to_string())?;
    config.api_base_url = api_base_url;
    cu_agent_core::save_config(&config).map_err(|e| e.to_string())?;
    to_status(&config)
}

#[tauri::command]
fn install_daemon_stub_cmd() -> Result<SetupStatus, String> {
    // Phase 1: mark stub installed. Phase 4: register LaunchAgent / Windows Service.
    let config = install_daemon_stub().map_err(|e| e.to_string())?;
    to_status(&config)
}

#[tauri::command]
fn quit_after_install(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_setup_status,
            enroll_device,
            write_config,
            install_daemon_stub_cmd,
            quit_after_install
        ])
        .run(tauri::generate_context!())
        .expect("error while running CU Agent Setup");
}
