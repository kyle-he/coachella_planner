"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { DAYS, STAGES, type Stage } from "@/lib/coachella-data";
import { getWalkingTime } from "@/lib/stage-proximity";

// ── Types ────────────────────────────────────────────────────────────

interface TrackInfo {
  id: string | number;
  title: string;
  preview: string;
  duration: number;
  albumTitle: string;
  albumCover: string;
  link: string;
  source?: "deezer" | "spotify";
  isUserTopTrack?: boolean;
}

interface SetTime {
  artist: { name: string; spotifyName?: string };
  stage: string;
  day: "friday" | "saturday" | "sunday";
  dayLabel: string;
  startTime: string;
  endTime: string;
}

interface ArtistRecommendation {
  setTime: SetTime;
  artist: {
    name: string;
    image: string;
    link: string;
    fans: number;
    deezerId: number;
  } | null;
  affinityScore: number;
  affinityReason: string;
  topTracks: TrackInfo[];
  userTopTracks?: TrackInfo[];
  userTopTrackNames?: string[];
  matchType: "direct" | "genre" | "related" | "none";
  relatedTo?: string;
  genreOverlap?: string[];
}

interface ScheduleSlot {
  recommendation: ArtistRecommendation;
  walkFromPrevious: number | null;
  prevStage: string | null;
  isConflict: boolean;
  conflictWith?: string[];
}

interface DaySchedule {
  day: string;
  slots: ScheduleSlot[];
  totalWalkTime: number;
}

interface UserProfile {
  display_name: string;
  images: { url: string }[];
}

// ── Stage colors (Coachella multi-color palette) ─────────────────────

const STAGE_COLORS: Record<string, string> = {
  "Coachella Stage": "#00404f",
  "Outdoor Theater": "#294e2d",
  Sonora: "#5c7a6e",
  Gobi: "#3d8b6a",
  Mojave: "#8b6a4a",
  Sahara: "#4a6b8c",
  Yuma: "#2a5560",
};

// ── Helpers ──────────────────────────────────────────────────────────

