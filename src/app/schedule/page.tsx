"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback, useMemo, use } from "react";
import { useSession } from "next-auth/react";
import { DAYS, STAGES, SCHEDULE, type Stage } from "@/lib/coachella-data";
import {
  FESTIVAL_WALK_MPH,
  formatLegDistanceMiles,
  formatTotalWalkDistance,
  getWalkingDistanceMiles,
  getWalkingTime,
} from "@/lib/stage-proximity";
import {
  getShowPopularSongs,
  getShowLastfmRecommendations,
  setShowPopularSongsPreference,
  setShowLastfmRecommendationsPreference,
} from "@/lib/schedule-preferences";
import {
  ScheduleGridView,
  PartyMemberAvatarStack,
  type ScheduleGridItem,
} from "@/app/schedule/ScheduleGridView";

/** Human-readable copy for HTMLMediaElement.error codes (1–4). */
function previewErrorMessage(code: number | undefined): string {
  switch (code) {
    case 1: // MEDIA_ERR_ABORTED
      return "Preview load was interrupted.";
    case 2: // MEDIA_ERR_NETWORK
      return "Network error while loading preview.";
    case 3: // MEDIA_ERR_DECODE
      return "Preview could not be decoded.";
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return "Preview link expired or is unavailable — try again.";
    default:
      return "Preview could not be played.";
  }
}

/** Deezer track id for /api/track-preview retry (fresh signed MP3 URL). */
function deezerNumericIdForPreviewRetry(track: {
  source?: string;
  id: string | number;
  preview: string;
}): number | null {
  if (track.source === "spotify") return null;
  const likelyDeezerPreview =
    track.source === "deezer" ||
    /\bdzcdn\.net\b/i.test(track.preview) ||
    /\bdeezer\.com\b/i.test(track.preview);
  if (!likelyDeezerPreview) return null;
  const id = track.id;
  if (typeof id === "number" && Number.isFinite(id)) return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return parseInt(id, 10);
  return null;
}

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

function filterTracksByPopularPreference(
  tracks: TrackInfo[],
  showPopular: boolean
): TrackInfo[] {
  if (showPopular) return tracks;
  return tracks.filter((t) => t.isUserTopTrack);
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
  /** From API when Last.fm suggests this act */
  mightLike?: boolean;
}

interface ScheduleSlot {
  recommendation: ArtistRecommendation;
  walkFromPrevious: number | null;
  /** Path distance for this leg (miles), when walkFromPrevious > 0 */
  walkMilesFromPrevious?: number | null;
  prevStage: string | null;
  isConflict: boolean;
  conflictWith?: string[];
}

