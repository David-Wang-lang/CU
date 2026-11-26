"""Idempotent retention cleanup for screenshot records and files."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import RetentionPolicy, ScreenshotRecord, SystemSetting
from app.services.storage import resolve_screenshot_path, storage_root


async def get_retention_days(db: AsyncSession, organization_id: UUID) -> int:
    settings = get_settings()
    row = (
        await db.execute(
            select(RetentionPolicy).where(RetentionPolicy.organization_id == organization_id)
        )
    ).scalar_one_or_none()
    if row is None:
        return settings.default_retention_days
    if row.custom_days and row.custom_days > 0:
        return row.custom_days
    return row.retention_days


async def run_cleanup_for_org(db: AsyncSession, organization_id: UUID) -> dict[str, Any]:
    days = await get_retention_days(db, organization_id)
    cutoff = datetime.now(UTC) - timedelta(days=days)
    result = await db.execute(
        select(ScreenshotRecord).where(
            ScreenshotRecord.organization_id == organization_id,
            ScreenshotRecord.captured_at < cutoff,
        )
    )
    rows = list(result.scalars().all())

    deleted_files = 0
    deleted_rows = 0
    failed = 0
    for row in rows:
        try:
            path = resolve_screenshot_path(row.object_key)
            if path.exists():
                path.unlink()
                deleted_files += 1
        except FileNotFoundError:
            pass
        except OSError:
            failed += 1
            continue
        await db.execute(delete(ScreenshotRecord).where(ScreenshotRecord.id == row.id))
        deleted_rows += 1

    status = {
        "organization_id": str(organization_id),
        "retention_days": days,
        "cutoff": cutoff.isoformat(),
        "deleted_records": deleted_rows,
        "deleted_files": deleted_files,
        "failed": failed,
        "ran_at": datetime.now(UTC).isoformat(),
        "next_scheduled": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
    }
    await _save_cleanup_status(db, organization_id, status)
    await db.commit()
    return status


async def run_cleanup_all(db: AsyncSession) -> list[dict[str, Any]]:
    from app.db.models import Organization

    orgs = (await db.execute(select(Organization))).scalars().all()
    results = []
    for org in orgs:
        results.append(await run_cleanup_for_org(db, org.id))
    return results


async def _save_cleanup_status(
    db: AsyncSession, organization_id: UUID, status: dict[str, Any]
) -> None:
    row = (
        await db.execute(
            select(SystemSetting).where(
                SystemSetting.organization_id == organization_id,
                SystemSetting.key == "cleanup_status",
            )
        )
    ).scalar_one_or_none()
    if row is None:
        db.add(
            SystemSetting(
                organization_id=organization_id,
                key="cleanup_status",
                value=status,
            )
        )
    else:
        row.value = status


async def get_cleanup_status(db: AsyncSession, organization_id: UUID) -> dict[str, Any]:
    row = (
        await db.execute(
            select(SystemSetting).where(
                SystemSetting.organization_id == organization_id,
                SystemSetting.key == "cleanup_status",
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return {
            "ran_at": None,
            "next_scheduled": None,
            "deleted_records": 0,
            "deleted_files": 0,
            "message": "No cleanup has run yet",
        }
    return row.value


def storage_usage_bytes() -> int:
    root = storage_root()
    total = 0
    if not root.exists():
        return 0
    for path in root.rglob("*"):
        if path.is_file():
            total += path.stat().st_size
    return total
