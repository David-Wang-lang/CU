from pydantic import BaseModel, Field

INTERVAL_OPTIONS = [1, 2, 3, 5]
WIDTH_OPTIONS = [640, 720, 960, 1280]
QUALITY_OPTIONS = [35, 45, 55, 65]

DEFAULT_INTERVAL = 2
DEFAULT_WIDTH = 720
DEFAULT_QUALITY = 45


class CaptureSettingsOut(BaseModel):
    interval_seconds: int
    max_width: int
    jpeg_quality: int
    interval_options: list[int] = Field(default_factory=lambda: list(INTERVAL_OPTIONS))
    width_options: list[int] = Field(default_factory=lambda: list(WIDTH_OPTIONS))
    quality_options: list[int] = Field(default_factory=lambda: list(QUALITY_OPTIONS))


class CaptureSettingsUpdate(BaseModel):
    interval_seconds: int | None = None
    max_width: int | None = None
    jpeg_quality: int | None = None
