from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBasic,
    HTTPBasicCredentials,
    HTTPBearer,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import decode_token, verify_password
from app.db.models import Device, DeviceCredential, User
from app.db.session import get_db

bearer = HTTPBearer(auto_error=False)
basic = HTTPBasic(auto_error=False)


@dataclass
class AdminContext:
    user: User
    organization_id: UUID
    role: str


@dataclass
class DeviceContext:
    device: Device
    organization_id: UUID


async def get_current_admin(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> AdminContext:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(creds.credentials)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    user_id = UUID(payload["sub"])
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")
    role_name = user.role.name if user.role else payload.get("role", "admin")
    return AdminContext(user=user, organization_id=user.organization_id, role=role_name)


async def get_current_device(
    creds: HTTPBasicCredentials | None = Depends(basic),
    db: AsyncSession = Depends(get_db),
) -> DeviceContext:
    if creds is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Device auth required")
    result = await db.execute(
        select(DeviceCredential)
        .options(selectinload(DeviceCredential.device))
        .where(DeviceCredential.client_id == creds.username)
    )
    credential = result.scalar_one_or_none()
    if credential is None or not verify_password(creds.password, credential.client_secret_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device credentials")
    return DeviceContext(device=credential.device, organization_id=credential.device.organization_id)
