//! Sample mouse position / button state without an event tap (no Accessibility prompt).

use std::sync::Mutex;

use core_graphics::display::CGDisplay;
use core_graphics::event::CGEvent;
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::geometry::CGPoint;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
}

const BTN_LEFT: u32 = 0;
const BTN_RIGHT: u32 = 1;
const BTN_CENTER: u32 = 2;

static LAST_BUTTONS: Mutex<u8> = Mutex::new(0);

#[derive(Debug, Clone)]
pub struct MouseSample {
    /// Normalized 0–1, top-left origin (matches screenshot layout).
    pub x: f64,
    pub y: f64,
    /// Bit0=left, bit1=right, bit2=middle
    pub buttons: u8,
    /// none | move | click | right_click | middle_click | drag
    pub action: String,
}

pub fn sample_mouse() -> Option<MouseSample> {
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
    let event = CGEvent::new(source).ok()?;
    let loc: CGPoint = event.location();

    let display = CGDisplay::main();
    let bounds = display.bounds();
    let width = bounds.size.width.max(1.0);
    let height = bounds.size.height.max(1.0);
    // CG coords: origin bottom-left. Convert to top-left normalized.
    let x = ((loc.x - bounds.origin.x) / width).clamp(0.0, 1.0);
    let y = (1.0 - ((loc.y - bounds.origin.y) / height)).clamp(0.0, 1.0);

    let left = button_down(BTN_LEFT);
    let right = button_down(BTN_RIGHT);
    let middle = button_down(BTN_CENTER);
    let buttons = u8::from(left) | (u8::from(right) << 1) | (u8::from(middle) << 2);

    let mut last = LAST_BUTTONS.lock().ok()?;
    let prev = *last;
    let newly = buttons & !prev;
    let action = if newly & 0b001 != 0 {
        "click"
    } else if newly & 0b010 != 0 {
        "right_click"
    } else if newly & 0b100 != 0 {
        "middle_click"
    } else if buttons != 0 {
        "drag"
    } else {
        "move"
    };
    *last = buttons;

    Some(MouseSample {
        x,
        y,
        buttons,
        action: action.into(),
    })
}

fn button_down(button: u32) -> bool {
    // CombinedSessionState = 0
    unsafe { CGEventSourceButtonState(0, button) }
}
