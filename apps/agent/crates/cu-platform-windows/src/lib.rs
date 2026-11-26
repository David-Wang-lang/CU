//! Windows platform hooks. Phase 1 stubs only.

use cu_agent_core::mock::capture_mock_screenshot;
use cu_agent_core::{CoreError, MockScreenshotMeta};
use std::path::Path;

/// Capture screen content. Phase 1 always returns a mock image.
pub fn capture_screen(output_dir: impl AsRef<Path>) -> Result<MockScreenshotMeta, CoreError> {
    capture_mock_screenshot(output_dir)
}

pub fn platform_name() -> &'static str {
    "windows"
}
