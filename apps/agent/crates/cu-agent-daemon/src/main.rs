//! Headless CU agent daemon — continuous monitoring with no UI window.

use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use chrono::Utc;
use cu_agent_core::api::{post_activity, upload_screenshot, ActivityEventIn, HeartbeatRequest};
use cu_agent_core::config::{config_dir, load_config};
use cu_agent_core::{AgentConfig, CoreError};
use serde_json::json;

fn main() {
    if let Err(err) = run() {
        eprintln!("cu-agent-daemon error: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), CoreError> {
    let mut config = load_config()?;
    if !config.is_enrolled() {
        eprintln!(
            "cu-agent-daemon: not enrolled. Run CU Agent Setup first. Config: {:?}",
            cu_agent_core::config_path()?
        );
        std::process::exit(2);
    }

    println!(
        "cu-agent-daemon starting device_id={:?} api={} mock={} capture_interval=1s",
        config.device_id, config.api_base_url, config.mock_screenshots
    );

    // Capture once per second; heartbeat / activity samples less often.
    // If macOS denies Screen Recording, back off hard — each screencapture call
    // can re-open the TCC alert dialog.
    let capture_tick = Duration::from_secs(1);
    let heartbeat_every = Duration::from_secs(30);
    let permission_backoff = Duration::from_secs(15 * 60);
    let mut since_heartbeat = heartbeat_every; // heartbeat on first tick
    let mut authorized = true;
    let mut capture_paused_until = None::<std::time::Instant>;
    loop {
        let now = std::time::Instant::now();
        let capture_blocked = capture_paused_until
            .map(|until| now < until)
            .unwrap_or(false);

        let do_hb = since_heartbeat >= heartbeat_every;
        match tick_once(&mut config, do_hb, &mut authorized, !capture_blocked) {
            Ok(()) => {}
            Err(err) => {
                let msg = err.to_string();
                if msg.contains("SCREEN_RECORDING_DENIED") {
                    capture_paused_until = Some(now + permission_backoff);
                    eprintln!(
                        "cu-agent-daemon: Screen Recording denied — pausing capture for {}s to avoid permission spam.\n\
                         Fix: System Settings → Privacy & Security → Screen Recording → enable cu-agent-daemon, then restart the daemon.",
                        permission_backoff.as_secs()
                    );
                } else {
                    eprintln!("cu-agent-daemon tick error: {err}");
                }
            }
        }
        if do_hb {
            since_heartbeat = Duration::ZERO;
        }
        thread::sleep(capture_tick);
        since_heartbeat += capture_tick;
    }
}

fn sample_resources() -> (Option<f32>, Option<f32>, Option<f32>) {
    use sysinfo::{Disks, System};
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    std::thread::sleep(Duration::from_millis(50));
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let cpu = sys.global_cpu_usage();
    let mem = if sys.total_memory() > 0 {
        (sys.used_memory() as f32 / sys.total_memory() as f32) * 100.0
    } else {
        0.0
    };
    let disks = Disks::new_with_refreshed_list();
    let disk = disks.list().first().map(|d| {
        let total = d.total_space();
        let avail = d.available_space();
        if total > 0 {
            ((total - avail) as f32 / total as f32) * 100.0
        } else {
            0.0
        }
    });
    (Some(cpu), Some(mem), disk)
}

fn tick_once(
    config: &mut AgentConfig,
    do_heartbeat: bool,
    authorized: &mut bool,
    do_capture: bool,
) -> Result<(), CoreError> {
    if do_heartbeat {
        let (cpu, mem, disk) = sample_resources();
        let hb = cu_agent_core::api::heartbeat(
            config,
            &HeartbeatRequest {
                agent_version: env!("CARGO_PKG_VERSION").into(),
                cpu_percent: cpu,
                memory_percent: mem,
                disk_percent: disk,
            },
        )?;
        *authorized = hb.monitoring_authorization == "authorized";
        println!(
            "{} heartbeat ok auth={}",
            Utc::now().to_rfc3339(),
            hb.monitoring_authorization
        );
        if !*authorized {
            println!("monitoring withdrawn — skipping capture");
            return Ok(());
        }

        let (active, idle, keys) = sample_activity();
        post_activity(
            config,
            &[ActivityEventIn {
                event_type: "activity_sample".into(),
                payload: json!({
                    "active_seconds": active,
                    "idle_seconds": idle,
                    "keystroke_count": keys,
                }),
            }],
        )?;
    }

    if !*authorized || !do_capture {
        return Ok(());
    }

    let dir = mock_output_dir()?;
    let meta = platform_capture(&dir, config.mock_screenshots)?;
    println!(
        "{} capture path={} mock={} mouse=({},{}) action={}",
        Utc::now().to_rfc3339(),
        meta.path,
        meta.is_mock,
        meta.mouse_x
            .map(|v| format!("{v:.3}"))
            .unwrap_or_else(|| "-".into()),
        meta.mouse_y
            .map(|v| format!("{v:.3}"))
            .unwrap_or_else(|| "-".into()),
        meta.mouse_action.as_deref().unwrap_or("-"),
    );
    upload_screenshot(
        config,
        &meta.path,
        meta.is_mock,
        meta.mouse_x,
        meta.mouse_y,
        meta.mouse_buttons,
        meta.mouse_action.as_deref(),
    )?;
    Ok(())
}

fn mock_output_dir() -> Result<PathBuf, CoreError> {
    let dir = config_dir()?.join("captures");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn platform_capture(
    dir: &PathBuf,
    use_mock: bool,
) -> Result<cu_agent_core::MockScreenshotMeta, CoreError> {
    #[cfg(target_os = "macos")]
    {
        return cu_platform_macos::capture_screen(dir, use_mock);
    }
    #[cfg(target_os = "windows")]
    {
        let _ = use_mock;
        return cu_platform_windows::capture_screen(dir);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = use_mock;
        cu_agent_core::mock::capture_mock_screenshot(dir)
    }
}

fn sample_activity() -> (u64, u64, u64) {
    #[cfg(target_os = "macos")]
    {
        return cu_platform_macos::sample_activity_stats();
    }
    #[cfg(not(target_os = "macos"))]
    {
        (30, 0, 0)
    }
}
