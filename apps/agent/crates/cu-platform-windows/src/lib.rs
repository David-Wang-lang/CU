//! Windows screen capture for the interactive user session.
//! The daemon runs this in the logged-on user's session, not in Session 0.

use std::path::{Path, PathBuf};

use chrono::Utc;
use cu_agent_core::mock::capture_mock_screenshot;
use cu_agent_core::{CoreError, MockScreenshotMeta};
use image::codecs::jpeg::JpegEncoder;
use image::{ColorType, ImageEncoder, Rgb, RgbImage};
use uuid::Uuid;

#[cfg(windows)]
use windows_sys::Win32::Foundation::POINT;
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HALFTONE, RGBQUAD, SRCCOPY,
};
#[cfg(windows)]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN,
};

/// Capture the real desktop unless `CU_MOCK_SCREENSHOTS=true`.
pub fn capture_screen(
    output_dir: impl AsRef<Path>,
    max_width: u32,
    jpeg_quality: u8,
) -> Result<MockScreenshotMeta, CoreError> {
    if cu_agent_core::config::mock_screenshots_enabled() {
        return capture_mock_screenshot(output_dir);
    }
    #[cfg(windows)]
    {
        return capture_desktop(output_dir, max_width, jpeg_quality);
    }
    #[cfg(not(windows))]
    {
        let _ = (output_dir, max_width, jpeg_quality);
        Err(CoreError::Config(
            "Windows screen capture is only available on Windows".into(),
        ))
    }
}

pub fn platform_name() -> &'static str {
    "windows"
}

/// Active / idle seconds for the 30-second heartbeat sample. Keystrokes are not collected.
pub fn sample_activity_stats() -> (u64, u64, u64) {
    #[cfg(windows)]
    {
        return sample_idle();
    }
    #[cfg(not(windows))]
    {
        (0, 0, 0)
    }
}

#[cfg(windows)]
fn sample_idle() -> (u64, u64, u64) {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetLastInputInfo;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::LASTINPUTINFO;

    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info) == 0 {
            return (30, 0, 0);
        }
        let now = GetTickCount();
        let idle_ms = now.wrapping_sub(info.dwTime);
        if idle_ms >= 60_000 {
            (0, 30, 0)
        } else {
            (30, 0, 0)
        }
    }
}

#[cfg(windows)]
fn capture_desktop(
    output_dir: impl AsRef<Path>,
    max_width: u32,
    jpeg_quality: u8,
) -> Result<MockScreenshotMeta, CoreError> {
    let dir = output_dir.as_ref();
    std::fs::create_dir_all(dir)?;
    let max_w = max_width.clamp(320, 2560) as i32;
    let quality = jpeg_quality.clamp(20, 95);

    unsafe {
        let origin_x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let origin_y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let src_w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let src_h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if src_w <= 0 || src_h <= 0 {
            return Err(CoreError::Config("no desktop size reported".into()));
        }
        let (dst_w, dst_h) = if src_w > max_w {
            let dw = max_w;
            let dh = ((src_h as i64 * dw as i64) / src_w as i64).max(1) as i32;
            (dw, dh)
        } else {
            (src_w, src_h)
        };

        let screen = GetDC(std::ptr::null_mut());
        if screen.is_null() {
            return Err(CoreError::Config("GetDC failed".into()));
        }
        let mem = CreateCompatibleDC(screen);
        if mem.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen);
            return Err(CoreError::Config("CreateCompatibleDC failed".into()));
        }
        let bmp = CreateCompatibleBitmap(screen, dst_w, dst_h);
        if bmp.is_null() {
            DeleteDC(mem);
            ReleaseDC(std::ptr::null_mut(), screen);
            return Err(CoreError::Config("CreateCompatibleBitmap failed".into()));
        }
        let old = SelectObject(mem, bmp);
        SetStretchBltMode(mem, HALFTONE);
        let copied = StretchBlt(
            mem,
            0,
            0,
            dst_w,
            dst_h,
            screen,
            origin_x,
            origin_y,
            src_w,
            src_h,
            SRCCOPY,
        );
        if copied == 0 {
            SelectObject(mem, old);
            DeleteObject(bmp);
            DeleteDC(mem);
            ReleaseDC(std::ptr::null_mut(), screen);
            return Err(CoreError::Config("StretchBlt failed".into()));
        }

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: dst_w,
                biHeight: -dst_h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD {
                rgbBlue: 0,
                rgbGreen: 0,
                rgbRed: 0,
                rgbReserved: 0,
            }],
        };
        let byte_len = (dst_w as usize) * (dst_h as usize) * 4;
        let mut pixels = vec![0u8; byte_len];
        let rows = GetDIBits(
            mem,
            bmp,
            0,
            dst_h as u32,
            pixels.as_mut_ptr().cast(),
            &mut info,
            DIB_RGB_COLORS,
        );
        SelectObject(mem, old);
        DeleteObject(bmp);
        DeleteDC(mem);
        ReleaseDC(std::ptr::null_mut(), screen);
        if rows == 0 {
            return Err(CoreError::Config("GetDIBits failed".into()));
        }

        let mut img = RgbImage::new(dst_w as u32, dst_h as u32);
        for (i, pixel) in img.pixels_mut().enumerate() {
            let o = i * 4;
            if o + 2 >= pixels.len() {
                break;
            }
            *pixel = Rgb([pixels[o + 2], pixels[o + 1], pixels[o]]);
        }

        let mut point = POINT { x: 0, y: 0 };
        let have_cursor = GetCursorPos(&mut point) != 0;
        let mouse_x = if have_cursor {
            Some(((point.x - origin_x) as f64 / src_w as f64).clamp(0.0, 1.0))
        } else {
            None
        };
        let mouse_y = if have_cursor {
            Some(((point.y - origin_y) as f64 / src_h as f64).clamp(0.0, 1.0))
        } else {
            None
        };
        let left = GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000 != 0;
        let right = GetAsyncKeyState(VK_RBUTTON as i32) as u16 & 0x8000 != 0;
        let middle = GetAsyncKeyState(VK_MBUTTON as i32) as u16 & 0x8000 != 0;
        let mut buttons = 0u8;
        if left {
            buttons |= 1;
        }
        if right {
            buttons |= 2;
        }
        if middle {
            buttons |= 4;
        }
        let action = if left {
            "click"
        } else if right {
            "right_click"
        } else if middle {
            "middle_click"
        } else {
            "move"
        };

        let id = Uuid::new_v4();
        let path: PathBuf = dir.join(format!("screen-{id}.jpg"));
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, quality)
            .write_image(img.as_raw(), dst_w as u32, dst_h as u32, ColorType::Rgb8.into())
            .map_err(|e| CoreError::Config(format!("screenshot encode failed: {e}")))?;
        std::fs::write(&path, jpeg)
            .map_err(|e| CoreError::Config(format!("screenshot write failed: {e}")))?;

        Ok(MockScreenshotMeta {
            id,
            captured_at: Utc::now(),
            path: path.to_string_lossy().to_string(),
            is_mock: false,
            mouse_x,
            mouse_y,
            mouse_buttons: Some(buttons),
            mouse_action: Some(action.into()),
        })
    }
}
