"""Org-level capture settings stored in system_settings."""

from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SystemSetting
from app.schemas.capture_settings import (
    DEFAULT_INTERVAL,
    DEFAULT_QUALITY,
    DEFAULT_WIDTH,
    INTERVAL_OPTIONS,
    QUALITY_OPTIONS,
    WIDTH_OPTIONS,
    CaptureSettingsOut,
)

SETTING_KEY = "capture_settings"


def _clamp(value: int | None, options: list[int], default: int) -> int:
    if value is None:
        return default
    return value if value in options else default


def normalize_settings(
    *,
    interval_seconds: int | None = None,
    max_width: int | None = None,
    jpeg_quality: int | None = None,
    current: dict | None = None,
) -> dict:
    base = current or {}
    return {
        "interval_seconds": _clamp(
            interval_seconds if interval_seconds is not None else base.get("interval_seconds"),
            INTERVAL_OPTIONS,
            DEFAULT_INTERVAL,
        ),
        "max_width": _clamp(
            max_width if max_width is not None else base.get("max_width"),
            WIDTH_OPTIONS,
            DEFAULT_WIDTH,
        ),
        "jpeg_quality": _clamp(
            jpeg_quality if jpeg_quality is not None else base.get("jpeg_quality"),
            QUALITY_OPTIONS,
            DEFAULT_QUALITY,
        ),
    }


def settings_out(data: dict) -> CaptureSettingsOut:
    normalized = normalize_settings(current=data)
    return CaptureSettingsOut(
        interval_seconds=normalized["interval_seconds"],
        max_width=normalized["max_width"],
        jpeg_quality=normalized["jpeg_quality"],
    )


async def get_capture_settings(db: AsyncSession, organization_id: UUID) -> dict:
    row = (
        await db.execute(
            select(SystemSetting).where(
                SystemSetting.organization_id == organization_id,
                SystemSetting.key == SETTING_KEY,
            )
        )
    ).scalar_one_or_none()
    return normalize_settings(current=row.value if row and isinstance(row.value, dict) else None)


async def set_capture_settings(
    db: AsyncSession,
    organization_id: UUID,
    *,
    interval_seconds: int | None = None,
    max_width: int | None = None,
    jpeg_quality: int | None = None,
) -> dict:
    row = (
        await db.execute(
            select(SystemSetting).where(
                SystemSetting.organization_id == organization_id,
                SystemSetting.key == SETTING_KEY,
            )
        )
    ).scalar_one_or_none()
    current = row.value if row and isinstance(row.value, dict) else {}
    value = normalize_settings(
        interval_seconds=interval_seconds,
        max_width=max_width,
        jpeg_quality=jpeg_quality,
        current=current,
    )
    if row is None:
        db.add(
            SystemSetting(
                id=uuid4(),
                organization_id=organization_id,
                key=SETTING_KEY,
                value=value,
            )
        )
    else:
        row.value = value
    await db.commit()
    return value
