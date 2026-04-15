import { NextResponse } from "next/server";
import {
  searchArtist as deezerSearch,
  getArtistTopTracks as deezerTopTracks,
  type DeezerArtist,
  type DeezerTrack,
} from "@/lib/deezer";
import { SCHEDULE, type SetTime, type Stage } from "@/lib/coachella-data";
import { enrichDeezerArtistFromLineup } from "@/lib/coachella-lineup";
import {
  type ArtistRecommendation,
  type TrackInfo,
} from "@/lib/recommendation-types";
import { getWalkingTime } from "@/lib/stage-proximity";

export type { ArtistRecommendation, TrackInfo } from "@/lib/recommendation-types";

export interface ScheduleSlot {
  recommendation: ArtistRecommendation;
  walkFromPrevious: number | null;
  prevStage: string | null;
  isConflict: boolean;
  conflictWith?: string;
}

export interface DaySchedule {
  day: string;
  slots: ScheduleSlot[];
  totalWalkTime: number;
}

// ── Utilities ────────────────────────────────────────────────────────

function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
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

function deezerTrackToInfo(t: DeezerTrack): TrackInfo {
  return {
    id: t.id,
    title: t.title_short || t.title,
    preview: t.preview,
    duration: t.duration,
    albumTitle: t.album.title,
    albumCover: t.album.cover_medium || t.album.cover_big || t.album.cover,
    link: t.link,
    source: "deezer",
  };
}

// ── Main handler ─────────────────────────────────────────────────────

export async function GET() {
  const BATCH = 12;

  try {
    const searchNames = SCHEDULE.map((st) => ({
      setTime: st,
      searchName: st.artist.spotifyName || st.artist.name,
      normalized: normalizeArtistName(st.artist.spotifyName || st.artist.name),
    }));

    const deezerResults: {
      setTime: SetTime;
      artist: DeezerArtist | null;
    }[] = [];

    for (let i = 0; i < searchNames.length; i += BATCH) {
      const batch = searchNames.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async ({ setTime, searchName, normalized }) => {
          try {
            const res = await deezerSearch(searchName, 5);
            const artists = res.data || [];
            const exact = artists.find(
              (a) => normalizeArtistName(a.name) === normalized
            );
            return { setTime, artist: exact || artists[0] || null };
          } catch {
            return { setTime, artist: null };
          }
        })
      );
      deezerResults.push(...results);
      if (i + BATCH < searchNames.length) {
        await new Promise((r) => setTimeout(r, 35));
      }
    }

    const trackMap = new Map<number, TrackInfo[]>();
    const withArtist = deezerResults.filter((r) => r.artist);
    for (let i = 0; i < withArtist.length; i += BATCH) {
      const batch = withArtist.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (r) => {
          try {
            const data = await deezerTopTracks(r.artist!.id, 5);
            return {
              id: r.artist!.id,
              tracks: (data.data || []).slice(0, 5).map(deezerTrackToInfo),
            };
          } catch {
            return { id: r.artist!.id, tracks: [] as TrackInfo[] };
          }
        })
      );
      for (const r of results) {
        if (r.tracks.length > 0) trackMap.set(r.id, r.tracks);
      }
      if (i + BATCH < withArtist.length) {
        await new Promise((r) => setTimeout(r, 35));
      }
    }

    const recommendations: ArtistRecommendation[] = deezerResults.map((r) => ({
      setTime: r.setTime,
      artist: r.artist
        ? (() => {
            const { image, link } = enrichDeezerArtistFromLineup(
              r.setTime.artist,
              r.artist
            );
            return {
              name: r.artist.name,
              image,
              link,
              deezerId: r.artist.id,
            };
          })()
        : null,
      topTracks: r.artist ? (trackMap.get(r.artist.id) || []) : [],
    }));

    // Build per-day schedules with conflict detection
    const days = [...new Set(SCHEDULE.map((s) => s.day))];
    const optimizedSchedule: DaySchedule[] = days.map((day) => {
      const dayRecs = recommendations.filter((r) => r.setTime.day === day);
      dayRecs.sort(
        (a, b) =>
          timeToMinutes(a.setTime.startTime) -
          timeToMinutes(b.setTime.startTime)
      );
      const slots: ScheduleSlot[] = dayRecs.map((rec, i) => {
        const prev = i > 0 ? dayRecs[i - 1] : null;
        const walkFromPrevious =
          prev && prev.setTime.stage !== rec.setTime.stage
            ? getWalkingTime(prev.setTime.stage as Stage, rec.setTime.stage as Stage)
            : null;
        const isConflict = dayRecs
          .slice(0, i)
          .some((other) => setsOverlap(other.setTime, rec.setTime));
        const conflictWith = isConflict
          ? dayRecs
              .slice(0, i)
              .find((other) => setsOverlap(other.setTime, rec.setTime))
              ?.setTime.artist.name
          : undefined;
        return {
          recommendation: rec,
          walkFromPrevious,
          prevStage: prev?.setTime.stage ?? null,
          isConflict,
          conflictWith,
        };
      });
      return {
        day,
        slots,
        totalWalkTime: slots.reduce((s, sl) => s + (sl.walkFromPrevious ?? 0), 0),
      };
    });

    return NextResponse.json({
      recommendations,
      optimizedSchedule,
      totalArtists: recommendations.length,
    });
  } catch (e) {
    console.error("[recommendations] enrichment error:", e);
    const recommendations: ArtistRecommendation[] = SCHEDULE.map((setTime) => ({
      setTime,
      artist: null,
      topTracks: [],
    }));
    return NextResponse.json({
      recommendations,
      optimizedSchedule: [],
      totalArtists: recommendations.length,
    });
  }
}
