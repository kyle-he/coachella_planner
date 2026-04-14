import { NextRequest, NextResponse } from "next/server";
import {
  getUserTopArtists,
  getUserTopTracks,
  LastfmError,
} from "@/lib/lastfm";
import { readLastfmSession } from "@/lib/lastfm-session";
import {
  searchArtist as deezerSearch,
  getArtistTopTracks as deezerTopTracks,
  type DeezerArtist,
  type DeezerTrack,
} from "@/lib/deezer";
import { SCHEDULE, type SetTime, type Stage } from "@/lib/coachella-data";
import { enrichDeezerArtistFromLineup } from "@/lib/coachella-lineup";
import { getWalkingTime } from "@/lib/stage-proximity";

// ── Types ────────────────────────────────────────────────────────────

// What we return to the frontend
export interface TrackInfo {
  id: string | number;
  title: string;
  preview: string; // 30s mp3 (Deezer)
  duration: number; // seconds
  albumTitle: string;
  albumCover: string;
  link: string; // deezer track link
  source?: "deezer";
  isUserTopTrack?: boolean;
}

export interface ArtistRecommendation {
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
  userTopTrackNames?: string[];
  matchType: "direct" | "genre" | "related" | "none";
  relatedTo?: string;
  genreOverlap?: string[];
  /** True when this lineup act is likely a good match for the user (show “For you” badge). */
  mightLike?: boolean;
}

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

/**
 * Split collab artist names on common separators (x, &, feat, ft, vs, with, and)
 * Returns all individual artist name variants (normalized).
 */
