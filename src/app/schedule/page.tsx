"use client";

import Link from "next/link";
import {
  startTransition,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  use,
} from "react";
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
  ScheduleGridView,
  PartyMemberAvatarStack,
  type ScheduleGridItem,
} from "@/app/schedule/ScheduleGridView";
import type {
  ArtistRecommendation,
  TrackInfo,
} from "@/lib/recommendation-types";
import {
  getShowPopularSongs,
} from "@/lib/schedule-preferences";

/** Cached Deezer enrichments from `/api/recommendations` (images + previews). */
const SCHEDULE_REC_CACHE_KEY = "coachella:scheduleRecommendations:v1";

function buildPlaceholderRecommendations(): ArtistRecommendation[] {
  return SCHEDULE.map((st) => ({
    setTime: st,
    artist: null,
    topTracks: [],
  }));
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function TrackPlayToggleIcon({ playing }: { playing: boolean }) {
  if (playing) {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 fill-current">
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 fill-current">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PlayingBars({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex h-3.5 items-end gap-[2px] text-[var(--teal)]" aria-hidden>
      <span className="eq-bar" />
      <span className="eq-bar" />
      <span className="eq-bar" />
    </span>
  );
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
  Quasar: "#6a3d8b",
  "Do LaB": "#8a4a7b",
  "Heineken House": "#2f6b3d",
  "The Bunker": "#525252",
};

// ── Helpers ──────────────────────────────────────────────────────────

function formatTime(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const hour = h > 24 ? h - 24 : h;
  const ampm = hour >= 12 && hour < 24 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/** Stable identity key for matching a set to a stored plan entry */
function recIdentityKey(rec: ArtistRecommendation): string {
  return `${rec.setTime.day}|${rec.setTime.stage}|${rec.setTime.startTime}|${rec.setTime.endTime}|${rec.setTime.artist.name}`;
}

function gridRowKeyNonPlan(rec: ArtistRecommendation): string {
  return `${rec.setTime.day}-${rec.setTime.stage}-${rec.setTime.startTime}-${rec.setTime.artist.name}`;
}

type ScheduleLayout = "list" | "grid";
type DayFilter = "friday" | "saturday" | "sunday";

/** v2 stores { plan: {...}, savedAt: <epoch> } so timestamps can be compared with DB */
const USER_PLAN_KEY_PREFIX = "coachella:userplan:v3";

interface LocalPlanPayload {
  plan: Partial<Record<DayFilter, string[]>>;
  savedAt: number;
}

function getUserPlanStorageKey(email: string): string {
  return `${USER_PLAN_KEY_PREFIX}:${email.trim().toLowerCase()}`;
}

function getLocalPlanSavedAt(email: string): number {
  try {
    const raw = window.localStorage.getItem(getUserPlanStorageKey(email));
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as LocalPlanPayload;
    return Number(parsed.savedAt ?? 0);
  } catch {
    return 0;
  }
}

function loadUserPlan(email: string): Partial<Record<DayFilter, Set<string>>> {
  try {
    const raw = window.localStorage.getItem(getUserPlanStorageKey(email));
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
    return {};
  } catch {
    return {};
  }
}

function saveUserPlan(
  email: string,
  plan: Partial<Record<DayFilter, Set<string>>>,
  savedAt?: number
) {
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
    window.localStorage.setItem(
      getUserPlanStorageKey(email),
      JSON.stringify(payload)
    );
  } catch { /* ignore */ }
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
  const userEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  const [profileOverride, setProfileOverride] = useState<{
    name: string;
    image: string;
  } | null>(null);

  const [scheduleLayout, setScheduleLayout] = useState<ScheduleLayout>("list");
  const [selectedDay, setSelectedDay] = useState<DayFilter>("friday");
  const [expandedArtist, setExpandedArtist] = useState<string | null>(null);

  const [userPlanByDay, setUserPlanByDay] = useState<
    Partial<Record<DayFilter, Set<string>>>
  >({});
  const userPlanInitRef = useRef(false);
  /** True once the plan has been seeded from localStorage. */
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
  const [partyRefreshing, setPartyRefreshing] = useState(false);
  const partySyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partiesRef = useRef(parties);
  useEffect(() => { partiesRef.current = parties; }, [parties]);
  const partyIdsKey = parties.map((p) => p.id).sort().join(",");

  /** Any party has "Show on schedule" on — gates PFP stacks, Going in list/grid/expanded, attendance. */
  const partyStacksEnabled = useMemo(
    () =>
      parties.length > 0 &&
      parties.some((p) => schedulePartyVisible[p.id] !== false),
    [parties, schedulePartyVisible]
  );

  const [recommendations, setRecommendations] = useState<ArtistRecommendation[]>(
    buildPlaceholderRecommendations
  );
  const [recsFetchError, setRecsFetchError] = useState<string | null>(null);
  const [recsRefreshing, setRecsRefreshing] = useState(false);
  const [showPopularSongs, setShowPopularSongs] = useState(() =>
    typeof window === "undefined" ? true : getShowPopularSongs()
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingTrackKey, setPlayingTrackKey] = useState<string | null>(null);
  const playingTrackKeyRef = useRef<string | null>(null);
  const previewUrlCacheRef = useRef(new Map<string, string>());
  const preloadedPreviewUrlsRef = useRef(new Set<string>());

  useEffect(() => {
    playingTrackKeyRef.current = playingTrackKey;
  }, [playingTrackKey]);

  const disposeAudioElement = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
  }, []);

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlayingTrackKey(null);
  }, []);

  const playTrack = useCallback(async (track: TrackInfo, scopeKey: string) => {
    const key = `${scopeKey}:${String(track.id)}`;
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
      audio.onended = () => setPlayingTrackKey(null);
      audio.onpause = () => {
        if (audioRef.current?.ended !== true) {
          setPlayingTrackKey(null);
        }
      };
      audioRef.current = audio;
    }
    if (playingTrackKeyRef.current === key && !audio.paused) {
      stopPlayback();
      return;
    }

    const tryPlay = async (url: string) => {
      setPlayingTrackKey(key);
      if (audio!.src !== url) {
        audio!.src = url;
      }
      audio!.currentTime = 0;
      await audio!.play();
      previewUrlCacheRef.current.set(String(track.id), url);
    };

    const rollbackIfCurrent = () => {
      if (playingTrackKeyRef.current === key) {
        setPlayingTrackKey(null);
      }
    };

    const cachedPreview =
      previewUrlCacheRef.current.get(String(track.id)) ?? track.preview;
    if (cachedPreview) {
      try {
        await tryPlay(cachedPreview);
        return;
      } catch {
        rollbackIfCurrent();
      }
    }

    try {
      const r = await fetch(
        `/api/track-preview?id=${encodeURIComponent(String(track.id))}`
      );
      const j = (await r.json()) as { preview?: string | null };
      if (j.preview) {
        await tryPlay(j.preview);
        return;
      }
    } catch {
      rollbackIfCurrent();
    }
    rollbackIfCurrent();
  }, [stopPlayback]);

  useEffect(() => {
    return () => {
      disposeAudioElement();
      audioRef.current = null;
    };
  }, [disposeAudioElement]);

  useEffect(() => {
    const onPrefs = () => setShowPopularSongs(getShowPopularSongs());
    window.addEventListener("coachella-prefs-changed", onPrefs);
    return () => window.removeEventListener("coachella-prefs-changed", onPrefs);
  }, []);

  const refreshRecommendations = useCallback(
    async (opts?: { showLoading?: boolean }) => {
      const showLoading = opts?.showLoading === true;
      if (showLoading) setRecsRefreshing(true);
      try {
        const res = await fetch("/api/recommendations", { cache: "no-store" });
        const data = (await res.json()) as {
          recommendations?: ArtistRecommendation[];
        };
        if (res.ok && data.recommendations?.length) {
          setRecommendations(data.recommendations);
          setRecsFetchError(null);
          try {
            window.localStorage.setItem(
              SCHEDULE_REC_CACHE_KEY,
              JSON.stringify({
                recommendations: data.recommendations,
                savedAt: Date.now(),
              })
            );
          } catch {
            /* ignore */
          }
        } else if (!res.ok) {
          setRecsFetchError("Could not load artist images and previews");
        }
      } catch {
        setRecsFetchError("Could not load artist images and previews");
      } finally {
        if (showLoading) setRecsRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SCHEDULE_REC_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          recommendations?: ArtistRecommendation[];
        };
        if (
          Array.isArray(parsed.recommendations) &&
          parsed.recommendations.length > 0
        ) {
          setRecommendations(parsed.recommendations);
        }
      }
    } catch {
      /* ignore */
    }
    void refreshRecommendations();
  }, [refreshRecommendations]);

  const fetchParties = useCallback(async (opts?: { showLoading?: boolean }) => {
    const showLoading = opts?.showLoading === true;
    if (showLoading) setPartyRefreshing(true);
    try {
      const res = await fetch("/api/party", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          parties?: PartyInfo[];
          schedulePartyVisible?: Record<string, boolean>;
        };
        setParties(data.parties ?? []);
        setSchedulePartyVisible(data.schedulePartyVisible ?? {});
      }
    } catch {
      /* ignore */
    } finally {
      if (showLoading) setPartyRefreshing(false);
    }
  }, []);

  const togglePlanItem = useCallback(
    (day: DayFilter, key: string) => {
      if (!userEmail) return;
      setUserPlanByDay((prev) => {
        const next = { ...prev };
        const daySet = new Set(prev[day] ?? []);
        if (daySet.has(key)) {
          daySet.delete(key);
        } else {
          daySet.add(key);
        }
        next[day] = daySet;
        saveUserPlan(userEmail, next);
        return next;
      });
    },
    [userEmail]
  );

  const addToPlan = useCallback(
    (day: DayFilter, key: string) => {
      if (!userEmail) return;
      setUserPlanByDay((prev) => {
        const next = { ...prev };
        const daySet = new Set(prev[day] ?? []);
        daySet.add(key);
        next[day] = daySet;
        saveUserPlan(userEmail, next);
        return next;
      });
    },
    [userEmail]
  );

  const removeFromPlan = useCallback(
    (day: DayFilter, key: string) => {
      if (!userEmail) return;
      setUserPlanByDay((prev) => {
        const next = { ...prev };
        const daySet = new Set(prev[day] ?? []);
        daySet.delete(key);
        next[day] = daySet;
        saveUserPlan(userEmail, next);
        return next;
      });
    },
    [userEmail]
  );

  const clearPlanForDay = useCallback(
    (day: DayFilter) => {
      if (!userEmail) return;
      setUserPlanByDay((prev) => {
        const next = { ...prev };
        delete next[day];
        saveUserPlan(userEmail, next);
        return next;
      });
    },
    [userEmail]
  );

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
    if (sessionStatus === "unauthenticated" && typeof window !== "undefined") {
      window.location.href = "/";
    }
  }, [sessionStatus]);

  // Reset and seed userPlanByDay whenever the authenticated user changes.
  useEffect(() => {
    if (sessionStatus !== "authenticated" || !userEmail) {
      userPlanInitRef.current = false;
      planDbHydratedRef.current = false;
      planSyncKeyRef.current = "";
      startTransition(() => {
        setPlanInitialized(false);
        setUserPlanByDay({});
      });
      return;
    }

    userPlanInitRef.current = true;
    planDbHydratedRef.current = false;
    planSyncKeyRef.current = "";
    const saved = loadUserPlan(userEmail);
    startTransition(() => {
      setUserPlanByDay(saved);
      setPlanInitialized(true);
    });
  }, [sessionStatus, userEmail]);

  // Fetch parties, poll, and refresh when returning from Profile
  useEffect(() => {
    void fetchParties();
    const interval = setInterval(fetchParties, 15_000);
    const onFocus = () => { void fetchParties(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchParties();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchParties]);

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

  // ── Firestore: one-shot hydration of user plan after localStorage init ─
  // Compares DB updatedAt vs. local savedAt; takes whichever is newer.
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    if (!userEmail) return;
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

        const localSavedAt = getLocalPlanSavedAt(userEmail);
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
        saveUserPlan(userEmail, plan, data.updatedAt);
      } catch { /* offline */ }
    })();
  }, [sessionStatus, planInitialized, userEmail]);

  // ── Firestore: debounced sync of plan changes → /api/plan ────────────
  // Runs independently of party membership so solo users also get persistence.
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    if (!userEmail) return;
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
              const raw = window.localStorage.getItem(
                getUserPlanStorageKey(userEmail)
              );
              if (raw) {
                const parsed = JSON.parse(raw) as LocalPlanPayload;
                parsed.savedAt = respData.updatedAt;
                window.localStorage.setItem(
                  getUserPlanStorageKey(userEmail),
                  JSON.stringify(parsed)
                );
              }
            } catch { /* ignore */ }
          }
        }
      } catch { /* offline — will retry on next plan change */ }
    }, 1_000);
    return () => {
      if (planSyncRef.current) clearTimeout(planSyncRef.current);
    };
  }, [userPlanByDay, sessionStatus, planInitialized, userEmail]);

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
    session,
    userPlanByDay,
    partyStacksEnabled,
  ]);

  const dayRecs = useMemo(
    () => recommendations.filter((r) => r.setTime.day === selectedDay),
    [recommendations, selectedDay]
  );

  const sortedDayRecs = useMemo(() => {
    return [...dayRecs].sort((a, b) => {
      if (a.setTime.startTime !== b.setTime.startTime) {
        return a.setTime.startTime.localeCompare(b.setTime.startTime);
      }
      return (
        STAGES.indexOf(a.setTime.stage as Stage) -
        STAGES.indexOf(b.setTime.stage as Stage)
      );
    });
  }, [dayRecs]);

  const dayRecByRowKey = useMemo(() => {
    const map = new Map<string, ArtistRecommendation>();
    for (const rec of sortedDayRecs) {
      map.set(gridRowKeyNonPlan(rec), rec);
    }
    return map;
  }, [sortedDayRecs]);

  const dayRecByIdentityKey = useMemo(() => {
    const map = new Map<string, ArtistRecommendation>();
    for (const rec of sortedDayRecs) {
      map.set(recIdentityKey(rec), rec);
    }
    return map;
  }, [sortedDayRecs]);

  const currentDayPlan = userPlanByDay[selectedDay];

  const gridItems: ScheduleGridItem[] = useMemo(() => {
    const planSet = currentDayPlan;
    return sortedDayRecs.map((rec) => {
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
    sortedDayRecs,
    partyAttendance,
    partyStacksEnabled,
  ]);

  /** List (View Mode): rows derived from plan only, in time order, with walk info */
  const userPlanListForDay = useMemo(() => {
    const planSet = currentDayPlan;
    if (!planSet || planSet.size === 0) {
      return {
        recs: [] as ArtistRecommendation[],
        rows: [] as {
          walkFromPrevious: number | null;
          walkMilesFromPrevious: number | null;
          prevStage: string | null;
        }[],
        totalWalkMinutes: 0,
        totalWalkMiles: 0,
      };
    }
    const recs: ArtistRecommendation[] = [];
    for (const r of sortedDayRecs) {
      if (planSet.has(recIdentityKey(r))) recs.push(r);
    }

    let totalWalkMinutes = 0;
    let totalWalkMiles = 0;
    const rows: {
      walkFromPrevious: number | null;
      walkMilesFromPrevious: number | null;
      prevStage: string | null;
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
      rows.push({ walkFromPrevious, walkMilesFromPrevious, prevStage });
    }

    return { recs, rows, totalWalkMinutes, totalWalkMiles };
  }, [currentDayPlan, sortedDayRecs]);

  const scheduleLayoutEffective: ScheduleLayout =
    gridItems.length === 0 ? "list" : scheduleLayout;

  const handleGridTogglePlan = useCallback(
    (rowKey: string) => {
      const rec = dayRecByRowKey.get(rowKey);
      if (!rec) return;
      togglePlanItem(selectedDay, recIdentityKey(rec));
    },
    [dayRecByRowKey, selectedDay, togglePlanItem]
  );

  const gridSelectedArtistRec: ArtistRecommendation | null = useMemo(() => {
    if (scheduleLayoutEffective !== "grid" || !expandedArtist) return null;
    return dayRecByRowKey.get(expandedArtist) ?? null;
  }, [scheduleLayoutEffective, expandedArtist, dayRecByRowKey]);

  const setExpandedArtistSafely = useCallback(
    (next: string | null) => {
      if (playingTrackKey !== null) stopPlayback();
      setExpandedArtist(next);
    },
    [stopPlayback, playingTrackKey]
  );

  const onGridSelect = useCallback(
    (rowKey: string | null) => {
      if (rowKey === null) {
        setExpandedArtistSafely(null);
        return;
      }
      setExpandedArtistSafely(expandedArtist === rowKey ? null : rowKey);
    },
    [expandedArtist, setExpandedArtistSafely]
  );

  useEffect(() => {
    if (!expandedArtist) return;
    if (gridItems.length === 0 || scheduleLayout !== "grid") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedArtistSafely(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expandedArtist, scheduleLayout, gridItems.length, setExpandedArtistSafely]);

  const visibleTrackKeys = useMemo(() => {
    if (!showPopularSongs) return new Set<string>();

    const visibleRec =
      scheduleLayoutEffective === "grid"
        ? gridSelectedArtistRec
        : expandedArtist
          ? dayRecByIdentityKey.get(expandedArtist) ?? null
          : null;

    if (!visibleRec || (visibleRec.topTracks?.length ?? 0) === 0) {
      return new Set<string>();
    }

    return new Set(
      visibleRec.topTracks.map(
        (track) => `${recIdentityKey(visibleRec)}:${String(track.id)}`
      )
    );
  }, [
    dayRecByIdentityKey,
    expandedArtist,
    gridSelectedArtistRec,
    scheduleLayoutEffective,
    showPopularSongs,
  ]);

  useEffect(() => {
    if (playingTrackKey && !visibleTrackKeys.has(playingTrackKey)) {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
  }, [playingTrackKey, visibleTrackKeys]);

  useEffect(() => {
    if (!showPopularSongs) return;

    const visibleRec =
      scheduleLayoutEffective === "grid"
        ? gridSelectedArtistRec
        : expandedArtist
          ? dayRecByIdentityKey.get(expandedArtist) ?? null
          : null;
    if (!visibleRec || (visibleRec.topTracks?.length ?? 0) === 0) return;

    const preload = () => {
      for (const track of visibleRec.topTracks ?? []) {
        const preview =
          previewUrlCacheRef.current.get(String(track.id)) ?? track.preview;
        if (
          !preview ||
          preloadedPreviewUrlsRef.current.has(preview)
        ) {
          continue;
        }

        preloadedPreviewUrlsRef.current.add(preview);
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "audio";
        link.href = preview;
        link.crossOrigin = "anonymous";
        document.head.appendChild(link);
      }
    };

    const maybeWindow = window as Window & {
      requestIdleCallback?: (
        cb: IdleRequestCallback,
        opts?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof maybeWindow.requestIdleCallback === "function") {
      const idleId = maybeWindow.requestIdleCallback(preload, { timeout: 300 });
      return () => maybeWindow.cancelIdleCallback?.(idleId);
    }

    const timeoutId = setTimeout(preload, 0);
    return () => clearTimeout(timeoutId);
  }, [
    dayRecByIdentityKey,
    expandedArtist,
    gridSelectedArtistRec,
    scheduleLayoutEffective,
    showPopularSongs,
  ]);

  // ── Session ─────────────────────────────────────────────────────────

  if (sessionStatus === "loading" || sessionStatus === "unauthenticated") {
    return <main className="min-h-screen bg-background" />;
  }

  // ── Artist row ─────────────────────────────────────────────────────

  const renderArtistRow = (
    rec: ArtistRecommendation,
    walkInfo?: {
      walkFromPrevious: number | null;
      walkMilesFromPrevious?: number | null;
      prevStage: string | null;
    },
    rowId?: string
  ) => {
    const key = rowId ?? `${rec.setTime.day}-${rec.setTime.artist.name}`;
    const isExpanded = expandedArtist === key;
    const stageColor = STAGE_COLORS[rec.setTime.stage] || "#888888";
    const displayName = rec.setTime.artist.name;
    const recKey = recIdentityKey(rec);
    const goingToThisSet = partyAttendance.get(recKey) ?? [];

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
          onClick={() => setExpandedArtistSafely(isExpanded ? null : key)}
          className={`group schedule-artist-btn w-full text-left ${
            isExpanded ? "border-b border-border/30" : ""
          } ${
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

            {rec.artist?.image ? (
              <img
                src={rec.artist.image}
                alt=""
                className="h-10 w-10 shrink-0 object-cover scratch-blob"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center scratch-blob bg-[var(--hover-wash-strong)] font-display text-sm font-bold text-muted">
                {displayName.charAt(0)}
              </div>
            )}

            {/* Info */}
            <div className="flex-1 min-w-0 sm:flex sm:flex-col sm:justify-center">
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-semibold truncate text-muted group-hover:text-foreground">
                  {displayName}
                </span>
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
              </div>
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

        {/* Expanded: Going, tracks, artist link */}
        {isExpanded &&
          (partyStacksEnabled && parties.length > 0
            ? true
            : showPopularSongs && (rec.topTracks?.length ?? 0) > 0
              ? true
              : !!rec.artist?.link) && (
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

            {showPopularSongs && (rec.topTracks?.length ?? 0) > 0 && (
              <div
                className={`pt-2.5 pb-0 ${
                  partyStacksEnabled && parties.length > 0
                    ? "border-t border-border/30"
                    : ""
                }`}
              >
                <p className="mb-2 px-5 font-display text-sm font-semibold text-foreground/90">
                  Popular Songs
                </p>
                <ul>
                  {rec.topTracks.map((track) => {
                    const tk = `${recIdentityKey(rec)}:${String(track.id)}`;
                    const playing = playingTrackKey === tk;
                    return (
                      <li
                        key={String(track.id)}
                        className={`track-row flex min-w-0 items-center gap-3 border-t border-dashed px-5 py-3 first:border-t-0 ${
                          playing ? "is-playing" : ""
                        }`}
                      >
                        <div
                          className={`track-art-shell flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded ${
                            playing ? "is-playing" : ""
                          }`}
                          aria-hidden
                        >
                          {track.albumCover ? (
                            <img
                              src={track.albumCover}
                              alt=""
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-[var(--hover-wash-strong)] text-[10px] text-muted">
                              ♪
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-[13px] text-foreground">
                            <PlayingBars active={playing} />
                            <span className="truncate">{track.title}</span>
                          </p>
                          <p className="text-[11px] text-muted">
                            {formatDuration(track.duration)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void playTrack(track, recIdentityKey(rec));
                          }}
                          className={`track-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                            playing
                              ? "bg-[var(--hover-wash)] text-[var(--teal)]"
                              : "text-muted hover:bg-[var(--hover-wash)] hover:text-foreground"
                          }`}
                          aria-label={playing ? "Pause preview" : "Play preview"}
                        >
                          <TrackPlayToggleIcon playing={playing} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {rec.artist?.link && (
              <div
                className={`px-5 py-2.5 ${
                  (partyStacksEnabled && parties.length > 0) ||
                  (showPopularSongs && (rec.topTracks?.length ?? 0) > 0)
                    ? "border-t border-border/30"
                    : ""
                }`}
              >
                <a
                  href={rec.artist.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-cyan hover:text-foreground underline decoration-dotted underline-offset-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open artist on Spotify
                </a>
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
          : "flex min-h-screen flex-col"
      }
    >
      <div className="noise-overlay" aria-hidden />

      {/* Above fixed noise (z-50) so schedule body + sticky grid read at full opacity */}
      <div className="relative z-[60] flex min-h-0 min-w-0 w-full flex-1 flex-col">
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
                      className="h-5 w-5 shrink-0 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <span>{headerName}</span>
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="grain-strong border-b border-border/40 bg-[var(--schedule-toolbar-wash)] backdrop-blur-sm px-4 pb-3 pt-3 sm:px-6">
          <div className="flex flex-wrap gap-3 sm:gap-4 items-center">
            {/* Day picker */}
            <div className="flex flex-wrap gap-2">
              {DAYS.map((day) => (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => {
                    stopPlayback();
                    setExpandedArtist(null);
                    setSelectedDay(day.id);
                  }}
                  className={`scratch-pill px-3.5 py-1.5 text-[13px] font-display font-medium border transition-colors ${
                    selectedDay === day.id
                      ? "border-transparent bg-[var(--teal)] text-[var(--cream)] shadow-[0_1px_4px_rgba(12,31,36,0.22)] z-10"
                      : "border-border/50 text-muted hover:text-foreground hover:bg-[var(--hover-wash)]"
                  }`}
                >
                  {day.id.charAt(0).toUpperCase() + day.id.slice(1)}
                </button>
              ))}
            </div>

            {gridItems.length > 0 && (
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Schedule layout"
              >
                <button
                  type="button"
                  onClick={() => {
                    stopPlayback();
                    setExpandedArtist(null);
                    setScheduleLayout("list");
                  }}
                  className={`scratch-pill px-3 py-1.5 text-[12px] font-medium border transition-colors ${
                    scheduleLayoutEffective === "list"
                      ? "border-transparent bg-[var(--green)] text-[var(--cream)] shadow-[0_1px_4px_rgba(12,31,36,0.2)] z-10"
                      : "border-border/50 text-muted/70 hover:text-foreground hover:bg-[var(--hover-wash)]"
                  }`}
                >
                  List (View Mode)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopPlayback();
                    setExpandedArtist(null);
                    setScheduleLayout("grid");
                  }}
                  className={`scratch-pill px-3 py-1.5 text-[12px] font-medium border transition-colors ${
                    scheduleLayoutEffective === "grid"
                      ? "border-transparent bg-[var(--green)] text-[var(--cream)] shadow-[0_1px_4px_rgba(12,31,36,0.2)] z-10"
                      : "border-border/50 text-muted/70 hover:text-foreground hover:bg-[var(--hover-wash)]"
                  }`}
                >
                  Grid (Edit Mode)
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {recsFetchError && (
        <div
          className="relative z-10 border-b border-border/35 bg-[var(--hover-wash)] px-4 py-2 text-center sm:px-6"
          role="status"
        >
          <p className="text-[12px] text-muted">{recsFetchError}</p>
        </div>
      )}

      {/* Content */}
      <div
        className={
          isGridFullscreen
            ? "relative z-10 flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--schedule-content-bg)]"
            : "relative z-10 flex flex-1 flex-col bg-[var(--schedule-content-bg)]"
        }
      >
        {scheduleLayoutEffective === "list" ? (
          <div className="flex flex-1 flex-col">
            <div
              className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border/40 bg-[var(--schedule-toolbar-wash)] px-5 py-3 text-[13px] text-muted`}
            >
              <span
                title={`Path distances are approximate; time assumes ~${FESTIVAL_WALK_MPH} mph festival walking pace.`}
              >
                {`~${userPlanListForDay.totalWalkMinutes} min (${formatTotalWalkDistance(userPlanListForDay.totalWalkMiles)}) between sets`}
              </span>
              <button
                type="button"
                onClick={() => void fetchParties({ showLoading: true })}
                disabled={partyRefreshing}
                aria-label="Refresh party updates"
                title="Refresh party updates"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[14px] text-muted/70 transition-colors hover:text-foreground hover:bg-[var(--hover-wash)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ↻
              </button>
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
              <div className="divide-y divide-border/30">
                {userPlanListForDay.recs.map((rec, idx) =>
                  renderArtistRow(
                    rec,
                    userPlanListForDay.rows[idx],
                    recIdentityKey(rec)
                  )
                )}
              </div>
            )}
          </div>
        ) : (
          <div
            className={
              isGridFullscreen ? "flex min-h-0 min-w-0 flex-1 flex-col" : ""
            }
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {/* Grid info bar */}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border/40 bg-[var(--schedule-grid-info-wash)] px-4 py-2 sm:px-5">
                  <span
                    className="text-[13px] text-muted"
                    title={`Path distances are approximate; time assumes ~${FESTIVAL_WALK_MPH} mph festival walking pace.`}
                  >
                    {userPlanListForDay.recs.length === 0
                      ? "Nothing in your plan yet — tap + to add sets"
                      : `${userPlanListForDay.recs.length} set${userPlanListForDay.recs.length === 1 ? "" : "s"}, ~${userPlanListForDay.totalWalkMinutes} min (${formatTotalWalkDistance(userPlanListForDay.totalWalkMiles)}) walking between sets`}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => void fetchParties({ showLoading: true })}
                        disabled={partyRefreshing}
                        aria-label="Refresh party updates"
                        title="Refresh party updates"
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-[14px] text-muted/70 transition-colors hover:text-foreground hover:bg-[var(--hover-wash)] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {partyRefreshing ? "…" : "↻"}
                      </button>
                      {userPlanListForDay.recs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => clearPlanForDay(selectedDay)}
                        className="text-[12px] text-muted/60 hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
                      >
                        Clear day
                      </button>
                    )}
                  </div>
                </div>
                <ScheduleGridView
                  fillViewport
                  items={gridItems}
                  stageColors={STAGE_COLORS}
                  expandedKey={expandedArtist}
                  onSelect={onGridSelect}
                  editable
                  onTogglePlan={handleGridTogglePlan}
                />
            </div>
          </div>
        )}

      {scheduleLayoutEffective === "list" && (
        <footer className="grain-strong relative z-10 shrink-0 border-t border-border/40 bg-[var(--schedule-content-bg)] px-8 py-6 sm:px-12 lg:px-16">
          <p className="max-w-2xl mx-auto text-center text-[12px] text-muted/50">
            Made with ❤️ by{" "}
            <a
              href="https://kylehe.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted/70 underline decoration-dotted underline-offset-2 hover:text-foreground transition-colors"
            >
              Kyle He
            </a>
          </p>
        </footer>
      )}
      </div>
      </div>

      {gridSelectedArtistRec && scheduleLayoutEffective === "grid" && (() => {
        const selectedKey = recIdentityKey(gridSelectedArtistRec);
        const isSelectedInPlan = currentDayPlan?.has(selectedKey) ?? false;
        const goingToThisSet = partyAttendance.get(selectedKey) ?? [];
        return (
        <div
          className="fixed inset-x-0 bottom-0 z-[90] flex max-h-[min(33.333dvh,520px)] flex-col border-t border-border/60 bg-background pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-6px_16px_-2px_rgba(12,31,36,0.22)] grain-strong sm:max-h-[min(52dvh,520px)]"
          role="region"
          aria-label="Artist details"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/30 px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {gridSelectedArtistRec.artist?.image ? (
                <img
                  src={gridSelectedArtistRec.artist.image}
                  alt=""
                  className="h-10 w-10 shrink-0 object-cover scratch-blob"
                  referrerPolicy="no-referrer"
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
                onClick={() => setExpandedArtistSafely(null)}
                className="scratch-pill shrink-0 px-3 py-1.5 text-[12px] font-medium text-muted hover:text-foreground"
              >
                Close
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overscroll-behavior:contain]">
            {partyStacksEnabled && parties.length > 0 ? (
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
            ) : (
              <div className="px-4 py-4">
                <p className="text-[14px] text-muted">
                  {gridSelectedArtistRec.setTime.stage} · {formatTime(gridSelectedArtistRec.setTime.startTime)} – {formatTime(gridSelectedArtistRec.setTime.endTime)}
                </p>
              </div>
            )}

            {showPopularSongs &&
              (gridSelectedArtistRec.topTracks?.length ?? 0) > 0 && (
                <div className="border-t border-border/30 pt-3 pb-0">
                  <p className="mb-2 px-4 font-display text-sm font-semibold text-foreground/90">
                    Popular Songs
                  </p>
                  <ul>
                    {gridSelectedArtistRec.topTracks.map((track) => {
                      const tk = `${recIdentityKey(gridSelectedArtistRec)}:${String(track.id)}`;
                      const playing = playingTrackKey === tk;
                      return (
                        <li
                          key={String(track.id)}
                          className={`track-row flex min-w-0 items-center gap-3 border-t border-dashed px-4 py-3 first:border-t-0 ${
                            playing ? "is-playing" : ""
                          }`}
                        >
                          <div
                            className={`track-art-shell flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded ${
                              playing ? "is-playing" : ""
                            }`}
                            aria-hidden
                          >
                            {track.albumCover ? (
                              <img
                                src={track.albumCover}
                                alt=""
                                className="h-full w-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-[var(--hover-wash-strong)] text-[10px] text-muted">
                                ♪
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 truncate text-[13px] text-foreground">
                              <PlayingBars active={playing} />
                              <span className="truncate">{track.title}</span>
                            </p>
                            <p className="text-[11px] text-muted">
                              {formatDuration(track.duration)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              void playTrack(
                                track,
                                recIdentityKey(gridSelectedArtistRec)
                              )
                            }
                            className={`track-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                              playing
                                ? "bg-[var(--hover-wash)] text-[var(--teal)]"
                                : "text-muted hover:bg-[var(--hover-wash)] hover:text-foreground"
                            }`}
                            aria-label={playing ? "Pause preview" : "Play preview"}
                          >
                            <TrackPlayToggleIcon playing={playing} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

            {gridSelectedArtistRec.artist?.link && (
              <div className="border-t border-border/30 px-4 py-3">
                <a
                  href={gridSelectedArtistRec.artist.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-cyan hover:text-foreground underline decoration-dotted underline-offset-2"
                >
                  Open artist on Spotify
                </a>
              </div>
            )}
          </div>
        </div>
        );
      })()}
    </main>
  );
}
