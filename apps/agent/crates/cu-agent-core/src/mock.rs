//! Mock screenshot generation for development and automated tests.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use image::{Rgb, RgbImage};
use uuid::Uuid;

use crate::{CoreError, MockScreenshotMeta};

/// Write a visible 640×360 placeholder PNG (not a 1×1 pixel).
pub fn capture_mock_screenshot(output_dir: impl AsRef<Path>) -> Result<MockScreenshotMeta, CoreError> {
    let dir = output_dir.as_ref();
    fs::create_dir_all(dir)?;

    let id = Uuid::new_v4();
    let filename = format!("mock-{id}.png");
    let path: PathBuf = dir.join(&filename);

    let now = Utc::now();
    let mut img = RgbImage::new(640, 360);
    // Slate background
    for (x, y, pixel) in img.enumerate_pixels_mut() {
        let band = (x / 80) % 2 == (y / 80) % 2;
        *pixel = if band {
            Rgb([30, 41, 59])
        } else {
            Rgb([51, 65, 85])
        };
    }
    // Accent bar so mocks are obvious but not a solid red tile
    for x in 0..640 {
        for y in 0..48 {
            img.put_pixel(x, y, Rgb([13, 148, 136]));
        }
    }
    // Timestamp hash stripe (changes each second so playback is visible)
    let t = now.timestamp() as u32;
    let stripe = Rgb([
        ((t >> 16) & 0xff) as u8,
        ((t >> 8) & 0xff) as u8,
        (t & 0xff) as u8,
    ]);
    for x in 0..640 {
        for y in 300..360 {
            img.put_pixel(x, y, stripe);
        }
    }

    img.save(&path)
        .map_err(|e| CoreError::Config(format!("mock png write failed: {e}")))?;

    Ok(MockScreenshotMeta {
        id,
        captured_at: now,
        path: path.to_string_lossy().to_string(),
        is_mock: true,
        mouse_x: None,
        mouse_y: None,
        mouse_buttons: None,
        mouse_action: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn writes_mock_png() {
        let dir = env::temp_dir().join(format!("cu-mock-{}", Uuid::new_v4()));
        let meta = capture_mock_screenshot(&dir).expect("mock capture");
        assert!(meta.is_mock);
        assert!(Path::new(&meta.path).exists());
        let len = fs::metadata(&meta.path).unwrap().len();
        assert!(len > 1000, "expected real-sized PNG, got {len} bytes");
        let _ = fs::remove_dir_all(dir);
    }
}
