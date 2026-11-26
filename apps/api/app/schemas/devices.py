from datetime import datetime

from pydantic import BaseModel, Field


class EnrollmentTokenCreate(BaseModel):
    label: str | None = None
    employee_id: str | None = None
    expires_in_days: int = Field(default=30, ge=1, le=365)


class EnrollmentTokenOut(BaseModel):
    id: str
    token: str
    label: str | None
    employee_id: str | None
    is_active: bool
    expires_at: datetime | None
    created_at: datetime


class DeviceEnrollRequest(BaseModel):
    enrollment_token: str
    name: str
    os: str
    os_version: str
    agent_version: str = "0.1.0"


class DeviceEnrollResponse(BaseModel):
    device_id: str
    client_id: str
    client_secret: str
    api_base_url: str
    monitoring_authorization: str


class DeviceHeartbeatRequest(BaseModel):
    agent_version: str = "0.1.0"
    cpu_percent: float | None = None
    memory_percent: float | None = None
    disk_percent: float | None = None


class DeviceOut(BaseModel):
    id: str
    name: str
    employee_id: str | None
    os: str
    os_version: str
    agent_version: str
    status: str
    monitoring_authorization: str
    registered_at: datetime
    last_seen_at: datetime | None


class DeviceAuthUpdate(BaseModel):
    monitoring_authorization: str = Field(pattern="^(authorized|withdrawn|pending)$")
    employee_id: str | None = None
