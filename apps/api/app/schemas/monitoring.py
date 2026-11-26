from datetime import datetime

from pydantic import BaseModel, Field


class ScreenshotUploadResponse(BaseModel):
    id: str
    object_key: str
    captured_at: datetime
    is_mock: bool


class ScreenshotOut(BaseModel):
    id: str
    device_id: str
    captured_at: datetime
    monitor_index: int
    content_type: str
    byte_size: int
    is_mock: bool
    image_url: str
    mouse_x: float | None = None
    mouse_y: float | None = None
    mouse_buttons: int | None = None
    mouse_action: str | None = None


class ActivityEventIn(BaseModel):
    event_type: str
    payload: dict = Field(default_factory=dict)
    occurred_at: datetime | None = None


class ActivityStatsOut(BaseModel):
    device_id: str | None = None
    active_seconds: int = 0
    idle_seconds: int = 0
    keystroke_count: int = 0
    event_count: int = 0
    from_ts: datetime | None = None
    to_ts: datetime | None = None


class OverviewOut(BaseModel):
    employees: int
    devices: int
    online_devices: int
    offline_devices: int
    authorized_sessions: int
    alerts: int
    screenshots: int
    api_status: str = "ok"


class VideoSegmentOut(BaseModel):
    id: str
    device_id: str
    start_at: datetime
    end_at: datetime
    duration_seconds: int
    frame_count: int
    screenshot_ids: list[str]
    video_url: str | None = None


class VideoRenderOut(BaseModel):
    segment_id: str
    frame_count: int
    fps: float
    duration_seconds: float
    video_url: str
    byte_size: int
