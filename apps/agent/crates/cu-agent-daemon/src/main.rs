//! Headless CU Loader — continuous monitoring with no UI window.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
mod win_service;

use cu_agent_core::api::{post_activity, upload_screenshot_batch, ActivityEventIn, BatchFrame, HeartbeatRequest};
use cu_agent_core::config::{config_dir, load_config};
use cu_agent_core::{AgentConfig, CoreError};
use serde_json::json;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    #[cfg(windows)]
    if args.iter().any(|arg| arg == "--install-service") {
        std::process::exit(win_service::install_service());
    }
    if args.iter().any(|arg| arg == "--capture") || !cfg!(windows) {
        if let Err(err) = run() {
            #[cfg(windows)]
            win_service::log_line(&format!("CU Loader error: {err}"));
            #[cfg(not(windows))]
            eprintln!("CU Loader error: {err}");
            std::process::exit(1);
        }
        return;
    }
    #[cfg(windows)]
    {
        // Started by the Service Control Manager. A double-click does not open a window.
        let _ = win_service::run_service();
    }
}

fn run() -> Result<(), CoreError> {
    let mut config = load_config()?;
    #[cfg(windows)]
    if config.mock_screenshots && !cu_agent_core::config::mock_screenshots_enabled() {
        config.mock_screenshots = false;
        let _ = cu_agent_core::save_config(&config);
    }
    if !config.is_enrolled() {
        eprintln!(
            "CU Loader: not enrolled. Run CU Agent Setup first. Config: {:?}",
            cu_agent_core::config_path()?
        );
        std::process::exit(2);
    }

    // Defaults match org Storage settings until the first heartbeat.
    let capture = Arc::new(CaptureRuntime::default());
    daemon_log(&format!(
        "CU Loader starting device_id={:?} api={} mock={} interval={}s width={} q={}",
        config.device_id,
        config.api_base_url,
        config.mock_screenshots,
        capture.interval_secs(),
        capture.max_width(),
        capture.jpeg_quality()
    ));

    let authorized = Arc::new(AtomicBool::new(true));
    {
        let config = config.clone();
        let authorized = authorized.clone();
        let capture = capture.clone();
        thread::spawn(move || heartbeat_loop(config, authorized, capture));
    }
    {
        let config = config.clone();
        thread::spawn(move || batch_upload_loop(config));
    }

    loop {
        let started = Instant::now();
        let interval = Duration::from_secs(capture.interval_secs());
        if authorized.load(Ordering::Relaxed) {
            if let Err(err) = capture_frame(&config, &capture) {
                daemon_log(&format!("capture error: {err}"));
            }
        }
        let elapsed = started.elapsed();
        if let Some(rest) = interval.checked_sub(elapsed) {
            thread::sleep(rest);
        }
    }
}

struct CaptureRuntime {
    interval_secs: AtomicU64,
    max_width: AtomicU32,
    jpeg_quality: AtomicU32,
}

impl Default for CaptureRuntime {
    fn default() -> Self {
        Self {
            interval_secs: AtomicU64::new(2),
            max_width: AtomicU32::new(720),
            jpeg_quality: AtomicU32::new(45),
        }
    }
}

impl CaptureRuntime {
    fn interval_secs(&self) -> u64 {
        self.interval_secs.load(Ordering::Relaxed).clamp(1, 5)
    }

    fn max_width(&self) -> u32 {
        self.max_width.load(Ordering::Relaxed).clamp(320, 2560)
    }

    fn jpeg_quality(&self) -> u8 {
        self.jpeg_quality.load(Ordering::Relaxed).clamp(20, 95) as u8
    }

    fn apply_heartbeat(
        &self,
        interval: Option<u64>,
        width: Option<u32>,
        quality: Option<u8>,
    ) {
        if let Some(secs) = interval {
            if (1..=5).contains(&secs) {
                self.interval_secs.store(secs, Ordering::Relaxed);
            }
        }
        if let Some(w) = width {
            if [640, 720, 960, 1280].contains(&w) {
                self.max_width.store(w, Ordering::Relaxed);
            }
        }
        if let Some(q) = quality {
            let q = u32::from(q);
            if [35, 45, 55, 65].contains(&q) {
                self.jpeg_quality.store(q, Ordering::Relaxed);
            }
        }
    }
}

fn daemon_log(msg: &str) {
    #[cfg(windows)]
    win_service::log_line(msg);
    #[cfg(not(windows))]
    eprintln!("{msg}");
}

fn heartbeat_loop(
    mut config: AgentConfig,
    authorized: Arc<AtomicBool>,
    capture: Arc<CaptureRuntime>,
) {
    loop {
        match send_heartbeat(&mut config, &capture) {
            Ok(is_authorized) => authorized.store(is_authorized, Ordering::Relaxed),
            Err(err) => daemon_log(&format!("heartbeat error: {err}")),
        }
        thread::sleep(Duration::from_secs(30));
    }
}