interface DaySchedule {
  day: string;
  slots: ScheduleSlot[];
  totalWalkTime: number;
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

/** Stable identity for matching a recommendation to an optimized plan slot */
function recIdentityKey(rec: ArtistRecommendation): string {
  return `${rec.setTime.day}|${rec.setTime.stage}|${rec.setTime.startTime}|${rec.setTime.endTime}|${rec.setTime.artist.name}`;
}

function gridRowKeyNonPlan(rec: ArtistRecommendation): string {
  return `${rec.setTime.day}-${rec.setTime.stage}-${rec.setTime.startTime}-${rec.setTime.artist.name}`;
}

type ViewMode = "optimized" | "schedule";
type ScheduleLayout = "list" | "grid";
type DayFilter = "friday" | "saturday" | "sunday";

interface ScheduleCachePayload {
  savedAt: number;
  recommendations: ArtistRecommendation[];
  optimizedSchedule: DaySchedule[];
}

/**
 * Loading bar model (client cannot see server work units, so we combine):
 * - A fixed share for session verification vs. the heavy recommendations request.
 * - Elapsed-time exponentials per phase so the % rises smoothly and slows near each
 *   phase ceiling (never hits “done” until the fetch resolves).
 */
const SCHEDULE_CACHE_KEY = "coachella:schedule:v5";
const SCHEDULE_CACHE_TTL_MS = 1000 * 60 * 20;
/** v2 stores { plan: {...}, savedAt: <epoch> } so timestamps can be compared with DB */
const USER_PLAN_KEY = "coachella:userplan:v2";
const USER_PLAN_LEGACY_KEY = "coachella:userplan:v1";

interface LocalPlanPayload {
  plan: Partial<Record<DayFilter, string[]>>;
  savedAt: number;
}

function getLocalPlanSavedAt(): number {
  try {
    const raw = window.localStorage.getItem(USER_PLAN_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as LocalPlanPayload;
    return Number(parsed.savedAt ?? 0);
  } catch {
    return 0;
  }
}

function loadUserPlan(): Partial<Record<DayFilter, Set<string>>> {
  try {
    // v2 format
    const raw = window.localStorage.getItem(USER_PLAN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalPlanPayload;
      const result: Partial<Record<DayFilter, Set<string>>> = {};
      for (const day of ["friday", "saturday", "sunday"] as DayFilter[]) {
        const arr = parsed.plan?.[day];
        if (Array.isArray(arr) && arr.length > 0) {
          result[day] = new Set(arr);
        }
      }
      return result;
    }
    // Migrate from v1 (savedAt: 0 ensures DB wins if there's any data there)
    const legacyRaw = window.localStorage.getItem(USER_PLAN_LEGACY_KEY);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as Partial<Record<DayFilter, string[]>>;
      const result: Partial<Record<DayFilter, Set<string>>> = {};
      for (const day of ["friday", "saturday", "sunday"] as DayFilter[]) {
        const arr = parsed[day];
        if (Array.isArray(arr) && arr.length > 0) {
          result[day] = new Set(arr);
        }
      }
      if (Object.keys(result).length > 0) {
        saveUserPlan(result, 0); // write into v2 with stale timestamp
        window.localStorage.removeItem(USER_PLAN_LEGACY_KEY);
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

function saveUserPlan(plan: Partial<Record<DayFilter, Set<string>>>, savedAt?: number) {
  try {
    const serializable: Partial<Record<DayFilter, string[]>> = {};
    for (const day of ["friday", "saturday", "sunday"] as DayFilter[]) {
      const s = plan[day];
      if (s && s.size > 0) serializable[day] = [...s];
    }
    const payload: LocalPlanPayload = {
      plan: serializable,
      savedAt: savedAt ?? Date.now(),
    };
    window.localStorage.setItem(USER_PLAN_KEY, JSON.stringify(payload));
  } catch { /* ignore */ }
}

function buildPlaceholderRecommendations(): ArtistRecommendation[] {
  return SCHEDULE.map((setTime) => ({
    setTime,
    artist: null,
    affinityScore: 0,
    affinityReason: "",
    topTracks: [],
    matchType: "none",
    mightLike: false,
  }));
}

/** One entry per email (order preserved) when the same person appears via multiple parties. */
function dedupePartyMembersByEmail<T extends { email: string }>(members: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of members) {
    const k = m.email.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

// ── Component ────────────────────────────────────────────────────────

export default function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<Record<string, string | string[]>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  use(params);
  use(searchParams);

  const { data: session, status: sessionStatus } = useSession();
  const [profileOverride, setProfileOverride] = useState<{
    name: string;
    image: string;
  } | null>(null);
  const [recommendations, setRecommendations] = useState<
    ArtistRecommendation[]
  >(() => buildPlaceholderRecommendations());
  const [optimizedSchedule, setOptimizedSchedule] = useState<DaySchedule[]>(
    []
  );
  const [recsError, setRecsError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("optimized");
  const [scheduleLayout, setScheduleLayout] =
    useState<ScheduleLayout>("list");
  const [selectedDay, setSelectedDay] = useState<DayFilter>("friday");
  const [expandedArtist, setExpandedArtist] = useState<string | null>(null);
  const [playingTrack, setPlayingTrack] = useState<string | number | null>(
    null
  );
  const [audioError, setAudioError] = useState<string | null>(null);
  const [showPopularSongs, setShowPopularSongs] = useState(true);
  const [showLastfmRecommendations, setShowLastfmRecommendations] =
    useState(true);
  const [stageFilter, setStageFilter] = useState<Stage | "all">("all");
  const [matchFilter, setMatchFilter] = useState<"all" | "foryou">("all");
  const [userPlanByDay, setUserPlanByDay] = useState<
    Partial<Record<DayFilter, Set<string>>>
  >({});
  const userPlanInitRef = useRef(false);
  /** True once the plan has been seeded from localStorage or optimizedSchedule. */
  const [planInitialized, setPlanInitialized] = useState(false);
  /** Debounce timer for syncing plan to Firestore. */
  const planSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Last serialized plan that was successfully written to Firestore (dedup guard). */
  const planSyncKeyRef = useRef<string>("");
  /** Ensures we only hydrate from Firestore once per page load. */
  const planDbHydratedRef = useRef(false);

  interface PartyMemberInfo {
    email: string;
    name: string;
    image: string;
    plan: Partial<Record<string, string[]>>;
  }
  interface PartyInfo {
    id: string;
    code: string;
    name: string;
    members: PartyMemberInfo[];
  }
  const [parties, setParties] = useState<PartyInfo[]>([]);
  const [schedulePartyVisible, setSchedulePartyVisible] = useState<
    Record<string, boolean>
  >({});
  const partySyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partiesRef = useRef(parties);
  partiesRef.current = parties;
  const partyIdsKey = parties.map((p) => p.id).sort().join(",");

  /** Any party has “Show on schedule” on — gates PFP stacks, Going in list/grid/expanded, attendance. */
  const partyStacksEnabled = useMemo(
    () =>
      parties.length > 0 &&
      parties.some((p) => schedulePartyVisible[p.id] !== false),
    [parties, schedulePartyVisible]
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fetchStartedRef = useRef(false);

  const hasLastfm = optimizedSchedule.length > 0;

  const togglePlanItem = useCallback(
    (day: DayFilter, key: string) => {
      setUserPlanByDay((prev) => {
        const next = { ...prev };
        const daySet = new Set(prev[day] ?? []);
        if (daySet.has(key)) {
          daySet.delete(key);
        } else {
          daySet.add(key);
        }
        next[day] = daySet;
        saveUserPlan(next);
        return next;
      });
    },
    []
  );

  const addToPlan = useCallback(
    (day: DayFilter, key: string) => {
      setUserPlanByDay((prev) => {
        const next = { ...prev };
        const daySet = new Set(prev[day] ?? []);
        daySet.add(key);
        next[day] = daySet;
        saveUserPlan(next);
        return next;
      });
    },
    []
  );

  const removeFromPlan = useCallback(
    (day: DayFilter, key: string) => {
      setUserPlanByDay((prev) => {
        const next = { ...prev };
        const daySet = new Set(prev[day] ?? []);
        daySet.delete(key);
        next[day] = daySet;
        saveUserPlan(next);
        return next;
      });
    },
    []
  );

  const applySchedulePayload = useCallback(
    (data: {
      recommendations: ArtistRecommendation[];
      optimizedSchedule?: DaySchedule[];
    }) => {
      setRecsError(null);
      setRecommendations(data.recommendations);
      setOptimizedSchedule(data.optimizedSchedule || []);
    },
    []
  );

  useEffect(() => {
    setShowPopularSongs(getShowPopularSongs());
    setShowLastfmRecommendations(getShowLastfmRecommendations());
    const sync = () => {
      setShowPopularSongs(getShowPopularSongs());
      setShowLastfmRecommendations(getShowLastfmRecommendations());
    };
    window.addEventListener("storage", sync);
    window.addEventListener("coachella-prefs-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("coachella-prefs-changed", sync);
    };
  }, []);

  useEffect(() => {
    if (!showLastfmRecommendations && matchFilter === "foryou") {
      setMatchFilter("all");
    }
  }, [showLastfmRecommendations, matchFilter]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    (async () => {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) return;
        const data = (await res.json()) as {
          profile?: { name?: string; image?: string };
        };
        if (data.profile) {
          setProfileOverride({
            name: data.profile.name ?? "",
            image: data.profile.image ?? "",
          });
        }
      } catch {
        // ignore
      }
    })();
  }, [sessionStatus]);

  useEffect(() => {
    if (fetchStartedRef.current) return;
    fetchStartedRef.current = true;

    let cancelled = false;
    let showedCachedData = false;

    try {
      const raw = window.localStorage.getItem(SCHEDULE_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ScheduleCachePayload;
        if (parsed.recommendations.length > 0) {
          setRecommendations(parsed.recommendations);
          setOptimizedSchedule(parsed.optimizedSchedule || []);
          showedCachedData = true;
          const isFresh = Date.now() - parsed.savedAt < SCHEDULE_CACHE_TTL_MS;
          if (isFresh) {
            setRecsError(null);
            return;
          }
        }
      }
    } catch {
      window.localStorage.removeItem(SCHEDULE_CACHE_KEY);
    }

    const fetchData = async () => {
      try {
        const recRes = await fetch("/api/recommendations");
        if (!recRes.ok) {
          if (!cancelled) {
            setRecsError(
              showedCachedData
                ? "Could not refresh recommendations — showing cached data"
                : recRes.status === 429 || recRes.status === 503
                  ? "Too many requests — try again in a few minutes"
                  : "Could not load picks — try again"
            );
          }
          return;
        }
        const data = await recRes.json();
        if (!cancelled) applySchedulePayload(data);
        try {
          const payload: ScheduleCachePayload = {
            savedAt: Date.now(),
            recommendations: data.recommendations || [],
            optimizedSchedule: data.optimizedSchedule || [],
          };
          window.localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(payload));
        } catch {
          /* ignore */
        }
      } catch (e) {
        console.warn("[schedule] fetchData network error:", e);
        if (!cancelled) {
          setRecsError(
            showedCachedData
              ? "Network error — could not refresh"
              : "Network error — try again when online"
          );
        }
      }
    };
    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [applySchedulePayload]);

  // Seed userPlanByDay from optimizedSchedule on first load, or from localStorage
  useEffect(() => {
    if (userPlanInitRef.current) return;
    if (recommendations.length === 0) return;

    const saved = loadUserPlan();
    if (Object.keys(saved).length > 0) {
      userPlanInitRef.current = true;
      setPlanInitialized(true);
      setUserPlanByDay(saved);
      return;
    }

    const hasApiPayload = recommendations.some(
      (r) => r.artist != null || (r.topTracks?.length ?? 0) > 0
    );
    if (!hasApiPayload && optimizedSchedule.length === 0) return;

    userPlanInitRef.current = true;
    setPlanInitialized(true);

    if (optimizedSchedule.length > 0) {
      const plan: Partial<Record<DayFilter, Set<string>>> = {};
      for (const ds of optimizedSchedule) {
        const day = ds.day as DayFilter;
        const keys = new Set<string>();
        for (const slot of ds.slots) {
          keys.add(recIdentityKey(slot.recommendation));
        }
        if (keys.size > 0) plan[day] = keys;
      }
      setUserPlanByDay(plan);
      saveUserPlan(plan);
    }
  }, [recommendations, optimizedSchedule]);

  // Fetch parties, poll, and refresh when returning from Profile (e.g. after toggling visibility)
  useEffect(() => {
    let cancelled = false;
    const fetchParties = async () => {
      try {
        const res = await fetch("/api/party");
        if (res.ok && !cancelled) {
          const data = (await res.json()) as {
            parties?: PartyInfo[];
            schedulePartyVisible?: Record<string, boolean>;
          };
          setParties(data.parties ?? []);
          setSchedulePartyVisible(data.schedulePartyVisible ?? {});
        }
      } catch { /* ignore */ }
    };
    void fetchParties();
    const interval = setInterval(fetchParties, 15_000);
    const onFocus = () => {
      void fetchParties();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchParties();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Sync own plan to every party whenever it changes
  useEffect(() => {
    if (!partyIdsKey) return;
    if (partySyncRef.current) clearTimeout(partySyncRef.current);
    partySyncRef.current = setTimeout(() => {
      const list = partiesRef.current;
      if (list.length === 0) return;
      const serialized: Partial<Record<string, string[]>> = {};
      for (const day of ["friday", "saturday", "sunday"] as DayFilter[]) {
        const s = userPlanByDay[day];
        if (s && s.size > 0) serialized[day] = [...s];
      }
      void Promise.all(
        list.map((p) =>
          fetch("/api/party", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "sync",
              partyId: p.id,
              plan: serialized,
            }),
          }).then((r) => (r.ok ? r.json() : null))
        )
      )
        .then((results) => {
          const merged = results.find(
            (x): x is { parties: PartyInfo[] } =>
              x != null && Array.isArray(x.parties)
          );
          if (merged?.parties) setParties(merged.parties);
        })
        .catch(() => {});
    }, 1000);
    return () => {
      if (partySyncRef.current) clearTimeout(partySyncRef.current);
    };
  }, [userPlanByDay, partyIdsKey]);

  // ── Firestore: hydrate UI preferences once after auth resolves ───────
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    (async () => {
      try {
        const res = await fetch("/api/prefs");
        if (!res.ok) return;
        const data = (await res.json()) as {
          showPopularSongs?: boolean | null;
          showLastfmRecommendations?: boolean | null;
        };
        if (typeof data.showPopularSongs === "boolean") {
          setShowPopularSongs(data.showPopularSongs);
          setShowPopularSongsPreference(data.showPopularSongs);
        }
        if (typeof data.showLastfmRecommendations === "boolean") {
          setShowLastfmRecommendations(data.showLastfmRecommendations);
          setShowLastfmRecommendationsPreference(data.showLastfmRecommendations);
        }
      } catch { /* offline */ }
    })();
  }, [sessionStatus]);

  // ── Firestore: one-shot hydration of user plan after localStorage init ─
  // Compares DB updatedAt vs. local savedAt; takes whichever is newer.
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    if (!planInitialized) return;
    if (planDbHydratedRef.current) return;
    planDbHydratedRef.current = true;

    (async () => {
      try {
        const res = await fetch("/api/plan");
        if (!res.ok) return;
        const data = (await res.json()) as {
          plan: Partial<Record<string, string[]>>;
          updatedAt: number;
        };
        if (!data.updatedAt || !data.plan || Object.keys(data.plan).length === 0) return;

        const localSavedAt = getLocalPlanSavedAt();
        if (data.updatedAt <= localSavedAt) return; // localStorage is at least as fresh

        // DB has newer data — update state and localStorage
        const plan: Partial<Record<DayFilter, Set<string>>> = {};
        for (const day of ["friday", "saturday", "sunday"] as DayFilter[]) {
          const arr = data.plan[day];
          if (Array.isArray(arr) && arr.length > 0) {
            plan[day] = new Set(arr);
          }
        }
        setUserPlanByDay(plan);
        saveUserPlan(plan, data.updatedAt);
      } catch { /* offline */ }
    })();
  }, [sessionStatus, planInitialized]);

