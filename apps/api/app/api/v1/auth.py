from uuid import UUID

import pyotp
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import AdminContext, get_current_admin
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.db.models import User
from app.db.session import get_db
from app.schemas.auth import (
    LoginRequest,
    MfaDisableRequest,
    MfaEnableRequest,
    MfaSetupOut,
    RefreshRequest,
    TokenResponse,
    UserOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_tokens(user: User) -> TokenResponse:
    role = user.role.name if user.role else "admin"
    return TokenResponse(
        access_token=create_access_token(user.id, user.organization_id, role),
        refresh_token=create_refresh_token(user.id, user.organization_id),
        mfa_required=False,
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.email == body.email)
    )
    user = result.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")
    if user.mfa_enabled:
        if not body.mfa_code:
            return TokenResponse(mfa_required=True)
        if not user.mfa_secret or not pyotp.TOTP(user.mfa_secret).verify(body.mfa_code, valid_window=1):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid MFA code")
    return _issue_tokens(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    try:
        payload = decode_token(body.refresh_token)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh") from exc
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh")
    user_id = UUID(payload["sub"])
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")
    return _issue_tokens(user)


@router.get("/me", response_model=UserOut)
async def me(admin: AdminContext = Depends(get_current_admin)) -> UserOut:
    return UserOut(
        id=str(admin.user.id),
        email=admin.user.email,
        full_name=admin.user.full_name,
        role=admin.role,
        organization_id=str(admin.organization_id),
        mfa_enabled=admin.user.mfa_enabled,
    )


@router.post("/mfa/setup", response_model=MfaSetupOut)
async def mfa_setup(
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> MfaSetupOut:
    user = admin.user
    secret = user.mfa_secret or pyotp.random_base32()
    user.mfa_secret = secret
    await db.commit()
    totp = pyotp.TOTP(secret)
    url = totp.provisioning_uri(name=user.email, issuer_name="CU Admin")
    return MfaSetupOut(secret=secret, otpauth_url=url, mfa_enabled=user.mfa_enabled)


@router.post("/mfa/enable", response_model=UserOut)
async def mfa_enable(
    body: MfaEnableRequest,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    user = admin.user
    if not user.mfa_secret:
        raise HTTPException(status_code=400, detail="Call /auth/mfa/setup first")
    if not pyotp.TOTP(user.mfa_secret).verify(body.code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid MFA code")
    user.mfa_enabled = True
    await db.commit()
    return UserOut(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        role=admin.role,
        organization_id=str(admin.organization_id),
        mfa_enabled=True,
    )


@router.post("/mfa/disable", response_model=UserOut)
async def mfa_disable(
    body: MfaDisableRequest,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    user = admin.user
    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid password")
    if (
        user.mfa_enabled
        and user.mfa_secret
        and not pyotp.TOTP(user.mfa_secret).verify(body.code, valid_window=1)
    ):
        raise HTTPException(status_code=400, detail="Invalid MFA code")
    user.mfa_enabled = False
    user.mfa_secret = None
    await db.commit()
    return UserOut(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        role=admin.role,
        organization_id=str(admin.organization_id),
        mfa_enabled=False,
    )
