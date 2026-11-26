"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  return (
    <Suspense
      fallback={
        <AppShell title="Activity">
          <p className="text-sm text-muted">Loading activity…</p>
        </AppShell>
      }
    >
      <ActivityInner />
    </Suspense>
  );
}

function ActivityInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const deviceId = params.get("device") ?? "";
  const mode: ViewMode = params.get("mode") === "video" ? "video" : "screenshot";
  const displayEvery = Math.max(1, Number(params.get("every") ?? "1") || 1);
  const groupMinutes = Number(params.get("group") ?? params.get("clip") ?? "5") || 5;
  const segmentMinutes = Number(params.get("clip") ?? "5") || 5;
  const fps = Number(params.get("fps") ?? "3") || 3;
  const openBucket = params.get("bucket") ?? params.get("minute") ?? "";
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null,
  );
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  function setParams(updates: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    // Drop legacy minute key once bucket is in use.
    if ("bucket" in updates) next.delete("minute");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: () => apiFetch<Device[]>("/devices"),
  });

  const deviceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of devices.data ?? []) map.set(d.id, d.name);
    return map;
  }, [devices.data]);

  const shots = useQuery({
    queryKey: ["screenshots", deviceId],
    queryFn: () =>
      apiFetch<Shot[]>(
        `/screenshots?limit=3000&include_mock=false${
          deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ""
        }`,
      ),
    refetchInterval: mode === "screenshot" ? 20_000 : false,
    staleTime: 10_000,
  });

  const segments = useQuery({
    queryKey: ["video-segments", deviceId, segmentMinutes],
    queryFn: () =>
      apiFetch<VideoSegment[]>(
        `/activity/video-segments?segment_minutes=${segmentMinutes}${
          deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ""
        }`,
      ),
    enabled: mode === "video",
  });

  const stats = useQuery({
    queryKey: ["activity-stats", deviceId],
    queryFn: () =>
      apiFetch<Stats>(
        `/activity/stats${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ""}`,
      ),
  });

  const allFrames = useMemo(() => {
    let list = (shots.data ?? []).filter((s) => !s.is_mock);
    // Client-side guard so a racey URL never shows the wrong device.
    if (deviceId) {
      list = list.filter((s) => s.device_id === deviceId);
    }
    return list;
  }, [shots.data, deviceId]);

  const bucketGroups = useMemo(
    () => groupShotsByBucket(allFrames, groupMinutes, deviceNameById),
    [allFrames, groupMinutes, deviceNameById],
  );
  const activeGroup = useMemo(
    () => bucketGroups.find((g) => g.key === openBucket) ?? null,
    [bucketGroups, openBucket],
  );
  const displayed = useMemo(() => {
    if (!activeGroup) return [];
    const stride = Math.max(1, displayEvery);
    return activeGroup.shots.filter((_, i) => i % stride === 0);
  }, [activeGroup, displayEvery]);

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
    setSelectedSegmentId(null);
  }, [deviceId, segmentMinutes]);

  useEffect(() => {
    if (mode === "video" && segmentList.length && !selectedSegmentId) {
      setSelectedSegmentId(segmentList[0].id);
    }
  }, [mode, segmentList, selectedSegmentId]);

  return (
    <AppShell
      title="Activity"
      mainClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-6"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <p className="shrink-0 text-sm text-muted">
          Batches are {groupMinutes} minutes with one cover image each. Open a
          batch for the frame grid. Only the open batch loads images.
        </p>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <select
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            value={deviceId}
            onChange={(e) =>
              setParams({
                device: e.target.value,
                bucket: "",
              })
            }
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
              onClick={() => setParams({ mode: "screenshot" })}
              label="Screenshot"
            />
            <ModeTab
              active={mode === "video"}
              onClick={() => setParams({ mode: "video" })}
              label="Video"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-muted">
            Batch length
            <select
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
              value={mode === "video" ? segmentMinutes : groupMinutes}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedSegmentId(null);
                setParams({
                  group: value,
                  clip: value,
                  bucket: "",
                });
              }}
            >
              <option value={5}>5 min</option>
              <option value={10}>10 min</option>
            </select>
          </label>

          {mode === "screenshot" ? (
            <label className="flex items-center gap-2 text-sm text-muted">
              In batch, show every
              <select
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                value={displayEvery}
                onChange={(e) => setParams({ every: e.target.value })}
              >
                {[1, 2, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="flex items-center gap-2 text-sm text-muted">
              Playback FPS
              <select
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                value={fps}
                onChange={(e) => setParams({ fps: e.target.value })}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={5}>5</option>
                <option value={8}>8</option>
              </select>
            </label>
          )}
        </div>

        <div className="grid shrink-0 gap-3 sm:grid-cols-4">
          <Stat label="Active (s)" value={stats.data?.active_seconds} />
          <Stat label="Idle (s)" value={stats.data?.idle_seconds} />
          <Stat label="Keystroke count" value={stats.data?.keystroke_count} />
          <Stat
            label={mode === "screenshot" ? "Batches / frames" : "Clips"}
            value={mode === "screenshot" ? undefined : segmentList.length}
            text={
              mode === "screenshot"
                ? `${bucketGroups.length} / ${allFrames.length}`
                : undefined
            }
          />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {mode === "screenshot" ? (
            <ScreenshotMode
              groups={bucketGroups}
              openBucket={openBucket}
              frames={displayed}
              loading={shots.isFetching && !shots.data}
              error={shots.isError ? "Could not load screenshots for this device." : null}
              onOpenBucket={(key) => setParams({ bucket: key })}
              onCloseBucket={() => setParams({ bucket: "" })}
              onOpenShot={(id) => setLightboxId(id)}
            />
          ) : (
            <VideoMode
              segments={segmentList}
              activeSegment={activeSegment}
              onSelectSegment={(id) => setSelectedSegmentId(id)}
              fps={fps}
            />
          )}
        </div>
      </div>

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

type BucketGroup = {
  key: string;
  label: string;
  deviceLabel?: string;
  coverId: string;
  shots: Shot[];
};

function groupShotsByBucket(
  frames: Shot[],
  minutes: number,
  deviceNames: Map<string, string>,
): BucketGroup[] {
  const bucketMs = Math.max(5, minutes) * 60 * 1000;
  const map = new Map<string, Shot[]>();
  for (const shot of frames) {
    const at = new Date(shot.captured_at);
    if (Number.isNaN(at.getTime())) continue;
    const start = Math.floor(at.getTime() / bucketMs) * bucketMs;
    const key = `${shot.device_id}|${new Date(start).toISOString()}`;
    const list = map.get(key);
    if (list) list.push(shot);
    else map.set(key, [shot]);
  }
  return [...map.entries()]
    .sort((a, b) => {
      const aTime = a[1][0]?.captured_at ?? "";
      const bTime = b[1][0]?.captured_at ?? "";
      return aTime < bTime ? 1 : -1;
    })
    .map(([key, shots]) => {
      const ordered = [...shots].sort((a, b) =>
        a.captured_at < b.captured_at ? -1 : 1,
      );
      const start = new Date(ordered[0].captured_at);
      const cover = ordered[Math.floor(ordered.length / 2)] ?? ordered[0];
      const deviceLabel = deviceNames.get(ordered[0].device_id);
      return {
        key,
        deviceLabel,
        coverId: cover.id,
        label: start.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
        shots: ordered,
      };
    });
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
  groups,
  openBucket,
  frames,
  loading,
  error,
  onOpenBucket,
  onCloseBucket,
  onOpenShot,
}: {
  groups: BucketGroup[];
  openBucket: string;
  frames: Shot[];
  loading: boolean;
  error: string | null;
  onOpenBucket: (key: string) => void;
  onCloseBucket: () => void;
  onOpenShot: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-surface text-sm text-muted">
        Loading screenshots…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-surface p-6 text-sm text-red-600">
        {error}
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
        No screenshot records for this device yet.
      </div>
    );
  }

  if (openBucket) {
    const group = groups.find((g) => g.key === openBucket);
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">
              {group?.label ?? "Selected batch"}
              {group?.deviceLabel ? ` · ${group.deviceLabel}` : ""}
            </h2>
            <p className="text-xs text-muted">
              {frames.length} frame{frames.length === 1 ? "" : "s"} in this batch
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={onCloseBucket}
          >
            Back to batches
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {frames.length === 0 ? (
            <p className="text-sm text-muted">
              No frames in this batch with the current filter.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {frames.map((shot) => (
                <button
                  key={shot.id}
                  type="button"
                  onClick={() => onOpenShot(shot.id)}
                  className="overflow-hidden rounded-lg border border-border bg-surface text-left transition hover:border-accent"
                >
                  <div className="relative aspect-video bg-muted-bg">
                    <AuthImage
                      shotId={shot.id}
                      alt=""
                      className="h-full w-full"
                    />
                    <MouseOverlay shot={shot} compact />
                  </div>
                  <div className="px-2 py-1.5 text-[11px] text-muted">
                    {new Date(shot.captured_at).toLocaleTimeString()}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="shrink-0 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted">
        Batches
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <button
              key={group.key}
              type="button"
              onClick={() => onOpenBucket(group.key)}
              className="overflow-hidden rounded-lg border border-border bg-surface text-left transition hover:border-accent"
            >
              <div className="relative aspect-video bg-muted-bg">
                <AuthImage
                  shotId={group.coverId}
                  alt=""
                  className="h-full w-full"
                />
                <span className="absolute right-2 top-2 rounded bg-black/65 px-2 py-0.5 text-[11px] text-white">
                  {group.shots.length}
                </span>
              </div>
              <div className="px-3 py-2">
                <div className="text-sm font-medium">{group.label}</div>
                <div className="text-xs text-muted">
                  {group.deviceLabel ? `${group.deviceLabel} · ` : ""}
                  {group.shots.length} screenshot
                  {group.shots.length === 1 ? "" : "s"}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function friendlyVideoError(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as { detail?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail.trim();
    }
  } catch {
    /* response was not JSON */
  }
  if (/ffmpeg/i.test(trimmed)) {
    return "Video could not be built because ffmpeg is not available on the server.";
  }
  if (trimmed.length > 220) {
    return "Video could not be built for this clip. Wait for more screenshots, then try again.";
  }
  return trimmed || "Video could not be built for this clip.";
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
          throw new Error(friendlyVideoError(text || res.statusText));
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
          setError(e instanceof Error ? e.message : "Video could not be built for this clip.");
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
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <div className="shrink-0 border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
          Clips
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
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
                        {seg.frame_count} frames → ~
                        {Math.max(1, Math.round(seg.frame_count / fps))}s @ {fps}
                        fps
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-black">
        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950">
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
        <div className="shrink-0 border-t border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
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
              className="max-h-[80vh] w-full"
              contain
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
  contain = false,
}: {
  shotId: string;
  alt: string;
  className?: string;
  contain?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
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
  }, [shotId, visible]);

  return (
    <div ref={hostRef} className={className}>
      {error ? (
        <div className="flex h-full w-full items-center justify-center bg-slate-900 text-xs text-slate-400">
          Failed to load
        </div>
      ) : !url ? (
        <div className="h-full w-full animate-pulse bg-muted-bg" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          className={`h-full w-full ${contain ? "object-contain" : "object-cover"}`}
        />
      )}
    </div>
  );
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