  // ── Firestore: debounced sync of plan changes → /api/plan ────────────
  // Runs independently of party membership so solo users also get persistence.
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    if (!planInitialized) return;
    if (planSyncRef.current) clearTimeout(planSyncRef.current);
    planSyncRef.current = setTimeout(async () => {
      const serialized: Partial<Record<string, string[]>> = {};
      for (const day of ["friday", "saturday", "sunday"] as DayFilter[]) {
        const s = userPlanByDay[day];
        if (s && s.size > 0) serialized[day] = [...s];
      }
      const key = JSON.stringify(serialized);
      if (key === planSyncKeyRef.current) return; // no change since last successful write
      try {
        const res = await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: serialized }),
        });
        if (res.ok) {
          planSyncKeyRef.current = key;
          // Update the localStorage savedAt to match the server timestamp so the
          // next-device hydration comparison is accurate.
          const respData = (await res.json()) as { updatedAt?: number };
          if (respData.updatedAt) {
            try {
              const raw = window.localStorage.getItem(USER_PLAN_KEY);
              if (raw) {
                const parsed = JSON.parse(raw) as LocalPlanPayload;
                parsed.savedAt = respData.updatedAt;
                window.localStorage.setItem(USER_PLAN_KEY, JSON.stringify(parsed));
              }
            } catch { /* ignore */ }
          }
        }
      } catch { /* offline — will retry on next plan change */ }
    }, 1_000);
    return () => {
      if (planSyncRef.current) clearTimeout(planSyncRef.current);
    };
  }, [userPlanByDay, sessionStatus, planInitialized]);

  // Compute party member attendance per recIdentityKey (current user first)
  const partyAttendance = useMemo(() => {
    if (
      !session?.user?.email ||
      parties.length === 0 ||
      !partyStacksEnabled
    ) {
      return new Map<string, PartyMemberInfo[]>();
    }
    const myEmail = session.user.email;

    const meMember = (() => {
      for (const p of parties) {
        const m = p.members.find((x) => x.email === myEmail);
        if (m) return m;
      }
      return null;
    })();
    if (!meMember) return new Map<string, PartyMemberInfo[]>();

    const me: PartyMemberInfo = {
      email: meMember.email,
      name: meMember.name,
      image: meMember.image,
      plan: meMember.plan,
    };

    const visibleParties = parties.filter(
      (p) => schedulePartyVisible[p.id] !== false
    );

    const map = new Map<string, PartyMemberInfo[]>();

    for (const [, planSet] of Object.entries(userPlanByDay)) {
      if (!planSet) continue;
      for (const key of planSet) {
        map.set(key, [me]);
      }
    }

    for (const party of visibleParties) {
      for (const member of party.members) {
        if (member.email === myEmail) continue;
        for (const keys of Object.values(member.plan)) {
          if (!keys) continue;
          for (const key of keys) {
            const arr = map.get(key);
            if (arr) {
              if (!arr.some((m) => m.email === member.email)) {
                arr.push(member);
              }
            } else {
              map.set(key, [member]);
            }
          }
        }
      }
    }

    const deduped = new Map<string, PartyMemberInfo[]>();
    for (const [k, arr] of map) {
      deduped.set(k, dedupePartyMembersByEmail(arr));
    }
    return deduped;
  }, [
    parties,
    schedulePartyVisible,
    session?.user?.email,
    userPlanByDay,
    partyStacksEnabled,
  ]);

  const playTrack = useCallback(
    (track: Pick<TrackInfo, "preview" | "id" | "source">) => {
      const trackId = track.id;
      setAudioError(null);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (playingTrack === trackId) {
        setPlayingTrack(null);
        return;
      }
      if (!track.preview || typeof track.preview !== "string") {
        setAudioError("This track has no playable preview.");
        setPlayingTrack(null);
        return;
      }

      // Validate and normalize URL (guards against "null"/relative/garbage strings)
      let initialSrc = track.preview.trim();
      try {
        const u = new URL(initialSrc, window.location.origin);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          throw new Error("Unsupported protocol");
        }
        initialSrc = u.toString();
      } catch {
        setAudioError("Could not load preview audio for this track.");
        setPlayingTrack(null);
        return;
      }

      const loadAndPlay = (src: string, isRetry: boolean) => {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }

        const audio = new Audio();
        audio.preload = "none";
        audio.src = src;
        audio.volume = 0.5;

        const cleanup = () => {
          audio.onended = null;
          audio.onerror = null;
          audio.oncanplay = null;
        };

        audio.onerror = () => {
          cleanup();
          if (audioRef.current === audio) audioRef.current = null;
          const errCode = audio.error?.code;
          console.warn("[audio] failed to load", { src: audio.src, err: audio.error });

          const dzId = deezerNumericIdForPreviewRetry(track);
          if (!isRetry && dzId != null) {
            void (async () => {
              try {
                const r = await fetch(`/api/track-preview?id=${dzId}`, {
                  cache: "no-store",
                });
                const data = (await r.json()) as { preview?: string | null };
                const nextRaw =
                  typeof data.preview === "string" ? data.preview.trim() : "";
                if (nextRaw && nextRaw !== src) {
                  let nextUrl: string;
                  try {
                    const u = new URL(nextRaw, window.location.origin);
                    if (u.protocol !== "http:" && u.protocol !== "https:") {
                      throw new Error("Unsupported protocol");
                    }
                    nextUrl = u.toString();
                  } catch {
                    setAudioError("Could not load preview audio for this track.");
                    setPlayingTrack(null);
                    return;
                  }
                  loadAndPlay(nextUrl, true);
                  return;
                }
              } catch (e) {
                console.warn("[audio] preview refresh failed", e);
              }
              setAudioError(previewErrorMessage(errCode));
              setPlayingTrack(null);
            })();
            return;
          }

          setAudioError(previewErrorMessage(errCode));
          setPlayingTrack(null);
        };

        audio.onended = () => {
          cleanup();
          setPlayingTrack(null);
          if (audioRef.current === audio) audioRef.current = null;
        };

        audioRef.current = audio;
        setPlayingTrack(trackId);

        const tryPlay = () => {
          try {
            const p = audio.play();
            if (p && typeof (p as Promise<void>).catch === "function") {
              (p as Promise<void>).catch((e) => {
                console.warn("[audio] play() rejected", e);
                setAudioError("Preview could not be played.");
                setPlayingTrack(null);
                if (audioRef.current === audio) audioRef.current = null;
              });
            }
          } catch (e) {
            console.warn("[audio] play() threw", e);
            setAudioError("Preview could not be played.");
            setPlayingTrack(null);
            if (audioRef.current === audio) audioRef.current = null;
          }
        };

        if (audio.readyState >= 2 /* HAVE_CURRENT_DATA */) {
          tryPlay();
        } else {
          audio.oncanplay = () => {
            audio.oncanplay = null;
            tryPlay();
          };
          audio.load();
        }
      };

      loadAndPlay(initialSrc, false);
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
    let totalWalkMiles = 0;
    const slots: ScheduleSlot[] = slotModels.map((model, idx) => {
      const prev = idx > 0 ? slotModels[idx - 1].selected : null;
      let walkFromPrevious: number | null = null;
      let walkMilesFromPrevious: number | null = null;
      let prevStage: string | null = null;
      if (prev) {
        const fromSt = prev.setTime.stage as Stage;
        const toSt = model.selected.setTime.stage as Stage;
        walkMilesFromPrevious = getWalkingDistanceMiles(fromSt, toSt);
        walkFromPrevious = getWalkingTime(fromSt, toSt);
        prevStage = prev.setTime.stage;
        totalWalkTime += walkFromPrevious;
        totalWalkMiles += walkMilesFromPrevious;
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
        walkMilesFromPrevious,
        prevStage,
        isConflict: overlapNames.length > 0,
        conflictWith: overlapNames,
      };
    });

    return {
      day: daySchedule.day,
      slots,
      totalWalkTime,
      totalWalkMiles,
      slotModels,
    };
  }, [daySchedule, dayRecs]);

  const hasLastfmForYouPicks = useMemo(
    () =>
      recommendations.some(
        (r) => r.mightLike ?? r.matchType !== "none"
      ),
    [recommendations]
  );

  const filteredRecs = dayRecs
    .filter((r) => stageFilter === "all" || r.setTime.stage === stageFilter)
    .filter(
      (r) =>
        matchFilter === "all" ||
        (matchFilter === "foryou" &&
          showLastfmRecommendations &&
          (r.mightLike ?? r.matchType !== "none"))
    );

  const sortedByTime = [...filteredRecs].sort((a, b) => {
    if (a.setTime.startTime !== b.setTime.startTime)
      return a.setTime.startTime.localeCompare(b.setTime.startTime);
    return (
      STAGES.indexOf(a.setTime.stage as Stage) -
      STAGES.indexOf(b.setTime.stage as Stage)
    );
  });

  const currentDayPlan = userPlanByDay[selectedDay];

  const gridItems: ScheduleGridItem[] = useMemo(() => {
    const planSet = currentDayPlan;
    const allDaySorted = [...dayRecs].sort((a, b) => {
      if (a.setTime.startTime !== b.setTime.startTime)
        return a.setTime.startTime.localeCompare(b.setTime.startTime);
      return (
        STAGES.indexOf(a.setTime.stage as Stage) -
        STAGES.indexOf(b.setTime.stage as Stage)
      );
    });
    return allDaySorted.map((rec) => {
      const key = recIdentityKey(rec);
      const members = partyAttendance.get(key);
      const stack =
        partyStacksEnabled && members && members.length > 0
          ? members.map((m) => ({ name: m.name, image: m.image }))
          : undefined;
      return {
        recommendation: rec,
        rowKey: gridRowKeyNonPlan(rec),
        inPlan: planSet ? planSet.has(key) : false,
        partyMembers: stack,
      };
    });
  }, [
    currentDayPlan,
    dayRecs,
    partyAttendance,
    partyStacksEnabled,
  ]);

  /** List (View Mode): rows derived from grid plan only, in time order, with walk + overlap info */
  const userPlanListForDay = useMemo(() => {
    const planSet = userPlanByDay[selectedDay];
    if (!planSet || planSet.size === 0) {
      return {
        recs: [] as ArtistRecommendation[],
        rows: [] as {
          walkFromPrevious: number | null;
          walkMilesFromPrevious: number | null;
          prevStage: string | null;
          isConflict: boolean;
          conflictWith?: string[];
        }[],
        totalWalkMinutes: 0,
        totalWalkMiles: 0,
      };
    }
    const recs: ArtistRecommendation[] = [];
    for (const r of dayRecs) {
      if (planSet.has(recIdentityKey(r))) recs.push(r);
    }
    recs.sort((a, b) => {
      if (a.setTime.startTime !== b.setTime.startTime)
        return a.setTime.startTime.localeCompare(b.setTime.startTime);
      return (
        STAGES.indexOf(a.setTime.stage as Stage) -
        STAGES.indexOf(b.setTime.stage as Stage)
      );
    });

    let totalWalkMinutes = 0;
    let totalWalkMiles = 0;
    const rows: {
      walkFromPrevious: number | null;
      walkMilesFromPrevious: number | null;
      prevStage: string | null;
      isConflict: boolean;
      conflictWith?: string[];
    }[] = [];

    for (let idx = 0; idx < recs.length; idx++) {
      const rec = recs[idx];
      let walkFromPrevious: number | null = null;
      let walkMilesFromPrevious: number | null = null;
      let prevStage: string | null = null;
      if (idx > 0) {
        const prev = recs[idx - 1];
        const fromSt = prev.setTime.stage as Stage;
        const toSt = rec.setTime.stage as Stage;
        walkMilesFromPrevious = getWalkingDistanceMiles(fromSt, toSt);
        walkFromPrevious = getWalkingTime(fromSt, toSt);
        prevStage = prev.setTime.stage;
        totalWalkMinutes += walkFromPrevious;
        totalWalkMiles += walkMilesFromPrevious;
      }

      const overlapNames = dayRecs
        .filter(
          (r) =>
            r.affinityScore > 0 &&
            r.setTime.artist.name !== rec.setTime.artist.name &&
            setsOverlap(r.setTime, rec.setTime)
        )
        .sort((a, b) => b.affinityScore - a.affinityScore)
        .map((r) => r.setTime.artist.name);

      rows.push({
        walkFromPrevious,
        walkMilesFromPrevious,
        prevStage,
        isConflict: overlapNames.length > 0,
        conflictWith: overlapNames,
      });
    }

    return { recs, rows, totalWalkMinutes, totalWalkMiles };
  }, [selectedDay, dayRecs, userPlanByDay]);

  const scheduleLayoutEffective: ScheduleLayout =
    gridItems.length === 0 ? "list" : scheduleLayout;

  const serverPlanKeysForDay = useMemo(() => {
    const ds = optimizedSchedule.find((d) => d.day === selectedDay);
    if (!ds) return new Set<string>();
    return new Set(ds.slots.map((s) => recIdentityKey(s.recommendation)));
  }, [optimizedSchedule, selectedDay]);

  const planDiverged = useMemo(() => {
    const userSet = currentDayPlan;
    if (!userSet) return false;
    if (userSet.size !== serverPlanKeysForDay.size) return true;
    for (const k of userSet) {
      if (!serverPlanKeysForDay.has(k)) return true;
    }
    return false;
  }, [currentDayPlan, serverPlanKeysForDay]);

  const resetPlanForDay = useCallback(() => {
    setUserPlanByDay((prev) => {
      const next = { ...prev };
      if (serverPlanKeysForDay.size > 0) {
        next[selectedDay] = new Set(serverPlanKeysForDay);
      } else {
        delete next[selectedDay];
      }
      saveUserPlan(next);
      return next;
    });
  }, [selectedDay, serverPlanKeysForDay]);

  const handleGridTogglePlan = useCallback(
    (rowKey: string) => {
      const rec = dayRecs.find((r) => gridRowKeyNonPlan(r) === rowKey);
      if (!rec) return;
      togglePlanItem(selectedDay, recIdentityKey(rec));
    },
    [dayRecs, selectedDay, togglePlanItem]
  );

  const gridSelectedArtistRec: ArtistRecommendation | null = useMemo(() => {
    if (scheduleLayoutEffective !== "grid" || !expandedArtist) return null;
    return (
      dayRecs.find((r) => gridRowKeyNonPlan(r) === expandedArtist) ?? null
    );
  }, [scheduleLayoutEffective, expandedArtist, dayRecs]);

  useEffect(() => {
    if (!expandedArtist) return;
    if (gridItems.length === 0 || scheduleLayout !== "grid") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedArtist(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expandedArtist, scheduleLayout, gridItems.length]);

  // ── Session ─────────────────────────────────────────────────────────

  if (sessionStatus === "loading") {
    return <main className="min-h-screen bg-background" />;
  }

  if (sessionStatus === "unauthenticated") {
    if (typeof window !== "undefined") window.location.href = "/";
    return null;
  }

  // ── Artist row ─────────────────────────────────────────────────────

  const renderArtistRow = (
    rec: ArtistRecommendation,
    walkInfo?: {
      walkFromPrevious: number | null;
      walkMilesFromPrevious?: number | null;
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
    const showForYouBadge =
      showLastfmRecommendations &&
      (rec.mightLike ?? rec.matchType !== "none");
    const recKey = recIdentityKey(rec);
    const goingToThisSet = partyAttendance.get(recKey) ?? [];
    const topTrackNames =
      rec.userTopTrackNames?.slice(0, 3) ||
      rec.userTopTracks?.slice(0, 3).map((t) => t.title).filter(Boolean) ||
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
            <span className="text-[12px] text-muted">
              {`walk ~${walkInfo.walkFromPrevious} min (${formatLegDistanceMiles(
                walkInfo.walkMilesFromPrevious ?? 0
              )}) from ${walkInfo.prevStage ?? "last set"}`}
            </span>
          </div>
        )}

        {/* Main row */}
        <button
          type="button"
          onClick={() => setExpandedArtist(isExpanded ? null : key)}
          className={`group schedule-artist-btn w-full text-left border-b border-border/30 ${
            walkInfo?.walkFromPrevious != null && walkInfo.walkFromPrevious > 0
              ? "border-t border-border/30"
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
                    showForYouBadge
                      ? "text-foreground group-hover:text-cyan"
                      : "text-muted group-hover:text-foreground"
                  }`}
                >
                  {displayName}
                </span>
                {showForYouBadge && (
                  <span
                    className="badge-direct text-[11px] px-1.5 py-0.5 font-semibold shrink-0"
                    title={rec.affinityReason || "Suggested from your Last.fm taste"}
                  >
                    For you
                  </span>
                )}
              </div>
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted mt-0.5">
                <span style={{ color: stageColor }}>
                  {rec.setTime.stage}
                </span>
                <span className="text-border">·</span>
                <span>
                  {formatTime(rec.setTime.startTime)} –{" "}
                  {formatTime(rec.setTime.endTime)}
                </span>
                {partyStacksEnabled && goingToThisSet.length > 0 && (
                  <>
                    <span className="text-border">·</span>
                    <span
                      className="inline-flex items-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <PartyMemberAvatarStack
                        members={goingToThisSet.map((m) => ({
                          name: m.name,
                          image: m.image,
                        }))}
                        inPlan={false}
                      />
                    </span>
                  </>
                )}
                {walkInfo?.isConflict && walkInfo.conflictWith?.length && (
                  <>
                    <span className="text-border">·</span>
                    <span className="text-foreground/90 max-w-[min(100%,14rem)] sm:max-w-[22rem] sm:truncate">
                      <span className="text-[13px] text-cyan mr-0.5">
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
              {showForYouBadge && rec.affinityReason && (
                <p className="text-[12px] text-muted/70 mt-0.5 truncate">
                  {rec.affinityReason}
                  {topTracksSuffix}
                </p>
              )}
            </div>

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

        {/* Expanded: going + tracks */}
        {isExpanded && (
          <div className="scratch-panel mx-2 sm:mx-3 mt-2 mb-2 border-b-0">
            {partyStacksEnabled && parties.length > 0 && (
              <div className="px-5 py-2.5">
                <p className="mb-2 font-display text-sm font-semibold text-foreground/90">
                  Going
                </p>
                {goingToThisSet.length > 0 ? (
                  <ul className="space-y-2">
                    {goingToThisSet.map((m) => (
                      <li
                        key={m.email}
                        className="flex min-w-0 items-center gap-2.5"
                      >
                        {m.image ? (
                          <img
                            src={m.image}
                            alt=""
                            className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-border/40"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--hover-wash-strong)] text-[12px] font-bold text-muted">
                            {m.name.charAt(0)}
                          </div>
                        )}
                        <span className="min-w-0 truncate text-[14px] text-foreground">
                          {m.name}
                          {session?.user?.email === m.email && (
                            <span className="ml-1.5 text-[12px] text-muted">
                              (you)
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted">
                    No one from your parties is going to this set yet.
                  </p>
                )}
              </div>
            )}
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

              const tracksToShow = filterTracksByPopularPreference(
                deduped,
                showPopularSongs
              );

              if (deduped.length === 0) {
                return (
                  <div className="px-5 py-4">
                    <p className="text-[14px] text-muted">
                      No track data available.
                    </p>
                  </div>
                );
              }

              if (tracksToShow.length === 0) {
                return null;
              }

              return (
              <div className="divide-y divide-dashed divide-border/70">
                <div className="px-5 py-2">
                  <span className="font-display text-sm font-semibold text-foreground/90">
                    {showPopularSongs ? "Popular tracks" : "Your picks"}
                  </span>
                </div>
                {audioError && (
                  <div className="px-5 py-2.5">
                    <p className="text-[13px] text-muted">
                      {audioError}
                    </p>
                  </div>
                )}
                {tracksToShow.map((track) => (
                  <div
                    key={`${track.source || "track"}:${String(track.id)}`}
                    className="track-row flex items-center gap-3 px-5 py-2.5 cursor-pointer"
                    onClick={() =>
                      playTrack({
                        preview: track.preview,
                        id: track.id,
                        source: track.source,
                      })
                    }
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
                      <p className="text-[14px] text-foreground truncate flex items-center gap-1.5">
                        <span className="truncate">{track.title}</span>
                        {track.isUserTopTrack && (
                          <span
                            className="badge-direct text-[11px] px-1.5 py-0.5 font-semibold shrink-0"
                            title="This track is in your Last.fm top tracks"
                          >
                            Your Top Track
                          </span>
                        )}
                      </p>
                      <p className="text-[12px] text-muted truncate">
                        {track.albumTitle}
                      </p>
                    </div>

                    <span className="text-[12px] text-muted/50 tabular-nums shrink-0">
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
              <div
                className={`px-5 py-3 flex items-center gap-4 border-t ${
                  showPopularSongs
                    ? "border-dashed border-border/70"
                    : "border-t-2 border-solid border-border"
                }`}
              >
                <a
                  href={rec.artist.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] text-cyan hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
                >
                  Open on Spotify
                </a>
                {rec.relatedTo && (
                  <span className="text-[12px] text-muted" title="We matched via similarity to this artist you listen to">
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

  const isGridFullscreen =
    scheduleLayoutEffective === "grid" && gridItems.length > 0;

  const headerName = profileOverride?.name || session?.user?.name || "";
  const headerImage = profileOverride?.image || session?.user?.image || "";

  // ── Page ───────────────────────────────────────────────────────────

  return (
    <main
      className={
        isGridFullscreen
          ? "flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden overscroll-none bg-background"
          : "min-h-screen"
      }
    >
      <div className="noise-overlay" aria-hidden />

      {/* Header */}
      <header
        className={`z-50 bg-background ${
          isGridFullscreen ? "shrink-0" : "sticky top-0"
        }`}
      >
        <div className="header-canvas-strip">
          <div className="flex min-h-0 w-full items-center justify-between px-4 sm:px-6">
            <Link
              href="/"
              className="font-display text-[1.3rem] font-medium text-[var(--cream)] hover:text-white transition-colors leading-none drop-shadow-[0_1px_2px_color-mix(in_srgb,var(--teal)_35%,transparent)]"
            >
              🌴 coachella planner
            </Link>
            <div className="flex items-center gap-3">
              {session?.user && (
                <Link
                  href="/profile"
                  className="flex items-center gap-2 font-display text-[13px] font-medium text-[var(--cream)] hover:text-white transition-colors drop-shadow-[0_1px_2px_color-mix(in_srgb,var(--teal)_35%,transparent)]"
                >
                  {headerImage && (
                    <img
                      src={headerImage}
                      alt=""
                      className="h-5 w-5 shrink-0 rounded-full object-cover ring-1 ring-[color-mix(in_srgb,var(--cream)_40%,transparent)]"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <span>{headerName}</span>
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="grain-strong border-b border-border/40 bg-background/95 backdrop-blur-sm px-4 pb-3 pt-3 sm:px-6">
          {/* Day + view controls — same horizontal padding as profile header (single column) */}
          <div className="flex flex-wrap gap-3 sm:gap-4 items-center">
          {/* Day picker */}
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day) => (
              <button
                key={day.id}
                type="button"
                onClick={() => setSelectedDay(day.id)}
                className={`scratch-pill px-3.5 py-1.5 text-[13px] font-display font-medium border border-border/50 transition-colors ${
                  selectedDay === day.id
                    ? "bg-[var(--expand-wash)] text-foreground border-cyan/35 z-10"
                    : "text-muted hover:text-foreground hover:bg-[var(--hover-wash)]"
                }`}
              >
                {day.id.charAt(0).toUpperCase() + day.id.slice(1)}
              </button>
            ))}
          </div>

          {viewMode === "schedule" && (
            <button
              type="button"
              onClick={() => setViewMode("optimized")}
              className="scratch-pill px-3 py-1.5 text-[12px] font-medium border border-border/50 bg-[var(--hover-wash-strong)] text-foreground border-cyan/30"
            >
              Your plan
            </button>
          )}

          {gridItems.length > 0 && (
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Schedule layout"
            >
              <button
                type="button"
                onClick={() => setScheduleLayout("list")}
                className={`scratch-pill px-3 py-1.5 text-[12px] font-medium border border-border/50 transition-colors ${
                  scheduleLayoutEffective === "list"
                    ? "bg-[var(--hover-wash-strong)] text-foreground border-cyan/30 z-10"
                    : "text-muted/70 hover:text-foreground hover:bg-[var(--hover-wash)]"
                }`}
              >
                List (View Mode)
              </button>
              <button
                type="button"
                onClick={() => setScheduleLayout("grid")}
                className={`scratch-pill px-3 py-1.5 text-[12px] font-medium border border-border/50 transition-colors ${
                  scheduleLayoutEffective === "grid"
                    ? "bg-[var(--hover-wash-strong)] text-foreground border-cyan/30 z-10"
                    : "text-muted/70 hover:text-foreground hover:bg-[var(--hover-wash)]"
                }`}
              >
                Grid (Edit Mode)
              </button>
            </div>
          )}

          {planDiverged && hasLastfm && (
            <button
              type="button"
              onClick={resetPlanForDay}
              className="scratch-pill px-3 py-1.5 text-[12px] font-medium border border-border/50 text-muted/70 hover:text-foreground hover:bg-[var(--hover-wash)] transition-colors"
            >
              Reset to suggested
            </button>
          )}

          {/* Filters (browse-all only — list view shows your plan only) */}
          {viewMode !== "optimized" && scheduleLayoutEffective !== "list" && (
            <>
              <select
                value={stageFilter}
                onChange={(e) =>
                  setStageFilter(e.target.value as Stage | "all")
                }
                className="bg-background text-foreground scratch-pill border border-border/50 text-[12px] px-2.5 py-1.5 outline-none cursor-pointer"
              >
                <option value="all">All stages</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              {showLastfmRecommendations && hasLastfmForYouPicks ? (
                <div className="flex flex-wrap gap-2">
                  {(["all", "foryou"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setMatchFilter(f)}
                      className={`scratch-pill px-2.5 py-1.5 text-[12px] border border-border/50 transition-colors ${
                        matchFilter === f
                          ? "bg-[var(--hover-wash-strong)] text-foreground border-cyan/25"
                          : "text-muted/60 hover:text-foreground hover:bg-[var(--hover-wash)]"
                      }`}
                    >
                      {f === "all" ? "All" : "For you"}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
          </div>
        </div>
      </header>

      {recsError && (
        <div
          className="relative z-10 bg-[var(--hover-wash)] px-4 py-2 sm:px-6"
          role="status"
        >
          <p className="text-center text-[13px] text-muted">{recsError}</p>
        </div>
      )}

      {/* Content */}
      <div
        className={
          isGridFullscreen
            ? "relative z-10 flex min-h-0 min-w-0 flex-1 flex-col"
            : "relative z-10"
        }
      >
        {scheduleLayoutEffective === "list" ? (
          <div>
            <div
              className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 border-b border-border/40 text-[13px] text-muted`}
            >
              <span
                title={`Path distances are approximate; time assumes ~${FESTIVAL_WALK_MPH} mph festival walking pace.`}
              >
                {`~${userPlanListForDay.totalWalkMinutes} min (${formatTotalWalkDistance(userPlanListForDay.totalWalkMiles)}) between sets`}
              </span>
            </div>

            {userPlanListForDay.recs.length === 0 ? (
              <div className="text-center py-20 px-6">
                <p className="text-muted text-sm">
                  Nothing in your plan for this day yet.
                </p>
                <p className="mt-2 text-[14px] text-muted/90">
                  Switch to{" "}
                  <span className="font-medium text-foreground">
                    Grid (Edit Mode)
                  </span>{" "}
                  to add or remove sets.
                </p>
              </div>
            ) : (
              userPlanListForDay.recs.map((rec, idx) =>
                renderArtistRow(
                  rec,
                  userPlanListForDay.rows[idx],
                  recIdentityKey(rec)
                )
              )
            )}
          </div>
        ) : viewMode === "optimized" && personalizedDaySchedule ? (
          <div
            className={
              isGridFullscreen ? "flex min-h-0 min-w-0 flex-1 flex-col" : ""
            }
          >
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
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ScheduleGridView
                  fillViewport
                  items={gridItems}
                  stageColors={STAGE_COLORS}
                  expandedKey={expandedArtist}
                  onSelect={setExpandedArtist}
                  editable
                  onTogglePlan={handleGridTogglePlan}
                  showLastfmBadges={showLastfmRecommendations}
                />
              </div>
            )}
          </div>
        ) : (
          <div
            className={
              isGridFullscreen ? "flex min-h-0 min-w-0 flex-1 flex-col" : ""
            }
          >
            {sortedByTime.length === 0 ? (
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
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ScheduleGridView
                  fillViewport
                  items={gridItems}
                  stageColors={STAGE_COLORS}
                  expandedKey={expandedArtist}
                  onSelect={setExpandedArtist}
                  editable
                  onTogglePlan={handleGridTogglePlan}
                  showLastfmBadges={showLastfmRecommendations}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {gridSelectedArtistRec && scheduleLayoutEffective === "grid" && (() => {
        const selectedKey = recIdentityKey(gridSelectedArtistRec);
        const isSelectedInPlan = currentDayPlan?.has(selectedKey) ?? false;
        const goingToThisSet = partyAttendance.get(selectedKey) ?? [];
        return (
        <div
          className="fixed inset-x-0 bottom-0 z-[90] flex max-h-[min(33.333dvh,520px)] flex-col border-t border-border/60 bg-background pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-6px_16px_-2px_rgba(12,31,36,0.22)] grain-strong sm:max-h-[min(52dvh,520px)]"
          role="region"
          aria-label="Artist and tracks"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/30 px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {gridSelectedArtistRec.artist?.image ? (
                <img
                  src={gridSelectedArtistRec.artist.image}
                  alt=""
                  className="h-10 w-10 shrink-0 object-cover scratch-blob"
                />
              ) : (
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center scratch-blob bg-[var(--hover-wash-strong)] font-display text-sm font-bold text-muted"
                  aria-hidden
                >
                  {gridSelectedArtistRec.setTime.artist.name.charAt(0)}
                </div>
              )}
              <h2 className="m-0 min-w-0 flex-1 font-display text-[1.35rem] font-semibold leading-tight text-foreground">
                {gridSelectedArtistRec.setTime.artist.name}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isSelectedInPlan) {
                    removeFromPlan(selectedDay, selectedKey);
                  } else {
                    addToPlan(selectedDay, selectedKey);
                  }
                }}
                className={`scratch-pill shrink-0 px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  isSelectedInPlan
                    ? "border border-border/50 text-muted hover:text-foreground"
                    : "bg-accent text-on-accent hover:bg-[var(--accent-hover-soft)]"
                }`}
              >
                {isSelectedInPlan ? "Remove from plan" : "Add to plan"}
              </button>
              <button
                type="button"
                onClick={() => setExpandedArtist(null)}
                className="scratch-pill shrink-0 px-3 py-1.5 text-[12px] font-medium text-muted hover:text-foreground"
              >
                Close
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overscroll-behavior:contain]">
            {(() => {
              const rec = gridSelectedArtistRec;
              const mergedTracks: TrackInfo[] = [
                ...(rec.userTopTracks || []),
                ...(rec.topTracks || []),
              ].filter((t) => !!t?.preview);

              const deduped: TrackInfo[] = [];
              const seen = new Set<string>();
              for (const t of mergedTracks) {
                const tk = `${t.source || "unknown"}:${String(t.id)}`;
                if (seen.has(tk)) continue;
                seen.add(tk);
                deduped.push(t);
              }

              const tracksToShow = filterTracksByPopularPreference(
                deduped,
                showPopularSongs
              );

              const goingBlock =
                partyStacksEnabled && parties.length > 0 ? (
                  <div className="px-4 py-2.5">
                    <p className="mb-2 font-display text-sm font-semibold text-foreground/90">
                      Going
                    </p>
                    {goingToThisSet.length > 0 ? (
                      <ul className="space-y-2">
                        {goingToThisSet.map((m) => (
                          <li key={m.email} className="flex min-w-0 items-center gap-2.5">
                            {m.image ? (
                              <img
                                src={m.image}
                                alt=""
                                className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-border/40"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--hover-wash-strong)] text-[12px] font-bold text-muted">
                                {m.name.charAt(0)}
                              </div>
                            )}
                            <span className="min-w-0 truncate text-[14px] text-foreground">
                              {m.name}
                              {session?.user?.email === m.email && (
                                <span className="ml-1.5 text-[12px] text-muted">(you)</span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[13px] text-muted">
                        No one from your parties is going to this set yet.
                      </p>
                    )}
                  </div>
                ) : null;

              if (deduped.length === 0) {
                return (
                  <div>
                    {goingBlock}
                    <p className="px-4 py-4 text-[14px] text-muted">
                      No track previews available.
                    </p>
                  </div>
                );
              }

              if (tracksToShow.length === 0) {
                return <>{goingBlock}</>;
              }

              return (
                <div>
                  {goingBlock}
                  <div className="px-4 pt-3 pb-1">
                    <span className="font-display text-sm font-semibold text-foreground/90">
                      {showPopularSongs ? "Popular tracks" : "Your picks"}
                    </span>
                  </div>
                  {audioError && (
                    <p className="px-4 py-2 text-[13px] text-muted">{audioError}</p>
                  )}
                  <div className="divide-y divide-dashed divide-border/70">
                    {tracksToShow.map((track) => (
                      <div
                        key={`grid-${track.source || "track"}:${String(track.id)}`}
                        className="track-row flex cursor-pointer items-center gap-3 px-4 py-2.5"
                        onClick={() =>
                          playTrack({
                            preview: track.preview,
                            id: track.id,
                            source: track.source,
                          })
                        }
                      >
                        <div className="relative shrink-0">
                          {track.albumCover ? (
                            <img
                              src={track.albumCover}
                              alt=""
                              className="h-8 w-8 object-cover scratch-blob"
                            />
                          ) : (
                            <div className="h-8 w-8 bg-surface-light" />
                          )}
                          {playingTrack === track.id && (
                            <div className="absolute inset-0 flex items-center justify-center gap-0.5 bg-black/60">
                              <div className="eq-bar" />
                              <div className="eq-bar" />
                              <div className="eq-bar" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-[14px] text-foreground">
                            <span className="truncate">{track.title}</span>
                            {track.isUserTopTrack && (
                              <span
                                className="badge-direct shrink-0 px-1.5 py-0.5 text-[11px] font-semibold"
                                title="In your Last.fm top tracks"
                              >
                                Your Top Track
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[12px] text-muted">
                            {track.albumTitle}
                          </p>
                        </div>
                        <span className="shrink-0 tabular-nums text-[12px] text-muted/50">
                          {formatDuration(track.duration)}
                        </span>
                        {playingTrack === track.id ? (
                          <svg
                            className="h-4 w-4 shrink-0 fill-current text-cyan"
                            viewBox="0 0 24 24"
                          >
                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                          </svg>
                        ) : (
                          <svg
                            className="h-4 w-4 shrink-0 fill-current text-muted/40"
                            viewBox="0 0 24 24"
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
          {gridSelectedArtistRec.artist && (
            <div
              className={`shrink-0 px-4 py-2.5 border-t ${
                showPopularSongs
                  ? "border-dashed border-border/70"
                  : "border-t-2 border-solid border-border/40"
              }`}
            >
              <a
                href={gridSelectedArtistRec.artist.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-cyan underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
              >
                Open on Spotify
              </a>
            </div>
          )}
        </div>
        );
      })()}
    </main>
  );
}
