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
    #[serde(default)]
    pub capture_interval_seconds: Option<u64>,
    #[serde(default)]
    pub capture_max_width: Option<u32>,
    #[serde(default)]
    pub capture_jpeg_quality: Option<u8>,
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
        .timeout(std::time::Duration::from_secs(12))
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
    let ext = path
        .as_ref()
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let (file_name, mime) = if ext.eq_ignore_ascii_case("jpg") || ext.eq_ignore_ascii_case("jpeg")
    {
        ("capture.jpg", "image/jpeg")
    } else {
        ("capture.png", "image/png")
    };
    let part = multipart::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str(mime)
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

#[derive(Debug, Serialize)]
struct BatchItem<'a> {
    file: String,
    captured_at: &'a str,
    is_mock: bool,
    mouse_x: Option<f64>,
    mouse_y: Option<f64>,
    mouse_buttons: Option<u8>,
    mouse_action: Option<&'a str>,
}

pub struct BatchFrame {
    pub file_name: String,
    pub jpeg: Vec<u8>,
    pub captured_at: String,
    pub is_mock: bool,
    pub mouse_x: Option<f64>,
    pub mouse_y: Option<f64>,
    pub mouse_buttons: Option<u8>,
    pub mouse_action: Option<String>,
}

/// Upload a small group of frames.
/// Prefer one-by-one first (more reliable on constrained proxies). If that
/// fails completely, try the batch endpoint as a second chance.
pub fn upload_screenshot_batch(
    config: &AgentConfig,
    frames: &[BatchFrame],
) -> Result<Vec<String>, CoreError> {
    if frames.is_empty() {
        return Ok(Vec::new());
    }
    match upload_frames_individually(config, frames) {
        Ok(accepted) if accepted.len() == frames.len() => Ok(accepted),
        Ok(partial) if !partial.is_empty() => Ok(partial),
        Ok(_) | Err(_) => match try_upload_screenshot_batch(config, frames) {
            Ok(accepted) => Ok(accepted),
            Err(batch_err) => match upload_frames_individually(config, frames) {
                Ok(accepted) if !accepted.is_empty() => Ok(accepted),
                Ok(_) => Err(batch_err),
                Err(single_err) => Err(CoreError::Config(format!(
                    "upload failed ({batch_err}); retry also failed: {single_err}"
                ))),
            },
        },
    }
}

fn try_upload_screenshot_batch(
    config: &AgentConfig,
    frames: &[BatchFrame],
) -> Result<Vec<String>, CoreError> {
    let (client_id, secret) = creds(config)?;
    let items: Vec<BatchItem> = frames
        .iter()
        .map(|frame| BatchItem {
            file: frame.file_name.clone(),
            captured_at: &frame.captured_at,
            is_mock: frame.is_mock,
            mouse_x: frame.mouse_x,
            mouse_y: frame.mouse_y,
            mouse_buttons: frame.mouse_buttons,
            mouse_action: frame.mouse_action.as_deref(),
        })
        .collect();
    let manifest = serde_json::to_string(&items)?;
    let mut form = multipart::Form::new().text("manifest", manifest);
    for frame in frames {
        let part = multipart::Part::bytes(frame.jpeg.clone())
            .file_name(frame.file_name.clone())
            .mime_str("image/jpeg")
            .map_err(|e| CoreError::Config(e.to_string()))?;
        form = form.part("files", part);
    }
    let url = format!(
        "{}/screenshots/batch",
        config.api_base_url.trim_end_matches('/')
    );
    let res = batch_client()?
        .post(&url)
        .basic_auth(client_id, Some(secret))
        .multipart(form)
        .send()
        .map_err(|e| CoreError::Config(format!("batch upload failed: {e}")))?;
    let status = res.status();
    if status == StatusCode::NOT_FOUND
        || status == StatusCode::METHOD_NOT_ALLOWED
        || status == StatusCode::PAYLOAD_TOO_LARGE
        || status.is_server_error()
    {
        let text = res.text().unwrap_or_default();
        return Err(CoreError::Config(format!(
            "batch endpoint unavailable ({status}): {text}"
        )));
    }
    if !status.is_success() {
        let text = res.text().unwrap_or_default();
        return Err(CoreError::Config(format!("batch upload rejected: {text}")));
    }
    let body: BatchAccepted = res
        .json()
        .map_err(|e| CoreError::Config(format!("batch upload parse failed: {e}")))?;
    Ok(body.accepted_files)
}

fn upload_frames_individually(
    config: &AgentConfig,
    frames: &[BatchFrame],
) -> Result<Vec<String>, CoreError> {
    let mut accepted = Vec::new();
    let mut last_err: Option<CoreError> = None;
    for frame in frames {
        match upload_jpeg(config, frame) {
            Ok(()) => accepted.push(frame.file_name.clone()),
            Err(err) => last_err = Some(err),
        }
    }
    if accepted.is_empty() {
        return Err(last_err.unwrap_or_else(|| {
            CoreError::Config("single upload produced no accepted frames".into())
        }));
    }
    Ok(accepted)
}

fn upload_jpeg(config: &AgentConfig, frame: &BatchFrame) -> Result<(), CoreError> {
    let (client_id, secret) = creds(config)?;
    let url = format!("{}/screenshots", config.api_base_url.trim_end_matches('/'));
    let part = multipart::Part::bytes(frame.jpeg.clone())
        .file_name(frame.file_name.clone())
        .mime_str("image/jpeg")
        .map_err(|e| CoreError::Config(e.to_string()))?;
    let mut form = multipart::Form::new()
        .text("is_mock", if frame.is_mock { "true" } else { "false" })
        .text("captured_at", frame.captured_at.clone());
    if let Some(x) = frame.mouse_x {
        form = form.text("mouse_x", format!("{x:.6}"));
    }
    if let Some(y) = frame.mouse_y {
        form = form.text("mouse_y", format!("{y:.6}"));
    }
    if let Some(b) = frame.mouse_buttons {
        form = form.text("mouse_buttons", b.to_string());
    }
    if let Some(action) = &frame.mouse_action {
        form = form.text("mouse_action", action.clone());
    }
    let res = batch_client()?
        .post(url)
        .basic_auth(client_id, Some(secret))
        .multipart(form.part("file", part))
        .send()
        .map_err(|e| CoreError::Config(format!("upload failed: {e}")))?;
    if !res.status().is_success() {
        let text = res.text().unwrap_or_default();
        return Err(CoreError::Config(format!("upload rejected: {text}")));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct BatchAccepted {
    accepted_files: Vec<String>,
}

fn batch_client() -> Result<Client, CoreError> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| CoreError::Config(format!("http client: {e}")))
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
