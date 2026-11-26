from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class EmployeeCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    department: str | None = None


class EmployeeUpdate(BaseModel):
    full_name: str | None = None
    department: str | None = None
    is_active: bool | None = None


class EmployeeOut(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    department: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