fn send_heartbeat(
    config: &mut AgentConfig,
    capture: &CaptureRuntime,
) -> Result<bool, CoreError> {
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
    capture.apply_heartbeat(
        hb.capture_interval_seconds,
        hb.capture_max_width,
        hb.capture_jpeg_quality,
    );
    let is_authorized = hb.monitoring_authorization == "authorized";
    daemon_log(&format!(
        "heartbeat ok auth={is_authorized} interval={}s width={} q={}",
        capture.interval_secs(),
        capture.max_width(),
        capture.jpeg_quality()
    ));
    if is_authorized {
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
    Ok(is_authorized)
}

fn capture_frame(config: &AgentConfig, capture: &CaptureRuntime) -> Result<(), CoreError> {
    let root = config_dir()?;
    let shots = root.join("captures");
    std::fs::create_dir_all(&shots)?;
    let meta = platform_capture(
        &shots,
        config.mock_screenshots,
        capture.max_width(),
        capture.jpeg_quality(),
    )?;
    let queue = root.join("queue");
    cu_agent_core::spool::enqueue(&queue, &meta)?;
    let dropped = cu_agent_core::spool::prune(&queue, cu_agent_core::spool::MAX_QUEUED_FRAMES)?;
    if dropped > 0 {
        daemon_log(&format!("queue full; dropped {dropped} oldest frames"));
    }
    Ok(())
}

/// Small groups keep the queue near empty so frames are not dropped.
const UPLOAD_GROUP_SIZE: usize = 10;
const UPLOAD_MAX_WAIT: Duration = Duration::from_secs(10);

fn batch_upload_loop(config: AgentConfig) {
    if let Ok(root) = config_dir() {
        let _ = cu_agent_core::spool::remove_loose_images(&root.join("captures"));
        let _ = cu_agent_core::spool::remove_loose_images(&root.join("queue"));
    }
    let mut backoff = Duration::from_secs(5);
    loop {
        match flush_batch(&config) {
            Ok(0) => thread::sleep(Duration::from_secs(2)),
            Ok(sent) => {
                daemon_log(&format!("uploaded {sent} frames"));
                backoff = Duration::from_secs(5);
                // Catch up immediately while the queue is backed up.
            }
            Err(err) => {
                daemon_log(&format!("upload error: {err}"));
                thread::sleep(backoff);
                backoff = (backoff * 2).min(Duration::from_secs(60));
            }
        }
    }
}

fn flush_batch(config: &AgentConfig) -> Result<usize, CoreError> {
    let queue = config_dir()?.join("queue");
    let paths = cu_agent_core::spool::list_frames(&queue)?;
    if paths.is_empty() {
        return Ok(0);
    }
    let oldest = paths[0].clone();
    let age = oldest
        .metadata()
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .unwrap_or(Duration::from_secs(0));
    if paths.len() < UPLOAD_GROUP_SIZE && age < UPLOAD_MAX_WAIT {
        return Ok(0);
    }
    let selected: Vec<_> = paths.into_iter().take(UPLOAD_GROUP_SIZE).collect();
    let mut frames = Vec::new();
    let mut paths_by_name = Vec::new();
    for (index, path) in selected.iter().enumerate() {
        let queued = match cu_agent_core::spool::read_frame(path) {
            Ok(frame) => frame,
            Err(err) => {
                daemon_log(&format!("dropping unreadable queue file: {err}"));
                let _ = std::fs::remove_file(path);
                continue;
            }
        };
        let file_name = format!("{index}.jpg");
        paths_by_name.push((file_name.clone(), path.clone()));
        frames.push(BatchFrame {
            file_name,
            jpeg: queued.jpeg,
            captured_at: queued.captured_at,
            is_mock: queued.is_mock,
            mouse_x: queued.mouse_x,
            mouse_y: queued.mouse_y,
            mouse_buttons: queued.mouse_buttons,
            mouse_action: queued.mouse_action,
        });
    }
    if frames.is_empty() {
        return Ok(0);
    }
    // Prefer per-frame uploads: small requests survive VPS/proxy limits better.
    let accepted = upload_screenshot_batch(config, &frames)?;
    let accepted: std::collections::HashSet<_> = accepted.into_iter().collect();
    let mut sent = 0;
    for (name, path) in paths_by_name {
        if accepted.contains(&name) {
            let _ = std::fs::remove_file(path);
            sent += 1;
        }
    }
    Ok(sent)
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

fn platform_capture(
    dir: &PathBuf,
    use_mock: bool,
    max_width: u32,
    jpeg_quality: u8,
) -> Result<cu_agent_core::MockScreenshotMeta, CoreError> {
    #[cfg(target_os = "macos")]
    {
        let _ = (max_width, jpeg_quality);
        return cu_platform_macos::capture_screen(dir, use_mock);
    }
    #[cfg(target_os = "windows")]
    {
        if use_mock {
            return cu_agent_core::mock::capture_mock_screenshot(dir);
        }
        return cu_platform_windows::capture_screen(dir, max_width, jpeg_quality);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (use_mock, max_width, jpeg_quality);
        cu_agent_core::mock::capture_mock_screenshot(dir)
    }
}

fn sample_activity() -> (u64, u64, u64) {
    #[cfg(target_os = "macos")]
    {
        return cu_platform_macos::sample_activity_stats();
    }
    #[cfg(target_os = "windows")]
    {
        return cu_platform_windows::sample_activity_stats();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        (30, 0, 0)
    }
}
