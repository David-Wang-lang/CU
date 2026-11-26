import base64
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AdminContext, DeviceContext, get_current_admin, get_current_device
from app.core.config import get_settings
from app.db.models import ActivityEvent, Alert, Device, Employee, ScreenshotRecord
from app.db.session import get_db
from app.schemas.monitoring import (
    ActivityEventIn,
    ActivityStatsOut,
    OverviewOut,
    ScreenshotOut,
    ScreenshotUploadResponse,
    VideoRenderOut,
    VideoSegmentOut,
)
from app.services.storage import resolve_screenshot_path, save_screenshot_bytes
from app.services.video import cache_key, render_timelapse_mp4, video_cache_root

router = APIRouter(tags=["monitoring"])


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


@router.get("/overview", response_model=OverviewOut)
async def overview(
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> OverviewOut:
    settings = get_settings()
    org = admin.organization_id
    employees = (
        await db.execute(select(func.count()).select_from(Employee).where(Employee.organization_id == org))
    ).scalar_one()
    devices = (
        await db.execute(select(Device).where(Device.organization_id == org))
    ).scalars().all()
    threshold = datetime.now(UTC) - timedelta(seconds=settings.online_threshold_seconds)
    online = 0
    authorized = 0
    for d in devices:
        last = _aware(d.last_seen_at)
        if last and last >= threshold:
            online += 1
        if d.monitoring_authorization == "authorized":
            authorized += 1
    alerts = (
        await db.execute(
            select(func.count())
            .select_from(Alert)
            .where(Alert.organization_id == org, Alert.is_resolved.is_(False))
        )
    ).scalar_one()
    screenshots = (
        await db.execute(
            select(func.count()).select_from(ScreenshotRecord).where(ScreenshotRecord.organization_id == org)
        )
    ).scalar_one()
    return OverviewOut(
        employees=employees,
        devices=len(devices),
        online_devices=online,
        offline_devices=max(0, len(devices) - online),
        authorized_sessions=authorized,
        alerts=alerts,
        screenshots=screenshots,
    )


@router.post("/screenshots", response_model=ScreenshotUploadResponse)
async def upload_screenshot(
    captured_at: str | None = Form(default=None),
    monitor_index: int = Form(default=0),
    is_mock: bool = Form(default=True),
    mouse_x: float | None = Form(default=None),
    mouse_y: float | None = Form(default=None),
    mouse_buttons: int | None = Form(default=None),
    mouse_action: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    image_base64: str | None = Form(default=None),
    device_ctx: DeviceContext = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
) -> ScreenshotUploadResponse:
    device = device_ctx.device
    if device.monitoring_authorization != "authorized":
        raise HTTPException(status_code=403, detail="Monitoring not authorized")

    if file is not None:
        data = await file.read()
        content_type = file.content_type or "image/png"
    elif image_base64:
        data = base64.b64decode(image_base64)
        content_type = "image/png"
    else:
        raise HTTPException(status_code=400, detail="file or image_base64 required")

    record_id = uuid4()
    captured = (
        datetime.fromisoformat(captured_at)
        if captured_at
        else datetime.now(UTC)
    )
    settings = get_settings()
    object_key, size = save_screenshot_bytes(
        organization_id=device.organization_id,
        device_id=device.id,
        record_id=record_id,
        data=data,
        content_type=content_type,
    )
    expires = captured + timedelta(days=settings.default_retention_days)
    action = (mouse_action or None) and mouse_action[:32]
    row = ScreenshotRecord(
        id=record_id,
        organization_id=device.organization_id,
        device_id=device.id,
        captured_at=captured,
        monitor_index=monitor_index,
        object_key=object_key,
        content_type=content_type,
        byte_size=size,
        is_mock=is_mock,
        mouse_x=mouse_x,
        mouse_y=mouse_y,
        mouse_buttons=mouse_buttons,
        mouse_action=action,
        expires_at=expires,
    )
    db.add(row)
    await db.commit()
    return ScreenshotUploadResponse(
        id=str(row.id),
        object_key=object_key,
        captured_at=captured,
        is_mock=is_mock,
    )


@router.get("/screenshots", response_model=list[ScreenshotOut])
async def list_screenshots(
    device_id: UUID | None = None,
    limit: int = 2000,
    from_ts: datetime | None = None,
    to_ts: datetime | None = None,
    include_mock: bool = False,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[ScreenshotOut]:
    stmt = (
        select(ScreenshotRecord)
        .where(ScreenshotRecord.organization_id == admin.organization_id)
        .order_by(ScreenshotRecord.captured_at.asc())
        .limit(min(max(limit, 1), 10000))
    )
    if device_id:
        stmt = stmt.where(ScreenshotRecord.device_id == device_id)
    if from_ts is not None:
        stmt = stmt.where(ScreenshotRecord.captured_at >= from_ts)
    if to_ts is not None:
        stmt = stmt.where(ScreenshotRecord.captured_at <= to_ts)
    if not include_mock:
        stmt = stmt.where(ScreenshotRecord.is_mock.is_(False))
    rows = (await db.execute(stmt)).scalars().all()
    return [
        ScreenshotOut(
            id=str(r.id),
            device_id=str(r.device_id),
            captured_at=r.captured_at,
            monitor_index=r.monitor_index,
            content_type=r.content_type,
            byte_size=r.byte_size,
            is_mock=r.is_mock,
            image_url=f"/api/v1/screenshots/{r.id}/image",
            mouse_x=r.mouse_x,
            mouse_y=r.mouse_y,
            mouse_buttons=r.mouse_buttons,
            mouse_action=r.mouse_action,
        )
        for r in rows
    ]


@router.get("/activity/video-segments", response_model=list[VideoSegmentOut])
async def list_video_segments(
    device_id: UUID | None = None,
    segment_minutes: int = 30,
    limit_frames: int = 20000,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[VideoSegmentOut]:
    """Group real screenshots into wall-clock clips (default 30 minutes) for Video mode."""
    minutes = min(max(segment_minutes, 5), 120)
    bucket = timedelta(minutes=minutes)
    stmt = (
        select(ScreenshotRecord)
        .where(
            ScreenshotRecord.organization_id == admin.organization_id,
            ScreenshotRecord.is_mock.is_(False),
        )
        .order_by(ScreenshotRecord.captured_at.asc())
        .limit(min(max(limit_frames, 1), 50000))
    )
    if device_id:
        stmt = stmt.where(ScreenshotRecord.device_id == device_id)
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return []

    segments: list[VideoSegmentOut] = []
    by_device: dict[str, list[ScreenshotRecord]] = {}
    for r in rows:
        by_device.setdefault(str(r.device_id), []).append(r)

    for did, frames in by_device.items():
        first = _aware(frames[0].captured_at) or datetime.now(UTC)
        current_start = first
        current_end = first + bucket
        batch: list[ScreenshotRecord] = []

        def flush(start: datetime, end: datetime, batch_rows: list[ScreenshotRecord]) -> None:
            if not batch_rows:
                return
            last = _aware(batch_rows[-1].captured_at) or end
            start_a = _aware(batch_rows[0].captured_at) or start
            dur = max(1, int((last - start_a).total_seconds()))
            seg_id = f"{did}:{start_a.isoformat()}"
            segments.append(
                VideoSegmentOut(
                    id=seg_id,
                    device_id=did,
                    start_at=start_a,
                    end_at=last,
                    duration_seconds=dur,
                    frame_count=len(batch_rows),
                    screenshot_ids=[str(x.id) for x in batch_rows],
                    video_url=(
                        f"/api/v1/activity/video?"
                        f"device_id={did}&from_ts={start_a.isoformat()}&to_ts={last.isoformat()}&fps=3"
                    ),
                )
            )

        for r in frames:
            ts = _aware(r.captured_at) or current_start
            while ts >= current_end:
                flush(current_start, current_end, batch)
                batch = []
                current_start = current_end
                current_end = current_start + bucket
            batch.append(r)
        flush(current_start, current_end, batch)

    segments.sort(key=lambda s: s.start_at)
    return segments


@router.get("/activity/video", response_model=None)
async def render_activity_video(
    device_id: UUID,
    from_ts: datetime,
    to_ts: datetime,
    fps: float = 3.0,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    """Encode a smooth MP4 time-lapse from real screenshots in [from_ts, to_ts]."""
    stmt = (
        select(ScreenshotRecord)
        .where(
            ScreenshotRecord.organization_id == admin.organization_id,
            ScreenshotRecord.device_id == device_id,
            ScreenshotRecord.is_mock.is_(False),
            ScreenshotRecord.captured_at >= from_ts,
            ScreenshotRecord.captured_at <= to_ts,
        )
        .order_by(ScreenshotRecord.captured_at.asc())
        .limit(20000)
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="No frames in range")

    paths = []
    keys = []
    for r in rows:
        try:
            paths.append(resolve_screenshot_path(r.object_key))
            keys.append(r.object_key)
        except FileNotFoundError:
            continue
    if not paths:
        raise HTTPException(status_code=404, detail="Screenshot files missing")

    out = video_cache_root() / f"{cache_key(keys, fps)}.mp4"
    try:
        render_timelapse_mp4(frame_paths=paths, fps=fps, out_path=out)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Video encode failed: {exc}") from exc

    from app.services.audit import write_audit

    await write_audit(
        db,
        organization_id=admin.organization_id,
        actor_user_id=admin.user.id,
        action="video.render",
        resource_type="device",
        resource_id=str(device_id),
        details={"frames": len(paths), "fps": fps},
    )
    return FileResponse(out, media_type="video/mp4", filename="activity-clip.mp4")


@router.post("/activity/video/render", response_model=VideoRenderOut)
async def prepare_activity_video(
    device_id: UUID,
    from_ts: datetime,
    to_ts: datetime,
    fps: float = 3.0,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> VideoRenderOut:
    """Pre-render a clip and return metadata + URL (same encode as GET /activity/video)."""
    stmt = (
        select(ScreenshotRecord)
        .where(
            ScreenshotRecord.organization_id == admin.organization_id,
            ScreenshotRecord.device_id == device_id,
            ScreenshotRecord.is_mock.is_(False),
            ScreenshotRecord.captured_at >= from_ts,
            ScreenshotRecord.captured_at <= to_ts,
        )
        .order_by(ScreenshotRecord.captured_at.asc())
        .limit(20000)
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="No frames in range")
    paths = []
    keys = []
    for r in rows:
        try:
            paths.append(resolve_screenshot_path(r.object_key))
            keys.append(r.object_key)
        except FileNotFoundError:
            continue
    if not paths:
        raise HTTPException(status_code=404, detail="Screenshot files missing")
    out = video_cache_root() / f"{cache_key(keys, fps)}.mp4"
    try:
        render_timelapse_mp4(frame_paths=paths, fps=fps, out_path=out)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Video encode failed: {exc}") from exc
    return VideoRenderOut(
        segment_id=f"{device_id}:{from_ts.isoformat()}",
        frame_count=len(paths),
        fps=fps,
        duration_seconds=round(len(paths) / max(fps, 0.1), 2),
        video_url=(
            f"/api/v1/activity/video?device_id={device_id}"
            f"&from_ts={from_ts.isoformat()}&to_ts={to_ts.isoformat()}&fps={fps}"
        ),
        byte_size=out.stat().st_size,
    )


@router.get("/screenshots/{screenshot_id}/image")
async def get_screenshot_image(
    screenshot_id: UUID,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    result = await db.execute(
        select(ScreenshotRecord).where(
            ScreenshotRecord.id == screenshot_id,
            ScreenshotRecord.organization_id == admin.organization_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    from app.services.audit import write_audit

    await write_audit(
        db,
        organization_id=admin.organization_id,
        actor_user_id=admin.user.id,
        action="screenshot.view",
        resource_type="screenshot_record",
        resource_id=str(row.id),
        details={"device_id": str(row.device_id), "is_mock": row.is_mock},
    )
    try:
        path = resolve_screenshot_path(row.object_key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File missing") from exc
    return FileResponse(path, media_type=row.content_type)


@router.post("/activity/events")
async def post_activity_events(
    events: list[ActivityEventIn],
    device_ctx: DeviceContext = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
) -> dict:
    device = device_ctx.device
    if device.monitoring_authorization != "authorized":
        raise HTTPException(status_code=403, detail="Monitoring not authorized")
    for event in events:
        db.add(
            ActivityEvent(
                organization_id=device.organization_id,
                device_id=device.id,
                event_type=event.event_type,
                payload=event.payload,
                occurred_at=event.occurred_at or datetime.now(UTC),
            )
        )
    await db.commit()
    return {"accepted": len(events)}


@router.get("/activity/stats", response_model=ActivityStatsOut)
async def activity_stats(
    device_id: UUID | None = None,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> ActivityStatsOut:
    stmt = select(ActivityEvent).where(ActivityEvent.organization_id == admin.organization_id)
    if device_id:
        stmt = stmt.where(ActivityEvent.device_id == device_id)
    rows = (await db.execute(stmt)).scalars().all()
    active = idle = keys = 0
    times: list[datetime] = []
    for r in rows:
        times.append(r.occurred_at)
        payload = r.payload or {}
        active += int(payload.get("active_seconds", 0))
        idle += int(payload.get("idle_seconds", 0))
        keys += int(payload.get("keystroke_count", 0))
        if r.event_type == "keystroke_stats":
            keys += int(payload.get("count", 0))
    return ActivityStatsOut(
        device_id=str(device_id) if device_id else None,
        active_seconds=active,
        idle_seconds=idle,
        keystroke_count=keys,
        event_count=len(rows),
        from_ts=min(times) if times else None,
        to_ts=max(times) if times else None,
    )
