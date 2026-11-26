"""Seed default organization, roles, and admin user."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import EnrollmentToken, Organization, RetentionPolicy, Role, User


async def seed_defaults(db: AsyncSession) -> dict[str, str]:
    settings = get_settings()
    admin_email = getattr(settings, "seed_admin_email", "admin@cu.local")
    admin_password = getattr(settings, "seed_admin_password", "admin123!")

    role = (
        await db.execute(select(Role).where(Role.name == "admin"))
    ).scalar_one_or_none()
    if role is None:
        role = Role(name="admin", description="Full administrator", permissions={"*": True})
        db.add(role)
        await db.flush()

    org = (
        await db.execute(select(Organization).where(Organization.slug == "default"))
    ).scalar_one_or_none()
    if org is None:
        org = Organization(name="Default Organization", slug="default")
        db.add(org)
        await db.flush()
        db.add(RetentionPolicy(organization_id=org.id, retention_days=settings.default_retention_days))

    user = (
        await db.execute(
            select(User).where(User.organization_id == org.id, User.email == admin_email)
        )
    ).scalar_one_or_none()
    if user is None:
        user = User(
            organization_id=org.id,
            role_id=role.id,
            email=admin_email,
            full_name="CU Admin",
            hashed_password=hash_password(admin_password),
            is_active=True,
        )
        db.add(user)
        await db.flush()

    token_row = (
        await db.execute(
            select(EnrollmentToken).where(
                EnrollmentToken.organization_id == org.id,
                EnrollmentToken.label == "default-dev",
                EnrollmentToken.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if token_row is None:
        token_value = secrets.token_urlsafe(24)
        token_row = EnrollmentToken(
            organization_id=org.id,
            token=token_value,
            label="default-dev",
            is_active=True,
            expires_at=datetime.now(UTC) + timedelta(days=365),
            created_by=user.id,
        )
        db.add(token_row)
    else:
        token_value = token_row.token

    await db.commit()
    return {
        "admin_email": admin_email,
        "admin_password": admin_password,
        "enrollment_token": token_value,
        "organization_id": str(org.id),
    }
