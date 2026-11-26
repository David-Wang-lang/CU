//! Local upload queue. Frames are not stored as `.jpg` files, so Windows
//! image search does not list them while they wait to upload.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{CoreError, MockScreenshotMeta};

const MAGIC: &[u8] = b"CUQ1";
const MASK: u8 = 0xA5;
/// About 20 minutes at one frame per second.
pub const MAX_QUEUED_FRAMES: usize = 20 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedFrame {
    pub captured_at: String,
    pub is_mock: bool,
    pub mouse_x: Option<f64>,
    pub mouse_y: Option<f64>,
    pub mouse_buttons: Option<u8>,
    pub mouse_action: Option<String>,
    #[serde(skip)]
    pub jpeg: Vec<u8>,
    #[serde(skip)]
    pub path: PathBuf,
}

pub fn enqueue(dir: &Path, meta: &MockScreenshotMeta) -> Result<PathBuf, CoreError> {
    let jpeg = fs::read(&meta.path)?;
    fs::create_dir_all(dir)?;
    let millis = meta.captured_at.timestamp_millis().max(0) as u64;
    let path = dir.join(format!("{millis:020}-{}.cuq", meta.id));
    fs::write(&path, encode(&meta_record(meta), &jpeg)?)?;
    let _ = fs::remove_file(&meta.path);
    Ok(path)
}

pub fn read_frame(path: &Path) -> Result<QueuedFrame, CoreError> {
    let bytes = fs::read(path)?;
    let (record, jpeg) = decode(&bytes)?;
    Ok(QueuedFrame {
        captured_at: record.captured_at,
        is_mock: record.is_mock,
        mouse_x: record.mouse_x,
        mouse_y: record.mouse_y,
        mouse_buttons: record.mouse_buttons,
        mouse_action: record.mouse_action,
        jpeg,
        path: path.to_path_buf(),
    })
}

pub fn list_frames(dir: &Path) -> Result<Vec<PathBuf>, CoreError> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("cuq") {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

pub fn prune(dir: &Path, max_files: usize) -> Result<usize, CoreError> {
    let paths = list_frames(dir)?;
    if paths.len() <= max_files {
        return Ok(0);
    }
    let extra = paths.len() - max_files;
    for path in paths.into_iter().take(extra) {
        let _ = fs::remove_file(path);
    }
    Ok(extra)
}

/// Remove picture files left by older builds so they are not image-search results.
pub fn remove_loose_images(dir: &Path) -> Result<(), CoreError> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext == "jpg" || ext == "jpeg" || ext == "png" {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

fn meta_record(meta: &MockScreenshotMeta) -> SpoolRecord {
    SpoolRecord {
        captured_at: meta.captured_at.to_rfc3339(),
        is_mock: meta.is_mock,
        mouse_x: meta.mouse_x,
        mouse_y: meta.mouse_y,
        mouse_buttons: meta.mouse_buttons,
        mouse_action: meta.mouse_action.clone(),
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct SpoolRecord {
    captured_at: String,
    is_mock: bool,
    mouse_x: Option<f64>,
    mouse_y: Option<f64>,
    mouse_buttons: Option<u8>,
    mouse_action: Option<String>,
}

fn encode(record: &SpoolRecord, jpeg: &[u8]) -> Result<Vec<u8>, CoreError> {
    let json = serde_json::to_vec(record)?;
    if json.len() > u32::MAX as usize {
        return Err(CoreError::Config("spool record too large".into()));
    }
    let mut out = Vec::with_capacity(5 + 4 + json.len() + jpeg.len());
    out.extend_from_slice(MAGIC);
    out.push(1);
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    out.extend(jpeg.iter().map(|byte| byte ^ MASK));
    Ok(out)
}

fn decode(bytes: &[u8]) -> Result<(SpoolRecord, Vec<u8>), CoreError> {
    if bytes.len() < 9 || &bytes[..4] != MAGIC || bytes[4] != 1 {
        return Err(CoreError::Config("not a CU queue frame".into()));
    }
    let json_len = u32::from_le_bytes(bytes[5..9].try_into().unwrap()) as usize;
    let json_end = 9 + json_len;
    if bytes.len() < json_end {
        return Err(CoreError::Config("truncated CU queue frame".into()));
    }
    let record: SpoolRecord = serde_json::from_slice(&bytes[9..json_end])?;
    let jpeg = bytes[json_end..].iter().map(|byte| byte ^ MASK).collect();
    Ok((record, jpeg))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    #[test]
    fn roundtrip_hides_jpeg_header() {
        let dir = std::env::temp_dir().join(format!("cu-spool-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let jpeg_path = dir.join("shot.jpg");
        let jpeg = b"\xff\xd8\xff\xe0fake-jpeg".to_vec();
        fs::write(&jpeg_path, &jpeg).unwrap();
        let meta = MockScreenshotMeta {
            id: Uuid::new_v4(),
            captured_at: Utc::now(),
            path: jpeg_path.to_string_lossy().to_string(),
            is_mock: false,
            mouse_x: Some(0.25),
            mouse_y: Some(0.5),
            mouse_buttons: Some(0),
            mouse_action: Some("move".into()),
        };
        let queued = enqueue(&dir, &meta).unwrap();
        assert!(!jpeg_path.exists());
        let stored = fs::read(&queued).unwrap();
        assert!(stored.windows(2).all(|pair| pair != [0xff, 0xd8]));
        let frame = read_frame(&queued).unwrap();
        assert_eq!(frame.jpeg, jpeg);
        assert!((frame.mouse_x.unwrap() - 0.25).abs() < f64::EPSILON);
        let _ = fs::remove_dir_all(dir);
    }
}
