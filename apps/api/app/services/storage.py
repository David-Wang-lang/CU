"""Local object storage for screenshots (MinIO can replace this in Phase 5/7)."""

from pathlib import Path
from uuid import UUID

from app.core.config import get_settings


def storage_root() -> Path:
    settings = get_settings()
    root = Path(getattr(settings, "local_storage_path", "data/screenshots"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def save_screenshot_bytes(
    *,
    organization_id: UUID,
    device_id: UUID,
    record_id: UUID,
    data: bytes,
    content_type: str = "image/png",
) -> tuple[str, int]:
    lowered = content_type.lower()
    if "jpeg" in lowered or "jpg" in lowered:
        ext = "jpg"
    elif "png" in lowered:
        ext = "png"
    else:
        ext = "bin"
    rel = f"{organization_id}/{device_id}/{record_id}.{ext}"
    path = storage_root() / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return rel, len(data)


def resolve_screenshot_path(object_key: str) -> Path:
    path = storage_root() / object_key
    if not path.exists():
        raise FileNotFoundError(object_key)
    return path
