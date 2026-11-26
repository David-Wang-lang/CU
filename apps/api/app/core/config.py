from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    cu_env: str = "development"
    cu_log_level: str = "INFO"
    cu_api_prefix: str = "/api/v1"
    app_name: str = "CU API"
    app_version: str = "0.1.0"

    database_url: str = "sqlite+aiosqlite:///./data/cu.db"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin_change_me"
    s3_bucket: str = "cu-monitoring"
    s3_region: str = "us-east-1"
    local_storage_path: str = "data/screenshots"

    secret_key: str = "change-me-to-a-long-random-string-in-production"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7
    cors_origins: str = "http://localhost:3000,http://localhost:1420"

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    default_retention_days: int = 5
    seed_on_startup: bool = True
    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = "admin123!"
    online_threshold_seconds: int = 120

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
