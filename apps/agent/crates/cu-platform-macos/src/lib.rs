//! macOS platform hooks.

mod mouse;

use std::path::{Path, PathBuf};
use std::process::Command;

use chrono::Utc;
use cu_agent_core::mock::capture_mock_screenshot;
use cu_agent_core::{CoreError, MockScreenshotMeta};
use uuid::Uuid;

pub use mouse::{sample_mouse, MouseSample};

/// Capture screen content.
/// When `use_mock` is false, runs macOS `screencapture` (needs Screen Recording permission).
/// Does **not** fall back to mock — skip the tick instead so the dashboard stays clean.
pub fn capture_screen(
    output_dir: impl AsRef<Path>,
    use_mock: bool,
) -> Result<MockScreenshotMeta, CoreError> {
    let env_mock = std::env::var("CU_MOCK_SCREENSHOTS")
        .map(|v| v != "0" && v.to_lowercase() != "false")
        .ok();
    let use_mock = env_mock.unwrap_or(use_mock);
    let mouse = sample_mouse();
    let mut meta = if use_mock {
        capture_mock_screenshot(output_dir)?
    } else {
        capture_via_screencapture(output_dir.as_ref())?
    };
    if let Some(m) = mouse {
        meta.mouse_x = Some(m.x);
        meta.mouse_y = Some(m.y);
        meta.mouse_buttons = Some(m.buttons);
        meta.mouse_action = Some(m.action);
    }
    Ok(meta)
}

fn capture_via_screencapture(output_dir: &Path) -> Result<MockScreenshotMeta, CoreError> {
    std::fs::create_dir_all(output_dir)?;
    let id = Uuid::new_v4();
    let path: PathBuf = output_dir.join(format!("capture-{id}.png"));
    // -x: no sound. -C: include mouse cursor in the bitmap.
    // Requires Screen Recording permission in System Settings.
    let output = Command::new("screencapture")
        .args(["-x", "-C", "-t", "png"])
        .arg(&path)
        .output()
        .map_err(|e| CoreError::Config(format!("screencapture: {e}")))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{stderr}{stdout}").to_lowercase();
    if !output.status.success() || !path.exists() {
        if combined.contains("could not create image")
            || combined.contains("not authorized")
            || combined.contains("permission")
            || !output.status.success()
        {
            let _ = std::fs::remove_file(&path);
            return Err(CoreError::Config(format!(
                "SCREEN_RECORDING_DENIED: grant Screen Recording to cu-agent-daemon in System Settings → Privacy & Security. detail={}",
                stderr.trim()
            )));
        }
        let _ = std::fs::remove_file(&path);
        return Err(CoreError::Config("screencapture failed".into()));
    }
    Ok(MockScreenshotMeta {
        id,
        captured_at: Utc::now(),
        path: path.to_string_lossy().to_string(),
        is_mock: false,
        mouse_x: None,
        mouse_y: None,
        mouse_buttons: None,
        mouse_action: None,
    })
}

pub fn platform_name() -> &'static str {
    "macos"
}

/// Aggregate idle/active estimate via `ioreg` (best-effort; no keystroke content).
pub fn sample_activity_stats() -> (u64, u64, u64) {
    let idle_ns = Command::new("ioreg")
        .args(["-c", "IOHIDSystem"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| {
            s.lines()
                .find(|l| l.contains("HIDIdleTime"))
                .and_then(|l| {
                    l.split('=')
                        .nth(1)
                        .map(|v| v.trim().trim_matches(|c: char| !c.is_ascii_digit()).to_string())
                })
                .and_then(|n| n.parse::<u64>().ok())
        })
        .unwrap_or(0);
    let idle_secs = idle_ns / 1_000_000_000;
    if idle_secs > 60 {
        (0, 30, 0)
    } else {
        (30, 0, 0)
    }
}
