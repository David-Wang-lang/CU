//! HTTP client for CU API (blocking — used by setup + daemon).

use std::fs;
use std::path::Path;

use reqwest::blocking::{Client, multipart};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config::AgentConfig;
use crate::CoreError;

#[derive(Debug, Deserialize)]
pub struct EnrollResponse {
    pub device_id: Uuid,
    pub client_id: String,
    pub client_secret: String,
    pub api_base_url: String,
    pub monitoring_authorization: String,
}

#[derive(Debug, Deserialize)]
pub struct HeartbeatResponse {
    pub ok: bool,
    pub monitoring_authorization: String,
}

#[derive(Debug, Serialize)]
pub struct HeartbeatRequest {
    pub agent_version: String,
    pub cpu_percent: Option<f32>,
    pub memory_percent: Option<f32>,
    pub disk_percent: Option<f32>,
}

#[derive(Debug, Serialize)]
pub struct ActivityEventIn {
    pub event_type: String,
    pub payload: serde_json::Value,
}

fn client() -> Result<Client, CoreError> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| CoreError::Config(format!("http client: {e}")))
}

pub fn enroll(
    api_base_url: &str,
    enrollment_token: &str,
    name: &str,
    os: &str,
    os_version: &str,
    agent_version: &str,
) -> Result<EnrollResponse, CoreError> {
    let url = format!("{}/devices/enroll", api_base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "enrollment_token": enrollment_token,
        "name": name,
        "os": os,
        "os_version": os_version,
        "agent_version": agent_version,
    });
    let res = client()?
        .post(url)
        .json(&body)
        .send()
        .map_err(|e| CoreError::Config(format!("enroll request failed: {e}")))?;
    if res.status() != StatusCode::OK {
        let text = res.text().unwrap_or_default();
        return Err(CoreError::Config(format!("enroll failed: {text}")));
    }
    res.json()
        .map_err(|e| CoreError::Config(format!("enroll parse failed: {e}")))
}

pub fn heartbeat(config: &AgentConfig, req: &HeartbeatRequest) -> Result<HeartbeatResponse, CoreError> {
    let (client_id, secret) = creds(config)?;
    let url = format!(
        "{}/devices/heartbeat",
        config.api_base_url.trim_end_matches('/')
    );
    let res = client()?
        .post(url)
        .basic_auth(client_id, Some(secret))
        .json(req)
        .send()
        .map_err(|e| CoreError::Config(format!("heartbeat failed: {e}")))?;
    if !res.status().is_success() {
        let text = res.text().unwrap_or_default();
        return Err(CoreError::Config(format!("heartbeat rejected: {text}")));
    }
    res.json()
        .map_err(|e| CoreError::Config(format!("heartbeat parse failed: {e}")))
}

pub fn upload_screenshot(
    config: &AgentConfig,
    path: impl AsRef<Path>,
    is_mock: bool,
    mouse_x: Option<f64>,
    mouse_y: Option<f64>,
    mouse_buttons: Option<u8>,
    mouse_action: Option<&str>,
) -> Result<(), CoreError> {
    let (client_id, secret) = creds(config)?;
    let bytes = fs::read(path.as_ref())?;
    let url = format!("{}/screenshots", config.api_base_url.trim_end_matches('/'));
    let part = multipart::Part::bytes(bytes)
        .file_name("capture.png")
        .mime_str("image/png")
        .map_err(|e| CoreError::Config(e.to_string()))?;
    let mut form = multipart::Form::new()
        .text("is_mock", if is_mock { "true" } else { "false" })
        .text("monitor_index", "0");
    if let Some(x) = mouse_x {
        form = form.text("mouse_x", format!("{x:.6}"));
    }
    if let Some(y) = mouse_y {
        form = form.text("mouse_y", format!("{y:.6}"));
    }
    if let Some(b) = mouse_buttons {
        form = form.text("mouse_buttons", b.to_string());
    }
    if let Some(a) = mouse_action {
        form = form.text("mouse_action", a.to_string());
    }
    let form = form.part("file", part);
    let res = client()?
        .post(url)
        .basic_auth(client_id, Some(secret))
        .multipart(form)
        .send()
        .map_err(|e| CoreError::Config(format!("upload failed: {e}")))?;
    if !res.status().is_success() {
        let text = res.text().unwrap_or_default();
        return Err(CoreError::Config(format!("upload rejected: {text}")));
    }
    Ok(())
}

pub fn post_activity(config: &AgentConfig, events: &[ActivityEventIn]) -> Result<(), CoreError> {
    let (client_id, secret) = creds(config)?;
    let url = format!(
        "{}/activity/events",
        config.api_base_url.trim_end_matches('/')
    );
    let res = client()?
        .post(url)
        .basic_auth(client_id, Some(secret))
        .json(events)
        .send()
        .map_err(|e| CoreError::Config(format!("activity failed: {e}")))?;
    if !res.status().is_success() {
        let text = res.text().unwrap_or_default();
        return Err(CoreError::Config(format!("activity rejected: {text}")));
    }
    Ok(())
}

fn creds(config: &AgentConfig) -> Result<(&str, &str), CoreError> {
    let client_id = config
        .client_id
        .as_deref()
        .ok_or_else(|| CoreError::Config("missing client_id".into()))?;
    let secret = config
        .client_secret
        .as_deref()
        .ok_or_else(|| CoreError::Config("missing client_secret".into()))?;
    Ok((client_id, secret))
}
