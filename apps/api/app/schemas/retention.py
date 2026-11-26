from datetime import datetime

from pydantic import BaseModel, Field

RETENTION_OPTIONS = [1, 3, 7, 15, 30, 60, 90]


class RetentionOut(BaseModel):
    retention_days: int
    custom_days: int | None = None
    options: list[int] = Field(default_factory=lambda: RETENTION_OPTIONS)
    updated_at: datetime | None = None


class RetentionUpdate(BaseModel):
    retention_days: int = Field(ge=1, le=3650)
    custom_days: int | None = Field(default=None, ge=1, le=3650)


class CleanupStatusOut(BaseModel):
    ran_at: str | None = None
    next_scheduled: str | None = None
    deleted_records: int = 0
    deleted_files: int = 0
    failed: int = 0
    retention_days: int | None = None
    message: str | None = None


class StorageAnalyticsOut(BaseModel):
    total_bytes: int
    used_bytes: int
    available_bytes: int | None = None
    screenshot_count: int
    by_device: list[dict]
    daily_growth_bytes: int
    estimated_30d_bytes: int
    retention_days: int
    cleanup: CleanupStatusOut
