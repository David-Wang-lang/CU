"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { apiFetch, getAccessToken, getApiBase } from "@/lib/api";

type Device = { id: string; name: string };
type Shot = {
  id: string;
  device_id: string;
  captured_at: string;
  is_mock: boolean;
  image_url: string;
  mouse_x?: number | null;
  mouse_y?: number | null;
  mouse_buttons?: number | null;
  mouse_action?: string | null;
};
type Stats = {
  active_seconds: number;
  idle_seconds: number;
  keystroke_count: number;
  event_count: number;
};
type VideoSegment = {
  id: string;
  device_id: string;
  start_at: string;
  end_at: string;
  duration_seconds: number;
  frame_count: number;
  screenshot_ids: string[];
  video_url?: string | null;
};

type ViewMode = "screenshot" | "video";

export default function ActivityPage() {
  const [deviceId, setDeviceId] = useState("");
  const [mode, setMode] = useState<ViewMode>("screenshot");
  /** Display stride: show 1 image out of every N captures (not capture interval). */
  const [displayEvery, setDisplayEvery] = useState(1);
  const [segmentMinutes, setSegmentMinutes] = useState(30);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null,
  );
  const [fps, setFps] = useState(3);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: () => apiFetch<Device[]>("/devices"),
  });

  const shots = useQuery({
    queryKey: ["screenshots", deviceId],
    queryFn: () =>
      apiFetch<Shot[]>(
        `/screenshots?limit=5000&include_mock=false${
          deviceId ? `&device_id=${deviceId}` : ""
        }`,
      ),
    refetchInterval: mode === "screenshot" ? 5000 : false,
  });

  const segments = useQuery({
    queryKey: ["video-segments", deviceId, segmentMinutes],
    queryFn: () =>
      apiFetch<VideoSegment[]>(
        `/activity/video-segments?segment_minutes=${segmentMinutes}${
          deviceId ? `&device_id=${deviceId}` : ""
        }`,
      ),
    enabled: mode === "video",
  });

  const stats = useQuery({
    queryKey: ["activity-stats", deviceId],
    queryFn: () =>
      apiFetch<Stats>(
        `/activity/stats${deviceId ? `?device_id=${deviceId}` : ""}`,
      ),
  });

  const allFrames = useMemo(
    () => (shots.data ?? []).filter((s) => !s.is_mock),
    [shots.data],
  );
  const displayed = useMemo(() => {
    const stride = Math.max(1, displayEvery);
    return allFrames.filter((_, i) => i % stride === 0);
  }, [allFrames, displayEvery]);

  const segmentList = segments.data ?? [];
  const activeSegment =
    segmentList.find((s) => s.id === selectedSegmentId) ??
    segmentList[0] ??
    null;

  const lightboxIndex = useMemo(
    () => displayed.findIndex((s) => s.id === lightboxId),
    [displayed, lightboxId],
  );
  const lightboxShot =
    lightboxIndex >= 0 ? displayed[lightboxIndex] : null;

  useEffect(() => {
    if (mode === "video" && segmentList.length && !selectedSegmentId) {
      setSelectedSegmentId(segmentList[0].id);
    }
  }, [mode, segmentList, selectedSegmentId]);

  return (
    <AppShell title="Activity">
      <p className="mb-4 text-sm text-muted">
        Agent captures about once per second. Screenshot mode can thin the grid
        for viewing. Video mode builds a smooth MP4 time-lapse (ffmpeg) from
        real captures — clips default to 30 minutes of wall-clock time.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
        >
          <option value="">All devices</option>
          {(devices.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
          <ModeTab
            active={mode === "screenshot"}
            onClick={() => setMode("screenshot")}
            label="Screenshot"
          />
          <ModeTab
            active={mode === "video"}
            onClick={() => setMode("video")}
            label="Video"
          />
        </div>

        {mode === "screenshot" ? (
          <label className="flex items-center gap-2 text-sm text-muted">
            Show every
            <select
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
              value={displayEvery}
              onChange={(e) => setDisplayEvery(Number(e.target.value))}
            >
              {[1, 2, 5, 10, 15, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n} screenshot{n === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-muted">
              Clip length
              <select
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                value={segmentMinutes}
                onChange={(e) => {
                  setSegmentMinutes(Number(e.target.value));
                  setSelectedSegmentId(null);
                }}
              >
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              Playback FPS
              <select
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              >
                <option value={1}>1 (slowest)</option>
                <option value={2}>2</option>
                <option value={3}>3 (default)</option>
                <option value={5}>5</option>
                <option value={8}>8</option>
                <option value={12}>12 (faster)</option>
              </select>
            </label>
          </>
        )}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Active (s)" value={stats.data?.active_seconds} />
        <Stat label="Idle (s)" value={stats.data?.idle_seconds} />
        <Stat label="Keystroke count" value={stats.data?.keystroke_count} />
        <Stat
          label={mode === "screenshot" ? "Shown / total" : "Clips"}
          value={mode === "screenshot" ? undefined : segmentList.length}
          text={
            mode === "screenshot"
              ? `${displayed.length} / ${allFrames.length}`
              : undefined
          }
        />
      </div>

      {mode === "screenshot" ? (
        <ScreenshotMode
          frames={displayed}
          onOpen={(id) => setLightboxId(id)}
        />
      ) : (
        <VideoMode
          segments={segmentList}
          activeSegment={activeSegment}
          onSelectSegment={(id) => setSelectedSegmentId(id)}
          fps={fps}
        />
      )}

      {lightboxShot && lightboxIndex >= 0 ? (
        <Lightbox
          shot={lightboxShot}
          index={lightboxIndex}
          total={displayed.length}
          onClose={() => setLightboxId(null)}
          onPrev={() => {
            if (lightboxIndex > 0) {
              setLightboxId(displayed[lightboxIndex - 1].id);
            }
          }}
          onNext={() => {
            if (lightboxIndex < displayed.length - 1) {
              setLightboxId(displayed[lightboxIndex + 1].id);
            }
          }}
        />
      ) : null}
    </AppShell>
  );
}

function ModeTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-sm font-medium ${
        active
          ? "bg-accent text-accent-fg"
          : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function ScreenshotMode({
  frames,
  onOpen,
}: {
  frames: Shot[];
  onOpen: (id: string) => void;
}) {
  if (frames.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
        No screenshot records yet. Start the daemon to begin capturing.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {frames.map((shot) => (
        <button
          key={shot.id}
          type="button"
          onClick={() => onOpen(shot.id)}
          className="group overflow-hidden rounded-lg border border-border bg-surface text-left transition hover:border-accent"
        >
          <div className="relative aspect-video bg-muted-bg">
            <AuthImage
              shotId={shot.id}
              alt=""
              className="h-full w-full object-cover"
            />
            <MouseOverlay shot={shot} compact />
          </div>
          <div className="px-2 py-1.5 text-[11px] text-muted">
            {new Date(shot.captured_at).toLocaleString()}
            {shot.mouse_action && shot.mouse_action !== "move"
              ? ` · ${shot.mouse_action}`
              : ""}
          </div>
        </button>
      ))}
    </div>
  );
}

function VideoMode({
  segments,
  activeSegment,
  onSelectSegment,
  fps,
}: {
  segments: VideoSegment[];
  activeSegment: VideoSegment | null;
  onSelectSegment: (id: string) => void;
  fps: number;
}) {
  const videoPath = useMemo(() => {
    if (!activeSegment) return null;
    const q = new URLSearchParams({
      device_id: activeSegment.device_id,
      from_ts: activeSegment.start_at,
      to_ts: activeSegment.end_at,
      fps: String(fps),
    });
    return `/activity/video?${q}`;
  }, [activeSegment, fps]);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "encoding" | "ready" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    async function load() {
      if (!videoPath || !activeSegment) {
        setVideoUrl(null);
        setStatus("idle");
        return;
      }
      setStatus("encoding");
      setError(null);
      setVideoUrl(null);
      try {
        const token = getAccessToken();
        const res = await fetch(`${getApiBase()}${videoPath}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || res.statusText);
        }
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoked = url;
        setVideoUrl(url);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "Encode failed");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [videoPath, activeSegment]);

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
          Clips
        </div>
        {segments.length === 0 ? (
          <p className="p-4 text-sm text-muted">No clips yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {segments.map((seg, i) => {
              const active = activeSegment?.id === seg.id;
              return (
                <li key={seg.id}>
                  <button
                    type="button"
                    onClick={() => onSelectSegment(seg.id)}
                    className={`w-full px-3 py-3 text-left text-sm ${
                      active ? "bg-muted-bg" : "hover:bg-muted-bg/60"
                    }`}
                  >
                    <div className="font-medium">
                      Clip {i + 1} · {formatDuration(seg.duration_seconds)}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {new Date(seg.start_at).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted">
                      {seg.frame_count} frames → ~{Math.max(1, Math.round(seg.frame_count / fps))}s
                      @ {fps}fps
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <div className="overflow-hidden rounded-lg border border-border bg-black">
        <div className="flex aspect-video items-center justify-center bg-slate-950">
          {status === "encoding" ? (
            <p className="text-sm text-slate-400">
              Encoding smooth MP4 with ffmpeg…
            </p>
          ) : status === "error" ? (
            <p className="max-w-md px-4 text-center text-sm text-red-300">
              {error ?? "Failed to build video"}
            </p>
          ) : videoUrl ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              key={videoUrl}
              src={videoUrl}
              controls
              autoPlay
              className="max-h-full max-w-full"
            />
          ) : (
            <p className="text-sm text-slate-400">Select a clip</p>
          )}
        </div>
        <div className="border-t border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
          {activeSegment
            ? `${activeSegment.frame_count} real frames · encoded @ ${fps} fps · ${new Date(
                activeSegment.start_at,
              ).toLocaleString()} → ${new Date(activeSegment.end_at).toLocaleString()}`
            : "—"}
        </div>
      </div>
    </div>
  );
}

function Lightbox({
  shot,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}: {
  shot: Shot;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPrev();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-lg bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <p className="text-sm text-muted">
            {index + 1} / {total} · {new Date(shot.captured_at).toLocaleString()}
            <span className="ml-2 text-xs opacity-70">← → to navigate</span>
          </p>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-muted hover:bg-muted-bg"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="relative bg-slate-950 p-2">
          <button
            type="button"
            aria-label="Previous"
            disabled={index <= 0}
            onClick={onPrev}
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-lg text-white disabled:opacity-30"
          >
            ‹
          </button>
          <div className="relative mx-auto inline-block max-h-[80vh] w-full">
            <AuthImage
              shotId={shot.id}
              alt="Screenshot"
              className="max-h-[80vh] w-full object-contain"
            />
            <MouseOverlay shot={shot} />
          </div>
          <button
            type="button"
            aria-label="Next"
            disabled={index >= total - 1}
            onClick={onNext}
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-lg text-white disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}

function MouseOverlay({
  shot,
  compact = false,
}: {
  shot: Shot;
  compact?: boolean;
}) {
  if (shot.mouse_x == null || shot.mouse_y == null) return null;
  const left = `${shot.mouse_x * 100}%`;
  const top = `${shot.mouse_y * 100}%`;
  const isClick =
    shot.mouse_action === "click" ||
    shot.mouse_action === "right_click" ||
    shot.mouse_action === "middle_click";
  const isDrag = shot.mouse_action === "drag";
  const size = compact ? 10 : 18;
  return (
    <>
      <div
        className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2"
        style={{ left, top, width: size, height: size }}
        title={`mouse ${shot.mouse_action ?? "move"} (${shot.mouse_x.toFixed(2)}, ${shot.mouse_y.toFixed(2)})`}
      >
        <div
          className={`h-full w-full rounded-full border-2 ${
            isClick
              ? "border-amber-300 bg-amber-400/80"
              : isDrag
                ? "border-sky-300 bg-sky-400/70"
                : "border-white bg-teal-400/80"
          } shadow`}
        />
      </div>
      {!compact && shot.mouse_action && shot.mouse_action !== "move" ? (
        <div
          className="pointer-events-none absolute z-[5] -translate-y-1/2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white"
          style={{ left, top, marginLeft: 14 }}
        >
          {shot.mouse_action.replace("_", " ")}
        </div>
      ) : null}
    </>
  );
}

function AuthImage({
  shotId,
  alt,
  className,
}: {
  shotId: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    async function load() {
      setError(false);
      setUrl(null);
      const token = getAccessToken();
      const res = await fetch(`${getApiBase()}/screenshots/${shotId}/image`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok || cancelled) {
        if (!cancelled) setError(true);
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      revoked = objectUrl;
      if (!cancelled) setUrl(objectUrl);
    }
    load();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [shotId]);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-900 text-xs text-slate-400 ${className ?? ""}`}
      >
        Failed to load
      </div>
    );
  }
  if (!url) {
    return <div className={`animate-pulse bg-muted-bg ${className ?? ""}`} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={className} />;
}

function Stat({
  label,
  value,
  text,
}: {
  label: string;
  value?: number;
  text?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{text ?? value ?? "—"}</p>
    </div>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  }
  return s ? `${m}m ${s}s` : `${m}m`;
}
