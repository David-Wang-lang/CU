import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AdminContext, DeviceContext, get_current_admin, get_current_device
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import (
    Device,
    DeviceCredential,
    DeviceHeartbeat,
    EnrollmentToken,
    MonitoringAuthorization,
)
from app.db.session import get_db
from app.schemas.devices import (
    DeviceAuthUpdate,
    DeviceEnrollRequest,
    DeviceEnrollResponse,
    DeviceHeartbeatRequest,
    DeviceOut,
    EnrollmentTokenCreate,
    EnrollmentTokenOut,
)

router = APIRouter(tags=["devices"])


def _device_out(device: Device, *, online_threshold: int) -> DeviceOut:
    status_value = device.status
    if device.last_seen_at is not None:
        last = device.last_seen_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=UTC)
        age = (datetime.now(UTC) - last).total_seconds()
        status_value = "online" if age <= online_threshold else "offline"
    return DeviceOut(
        id=str(device.id),
        name=device.name,
        employee_id=str(device.employee_id) if device.employee_id else None,
        os=device.os,
        os_version=device.os_version,
        agent_version=device.agent_version,
        status=status_value,
        monitoring_authorization=device.monitoring_authorization,
        registered_at=device.registered_at,
        last_seen_at=device.last_seen_at,
    )


@router.get("/devices", response_model=list[DeviceOut])
async def list_devices(
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[DeviceOut]:
    settings = get_settings()
    result = await db.execute(
        select(Device)
        .where(Device.organization_id == admin.organization_id)
        .order_by(Device.name)
    )
    return [_device_out(d, online_threshold=settings.online_threshold_seconds) for d in result.scalars()]


@router.patch("/devices/{device_id}", response_model=DeviceOut)
async def update_device(
    device_id: UUID,
    body: DeviceAuthUpdate,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> DeviceOut:
    settings = get_settings()
    result = await db.execute(
        select(Device).where(
            Device.id == device_id,
            Device.organization_id == admin.organization_id,
        )
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    if body.monitoring_authorization is None and not (body.name and body.name.strip()):
        raise HTTPException(status_code=400, detail="Nothing to update")
    if body.name is not None and body.name.strip():
        device.name = body.name.strip()
    if body.monitoring_authorization is None:
        await db.commit()
        await db.refresh(device)
        return _device_out(device, online_threshold=settings.online_threshold_seconds)
    device.monitoring_authorization = body.monitoring_authorization
    if body.employee_id is not None:
        device.employee_id = UUID(body.employee_id) if body.employee_id else None

    auth = (
        await db.execute(
            select(MonitoringAuthorization).where(MonitoringAuthorization.device_id == device.id)
        )
    ).scalar_one_or_none()
    now = datetime.now(UTC)
    if auth is None:
        auth = MonitoringAuthorization(
            organization_id=admin.organization_id,
            device_id=device.id,
            status=body.monitoring_authorization,
            authorized_by=admin.user.id,
            authorized_at=now if body.monitoring_authorization == "authorized" else None,
            withdrawn_at=now if body.monitoring_authorization == "withdrawn" else None,
        )
        db.add(auth)
    else:
        auth.status = body.monitoring_authorization
        if body.monitoring_authorization == "authorized":
            auth.authorized_at = now
            auth.authorized_by = admin.user.id
            auth.withdrawn_at = None
        elif body.monitoring_authorization == "withdrawn":
            auth.withdrawn_at = now

    await db.commit()
    await db.refresh(device)
    return _device_out(device, online_threshold=settings.online_threshold_seconds)


@router.post("/enrollment-tokens", response_model=EnrollmentTokenOut, status_code=201)
async def create_enrollment_token(
    body: EnrollmentTokenCreate,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> EnrollmentTokenOut:
    token_value = secrets.token_urlsafe(24)
    row = EnrollmentToken(
        organization_id=admin.organization_id,
        employee_id=UUID(body.employee_id) if body.employee_id else None,
        token=token_value,
        label=body.label,
        is_active=True,
        expires_at=datetime.now(UTC) + timedelta(days=body.expires_in_days),
        created_by=admin.user.id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return EnrollmentTokenOut(
        id=str(row.id),
        token=row.token,
        label=row.label,
        employee_id=str(row.employee_id) if row.employee_id else None,
        is_active=row.is_active,
        expires_at=row.expires_at,
        created_at=row.created_at,
    )


@router.get("/enrollment-tokens", response_model=list[EnrollmentTokenOut])
async def list_enrollment_tokens(
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[EnrollmentTokenOut]:
    result = await db.execute(
        select(EnrollmentToken)
        .where(EnrollmentToken.organization_id == admin.organization_id)
        .order_by(EnrollmentToken.created_at.desc())
    )
    rows = result.scalars().all()
    return [
        EnrollmentTokenOut(
            id=str(r.id),
            token=r.token,
            label=r.label,
            employee_id=str(r.employee_id) if r.employee_id else None,
            is_active=r.is_active,
            expires_at=r.expires_at,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.delete("/enrollment-tokens/{token_id}", status_code=204)
async def delete_enrollment_token(
    token_id: UUID,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(EnrollmentToken).where(
            EnrollmentToken.id == token_id,
            EnrollmentToken.organization_id == admin.organization_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Enrollment token not found")
    await db.delete(row)
    await db.commit()


@router.post("/devices/enroll", response_model=DeviceEnrollResponse)
async def enroll_device(
    body: DeviceEnrollRequest,
    db: AsyncSession = Depends(get_db),
) -> DeviceEnrollResponse:
    settings = get_settings()
    result = await db.execute(
        select(EnrollmentToken).where(
            EnrollmentToken.token == body.enrollment_token,
            EnrollmentToken.is_active.is_(True),
        )
    )
    token = result.scalar_one_or_none()
    if token is None:
        raise HTTPException(status_code=401, detail="Invalid enrollment token")
    if token.expires_at and token.expires_at.replace(tzinfo=UTC) < datetime.now(UTC):
        raise HTTPException(status_code=401, detail="Enrollment token expired")

    device = Device(
        organization_id=token.organization_id,
        employee_id=token.employee_id,
        name=body.name,
        os=body.os,
        os_version=body.os_version,
        agent_version=body.agent_version,
        status="online",
        monitoring_authorization="authorized",
        last_seen_at=datetime.now(UTC),
    )
    db.add(device)
    await db.flush()

    client_id = f"cu-device-{uuid4()}"
    client_secret = secrets.token_urlsafe(32)
    db.add(
        DeviceCredential(
            device_id=device.id,
            client_id=client_id,
            client_secret_hash=hash_password(client_secret),
        )
    )
    db.add(
        MonitoringAuthorization(
            organization_id=token.organization_id,
            device_id=device.id,
            status="authorized",
            authorized_at=datetime.now(UTC),
        )
    )
    token.used_at = datetime.now(UTC)
    # Keep token reusable for multi-device fleets in Phase 2; deactivate only if labeled single-use later
    await db.commit()

    return DeviceEnrollResponse(
        device_id=str(device.id),
        client_id=client_id,
        client_secret=client_secret,
        api_base_url=f"http://localhost:{settings.api_port}{settings.cu_api_prefix}",
        monitoring_authorization=device.monitoring_authorization,
    )


@router.post("/devices/heartbeat")
async def device_heartbeat(
    body: DeviceHeartbeatRequest,
    device_ctx: DeviceContext = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
) -> dict:
    device = device_ctx.device
    device.last_seen_at = datetime.now(UTC)
    device.status = "online"
    device.agent_version = body.agent_version
    db.add(
        DeviceHeartbeat(
            organization_id=device.organization_id,
            device_id=device.id,
            cpu_percent=body.cpu_percent,
            memory_percent=body.memory_percent,
            disk_percent=body.disk_percent,
            agent_version=body.agent_version,
            reported_at=datetime.now(UTC),
        )
    )
    await db.commit()
    return {
        "ok": True,
        "monitoring_authorization": device.monitoring_authorization,
    }
