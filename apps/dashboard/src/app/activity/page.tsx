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

type BucketGroup = {
  key: string;
  label: string;
  timeRange: string;
  deviceLabel?: string;
  coverId: string;
  shots: Shot[];
  startAt: string;
  endAt: string;
};

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
  const groupMinutes = Number(params.get("group") ?? params.get("clip") ?? "3") || 3;
  const segmentMinutes = Number(params.get("clip") ?? "3") || 3;
  const fps = Number(params.get("fps") ?? "3") || 3;
  const dayParam = params.get("day") ?? "today";
  const openBucket = params.get("bucket") ?? params.get("minute") ?? "";
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [filmIndex, setFilmIndex] = useState(0);

  function setParams(updates: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    if ("bucket" in updates) next.delete("minute");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const dayKey = resolveDayKey(dayParam);
  const dayInputValue = dayKey;
  const dayRange = useMemo(() => localDayBounds(dayKey), [dayKey]);

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
    queryKey: ["screenshots", deviceId, dayKey],
    queryFn: () =>
      apiFetch<Shot[]>(
        `/screenshots?limit=10000&include_mock=false` +
          `&from_ts=${encodeURIComponent(dayRange.fromIso)}` +
          `&to_ts=${encodeURIComponent(dayRange.toIso)}` +
          (deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ""),
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

  const dayFrames = useMemo(() => {
    let list = (shots.data ?? []).filter((s) => !s.is_mock);
    if (deviceId) list = list.filter((s) => s.device_id === deviceId);
    // Keep a local-day guard in case API timezone parsing drifts.
    return list.filter((s) => localDayKey(new Date(s.captured_at)) === dayKey);
  }, [shots.data, deviceId, dayKey]);

  const bucketGroups = useMemo(
    () => groupShotsByBucket(dayFrames, groupMinutes, deviceNameById),
    [dayFrames, groupMinutes, deviceNameById],
  );

  const hourSections = useMemo(
    () => groupBucketsByHour(bucketGroups),
    [bucketGroups],
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

  const segmentList = useMemo(() => {
    const list = segments.data ?? [];
    return list.filter((seg) => localDayKey(new Date(seg.start_at)) === dayKey);
  }, [segments.data, dayKey]);

  const videoCards = useMemo(
    () =>
      segmentList.map((seg) => ({
        id: seg.id,
        coverId: seg.screenshot_ids[Math.floor(seg.screenshot_ids.length / 2)] ?? seg.screenshot_ids[0] ?? "",
        timeRange: formatTimeRange(seg.start_at, seg.end_at),
        deviceLabel: deviceNameById.get(seg.device_id),
        frameCount: seg.frame_count,
        segment: seg,
      })),
    [segmentList, deviceNameById],
  );

  const activeSegment =
    segmentList.find((s) => s.id === selectedSegmentId) ?? segmentList[0] ?? null;

  useEffect(() => {
    setSelectedSegmentId(null);
  }, [deviceId, segmentMinutes, dayKey]);

  useEffect(() => {
    if (mode === "video" && segmentList.length && !selectedSegmentId) {
      setSelectedSegmentId(segmentList[0].id);
    }
  }, [mode, segmentList, selectedSegmentId]);

  useEffect(() => {
    setFilmIndex(0);
  }, [openBucket, displayEvery]);

  useEffect(() => {
    if (filmIndex >= displayed.length) setFilmIndex(0);
  }, [displayed.length, filmIndex]);

  const selectedShot = displayed[filmIndex] ?? null;

  return (
    <AppShell
      title="Activity"
      mainClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-6"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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
              onClick={() => setParams({ mode: "screenshot", bucket: "" })}
              label="Screenshot"
            />
            <ModeTab
              active={mode === "video"}
              onClick={() => setParams({ mode: "video", bucket: "" })}
              label="Video"
            />
          </div>

          <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
            <ModeTab
              active={dayParam === "today" || dayKey === todayKey()}
              onClick={() => setParams({ day: "today", bucket: "" })}
              label="Today"
            />
            <ModeTab
              active={dayParam === "yesterday" || dayKey === yesterdayKey()}
              onClick={() => setParams({ day: "yesterday", bucket: "" })}
              label="Yesterday"
            />
          </div>

          <input
            type="date"
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            value={dayInputValue}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              const today = todayKey();
              const yday = yesterdayKey();
              const day =
                value === today ? "today" : value === yday ? "yesterday" : value;
              setParams({ day, bucket: "" });
            }}
          />

          <label className="flex items-center gap-2 text-sm text-muted">
            Batch
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
              <option value={3}>3 min</option>
              <option value={5}>5 min</option>
              <option value={10}>10 min</option>
              <option value={15}>15 min</option>
            </select>
          </label>

          {mode === "screenshot" ? (
            <label className="flex items-center gap-2 text-sm text-muted">
              Every
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
              FPS
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

        <p className="shrink-0 text-xs text-muted">
          Active {stats.data?.active_seconds ?? "—"}s · Idle{" "}
          {stats.data?.idle_seconds ?? "—"}s · Keys{" "}
          {stats.data?.keystroke_count ?? "—"} ·{" "}
          {mode === "screenshot"
            ? `${bucketGroups.length} batches · ${dayFrames.length} frames`
            : `${segmentList.length} clips`}
        </p>

        <div className="min-h-0 flex-1 overflow-hidden">
          {mode === "screenshot" ? (
            <ScreenshotMode
              groups={bucketGroups}
              hourSections={hourSections}
              openBucket={openBucket}
              frames={displayed}
              selectedShot={selectedShot}
              filmIndex={filmIndex}
              loading={shots.isFetching && !shots.data}
              error={
                shots.isError
                  ? "Could not load screenshots for this device."
                  : null
              }
              onOpenBucket={(key) => setParams({ bucket: key })}
              onCloseBucket={() => setParams({ bucket: "" })}
              onSelectFrame={setFilmIndex}
            />
          ) : (
            <VideoMode
              cards={videoCards}
              activeSegment={activeSegment}
              onSelectSegment={(id) => setSelectedSegmentId(id)}
              fps={fps}
              loading={segments.isFetching && !segments.data}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

type HourSection = {
  key: string;
  label: string;
  frameCount: number;
  groups: BucketGroup[];
};

function groupShotsByBucket(
  frames: Shot[],
  minutes: number,
  deviceNames: Map<string, string>,
): BucketGroup[] {
  const bucketMs = Math.max(3, minutes) * 60 * 1000;
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
      const startAt = ordered[0].captured_at;
      const endAt = ordered[ordered.length - 1].captured_at;
      const cover = ordered[Math.floor(ordered.length / 2)] ?? ordered[0];
      const deviceLabel = deviceNames.get(ordered[0].device_id);
      return {
        key,
        deviceLabel,
        coverId: cover.id,
        startAt,
        endAt,
        timeRange: formatTimeRange(startAt, endAt),
        label: new Date(startAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
        shots: ordered,
      };
    });
}

function groupBucketsByHour(groups: BucketGroup[]): HourSection[] {
  const map = new Map<string, BucketGroup[]>();
  for (const group of groups) {
    const at = new Date(group.startAt);
    if (Number.isNaN(at.getTime())) continue;
    const hour = new Date(
      at.getFullYear(),
      at.getMonth(),
      at.getDate(),
      at.getHours(),
      0,
      0,
      0,
    );
    const key = hour.toISOString();
    const list = map.get(key);
    if (list) list.push(group);
    else map.set(key, [group]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, sectionGroups]) => {
      const hourDate = new Date(key);
      const frameCount = sectionGroups.reduce((n, g) => n + g.shots.length, 0);
      return {
        key,
        label: hourDate.toLocaleTimeString(undefined, {
          hour: "numeric",
        }),
        frameCount,
        groups: sectionGroups,
      };
    });
}

function groupVideoCardsByHour(
  cards: {
    id: string;
    coverId: string;
    timeRange: string;
    deviceLabel?: string;
    frameCount: number;
    segment: VideoSegment;
  }[],
): { key: string; label: string; frameCount: number; cards: typeof cards }[] {
  const map = new Map<string, typeof cards>();
  for (const card of cards) {
    const at = new Date(card.segment.start_at);
    if (Number.isNaN(at.getTime())) continue;
    const hour = new Date(
      at.getFullYear(),
      at.getMonth(),
      at.getDate(),
      at.getHours(),
      0,
      0,
      0,
    );
    const key = hour.toISOString();
    const list = map.get(key);
    if (list) list.push(card);
    else map.set(key, [card]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, sectionCards]) => {
      const hourDate = new Date(key);
      return {
        key,
        label: hourDate.toLocaleTimeString(undefined, { hour: "numeric" }),
        frameCount: sectionCards.reduce((n, c) => n + c.frameCount, 0),
        cards: sectionCards,
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
  hourSections,
  openBucket,
  frames,
  selectedShot,
  filmIndex,
  loading,
  error,
  onOpenBucket,
  onCloseBucket,
  onSelectFrame,
}: {
  groups: BucketGroup[];
  hourSections: HourSection[];
  openBucket: string;
  frames: Shot[];
  selectedShot: Shot | null;
  filmIndex: number;
  loading: boolean;
  error: string | null;
  onOpenBucket: (key: string) => void;
  onCloseBucket: () => void;
  onSelectFrame: (index: number) => void;
}) {
  useEffect(() => {
    if (!openBucket || frames.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseBucket();
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onSelectFrame(Math.max(0, filmIndex - 1));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onSelectFrame(Math.min(frames.length - 1, filmIndex + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openBucket, frames.length, filmIndex, onCloseBucket, onSelectFrame]);

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
        No screenshots for this day.
      </div>
    );
  }

  if (openBucket) {
    const group = groups.find((g) => g.key === openBucket);
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div>
            <h2 className="text-sm font-semibold">
              {group?.timeRange ?? "Batch"}
              {group?.deviceLabel ? ` · ${group.deviceLabel}` : ""}
            </h2>
            <p className="text-xs text-muted">
              {frames.length} frame{frames.length === 1 ? "" : "s"} · ← → to move
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={onCloseBucket}
          >
            Back
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-3">
          <button
            type="button"
            aria-label="Previous"
            disabled={filmIndex <= 0}
            onClick={() => onSelectFrame(Math.max(0, filmIndex - 1))}
            className="absolute left-3 z-10 rounded-full bg-black/50 px-3 py-2 text-lg text-white disabled:opacity-30"
          >
            ‹
          </button>
          {selectedShot ? (
            <div className="relative h-full max-h-full w-full max-w-5xl">
              <AuthImage
                shotId={selectedShot.id}
                alt="Screenshot"
                className="h-full w-full"
                contain
                eager
              />
              <MouseOverlay shot={selectedShot} />
            </div>
          ) : (
            <p className="text-sm text-slate-400">No frames in this batch.</p>
          )}
          <button
            type="button"
            aria-label="Next"
            disabled={filmIndex >= frames.length - 1}
            onClick={() =>
              onSelectFrame(Math.min(frames.length - 1, filmIndex + 1))
            }
            className="absolute right-3 z-10 rounded-full bg-black/50 px-3 py-2 text-lg text-white disabled:opacity-30"
          >
            ›
          </button>
        </div>

        <div className="shrink-0 border-t border-border bg-surface px-3 py-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {frames.map((shot, index) => {
              const active = index === filmIndex;
              return (
                <button
                  key={shot.id}
                  type="button"
                  onClick={() => onSelectFrame(index)}
                  className={`relative h-16 w-28 shrink-0 overflow-hidden rounded border ${
                    active
                      ? "border-accent ring-1 ring-accent"
                      : "border-border"
                  }`}
                >
                  <AuthImage
                    shotId={shot.id}
                    alt=""
                    className="h-full w-full"
                  />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/55 px-1 text-[10px] text-white">
                    {new Date(shot.captured_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-5">
          {hourSections.map((section) => (
            <section key={section.key}>
              <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-border pb-1.5">
                <h2 className="text-sm font-semibold text-foreground">
                  {section.label}
                </h2>
                <p className="text-xs text-muted">
                  {section.groups.length} batch
                  {section.groups.length === 1 ? "" : "es"} ·{" "}
                  {section.frameCount} frame
                  {section.frameCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {section.groups.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => onOpenBucket(group.key)}
                    className="overflow-hidden rounded-lg border border-border bg-surface text-left transition hover:border-accent"
                  >
                    <div className="relative aspect-[16/9] max-h-28 bg-muted-bg sm:max-h-32">
                      <AuthImage
                        shotId={group.coverId}
                        alt=""
                        className="h-full w-full"
                      />
                      <span className="absolute right-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                        {group.shots.length}
                      </span>
                    </div>
                    <div className="px-2.5 py-1.5">
                      <div className="text-sm font-medium">
                        {group.timeRange}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {group.deviceLabel ?? "Device"}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
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
  cards,
  activeSegment,
  onSelectSegment,
  fps,
  loading,
}: {
  cards: {
    id: string;
    coverId: string;
    timeRange: string;
    deviceLabel?: string;
    frameCount: number;
    segment: VideoSegment;
  }[];
  activeSegment: VideoSegment | null;
  onSelectSegment: (id: string) => void;
  fps: number;
  loading: boolean;
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
          setError(
            e instanceof Error
              ? e.message
              : "Video could not be built for this clip.",
          );
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [videoPath, activeSegment]);

  const hourSections = useMemo(() => groupVideoCardsByHour(cards), [cards]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-surface text-sm text-muted">
        Loading clips…
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
        No video clips for this day.
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-black">
        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950">
          {status === "encoding" ? (
            <p className="text-sm text-slate-400">Encoding MP4…</p>
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
        <div className="shrink-0 border-t border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300">
          {activeSegment
            ? `${activeSegment.frame_count} frames · ${fps} fps · ${formatTimeRange(
                activeSegment.start_at,
                activeSegment.end_at,
              )}`
            : "—"}
        </div>
      </div>

      <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <div className="shrink-0 border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
          Clips by hour
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="flex flex-col gap-4">
            {hourSections.map((section) => (
              <section key={section.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2 px-0.5">
                  <h3 className="text-xs font-semibold text-foreground">
                    {section.label}
                  </h3>
                  <span className="text-[10px] text-muted">
                    {section.cards.length} clip
                    {section.cards.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {section.cards.map((card) => {
                    const active = activeSegment?.id === card.id;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => onSelectSegment(card.id)}
                        className={`overflow-hidden rounded-lg border text-left transition ${
                          active
                            ? "border-accent ring-1 ring-accent"
                            : "border-border hover:border-accent"
                        }`}
                      >
                        <div className="relative aspect-[16/9] max-h-24 bg-muted-bg">
                          {card.coverId ? (
                            <AuthImage
                              shotId={card.coverId}
                              alt=""
                              className="h-full w-full"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs text-muted">
                              No cover
                            </div>
                          )}
                          <span className="absolute right-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                            {card.frameCount}
                          </span>
                        </div>
                        <div className="px-2.5 py-1.5">
                          <div className="text-sm font-medium">
                            {card.timeRange}
                          </div>
                          <div className="truncate text-xs text-muted">
                            {card.deviceLabel ?? "Device"} · ~
                            {Math.max(1, Math.round(card.frameCount / fps))}s
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </aside>
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
  eager = false,
}: {
  shotId: string;
  alt: string;
  className?: string;
  contain?: boolean;
  eager?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState(eager);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (eager) {
      setVisible(true);
      return;
    }
    const node = hostRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "800px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager]);

  useEffect(() => {
    if (!visible || !shotId) return;
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
          Failed
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

function formatTimeRange(startAt: string, endAt: string) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  return `${start.toLocaleTimeString(undefined, opts)}–${end.toLocaleTimeString(undefined, opts)}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function localDayKey(date: Date) {
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayKey() {
  return localDayKey(new Date());
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDayKey(d);
}

function resolveDayKey(dayParam: string) {
  if (dayParam === "today" || !dayParam) return todayKey();
  if (dayParam === "yesterday") return yesterdayKey();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayParam)) return dayParam;
  return todayKey();
}

/** Local calendar-day bounds as ISO strings for API from_ts / to_ts. */
function localDayBounds(dayKey: string): { fromIso: string; toIso: string } {
  const [y, m, d] = dayKey.split("-").map(Number);
  const from = new Date(y, m - 1, d, 0, 0, 0, 0);
  const to = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}
