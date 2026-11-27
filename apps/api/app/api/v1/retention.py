from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

# datetime used for daily growth window
from app.api.deps import AdminContext, get_current_admin
from app.core.config import get_settings
from app.db.models import Device, RetentionPolicy, ScreenshotRecord
from app.db.session import get_db
from app.schemas.capture_settings import CaptureSettingsOut, CaptureSettingsUpdate
from app.schemas.retention import (
    RETENTION_OPTIONS,
    CleanupStatusOut,
    RetentionOut,
    RetentionUpdate,
    StorageAnalyticsOut,
)
from app.services.capture_settings import (
    get_capture_settings,
    set_capture_settings,
    settings_out,
)
from app.services.cleanup import (
    get_cleanup_status,
    get_retention_days,
    run_cleanup_for_org,
    storage_usage_bytes,
)

router = APIRouter(tags=["retention"])


@router.get("/capture-settings", response_model=CaptureSettingsOut)
async def get_org_capture_settings(
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> CaptureSettingsOut:
    data = await get_capture_settings(db, admin.organization_id)
    return settings_out(data)


@router.put("/capture-settings", response_model=CaptureSettingsOut)
async def update_org_capture_settings(
    body: CaptureSettingsUpdate,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> CaptureSettingsOut:
    data = await set_capture_settings(
        db,
        admin.organization_id,
        interval_seconds=body.interval_seconds,
        max_width=body.max_width,
        jpeg_quality=body.jpeg_quality,
    )
    return settings_out(data)


@router.get("/retention", response_model=RetentionOut)
async def get_retention(
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> RetentionOut:
    row = (
        await db.execute(
            select(RetentionPolicy).where(RetentionPolicy.organization_id == admin.organization_id)
        )
    ).scalar_one_or_none()
    settings = get_settings()
    if row is None:
        return RetentionOut(retention_days=settings.default_retention_days, options=RETENTION_OPTIONS)
    return RetentionOut(
        retention_days=row.retention_days,
        custom_days=row.custom_days,
        options=RETENTION_OPTIONS,
        updated_at=row.updated_at,
    )


@router.put("/retention", response_model=RetentionOut)
async def update_retention(
    body: RetentionUpdate,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> RetentionOut:
    row = (
        await db.execute(
            select(RetentionPolicy).where(RetentionPolicy.organization_id == admin.organization_id)
        )
    ).scalar_one_or_none()
    days = body.custom_days or body.retention_days
    if row is None:
        row = RetentionPolicy(
            organization_id=admin.organization_id,
            retention_days=body.retention_days if body.retention_days in RETENTION_OPTIONS else 5,
            custom_days=body.custom_days or (None if body.retention_days in RETENTION_OPTIONS else days),
            updated_by=admin.user.id,
        )
        db.add(row)
    else:
        row.retention_days = body.retention_days if body.retention_days in RETENTION_OPTIONS else row.retention_days
        row.custom_days = body.custom_days if body.custom_days else (
            body.retention_days if body.retention_days not in RETENTION_OPTIONS else None
        )
        row.updated_by = admin.user.id
        # Recompute expires_at for existing screenshots
    retention = body.custom_days or body.retention_days
    shots = (
        await db.execute(
            select(ScreenshotRecord).where(ScreenshotRecord.organization_id == admin.organization_id)
        )
    ).scalars().all()
    for shot in shots:
        base = shot.captured_at
        if base.tzinfo is None:
            base = base.replace(tzinfo=UTC)
        shot.expires_at = base + timedelta(days=retention)
    await db.commit()
    await db.refresh(row)
    return RetentionOut(
        retention_days=row.retention_days,
        custom_days=row.custom_days,
        options=RETENTION_OPTIONS,
        updated_at=row.updated_at,
    )


@router.get("/retention/cleanup-status", response_model=CleanupStatusOut)
async def cleanup_status(
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> CleanupStatusOut:
    status = await get_cleanup_status(db, admin.organization_id)
    return CleanupStatusOut(**{k: status.get(k) for k in CleanupStatusOut.model_fields})


@router.post("/retention/cleanup", response_model=CleanupStatusOut)
async def trigger_cleanup(
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> CleanupStatusOut:
    result = await run_cleanup_for_org(db, admin.organization_id)
    return CleanupStatusOut(
        ran_at=result.get("ran_at"),
        next_scheduled=result.get("next_scheduled"),
        deleted_records=result.get("deleted_records", 0),
        deleted_files=result.get("deleted_files", 0),
        failed=result.get("failed", 0),
        retention_days=result.get("retention_days"),
    )


@router.get("/storage/analytics", response_model=StorageAnalyticsOut)
async def storage_analytics(
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> StorageAnalyticsOut:
    org = admin.organization_id
    used = storage_usage_bytes()
    count = (
        await db.execute(
            select(func.count()).select_from(ScreenshotRecord).where(
                ScreenshotRecord.organization_id == org
            )
        )
    ).scalar_one()
    by_device_rows = (
        await db.execute(
            select(
                ScreenshotRecord.device_id,
                func.count(),
                func.coalesce(func.sum(ScreenshotRecord.byte_size), 0),
            )
            .where(ScreenshotRecord.organization_id == org)
            .group_by(ScreenshotRecord.device_id)
        )
    ).all()
    device_names = {
        str(d.id): d.name
        for d in (
            await db.execute(select(Device).where(Device.organization_id == org))
        ).scalars().all()
    }
    by_device = [
        {
            "device_id": str(device_id),
            "device_name": device_names.get(str(device_id), "unknown"),
            "screenshot_count": int(cnt),
            "bytes": int(size),
        }
        for device_id, cnt, size in by_device_rows
    ]
    day_ago = datetime.now(UTC) - timedelta(days=1)
    daily = (
        await db.execute(
            select(func.coalesce(func.sum(ScreenshotRecord.byte_size), 0)).where(
                ScreenshotRecord.organization_id == org,
                ScreenshotRecord.created_at >= day_ago,
            )
        )
    ).scalar_one()
    daily_i = int(daily or 0)
    retention = await get_retention_days(db, org)
    cleanup = await get_cleanup_status(db, org)
    return StorageAnalyticsOut(
        total_bytes=max(used * 2, 10 * 1024**3),  # soft capacity estimate for UI
        used_bytes=used,
        available_bytes=max(0, max(used * 2, 10 * 1024**3) - used),
        screenshot_count=int(count),
        by_device=by_device,
        daily_growth_bytes=daily_i,
        estimated_30d_bytes=daily_i * 30,
        retention_days=retention,
        cleanup=CleanupStatusOut(**{k: cleanup.get(k) for k in CleanupStatusOut.model_fields}),
    )
