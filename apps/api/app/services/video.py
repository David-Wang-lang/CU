"""Build smooth MP4 time-lapse clips from screenshot PNGs via ffmpeg."""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.services.storage import storage_root


def video_cache_root() -> Path:
    root = storage_root().parent / "videos"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _ffmpeg_bin() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        which = shutil.which("ffmpeg")
        if which:
            return which
        raise RuntimeError(
            "ffmpeg not available. Install imageio-ffmpeg or system ffmpeg."
        ) from exc


def cache_key(object_keys: list[str], fps: float) -> str:
    h = hashlib.sha256()
    h.update(f"fps={fps}\n".encode())
    for key in object_keys:
        h.update(key.encode())
        h.update(b"\n")
    return h.hexdigest()[:24]


def _frame_suffix(path: Path) -> str:
    """JPEG files were stored with a .png name. Trust the file header."""
    try:
        with path.open("rb") as handle:
            magic = handle.read(3)
    except OSError:
        return ".png"
    if magic[:2] == b"\xff\xd8":
        return ".jpg"
    return ".png"


def _mostly_jpeg(paths: list[Path]) -> bool:
    return bool(paths) and _frame_suffix(paths[0]) == ".jpg"


def render_timelapse_mp4(
    *,
    frame_paths: list[Path],
    fps: float = 3.0,
    out_path: Path | None = None,
) -> Path:
    """Encode frames into an H.264 MP4 (even dimensions, web-friendly)."""
    if len(frame_paths) < 1:
        raise ValueError("need at least one frame")
    fps = min(max(fps, 1.0), 60.0)
    if out_path is None:
        out_path = video_cache_root() / f"clip-{cache_key([str(p) for p in frame_paths], fps)}.mp4"
    if out_path.exists() and out_path.stat().st_size > 0:
        return out_path

    out_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = _ffmpeg_bin()

    with tempfile.TemporaryDirectory(prefix="cu-video-") as tmp:
        tmp_dir = Path(tmp)
        for i, src in enumerate(frame_paths):
            dest = tmp_dir / f"frame_{i:06d}{_frame_suffix(src)}"
            # Hard-link when possible; copy otherwise
            try:
                dest.hardlink_to(src)
            except OSError:
                shutil.copy2(src, dest)

        # Scale to even dims for yuv420p; constant framerate for smooth playback.
        cmd = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-framerate",
            str(fps),
            "-i",
            str(tmp_dir / "frame_%06d.jpg") if _mostly_jpeg(frame_paths) else str(tmp_dir / "frame_%06d.png"),
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(out_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode != 0 or not out_path.exists():
            raise RuntimeError(proc.stderr.strip() or "ffmpeg failed")

    return out_path
