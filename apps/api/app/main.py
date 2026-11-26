import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from sqlalchemy import text

import app.db.models
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.base import Base
from app.db.session import AsyncSessionLocal, engine
from app.services.seed import seed_defaults

logger = logging.getLogger("cu.api")
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])


async def _retention_loop(stop: asyncio.Event) -> None:
    """In-process hourly cleanup when Celery/Redis is not used (local Mac dev)."""
    while not stop.is_set():
        try:
            async with AsyncSessionLocal() as session:
                from app.services.cleanup import run_cleanup_all

                results = await run_cleanup_all(session)
                logger.info("retention cleanup finished orgs=%s", len(results))
        except Exception:
            logger.exception("retention cleanup failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=3600)
        except TimeoutError:
            continue


async def _ensure_schema_columns() -> None:
    """Add columns introduced after initial create_all (SQLite + Postgres)."""
    url = get_settings().database_url
    async with engine.begin() as conn:
        if url.startswith("sqlite"):
            cols = await conn.execute(text("PRAGMA table_info(users)"))
            names = {row[1] for row in cols.fetchall()}
            if "mfa_secret" not in names:
                await conn.execute(text("ALTER TABLE users ADD COLUMN mfa_secret VARCHAR(64)"))
            shot_cols = await conn.execute(text("PRAGMA table_info(screenshot_records)"))
            shot_names = {row[1] for row in shot_cols.fetchall()}
            alters = {
                "mouse_x": "ALTER TABLE screenshot_records ADD COLUMN mouse_x FLOAT",
                "mouse_y": "ALTER TABLE screenshot_records ADD COLUMN mouse_y FLOAT",
                "mouse_buttons": "ALTER TABLE screenshot_records ADD COLUMN mouse_buttons INTEGER",
                "mouse_action": "ALTER TABLE screenshot_records ADD COLUMN mouse_action VARCHAR(32)",
            }
            for col, sql in alters.items():
                if col not in shot_names:
                    await conn.execute(text(sql))
            return

        # Postgres
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(64)")
        )
        await conn.execute(
            text("ALTER TABLE screenshot_records ADD COLUMN IF NOT EXISTS mouse_x DOUBLE PRECISION")
        )
        await conn.execute(
            text("ALTER TABLE screenshot_records ADD COLUMN IF NOT EXISTS mouse_y DOUBLE PRECISION")
        )
        await conn.execute(
            text(
                "ALTER TABLE screenshot_records ADD COLUMN IF NOT EXISTS mouse_buttons INTEGER"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE screenshot_records ADD COLUMN IF NOT EXISTS mouse_action VARCHAR(32)"
            )
        )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    settings = get_settings()
    if settings.database_url.startswith("sqlite"):
        Path("data").mkdir(parents=True, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _ensure_schema_columns()
    if settings.seed_on_startup:
        async with AsyncSessionLocal() as session:
            info = await seed_defaults(session)
            print(
                f"CU seed ready admin={info['admin_email']} "
                f"enrollment_token={info['enrollment_token']}"
            )
    stop = asyncio.Event()
    task = asyncio.create_task(_retention_loop(stop))
    yield
    stop.set()
    await task


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="CU Platform API — enterprise endpoint monitoring and DLP",
        lifespan=lifespan,
        docs_url="/docs",
        openapi_url="/openapi.json",
    )
    application.state.limiter = limiter
    application.add_middleware(SlowAPIMiddleware)
    application.add_exception_handler(
        RateLimitExceeded,
        lambda request, exc: JSONResponse(
            status_code=429, content={"detail": "Rate limit exceeded"}
        ),
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(api_router, prefix=settings.cu_api_prefix)

    @application.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    return application


app = create_app()