function splitCollabNames(name: string): string[] {
  const normalized = normalizeArtistName(name);
  const parts = name
    .split(/\s+(?:x|&|feat\.?|ft\.?|vs\.?|with|and|,)\s+/i)
    .map(normalizeArtistName)
    .filter((p) => p.length > 0);

  const result = [normalized];
  if (parts.length > 1) {
    for (const p of parts) {
      if (p !== normalized) result.push(p);
    }
  }
  return result;
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

export async function GET(request: NextRequest) {
  const username = readLastfmSession(request);

  // No Last.fm connected: return all lineup artists with Deezer data but no scoring
  if (!username) {
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

      const BATCH = 12;
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

      const bareRecs: ArtistRecommendation[] = deezerResults.map((r) => ({
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
        affinityScore: 0,
        affinityReason: "",
        topTracks: r.artist ? (trackMap.get(r.artist.id) || []) : [],
        matchType: "none" as const,
        mightLike: false,
      }));

      return NextResponse.json({
        recommendations: bareRecs,
        optimizedSchedule: [],
        totalMatched: 0,
        totalDiscovery: 0,
        totalArtists: bareRecs.length,
      });
    } catch (e) {
      console.error("[recommendations] bare enrichment error:", e);
      const bareRecs: ArtistRecommendation[] = SCHEDULE.map((setTime) => ({
        setTime,
        artist: null,
        affinityScore: 0,
        affinityReason: "",
        topTracks: [],
        matchType: "none" as const,
      }));
      return NextResponse.json({
        recommendations: bareRecs,
        optimizedSchedule: [],
        totalMatched: 0,
        totalDiscovery: 0,
        totalArtists: bareRecs.length,
      });
    }
  }

  try {
    const t0 = Date.now();
    const log = (msg: string) =>
      console.log(`[recs +${Date.now() - t0}ms] ${msg}`);

    // ── Last.fm: only overall top artists + top tracks (2 API calls) ─
    log("Last.fm: overall artists + top tracks…");
    const [topOverall, topTracks] = await Promise.all([
      getUserTopArtists(username, "overall", 35),
      getUserTopTracks(username, "overall", 30),
    ]);

    log(
      `Last.fm — ${topOverall.length} top artists, ${topTracks.length} top tracks`
    );

    const affinityMap = new Map<string, { score: number; reason: string }>();

    const processArtists = (
      artists: { name: string }[],
      weight: number,
      label: string
    ) => {
      artists.forEach((artist, index) => {
        const names = splitCollabNames(artist.name);
        const positionScore =
          ((artists.length - index) / artists.length) * weight;
        for (const normalized of names) {
          const existing = affinityMap.get(normalized);
          if (!existing || existing.score < positionScore) {
            affinityMap.set(normalized, {
              score: positionScore,
              reason: label,
            });
          } else {
            existing.score += positionScore * 0.5;
          }
        }
      });
    };

    processArtists(topOverall, 72, "You listen to this artist");

    const trackArtistCounts = new Map<string, number>();
    const userTopTrackNamesByArtist = new Map<string, string[]>();

    for (const track of topTracks) {
      const artistName =
        track.artist.name || track.artist["#text"] || "";
      if (!artistName) continue;
      const names = splitCollabNames(artistName);
      for (const normalized of names) {
        trackArtistCounts.set(
          normalized,
          (trackArtistCounts.get(normalized) || 0) + 1
        );
        const existing = userTopTrackNamesByArtist.get(normalized) || [];
        existing.push(track.name);
        userTopTrackNamesByArtist.set(normalized, existing);
      }
    }

    trackArtistCounts.forEach((count, key) => {
      const existing = affinityMap.get(key);
      const trackScore = count * 12;
      if (existing) {
        existing.score += trackScore;
      } else {
        affinityMap.set(key, {
          score: trackScore,
          reason: `${count} of your top tracks`,
        });
      }
    });

    log(`Affinity map — ${affinityMap.size} keys`);

    // ── Deezer: resolve every lineup act (no related-artist expansion) ─
    interface DeezerMatch {
      setTime: SetTime;
      deezerArtist: DeezerArtist | null;
      normalized: string;
      collabNames: string[];
    }

    const scheduleSearchNames = SCHEDULE.map((setTime) => {
      const searchName = setTime.artist.spotifyName || setTime.artist.name;
      return {
        setTime,
        searchName,
        normalized: normalizeArtistName(searchName),
        collabNames: splitCollabNames(searchName),
      };
    });

    const deezerMatches: DeezerMatch[] = [];
    const searchBatch = 12;
    for (let i = 0; i < scheduleSearchNames.length; i += searchBatch) {
      const batch = scheduleSearchNames.slice(i, i + searchBatch);
      const results = await Promise.all(
        batch.map(async ({ setTime, searchName, normalized, collabNames }) => {
          try {
            const result = await deezerSearch(searchName, 5);
            const artists = result.data || [];
            const exact = artists.find(
              (a) => normalizeArtistName(a.name) === normalized
            );
            let bestMatch = exact || null;
            if (!bestMatch && collabNames.length > 1) {
              for (const name of collabNames.slice(1)) {
                bestMatch =
                  artists.find(
                    (a) => normalizeArtistName(a.name) === name
                  ) || null;
                if (bestMatch) break;
              }
            }
            return {
              setTime,
              deezerArtist: bestMatch || artists[0] || null,
              normalized,
              collabNames,
            };
          } catch {
            return {
              setTime,
              deezerArtist: null,
              normalized,
              collabNames,
            };
          }
        })
      );
      deezerMatches.push(...results);
      if (i + searchBatch < scheduleSearchNames.length) {
        await new Promise((r) => setTimeout(r, 25));
      }
    }

    log(
      `Deezer lineup — ${deezerMatches.filter((m) => m.deezerArtist).length}/${deezerMatches.length} matched`
    );

    // ── Score lineup vs taste (direct + optional popularity hint only) ─
    interface ScoredArtist {
      setTime: SetTime;
      deezerArtist: DeezerArtist | null;
      affinityScore: number;
      affinityReason: string;
      matchType: ArtistRecommendation["matchType"];
      relatedTo?: string;
      genreOverlap?: string[];
    }

    const scored: ScoredArtist[] = deezerMatches.map((m) => {
      const { setTime, deezerArtist, collabNames } = m;
      let affinityScore = 0;
      let affinityReason = "Not in your listening history";
      let matchType: ArtistRecommendation["matchType"] = "none";
      const relatedTo: string | undefined = undefined;
      const genreOverlap: string[] | undefined = undefined;

      const deezerNorm = deezerArtist
        ? normalizeArtistName(deezerArtist.name)
        : "";

      const allNames = [...collabNames];
      if (deezerNorm && !allNames.includes(deezerNorm)) {
        allNames.push(deezerNorm);
      }
      if (deezerArtist) {
        for (const cn of splitCollabNames(deezerArtist.name)) {
          if (!allNames.includes(cn)) allNames.push(cn);
        }
      }

      for (const name of allNames) {
        const direct = affinityMap.get(name);
        if (direct) {
          if (direct.score > affinityScore) {
            affinityScore = direct.score;
            affinityReason = direct.reason;
          }
          matchType = "direct";
        }
      }

      if (deezerArtist && deezerArtist.nb_fan > 0) {
        const fanBonus = Math.min(
          8,
          Math.log10(Math.max(deezerArtist.nb_fan, 1)) * 1.2
        );
        if (matchType === "direct") {
          affinityScore += fanBonus * 0.35;
        } else if (matchType === "none" && deezerArtist.nb_fan > 500000) {
          affinityScore = Math.max(affinityScore, fanBonus * 1.4);
          if (affinityScore > 0) {
            affinityReason = "Popular — you might enjoy";
            matchType = "genre";
          }
        }
      }

      return {
        setTime,
        deezerArtist,
        affinityScore,
        affinityReason,
        matchType,
        relatedTo,
        genreOverlap,
      };
    });

    log(
      `Scored — ${scored.filter((s) => s.matchType === "direct").length} direct, ${scored.filter((s) => s.matchType === "genre").length} discovery`
    );

    // ── Deezer top tracks (batched previews) ─────────────────────────
    const trackMap = new Map<number, TrackInfo[]>();

    const withDeezer = scored
      .filter((s) => s.deezerArtist)
      .sort((a, b) => b.affinityScore - a.affinityScore);

    const trackBatch = 14;
    for (let i = 0; i < withDeezer.length; i += trackBatch) {
      const batch = withDeezer.slice(i, i + trackBatch);
      const results = await Promise.all(
        batch.map(async (s) => {
          try {
            const data = await deezerTopTracks(s.deezerArtist!.id, 5);
            return {
              id: s.deezerArtist!.id,
              tracks: (data.data || []).slice(0, 5).map(deezerTrackToInfo),
            };
          } catch {
            return { id: s.deezerArtist!.id, tracks: [] };
          }
        })
      );
      results.forEach((r) => {
        if (r.tracks.length > 0) trackMap.set(r.id, r.tracks);
      });
      if (i + trackBatch < withDeezer.length) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    log(`Deezer previews — ${trackMap.size} artists`);
    const recommendations: ArtistRecommendation[] = scored.map((s) => {
      const userTopTrackNames: string[] = [];
      if (s.matchType === "direct") {
        const artistNameForLookup =
          s.setTime.artist.spotifyName || s.setTime.artist.name;
        const lookups = splitCollabNames(artistNameForLookup);
        if (s.deezerArtist) {
          for (const n of splitCollabNames(s.deezerArtist.name)) {
            if (!lookups.includes(n)) lookups.push(n);
          }
        }
        const seen = new Set<string>();
        for (const key of lookups) {
          const names = userTopTrackNamesByArtist.get(key) || [];
          for (const name of names) {
            if (seen.has(name)) continue;
            seen.add(name);
            userTopTrackNames.push(name);
          }
        }
      }

      const allDeezerTracks: TrackInfo[] = s.deezerArtist
        ? trackMap.get(s.deezerArtist.id) || []
        : [];

      // Mark Deezer tracks that appear in the user's Last.fm top tracks
      const normalizedUserNames = new Set(
        userTopTrackNames.map((n) =>
          n.toLowerCase().replace(/[^a-z0-9]/g, "")
        )
      );
      for (const dt of allDeezerTracks) {
        const norm = dt.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (normalizedUserNames.has(norm)) {
          dt.isUserTopTrack = true;
        }
      }

      const DISPLAY_CAP = 5;
      const matched = allDeezerTracks.filter((t) => t.isUserTopTrack);
      const popular = allDeezerTracks.filter((t) => !t.isUserTopTrack);
      const shownMatched = matched.slice(0, DISPLAY_CAP);
      const remaining = DISPLAY_CAP - shownMatched.length;
      const displayTracks = [...shownMatched, ...popular.slice(0, remaining)];

      const mightLike = s.matchType !== "none" && s.affinityScore > 0;

      return {
        setTime: s.setTime,
        artist: s.deezerArtist
          ? (() => {
              const { image, link } = enrichDeezerArtistFromLineup(
                s.setTime.artist,
                s.deezerArtist
              );
              return {
                name: s.deezerArtist.name,
                image,
                link,
                deezerId: s.deezerArtist.id,
              };
            })()
          : null,
        affinityScore: s.affinityScore,
        affinityReason: s.affinityReason,
        topTracks: displayTracks,
        userTopTrackNames: userTopTrackNames.slice(0, 10),
        matchType: s.matchType,
        relatedTo: s.relatedTo,
        genreOverlap: s.genreOverlap,
        mightLike,
      };
    });

    log(`Assembled ${recommendations.length} recommendations`);

    // ── Optimized schedule per day (unchanged heuristic) ──────────────
    const days = ["friday", "saturday", "sunday"] as const;
    const optimizedSchedule: DaySchedule[] = days.map((day) => {
      const dayRecs = recommendations
        .filter((r) => r.setTime.day === day && r.affinityScore > 0)
        .sort((a, b) => b.affinityScore - a.affinityScore);

      const picked: ArtistRecommendation[] = [];

      // Pass 1: Greedy pick by score
      for (const rec of dayRecs) {
        const recStart = timeToMinutes(rec.setTime.startTime);

        const conflict = picked.find((p) =>
          setsOverlap(p.setTime, rec.setTime)
        );
        if (conflict) continue;

        const prevSet = picked
          .filter(
            (p) => timeToMinutes(p.setTime.endTime) <= recStart
          )
          .sort(
            (a, b) =>
              timeToMinutes(b.setTime.endTime) -
              timeToMinutes(a.setTime.endTime)
          )[0];

        if (prevSet) {
          const walkTime = getWalkingTime(
            prevSet.setTime.stage as Stage,
            rec.setTime.stage as Stage
          );
          const gapMinutes =
            recStart - timeToMinutes(prevSet.setTime.endTime);
          if (walkTime > gapMinutes + 10) continue;
        }

        picked.push(rec);
      }

      // Pass 2: Fill gaps
      const unpicked = dayRecs.filter(
        (r) => !picked.includes(r) && r.affinityScore > 0
      );
      for (const rec of unpicked) {
        const recStart = timeToMinutes(rec.setTime.startTime);

        const conflict = picked.find((p) =>
          setsOverlap(p.setTime, rec.setTime)
        );
        if (conflict) continue;

        const prevSet = picked
          .filter(
            (p) => timeToMinutes(p.setTime.endTime) <= recStart
          )
          .sort(
            (a, b) =>
              timeToMinutes(b.setTime.endTime) -
              timeToMinutes(a.setTime.endTime)
          )[0];

        const recEnd = timeToMinutes(rec.setTime.endTime);
        const nextSet = picked
          .filter(
            (p) => timeToMinutes(p.setTime.startTime) >= recEnd
          )
          .sort(
            (a, b) =>
              timeToMinutes(a.setTime.startTime) -
              timeToMinutes(b.setTime.startTime)
          )[0];

        if (prevSet) {
          const walkTime = getWalkingTime(
            prevSet.setTime.stage as Stage,
            rec.setTime.stage as Stage
          );
          const gapMinutes =
            recStart - timeToMinutes(prevSet.setTime.endTime);
          if (walkTime > gapMinutes + 10) continue;
        }

        if (nextSet) {
          const walkTime = getWalkingTime(
            rec.setTime.stage as Stage,
            nextSet.setTime.stage as Stage
          );
          const gapMinutes =
            timeToMinutes(nextSet.setTime.startTime) - recEnd;
          if (walkTime > gapMinutes + 10) continue;
        }

        picked.push(rec);
      }

      // Pass 3: Swap optimization
      const blocked = dayRecs.filter(
        (r) => !picked.includes(r) && r.affinityScore > 0
      );
      let improved = true;
      while (improved) {
        improved = false;
        for (const candidate of blocked) {
          if (picked.includes(candidate)) continue;
          const conflicting = picked.filter((p) =>
            setsOverlap(p.setTime, candidate.setTime)
          );
          if (conflicting.length !== 1) continue;
          const victim = conflicting[0];
          if (candidate.affinityScore <= victim.affinityScore * 1.3) continue;

          const testPicked = picked.filter((p) => p !== victim);
          testPicked.push(candidate);
          testPicked.sort((a, b) =>
            a.setTime.startTime.localeCompare(b.setTime.startTime)
          );

          let feasible = true;
          for (let j = 1; j < testPicked.length; j++) {
            const prev = testPicked[j - 1];
            const curr = testPicked[j];
            const currStart = timeToMinutes(curr.setTime.startTime);
            const prevEnd = timeToMinutes(prev.setTime.endTime);
            if (currStart < prevEnd) continue;
            const walk = getWalkingTime(
              prev.setTime.stage as Stage,
              curr.setTime.stage as Stage
            );
            if (walk > currStart - prevEnd + 10) {
              feasible = false;
              break;
            }
          }

          if (feasible) {
            const idx = picked.indexOf(victim);
            picked[idx] = candidate;
            improved = true;
            break;
          }
        }
      }

      picked.sort((a, b) =>
        a.setTime.startTime.localeCompare(b.setTime.startTime)
      );

      let totalWalkTime = 0;
      const slots: ScheduleSlot[] = picked.map((rec, idx) => {
        const prev = idx > 0 ? picked[idx - 1] : null;
        let walkFromPrevious: number | null = null;
        let prevStage: string | null = null;

        if (prev) {
          walkFromPrevious = getWalkingTime(
            prev.setTime.stage as Stage,
            rec.setTime.stage as Stage
          );
          prevStage = prev.setTime.stage;
          totalWalkTime += walkFromPrevious;
        }

        const conflicting = dayRecs.find(
          (r) =>
            r !== rec &&
            r.affinityScore > 0 &&
            !picked.includes(r) &&
            setsOverlap(r.setTime, rec.setTime) &&
            r.affinityScore >= rec.affinityScore * 0.7
        );

        return {
          recommendation: rec,
          walkFromPrevious,
          prevStage,
          isConflict: !!conflicting,
          conflictWith: conflicting?.setTime.artist.name,
        };
      });

      return { day, slots, totalWalkTime };
    });

    const allRecs = recommendations.sort(
      (a, b) => b.affinityScore - a.affinityScore
    );

    log(
      `Phase 9 done — schedule built. Sending ${allRecs.length} recs. Total time: ${Date.now() - t0}ms`
    );

    return NextResponse.json({
      recommendations: allRecs,
      optimizedSchedule,
      totalMatched: allRecs.filter((r) => r.matchType === "direct").length,
      totalDiscovery: allRecs.filter(
        (r) => r.mightLike && r.matchType !== "direct"
      ).length,
      totalArtists: allRecs.length,
    });
  } catch (error) {
    console.error("Recommendation error:", error);
    const msg = error instanceof Error ? error.message : "";
    if (error instanceof LastfmError) {
      return NextResponse.json(
        { error: "Could not fetch your Last.fm data. Please try again." },
        { status: 503 }
      );
    }
    const rateLimited =
      msg.includes("rate limit") || msg.includes("429");
    return NextResponse.json(
      {
        error: rateLimited
          ? "Too many requests — please try again in a few minutes"
          : "Failed to generate recommendations",
      },
      { status: rateLimited ? 503 : 500 }
    );
  }
}
