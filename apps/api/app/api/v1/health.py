from datetime import UTC, datetime

from fastapi import APIRouter

from app import __version__
from app.schemas.health import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="cu-api",
        version=__version__,
        timestamp=datetime.now(UTC),
    )