function formatTime(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const hour = h > 24 ? h - 24 : h;
  const ampm = hour >= 12 && hour < 24 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function setsOverlap(a: SetTime, b: SetTime): boolean {
  if (a.day !== b.day) return false;
  const aStart = timeToMinutes(a.startTime);
  const aEnd = timeToMinutes(a.endTime);
  const bStart = timeToMinutes(b.startTime);
  const bEnd = timeToMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

type ViewMode = "optimized" | "schedule" | "ranked";
type DayFilter = "friday" | "saturday" | "sunday";

type LoadPhase = "session" | "recommendations";
interface ScheduleCachePayload {
  savedAt: number;
  recommendations: ArtistRecommendation[];
  optimizedSchedule: DaySchedule[];
  stats: {
    totalMatched: number;
    totalDiscovery: number;
    totalArtists: number;
  };
}

/**
 * Loading bar model (client cannot see server work units, so we combine):
 * - A fixed share for session verification vs. the heavy recommendations request.
 * - Elapsed-time exponentials per phase so the % rises smoothly and slows near each
 *   phase ceiling (never hits “done” until the fetch resolves).
 */
const LOAD_SESSION_SHARE_PCT = 18;
/** Ceiling while `/api/recommendations` is in flight (100% only when JSON is back). */
const LOAD_RECS_PENDING_MAX_PCT = 97;
/** ms scale for how fast the session phase approaches its share (short calls). */
const LOAD_SESSION_TAU_MS = 650;
/** ms scale for recommendations (most of the wait). */
const LOAD_RECS_TAU_MS = 5500;
const SCHEDULE_CACHE_KEY = "coachella:schedule:v1";
const SCHEDULE_CACHE_TTL_MS = 1000 * 60 * 20;
const SESSION_CACHE_KEY = "coachella:session";

/** Read the sp_session cookie (non-httpOnly) to detect re-logins. */
function getCurrentSessionId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)sp_session=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const LOADING_SESSION_PHRASES: string[] = [
  "Checking your Spotify session",
  "Confirming you're signed in",
  "Pulling your account from Spotify",
  "Session looks good — hang on",
];

const LOADING_RECOMMENDATIONS_PHRASES: string[] = [
  "Matching the lineup to your listening history",
  "Scoring artists against what you actually play",
  "Mapping sets, stages, and awkward overlaps",
  "Estimating walks between tents",
  "Sorting conflicts and discovery picks",
  "Building your day-by-day plan",
  "Almost ready to show your schedule",
];

function ScheduleLoadingScreen({
  progress,
  phase,
}: {
  progress: number;
  phase: LoadPhase;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(progress)));
  const phrases =
    phase === "session"
      ? LOADING_SESSION_PHRASES
      : LOADING_RECOMMENDATIONS_PHRASES;

  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    if (phrases.length <= 1) return;
    const id = window.setInterval(() => {
      setPhraseIndex((i) => (i + 1) % phrases.length);
    }, 2600);
    return () => window.clearInterval(id);
  }, [phase, phrases.length]);

  const phaseLabel = phrases[phraseIndex % phrases.length] ?? phrases[0];

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="noise-overlay" aria-hidden />
      <div className="w-full max-w-sm relative z-10 space-y-4 text-center">
        <div>
          <p className="font-display text-foreground text-base font-medium">
            Loading your schedule
          </p>
          <p
            key={`${phase}-${phraseIndex}`}
            className="text-[13px] text-muted mt-1.5 leading-snug transition-opacity duration-200"
          >
            {phaseLabel}
          </p>
        </div>
        <div
          className="h-2 rounded-full bg-[var(--hover-wash)] overflow-hidden shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--teal)_15%,transparent)]"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${pct}% — ${phaseLabel}`}
          aria-label="Loading schedule"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-muted tabular-nums" aria-live="polite">
          {pct}%
        </p>
      </div>
    </main>
  );
}

// ── Component ────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [recommendations, setRecommendations] = useState<
    ArtistRecommendation[]
  >([]);
  const [optimizedSchedule, setOptimizedSchedule] = useState<DaySchedule[]>(
    []
  );
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("session");
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("optimized");
  const [selectedDay, setSelectedDay] = useState<DayFilter>("friday");
  const [expandedArtist, setExpandedArtist] = useState<string | null>(null);
  const [playingTrack, setPlayingTrack] = useState<string | number | null>(
    null
  );
  const [stageFilter, setStageFilter] = useState<Stage | "all">("all");
  const [matchFilter, setMatchFilter] = useState<
    "all" | "direct" | "related"
  >("all");
  const [stats, setStats] = useState({
    totalMatched: 0,
    totalDiscovery: 0,
    totalArtists: 0,
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadPhaseRef = useRef<LoadPhase>("session");
  const sessionStartedAtRef = useRef(0);
  const recsStartedAtRef = useRef<number | null>(null);
  const fetchStartedRef = useRef(false);

  const applySchedulePayload = useCallback(
    (data: {
      recommendations: ArtistRecommendation[];
      optimizedSchedule?: DaySchedule[];
      totalMatched: number;
      totalDiscovery: number;
      totalArtists: number;
    }) => {
      setRecommendations(data.recommendations);
      setOptimizedSchedule(data.optimizedSchedule || []);
      setStats({
        totalMatched: data.totalMatched,
        totalDiscovery: data.totalDiscovery,
        totalArtists: data.totalArtists,
      });
    },
    []
  );

  useEffect(() => {
    // Prevent duplicate fetches from React Strict Mode double-mounting
    if (fetchStartedRef.current) return;
    fetchStartedRef.current = true;

    let cancelled = false;
    let hydratedFromCache = false;
    sessionStartedAtRef.current = Date.now();
    loadPhaseRef.current = "session";
    recsStartedAtRef.current = null;

    // Detect session changes (logout + re-login) and invalidate stale caches
    const currentSession = getCurrentSessionId();
    const previousSession = window.localStorage.getItem(SESSION_CACHE_KEY);
    const sessionChanged = currentSession && currentSession !== previousSession;
    if (currentSession) {
      window.localStorage.setItem(SESSION_CACHE_KEY, currentSession);
    }
    if (sessionChanged) {
      window.localStorage.removeItem(SCHEDULE_CACHE_KEY);
    }

    try {
      const raw = !sessionChanged ? window.localStorage.getItem(SCHEDULE_CACHE_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as ScheduleCachePayload;
        const isFresh =
          Date.now() - parsed.savedAt < SCHEDULE_CACHE_TTL_MS &&
          parsed.recommendations.length > 0;
        if (isFresh) {
          setRecommendations(parsed.recommendations);
          setOptimizedSchedule(parsed.optimizedSchedule || []);
          setStats(parsed.stats);
          setLoading(false);
          setLoadProgress(100);
          hydratedFromCache = true;
        } else {
          window.localStorage.removeItem(SCHEDULE_CACHE_KEY);
        }
      }
    } catch {
      window.localStorage.removeItem(SCHEDULE_CACHE_KEY);
    }

    const tickProgress = () => {
      const now = Date.now();
      setLoadProgress((prev) => {
        if (loadPhaseRef.current === "session") {
          const elapsed = now - sessionStartedAtRef.current;
          const target =
            LOAD_SESSION_SHARE_PCT *
            (1 - Math.exp(-elapsed / LOAD_SESSION_TAU_MS));
          const cap = LOAD_SESSION_SHARE_PCT - 0.45;
          const jitter = (Math.random() - 0.5) * 0.35;
          let next = prev + (target - prev) * 0.2 + jitter;
          if (prev >= cap - 0.08) {
            next = Math.min(cap, prev + Math.random() * 0.05);
          } else {
            next = Math.min(cap - 0.2, Math.max(prev, next));
          }
          return next;
        }

        const recsStart = recsStartedAtRef.current;
        if (recsStart == null) return prev;

        const elapsed = now - recsStart;
        const span = LOAD_RECS_PENDING_MAX_PCT - LOAD_SESSION_SHARE_PCT;
        const target =
          LOAD_SESSION_SHARE_PCT +
          span * (1 - Math.exp(-elapsed / LOAD_RECS_TAU_MS));
        const cap = LOAD_RECS_PENDING_MAX_PCT - 0.35;
        const jitter = (Math.random() - 0.5) * 0.45;
        let next = prev + (target - prev) * 0.16 + jitter;
        if (prev >= cap - 0.08) {
          next = Math.min(cap, prev + Math.random() * 0.07);
        } else {
          next = Math.min(cap - 0.2, Math.max(prev, next));
        }
        return next;
      });
    };

    const intervalId = hydratedFromCache ? null : setInterval(tickProgress, 120);

    const fetchData = async () => {
      let skipFinale = false;
      const redirectToLogin = async (res: Response, fallbackCode: string) => {
        let code = fallbackCode;
        try {
          const body = (await res.json()) as { code?: string };
          if (body?.code) code = body.code;
        } catch {
          // Ignore non-JSON error bodies.
        }
        try {
          window.localStorage.removeItem(SCHEDULE_CACHE_KEY);
        } catch {
          // Ignore storage failures on forced logout.
        }
        skipFinale = true;
        window.location.href = `/?error=${encodeURIComponent(code)}`;
      };

      const fail = (msg: string) => {
        console.warn("[schedule]", msg);
        if (!cancelled && !hydratedFromCache) setError(msg);
      };

      try {
        console.log("[schedule] Fetching /api/me…");
        const meRes = await fetch("/api/me");
        console.log("[schedule] /api/me responded:", meRes.status);
        if (!meRes.ok) {
          if (meRes.status === 401) {
            console.log("[schedule] 401 — redirecting to reconnect");
            await redirectToLogin(meRes, "reauth_required");
            return;
          }
          if (hydratedFromCache) {
            console.log("[schedule] /api/me failed but using cached data");
            return;
          }
          fail("Spotify is temporarily unavailable — please try again in a few minutes");
          return;
        }
        setUser(await meRes.json());
        console.log("[schedule] User session OK, fetching /api/recommendations…");
        loadPhaseRef.current = "recommendations";
        recsStartedAtRef.current = Date.now();
        setLoadPhase("recommendations");
        setLoadProgress((prev) => Math.max(prev, LOAD_SESSION_SHARE_PCT));

        const recRes = await fetch("/api/recommendations");
        console.log("[schedule] /api/recommendations responded:", recRes.status);
        if (!recRes.ok) {
          if (recRes.status === 401) {
            await redirectToLogin(recRes, "reauth_required");
            return;
          }
          fail(
            recRes.status === 429 || recRes.status === 503
              ? "Spotify is rate-limiting requests — please try again in a few minutes"
              : "Could not load your recommendations — please try again"
          );
          return;
        }
        const data = await recRes.json();
        console.log("[schedule] Got recommendations:", data.recommendations?.length, "artists,", data.totalMatched, "matched");
        applySchedulePayload(data);
        try {
          const payload: ScheduleCachePayload = {
            savedAt: Date.now(),
            recommendations: data.recommendations || [],
            optimizedSchedule: data.optimizedSchedule || [],
            stats: {
              totalMatched: data.totalMatched || 0,
              totalDiscovery: data.totalDiscovery || 0,
              totalArtists: data.totalArtists || 0,
            },
          };
          window.localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(payload));
        } catch {
          // Cache write failures should never block the page.
        }
      } catch (e) {
        console.warn("[schedule] fetchData network error:", e);
        if (!cancelled && !hydratedFromCache) {
          setError("Network error — check your connection and try again");
        }
      } finally {
        console.log("[schedule] fetchData finished — cancelled:", cancelled, "skipFinale:", skipFinale);
        if (intervalId) clearInterval(intervalId);
        if (cancelled || skipFinale) return;
        setLoadProgress(100);
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [applySchedulePayload]);

  const playTrack = useCallback(
    (previewUrl: string, trackId: string | number) => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (playingTrack === trackId) {
        setPlayingTrack(null);
        return;
      }
      const audio = new Audio(previewUrl);
      audio.volume = 0.5;
      audio.play();
      audio.onended = () => setPlayingTrack(null);
      audioRef.current = audio;
      setPlayingTrack(trackId);
    },
    [playingTrack]
  );

  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingTrack(null);
  }, [expandedArtist, selectedDay]);

  const daySchedule = optimizedSchedule.find((d) => d.day === selectedDay);
  const dayRecs = recommendations.filter((r) => r.setTime.day === selectedDay);
  const personalizedDaySchedule = useMemo(() => {
    if (!daySchedule) return null;

    const slotModels = daySchedule.slots.map((slot, idx) => {
      const slotId = `${daySchedule.day}-${idx}-${slot.recommendation.setTime.startTime}-${slot.recommendation.setTime.endTime}`;
      const overlapCandidates = dayRecs
        .filter(
          (r) =>
            r.affinityScore > 0 &&
            setsOverlap(r.setTime, slot.recommendation.setTime)
        )
        .sort((a, b) => b.affinityScore - a.affinityScore);

      const rawCandidates = [slot.recommendation, ...overlapCandidates];
      const deduped: ArtistRecommendation[] = [];
      const seenArtist = new Set<string>();
      for (const c of rawCandidates) {
        const name = c.setTime.artist.name;
        if (seenArtist.has(name)) continue;
        seenArtist.add(name);
        deduped.push(c);
      }

      return {
        slotId,
        candidates: deduped,
        selected: slot.recommendation,
        selectedIdx: 0,
      };
    });

    let totalWalkTime = 0;
    const slots: ScheduleSlot[] = slotModels.map((model, idx) => {
      const prev = idx > 0 ? slotModels[idx - 1].selected : null;
      let walkFromPrevious: number | null = null;
      let prevStage: string | null = null;
      if (prev) {
        walkFromPrevious = getWalkingTime(
          prev.setTime.stage as Stage,
          model.selected.setTime.stage as Stage
        );
        prevStage = prev.setTime.stage;
        totalWalkTime += walkFromPrevious;
      }

      const overlapNames = dayRecs
        .filter(
          (r) =>
            r.affinityScore > 0 &&
            r.setTime.artist.name !== model.selected.setTime.artist.name &&
            setsOverlap(r.setTime, model.selected.setTime)
        )
        .sort((a, b) => b.affinityScore - a.affinityScore)
        .map((r) => r.setTime.artist.name);

      return {
        recommendation: model.selected,
        walkFromPrevious,
        prevStage,
        isConflict: overlapNames.length > 0,
        conflictWith: overlapNames,
      };
    });

    return { day: daySchedule.day, slots, totalWalkTime, slotModels };
  }, [daySchedule, dayRecs]);
  const filteredRecs = dayRecs
    .filter((r) => stageFilter === "all" || r.setTime.stage === stageFilter)
    .filter((r) => matchFilter === "all" || r.matchType === matchFilter);

  const sortedByTime = [...filteredRecs].sort((a, b) => {
    if (a.setTime.startTime !== b.setTime.startTime)
      return a.setTime.startTime.localeCompare(b.setTime.startTime);
    return (
      STAGES.indexOf(a.setTime.stage as Stage) -
      STAGES.indexOf(b.setTime.stage as Stage)
    );
  });

  const sortedByRank = [...filteredRecs].sort(
    (a, b) => b.affinityScore - a.affinityScore
  );

  // ── Loading ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <ScheduleLoadingScreen
        key={loadPhase}
        progress={loadProgress}
        phase={loadPhase}
      />
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6">
        <div className="noise-overlay" aria-hidden />
        <div className="text-center space-y-4 relative z-10">
          <h1 className="font-display text-xl font-bold text-foreground">
            Something went wrong
          </h1>
          <p className="text-muted text-sm">{error}</p>
          <Link
            href="/"
            className="inline-block scratch-pill px-5 py-2.5 text-sm bg-accent text-on-accent hover:bg-[var(--accent-hover-soft)] transition shadow-[2px_2px_0_color-mix(in_srgb,var(--teal)_25%,transparent)]"
          >
            Try again
          </Link>
        </div>
      </main>
    );
  }

  // ── Artist row ─────────────────────────────────────────────────────

  const renderArtistRow = (
    rec: ArtistRecommendation,
    walkInfo?: {
      walkFromPrevious: number | null;
      prevStage: string | null;
      isConflict: boolean;
      conflictWith?: string[];
    },
    rowId?: string
  ) => {
    const key = rowId ?? `${rec.setTime.day}-${rec.setTime.artist.name}`;
    const isExpanded = expandedArtist === key;
    const stageColor = STAGE_COLORS[rec.setTime.stage] || "#888888";
    const displayName = rec.setTime.artist.name;
    const isMatched = rec.matchType !== "none";
    const topTrackNames =
      rec.userTopTrackNames?.slice(0, 2) ||
      rec.userTopTracks?.slice(0, 2).map((t) => t.title).filter(Boolean) ||
      [];
    const topTracksSuffix =
      topTrackNames.length > 0
        ? ` (${topTrackNames.join(", ")})`
        : "";

    return (
      <div key={key}>
        {/* Walk connector — skip when same stage (0 min walk) */}
        {walkInfo?.walkFromPrevious != null &&
          walkInfo.walkFromPrevious > 0 && (
          <div className="flex items-center gap-2 py-1 pl-5">
            <div className="w-px h-3 bg-border/80 rounded-full" />
            <span className="text-[11px] text-muted">
              <span className="font-nineties text-[13px] text-foreground/85 mr-1">
                walk
              </span>
              ~{walkInfo.walkFromPrevious} min from{" "}
              {walkInfo.prevStage ?? "last set"}
            </span>
          </div>
        )}

        {/* Main row */}
        <button
          type="button"
          onClick={() => setExpandedArtist(isExpanded ? null : key)}
          className={`group schedule-artist-btn w-full text-left border-b border-dashed border-border/60 ${
            walkInfo?.walkFromPrevious != null && walkInfo.walkFromPrevious > 0
              ? "border-t border-dashed border-border/60"
              : ""
          } ${isExpanded ? "schedule-artist-btn-expanded" : ""}`}
        >
          <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
            {/* Stage pip */}
            <div
              className="stage-pip"
              style={{ backgroundColor: stageColor }}
            />

            {/* Artist image */}
            {rec.artist?.image ? (
              <img
                src={rec.artist.image}
                alt={displayName}
                className="w-10 h-10 object-cover shrink-0 scratch-blob"
              />
            ) : (
              <div className="w-10 h-10 scratch-blob bg-[var(--hover-wash-strong)] flex items-center justify-center shrink-0 text-sm font-display font-bold text-muted">
                {displayName.charAt(0)}
              </div>
            )}

            {/* Info */}
            <div className="flex-1 min-w-0 sm:flex sm:flex-col sm:justify-center">
              <div className="flex items-center gap-2">
                <span
                  className={`font-display text-sm font-semibold truncate ${
                    isMatched
                      ? "text-foreground group-hover:text-cyan"
                      : "text-muted group-hover:text-foreground"
                  }`}
                >
                  {displayName}
                </span>
                {rec.matchType === "direct" && (
                  <span
                    className="badge-direct text-[10px] px-1.5 py-0.5 font-semibold shrink-0"
                    title="In your Spotify library or top listens"
                  >
                    MATCH
                  </span>
                )}
                {rec.matchType === "related" && (
                  <span
                    className="badge-related text-[10px] px-1.5 py-0.5 font-semibold shrink-0"
                    title="Similar artist to someone you listen to"
                  >
                    SIMILAR
                  </span>
                )}
                {rec.matchType === "genre" && (
                  <span
                    className="badge-genre text-[10px] px-1.5 py-0.5 font-semibold shrink-0"
                    title="Overlapping genre taste, not necessarily a direct match"
                  >
                    GENRE
                  </span>
                )}
              </div>
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted mt-0.5">
                <span style={{ color: stageColor }}>
                  {rec.setTime.stage}
                </span>
                <span className="text-border">·</span>
                <span>
                  {formatTime(rec.setTime.startTime)} –{" "}
                  {formatTime(rec.setTime.endTime)}
                </span>
                {walkInfo?.isConflict && walkInfo.conflictWith?.length && (
                  <>
                    <span className="text-border">·</span>
                    <span className="text-foreground/90 max-w-[min(100%,14rem)] sm:max-w-[22rem] sm:truncate">
                      <span className="font-nineties text-[13px] text-cyan mr-0.5">
                        overlap
                      </span>
                      with{" "}
                      <span className="font-medium text-foreground">
                        {walkInfo.conflictWith.slice(0, 4).join(", ")}
                      </span>
                    </span>
                  </>
                )}
              </div>
              {isMatched && (
                <p className="text-[11px] text-muted/70 mt-0.5 truncate">
                  {rec.affinityReason}
                  {topTracksSuffix}
                </p>
              )}
            </div>

            {/* Score */}
            {rec.affinityScore > 0 && (
              <span
                className="font-display text-xs text-muted font-medium shrink-0 tabular-nums"
                title="Match score — higher means closer to your listening taste"
              >
                {Math.round(rec.affinityScore)}
              </span>
            )}

            {/* Expand indicator */}
            <svg
              className={`w-4 h-4 text-muted/40 shrink-0 transition-transform ${
                isExpanded ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </button>

        {/* Expanded: tracks */}
        {isExpanded && (
          <div className="scratch-panel mx-2 sm:mx-3 mt-2 mb-2 border-b-0">
            {(() => {
              const mergedTracks: TrackInfo[] = [
                ...(rec.userTopTracks || []),
                ...(rec.topTracks || []),
              ].filter((t) => !!t?.preview);

              const deduped: TrackInfo[] = [];
              const seen = new Set<string>();
              for (const t of mergedTracks) {
                const key = `${t.source || "unknown"}:${String(t.id)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                deduped.push(t);
              }

              if (deduped.length === 0) {
                return (
                  <div className="px-5 py-4">
                    <p className="text-[13px] text-muted">
                      No track data available.
                    </p>
                  </div>
                );
              }

              return (
              <div className="divide-y divide-dashed divide-border/70">
                <div className="px-5 py-2">
                  <span className="font-nineties text-[1.15rem] text-foreground/80">
                    Popular tracks
                  </span>
                </div>
                {deduped.map((track) => (
                  <div
                    key={`${track.source || "track"}:${String(track.id)}`}
                    className="track-row flex items-center gap-3 px-5 py-2.5 cursor-pointer"
                    onClick={() => playTrack(track.preview, track.id)}
                  >
                    {/* Album art */}
                    <div className="relative shrink-0">
                      {track.albumCover ? (
                        <img
                          src={track.albumCover}
                          alt={track.albumTitle}
                          className="w-8 h-8 object-cover scratch-blob"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-surface-light" />
                      )}
                      {playingTrack === track.id && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-0.5">
                          <div className="eq-bar" />
                          <div className="eq-bar" />
                          <div className="eq-bar" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-foreground truncate flex items-center gap-1.5">
                        <span className="truncate">{track.title}</span>
                        {track.isUserTopTrack && (
                          <span
                            className="badge-direct text-[10px] px-1.5 py-0.5 font-semibold shrink-0"
                            title="This track is in your Spotify top tracks"
                          >
                            Your Top Track
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted truncate">
                        {track.albumTitle}
                      </p>
                    </div>

                    <span className="text-[11px] text-muted/50 tabular-nums shrink-0">
                      {formatDuration(track.duration)}
                    </span>

                    {playingTrack === track.id ? (
                      <svg
                        className="w-4 h-4 text-cyan shrink-0"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                      </svg>
                    ) : (
                      <svg
                        className="w-4 h-4 text-muted/40 shrink-0"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
              );
            })()}

            {/* Footer links */}
            {rec.artist && (
              <div className="px-5 py-3 border-t border-border flex items-center gap-4">
                <a
                  href={rec.artist.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-cyan hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
                >
                  Open on Deezer
                </a>
                {rec.artist.fans > 0 && (
                  <span className="text-[11px] text-muted/40">
                    {rec.artist.fans.toLocaleString()} fans
                  </span>
                )}
                {rec.relatedTo && (
                  <span className="text-[11px] text-muted" title="We matched via similarity to this artist you listen to">
                    Like {rec.relatedTo}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Page ───────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen">
      <div className="noise-overlay" aria-hidden />

      {/* Header */}
      <header className="grain-strong sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-dashed border-border/70">
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="font-nineties text-[1.35rem] text-foreground hover:text-cyan transition-colors leading-none"
            >
              coachella planner
            </Link>
            <div className="hidden sm:flex items-center gap-2 text-[11px]">
              {stats.totalMatched > 0 && (
                <span
                  className="badge-direct px-1.5 py-0.5 font-semibold"
                  title="Acts that directly match your Spotify history"
                >
                  {stats.totalMatched} matched
                </span>
              )}
              {stats.totalDiscovery > 0 && (
                <span
                  className="badge-related px-1.5 py-0.5 font-semibold"
                  title="Related or genre-based picks you might like"
                >
                  {stats.totalDiscovery} discoveries
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <span className="text-[12px] text-muted hidden sm:block">
                {user.display_name}
              </span>
            )}
            <a
              href="/api/auth/logout"
              className="text-[11px] text-muted/70 hover:text-foreground transition-colors"
            >
              Log out
            </a>
          </div>
        </div>

        {/* Controls strip */}
        <div className="px-4 pb-3 sm:px-6 flex flex-wrap gap-4 items-center">
          {/* Day picker */}
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day) => (
              <button
                key={day.id}
                type="button"
                onClick={() => setSelectedDay(day.id)}
                className={`scratch-pill px-3.5 py-1.5 text-[12px] font-display font-medium border border-dashed border-border/80 transition-colors ${
                  selectedDay === day.id
                    ? "bg-[var(--expand-wash)] text-foreground border-cyan/35 z-10"
                    : "text-muted hover:text-foreground hover:bg-[var(--hover-wash)]"
                }`}
              >
                {day.id.charAt(0).toUpperCase() + day.id.slice(1)}
              </button>
            ))}
          </div>

          {/* View mode */}
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["optimized", "Your Plan"],
                ["schedule", "By Time"],
                ["ranked", "By Match"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`scratch-pill px-3 py-1.5 text-[11px] font-medium border border-dashed border-border/80 transition-colors ${
                  viewMode === mode
                    ? "bg-[var(--hover-wash-strong)] text-foreground border-cyan/30 z-10"
                    : "text-muted/70 hover:text-foreground hover:bg-[var(--hover-wash)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Filters (non-optimized) */}
          {viewMode !== "optimized" && (
            <>
              <select
                value={stageFilter}
                onChange={(e) =>
                  setStageFilter(e.target.value as Stage | "all")
                }
                className="bg-background text-foreground scratch-pill border border-dashed border-border/80 text-[11px] px-2.5 py-1.5 outline-none cursor-pointer"
              >
                <option value="all">All stages</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              <div className="flex flex-wrap gap-2">
                {(["all", "direct", "related"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setMatchFilter(f)}
                    className={`scratch-pill px-2.5 py-1.5 text-[11px] border border-dashed border-border/80 transition-colors ${
                      matchFilter === f
                        ? "bg-[var(--hover-wash-strong)] text-foreground border-cyan/25"
                        : "text-muted/60 hover:text-foreground hover:bg-[var(--hover-wash)]"
                    }`}
                  >
                    {f === "all"
                      ? "All"
                      : f === "direct"
                        ? "Matched"
                        : "Similar"}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10">
        {viewMode === "optimized" && personalizedDaySchedule ? (
          <div>
            {/* Day summary bar */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 border-b border-dashed border-border/70 text-[12px] text-muted">
              <span>
                <span className="text-foreground font-display font-semibold">
                  {personalizedDaySchedule.slots.length}
                </span>{" "}
                sets in this plan
              </span>
              <span className="text-border">·</span>
              <span title="Rough total walking between stages">
                ~{personalizedDaySchedule.totalWalkTime} min walking between sets
              </span>
            </div>

            {personalizedDaySchedule.slots.length === 0 ? (
              <div className="text-center py-20 px-6">
                <p className="text-muted text-sm">
                  No strong matches for this day.
                </p>
                <button
                  type="button"
                  onClick={() => setViewMode("schedule")}
                  className="mt-3 text-cyan text-sm hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
                >
                  Browse all artists by time
                </button>
              </div>
            ) : (
              personalizedDaySchedule.slots.map((slot, idx) => {
                const model = personalizedDaySchedule.slotModels[idx];
                return renderArtistRow(slot.recommendation, {
                  walkFromPrevious: slot.walkFromPrevious,
                  prevStage: slot.prevStage,
                  isConflict: slot.isConflict,
                  conflictWith: slot.conflictWith,
                }, model.slotId);
              })
            )}
          </div>
        ) : (
          <div>
            {(viewMode === "schedule" ? sortedByTime : sortedByRank)
              .length === 0 ? (
              <div className="text-center py-20 px-6">
                <p className="text-muted text-sm">No artists match.</p>
                <button
                  type="button"
                  onClick={() => {
                    setStageFilter("all");
                    setMatchFilter("all");
                  }}
                  className="mt-3 text-cyan text-sm hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              (viewMode === "schedule" ? sortedByTime : sortedByRank).map(
                (rec) => renderArtistRow(rec)
              )
            )}
          </div>
        )}
      </div>
    </main>
  );
}
