from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)
    mfa_code: str | None = None


class TokenResponse(BaseModel):
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
    mfa_required: bool = False


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    role: str
    organization_id: str
    mfa_enabled: bool = False

    model_config = {"from_attributes": True}


class MfaSetupOut(BaseModel):
    secret: str
    otpauth_url: str
    mfa_enabled: bool


class MfaEnableRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class MfaDisableRequest(BaseModel):
    password: str
    code: str = Field(min_length=6, max_length=8)
