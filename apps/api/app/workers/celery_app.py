import asyncio

from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "cu",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "retention-cleanup-hourly": {
            "task": "cu.retention_cleanup",
            "schedule": crontab(minute=0),
        },
    },
)


@celery_app.task(name="cu.ping")
def ping() -> str:
    return "pong"


@celery_app.task(name="cu.retention_cleanup")
def retention_cleanup() -> dict:
    from app.db.session import AsyncSessionLocal
    from app.services.cleanup import run_cleanup_all

    async def _run() -> list:
        async with AsyncSessionLocal() as session:
            return await run_cleanup_all(session)

    results = asyncio.run(_run())
    return {"ok": True, "orgs": len(results), "results": results}
