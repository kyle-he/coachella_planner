import { NextRequest, NextResponse } from "next/server";
import {
  getTopArtists,
  getTopTracks,
  getRecentlyPlayed,
  getSavedTracks,
  getFollowedArtists,
  refreshAccessToken,
  SpotifyForbiddenError,
  SpotifyScopeError,
  SpotifyUnauthorizedError,
} from "@/lib/spotify";
import {
  SPOTIFY_COOKIE_OPTS,
  clearSpotifySessionCookies,
  getSpotifySessionIssue,
  readSpotifySession,
} from "@/lib/spotify-session";
import {
  searchArtist as deezerSearch,
  getArtistTopTracks as deezerTopTracks,
  getRelatedArtists as deezerRelated,
  type DeezerArtist,
  type DeezerTrack,
} from "@/lib/deezer";
import { SCHEDULE, type SetTime, type Stage } from "@/lib/coachella-data";
import { getWalkingTime } from "@/lib/stage-proximity";

// ── Auth helpers (Spotify only — for user listening data) ────────────

async function getValidToken(request: NextRequest) {
  const session = readSpotifySession(request);
  if (!session) return null;

  if (session.expiresAt && Date.now() < session.expiresAt - 60000) {
    return {
      accessToken: session.accessToken,
      refreshed: false,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      scope: session.scope,
    };
  }
  try {
    const newTokens = await refreshAccessToken(session.refreshToken);
    return {
      accessToken: newTokens.access_token as string,
      refreshed: true,
      refreshToken: (newTokens.refresh_token as string) || session.refreshToken,
      expiresAt: Date.now() + newTokens.expires_in * 1000,
      scope: newTokens.scope || session.scope,
    };
  } catch {
    return null;
  }
}

// ── Types ────────────────────────────────────────────────────────────

interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  popularity?: number;
}

interface SpotifyTrack {
  id: string;
  name: string;
  preview_url: string | null;
  duration_ms: number;
  external_urls?: { spotify?: string };
  album?: {
    name?: string;
    images?: { url: string; height?: number; width?: number }[];
  };
  artists: { id: string; name: string }[];
}

// What we return to the frontend
export interface TrackInfo {
  id: string | number;
  title: string;
  preview: string; // 30s mp3 (Deezer) or Spotify preview_url
  duration: number; // seconds
  albumTitle: string;
  albumCover: string;
  link: string; // deezer or spotify track link
  source?: "deezer" | "spotify";
  isUserTopTrack?: boolean;
}

export interface ArtistRecommendation {
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
 * e.g. "Chloe Caillet x Rossi." → ["chloe caillet x rossi", "chloe caillet", "rossi"]
 * e.g. "Green Velvet x AYYBO"  → ["green velvet x ayybo", "green velvet", "ayybo"]
 */
function splitCollabNames(name: string): string[] {
  const normalized = normalizeArtistName(name);
  const parts = name
    .split(/\s+(?:x|&|feat\.?|ft\.?|vs\.?|with|and|,)\s+/i)
    .map(normalizeArtistName)
    .filter((p) => p.length > 0);

  // Always include the full normalized name, then individual parts
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

function spotifyTrackToInfo(t: SpotifyTrack): TrackInfo | null {
  if (!t.preview_url) return null;
  const cover =
    t.album?.images?.[1]?.url ||
    t.album?.images?.[0]?.url ||
    t.album?.images?.[2]?.url ||
    "";
  return {
    id: t.id,
    title: t.name,
    preview: t.preview_url,
    duration: Math.max(1, Math.round(t.duration_ms / 1000)),
    albumTitle: t.album?.name || "Spotify",
    albumCover: cover,
    link: t.external_urls?.spotify || "",
    source: "spotify",
    isUserTopTrack: true,
  };
}

// ── Main handler ─────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const sessionIssue = getSpotifySessionIssue(request);
  if (sessionIssue) {
    const response = NextResponse.json(
      { error: "Reauthentication required", code: sessionIssue },
      { status: 401 }
    );
    clearSpotifySessionCookies(response);
    return response;
  }

  const result = await getValidToken(request);
  if (!result) {
    const response = NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
    clearSpotifySessionCookies(response);
    return response;
  }

  const session = {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    refreshed: result.refreshed,
    expiresAt: result.expiresAt,
    scope: result.scope,
  };

  try {
    const t0 = Date.now();
    const log = (msg: string) => console.log(`[recs +${Date.now() - t0}ms] ${msg}`);

    // ── Phase 1: Gather user taste from Spotify ──────────────────────
    log("Phase 1: Fetching Spotify listening data…");
    const fetchListeningData = (token: string) =>
      Promise.all([
        getTopArtists(token, "short_term", 50),
        getTopArtists(token, "medium_term", 50),
        getTopArtists(token, "long_term", 50),
        getTopTracks(token, "short_term", 50),
        getTopTracks(token, "medium_term", 50),
        getTopTracks(token, "long_term", 50),
        getRecentlyPlayed(token, 50),
        getSavedTracks(token, 50, 0),
        getFollowedArtists(token, 50),
      ]);

    let pack: Awaited<ReturnType<typeof fetchListeningData>>;
    try {
      pack = await fetchListeningData(session.accessToken);
    } catch (e) {
      if (e instanceof SpotifyUnauthorizedError) {
        const newTokens = await refreshAccessToken(session.refreshToken);
        session.accessToken = newTokens.access_token as string;
        session.refreshToken =
          (newTokens.refresh_token as string) || session.refreshToken;
        session.expiresAt = Date.now() + (newTokens.expires_in as number) * 1000;
        session.scope = newTokens.scope || session.scope;
        session.refreshed = true;
        log("Phase 1: Refreshed access token after 401, retrying…");
        pack = await fetchListeningData(session.accessToken);
      } else {
        throw e;
      }
    }

    const [
      topShort,
      topMedium,
      topLong,
      tracksShort,
      tracksMedium,
      tracksLong,
      recentlyPlayed,
      savedTracks,
      followed,
    ] = pack;

    const topArtistSlots =
      (topShort.items?.length ?? 0) +
      (topMedium.items?.length ?? 0) +
      (topLong.items?.length ?? 0);
    const topTrackSlots =
      (tracksShort.items?.length ?? 0) +
      (tracksMedium.items?.length ?? 0) +
      (tracksLong.items?.length ?? 0);
    log(
      `Phase 1 done — ${topArtistSlots} top-artist slots, ${topTrackSlots} top-track slots; recent ${recentlyPlayed.items?.length ?? 0}, saved ${savedTracks.items?.length ?? 0}, followed ${followed.artists?.items?.length ?? 0}`
    );

    // ── Phase 2: Build direct affinity map from user's Spotify data ──
    const affinityMap = new Map<
      string,
      { score: number; reason: string }
    >();

    const allUserArtists: SpotifyArtist[] = [];

    const processArtists = (
      artists: SpotifyArtist[],
      weight: number,
      label: string
    ) => {
      artists.forEach((artist, index) => {
        allUserArtists.push(artist);
        // Check all name variants (handles collabs like "Artist X Artist")
        const names = splitCollabNames(artist.name);
        const positionScore =
          ((artists.length - index) / artists.length) * weight;
        for (const normalized of names) {
          const existing = affinityMap.get(normalized);
          if (!existing || existing.score < positionScore) {
            affinityMap.set(normalized, { score: positionScore, reason: label });
          } else {
            existing.score += positionScore * 0.5;
          }
        }
      });
    };

    processArtists((topShort.items || []) as SpotifyArtist[], 100, "In your recent heavy rotation");
    processArtists((topMedium.items || []) as SpotifyArtist[], 70, "You listen to them regularly");
    processArtists((topLong.items || []) as SpotifyArtist[], 40, "A long-time favorite of yours");
    processArtists((followed.artists?.items || []) as SpotifyArtist[], 55, "Artists you follow");

    // Extract artists from ALL top tracks (short + medium + long term)
    const trackArtistCounts = new Map<string, number>();
    const userTopTracksByArtist = new Map<string, SpotifyTrack[]>();
    [
      ...((tracksShort.items || []) as SpotifyTrack[]),
      ...((tracksMedium.items || []) as SpotifyTrack[]),
      ...((tracksLong.items || []) as SpotifyTrack[]),
    ].forEach((track: SpotifyTrack) => {
      track.artists.forEach((a) => {
        const names = splitCollabNames(a.name);
        for (const normalized of names) {
          trackArtistCounts.set(
            normalized,
            (trackArtistCounts.get(normalized) || 0) + 1
          );
          const existing = userTopTracksByArtist.get(normalized) || [];
          existing.push(track);
          userTopTracksByArtist.set(normalized, existing);
        }
      });
    });

    // Extract artists from recently played
    ((recentlyPlayed.items || []) as { track: SpotifyTrack }[]).forEach(
      (item) => {
        item.track.artists.forEach((a) => {
          const names = splitCollabNames(a.name);
          for (const normalized of names) {
            trackArtistCounts.set(
              normalized,
              (trackArtistCounts.get(normalized) || 0) + 1
            );
          }
        });
      }
    );

    // Extract artists from saved/liked tracks
    ((savedTracks.items || []) as { track: SpotifyTrack }[]).forEach(
      (item) => {
        item.track.artists.forEach((a) => {
          const names = splitCollabNames(a.name);
          for (const normalized of names) {
            trackArtistCounts.set(
              normalized,
              (trackArtistCounts.get(normalized) || 0) + 1
            );
          }
        });
      }
    );

    trackArtistCounts.forEach((count, key) => {
      const existing = affinityMap.get(key);
      const trackScore = count * 10;
      if (existing) {
        existing.score += trackScore;
      } else {
        affinityMap.set(key, {
          score: trackScore,
          reason: `${count} of your top tracks`,
        });
      }
    });

    // ── Phase 3: Build genre profile from Spotify data ───────────────
    log(`Phase 2 done — ${affinityMap.size} artists in affinity map, ${trackArtistCounts.size} from tracks`);
    const genreCounts = new Map<string, number>();
    const deduped = new Map<string, SpotifyArtist>();
    allUserArtists.forEach((a) => {
      const n = normalizeArtistName(a.name);
      if (!deduped.has(n)) deduped.set(n, a);
    });
    deduped.forEach((artist) => {
      (artist.genres || []).forEach((g) => {
        genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
      });
    });
    const maxGenreCount = Math.max(...genreCounts.values(), 1);
    const genreProfile = new Map<string, number>();
    genreCounts.forEach((count, genre) => {
      genreProfile.set(genre, count / maxGenreCount);
    });

    // Build a set of genre words for fuzzy matching against artist names
    // e.g. "indie pop" → ["indie", "pop"]
    const genreWords = new Set<string>();
    genreCounts.forEach((_count, genre) => {
      genre
        .toLowerCase()
        .split(/\s+/)
        .forEach((w) => {
          if (w.length > 2) genreWords.add(w);
        });
    });

    // ── Phase 4: Search ALL Coachella artists on Deezer ──────────────
    log(`Phase 3 done — ${genreProfile.size} genres profiled`);
    // (Parallel with Phase 5 start) — increased batch size for speed
    interface DeezerMatch {
      setTime: SetTime;
      deezerArtist: DeezerArtist | null;
      normalized: string;
      collabNames: string[];
    }

    // Pre-build the normalized name index for Coachella schedule
    const scheduleSearchNames = SCHEDULE.map((setTime) => {
      const searchName = setTime.artist.spotifyName || setTime.artist.name;
      return {
        setTime,
        searchName,
        normalized: normalizeArtistName(searchName),
        collabNames: splitCollabNames(searchName),
      };
    });

    // Batch Deezer searches — 8 concurrent for speed
    const deezerMatches: DeezerMatch[] = [];
    const searchBatch = 8;
    for (let i = 0; i < scheduleSearchNames.length; i += searchBatch) {
      const batch = scheduleSearchNames.slice(i, i + searchBatch);
      const results = await Promise.all(
        batch.map(async ({ setTime, searchName, normalized, collabNames }) => {
          try {
            const result = await deezerSearch(searchName, 5);
            const artists = result.data || [];
            // Try exact match first, then fall back to top result
            const exact = artists.find(
              (a) => normalizeArtistName(a.name) === normalized
            );
            // If no exact match, also try matching each collab part
            let bestMatch = exact || null;
            if (!bestMatch && collabNames.length > 1) {
              for (const name of collabNames.slice(1)) {
                bestMatch =
                  artists.find((a) => normalizeArtistName(a.name) === name) ||
                  null;
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
            return { setTime, deezerArtist: null, normalized, collabNames };
          }
        })
      );
      deezerMatches.push(...results);
      if (i + searchBatch < scheduleSearchNames.length) {
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    // ── Phase 5: Get related artists from Deezer ─────────────────────
    log(`Phase 4 done — ${deezerMatches.filter(m => m.deezerArtist).length}/${deezerMatches.length} artists found on Deezer`);
    // For the user's top Spotify artists, find them on Deezer, then
    // fetch their related artists. This builds the "you'd like" map.
    const relatedArtistMap = new Map<
      string,
      { score: number; relatedTo: string }
    >();

    // Build a set of Coachella artist normalized names for fast lookups
    const coachellaNameSet = new Set<string>();
    for (const m of deezerMatches) {
      coachellaNameSet.add(m.normalized);
      for (const cn of m.collabNames) coachellaNameSet.add(cn);
      if (m.deezerArtist) {
        coachellaNameSet.add(normalizeArtistName(m.deezerArtist.name));
      }
    }

    // Use all deduplicated user artists (up to 60) for wider related net
    const userTopNames = [...deduped.values()].slice(0, 60);
    const relBatch = 8;
    for (let i = 0; i < userTopNames.length; i += relBatch) {
      const batch = userTopNames.slice(i, i + relBatch);
      const results = await Promise.all(
        batch.map(async (spArtist) => {
          try {
            // Search Deezer for this user's artist
            const searchRes = await deezerSearch(spArtist.name, 3);
            const dzArtist = searchRes.data?.[0];
            if (!dzArtist) return [];
            // Get related artists from Deezer
            const relRes = await deezerRelated(dzArtist.id, 25);
            return (relRes.data || []).map((rel, idx) => ({
              normalized: normalizeArtistName(rel.name),
              score: ((25 - idx) / 25) * 50,
              relatedTo: spArtist.name,
            }));
          } catch {
            return [];
          }
        })
      );
      results.flat().forEach(({ normalized, score, relatedTo }) => {
        if (affinityMap.has(normalized)) return;
        const existing = relatedArtistMap.get(normalized);
        if (!existing || existing.score < score) {
          relatedArtistMap.set(normalized, { score, relatedTo });
        } else {
          existing.score = Math.min(existing.score + score * 0.4, 70);
        }
      });
      if (i + relBatch < userTopNames.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // ── Phase 6: Score each Coachella artist ─────────────────────────
    log(`Phase 5 done — ${relatedArtistMap.size} related-artist mappings from ${userTopNames.length} user artists`);
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
      let relatedTo: string | undefined;
      let genreOverlap: string[] | undefined;

      // Also check the deezer match name in case it differs slightly
      const deezerNorm = deezerArtist
        ? normalizeArtistName(deezerArtist.name)
        : "";

      // Build all name variants to check
      const allNames = [...collabNames];
      if (deezerNorm && !allNames.includes(deezerNorm)) {
        allNames.push(deezerNorm);
      }
      // Also split the Deezer name for collabs
      if (deezerArtist) {
        for (const cn of splitCollabNames(deezerArtist.name)) {
          if (!allNames.includes(cn)) allNames.push(cn);
        }
      }

      // Direct match? Check all name variants against the affinity map
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

      // Related artist match?
      if (matchType !== "direct") {
        for (const name of allNames) {
          const rel = relatedArtistMap.get(name);
          if (rel && rel.score > affinityScore) {
            affinityScore = rel.score;
            affinityReason = `Similar to ${rel.relatedTo}`;
            matchType = "related";
            relatedTo = rel.relatedTo;
          }
        }
      }

      // Genre match — use the user's genre profile to find genre overlap
      // Deezer doesn't provide genres per artist, but we can use the
      // Spotify search data to cross-reference. For now, check if any
      // of the user's top genres appear as words in the artist name or
      // the Deezer tracklist metadata. This is a lightweight heuristic.
      if (matchType === "none" && deezerArtist) {
        // Search all user artists' genres for any that match Coachella
        // artist names or known associations. We check the artist name
        // words against genre words as a proxy.
        const artistNameWords = new Set(
          (deezerArtist.name || "")
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length > 2)
        );
        const matchedGenres: string[] = [];
        genreProfile.forEach((weight, genre) => {
          if (weight < 0.15) return; // skip very weak genres
          const gWords = genre.toLowerCase().split(/\s+/);
          for (const gw of gWords) {
            if (gw.length > 2 && artistNameWords.has(gw)) {
              matchedGenres.push(genre);
              break;
            }
          }
        });

        // Also: check if the Deezer artist is in any genre-tagged
        // Spotify artist's related network that we haven't checked
        // (this is the "genre proximity" heuristic)
        if (matchedGenres.length > 0) {
          const genreScore = matchedGenres.reduce((sum, g) => {
            return sum + (genreProfile.get(g) || 0) * 20;
          }, 0);
          affinityScore = Math.min(genreScore, 30);
          affinityReason = `Matches your taste in ${matchedGenres.slice(0, 3).join(", ")}`;
          matchType = "genre";
          genreOverlap = matchedGenres;
        }
      }

      // Popularity boost — if the artist has lots of fans on Deezer,
      // give a small bonus to help surface popular acts you might enjoy.
      // This acts as a tiebreaker and makes the schedule "cooler".
      if (deezerArtist && deezerArtist.nb_fan > 0) {
        // Log-scale fan bonus: 1M fans → ~6 points, 10M → ~8, 100K → ~4
        const fanBonus = Math.min(
          8,
          Math.log10(Math.max(deezerArtist.nb_fan, 1)) * 1.2
        );
        if (matchType === "direct") {
          // Small boost for popular matched artists
          affinityScore += fanBonus * 0.3;
        } else if (matchType === "related") {
          // Medium boost for popular related artists
          affinityScore += fanBonus * 0.5;
        } else if (matchType === "none" && deezerArtist.nb_fan > 500000) {
          // For unmatched but very popular artists, give a base discovery score
          // This surfaces headliners and popular acts the user might enjoy
          affinityScore = Math.max(affinityScore, fanBonus * 1.5);
          if (affinityScore > 0 && matchType === "none") {
            affinityReason = "Popular artist you might enjoy";
            matchType = "genre"; // treat as genre-level discovery
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

    // ── Phase 7: Fetch top tracks from Deezer ────────────────────────
    log(`Phase 6 done — scored ${scored.length} artists (${scored.filter(s => s.matchType === 'direct').length} direct, ${scored.filter(s => s.matchType === 'related').length} related, ${scored.filter(s => s.matchType === 'genre').length} genre)`);
    // Deezer always returns preview URLs! No more empty tracks.
    const trackMap = new Map<number, TrackInfo[]>();

    // Prioritize artists with scores, but fetch for ALL that have a Deezer ID
    const withDeezer = scored
      .filter((s) => s.deezerArtist)
      .sort((a, b) => b.affinityScore - a.affinityScore);

    const trackBatch = 8;
    for (let i = 0; i < withDeezer.length; i += trackBatch) {
      const batch = withDeezer.slice(i, i + trackBatch);
      const results = await Promise.all(
        batch.map(async (s) => {
          try {
            const data = await deezerTopTracks(s.deezerArtist!.id, 50);
            return {
              id: s.deezerArtist!.id,
              tracks: (data.data || []).map(deezerTrackToInfo),
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
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    // ── Phase 8: Assemble final recommendations ──────────────────────
    log(`Phase 7 done — fetched tracks for ${trackMap.size} artists`);
    const recommendations: ArtistRecommendation[] = scored.map((s) => {
      const userTopTracks: TrackInfo[] = [];
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
          const tracks = userTopTracksByArtist.get(key) || [];
          for (const t of tracks) {
            if (seen.has(t.id)) continue;
            seen.add(t.id);
            userTopTrackNames.push(t.name);
            const info = spotifyTrackToInfo(t);
            if (info) userTopTracks.push(info);
          }
        }
      }

      const allDeezerTracks: TrackInfo[] = s.deezerArtist
        ? trackMap.get(s.deezerArtist.id) || []
        : [];

      // Cross-reference user top track names against the full Deezer catalog
      const normalizedUserNames = new Set(
        userTopTrackNames.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ""))
      );
      for (const dt of allDeezerTracks) {
        const norm = dt.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (normalizedUserNames.has(norm)) {
          dt.isUserTopTrack = true;
        }
      }

      // Build display list: overlapping user top tracks first, then fill
      // remaining slots with the most popular Deezer tracks (up to 5 total)
      const DISPLAY_CAP = 5;
      const matched = allDeezerTracks.filter((t) => t.isUserTopTrack);
      const popular = allDeezerTracks.filter((t) => !t.isUserTopTrack);
      const shownMatched = matched.slice(0, DISPLAY_CAP);
      const remaining = DISPLAY_CAP - shownMatched.length;
      const displayTracks = [
        ...shownMatched,
        ...popular.slice(0, remaining),
      ];

      return {
        setTime: s.setTime,
        artist: s.deezerArtist
          ? {
              name: s.deezerArtist.name,
              image: s.deezerArtist.picture_big || s.deezerArtist.picture_medium,
              link: s.deezerArtist.link,
              fans: s.deezerArtist.nb_fan,
              deezerId: s.deezerArtist.id,
            }
          : null,
        affinityScore: s.affinityScore,
        affinityReason: s.affinityReason,
        topTracks: displayTracks,
        userTopTracks: userTopTracks.slice(0, 5),
        userTopTrackNames: userTopTrackNames.slice(0, 10),
        matchType: s.matchType,
        relatedTo: s.relatedTo,
        genreOverlap: s.genreOverlap,
      };
    });

    // ── Phase 9: Build optimized schedule per day ────────────────────
    log(`Phase 8 done — ${recommendations.length} recommendations assembled`);
    // Two-pass greedy: first pass picks greedily by score, second pass
    // tries to fill gaps with lower-scored artists that fit.
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
          .filter((p) => timeToMinutes(p.setTime.endTime) <= recStart)
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

      // Pass 2: Try to fill gaps — look for recs that can fit in time
      // slots where nothing is picked. Allows discovering more artists.
      const unpicked = dayRecs.filter(
        (r) => !picked.includes(r) && r.affinityScore > 0
      );
      for (const rec of unpicked) {
        const recStart = timeToMinutes(rec.setTime.startTime);

        const conflict = picked.find((p) =>
          setsOverlap(p.setTime, rec.setTime)
        );
        if (conflict) continue;

        // Find the closest previous and next picked sets
        const prevSet = picked
          .filter((p) => timeToMinutes(p.setTime.endTime) <= recStart)
          .sort(
            (a, b) =>
              timeToMinutes(b.setTime.endTime) -
              timeToMinutes(a.setTime.endTime)
          )[0];

        const recEnd = timeToMinutes(rec.setTime.endTime);
        const nextSet = picked
          .filter((p) => timeToMinutes(p.setTime.startTime) >= recEnd)
          .sort(
            (a, b) =>
              timeToMinutes(a.setTime.startTime) -
              timeToMinutes(b.setTime.startTime)
          )[0];

        // Check walk feasibility from prev
        if (prevSet) {
          const walkTime = getWalkingTime(
            prevSet.setTime.stage as Stage,
            rec.setTime.stage as Stage
          );
          const gapMinutes =
            recStart - timeToMinutes(prevSet.setTime.endTime);
          if (walkTime > gapMinutes + 10) continue;
        }

        // Check walk feasibility to next
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

      // Pass 3: Swap optimization — try replacing low-score picks with
      // higher-score ones that were blocked by walk constraints
      const blocked = dayRecs.filter(
        (r) => !picked.includes(r) && r.affinityScore > 0
      );
      let improved = true;
      while (improved) {
        improved = false;
        for (const candidate of blocked) {
          if (picked.includes(candidate)) continue;
          // Find which picked set(s) it conflicts with
          const conflicting = picked.filter((p) =>
            setsOverlap(p.setTime, candidate.setTime)
          );
          if (conflicting.length !== 1) continue; // skip multi-conflicts
          const victim = conflicting[0];
          // Only swap if candidate is meaningfully better
          if (candidate.affinityScore <= victim.affinityScore * 1.3) continue;

          // Temporarily swap and check walk feasibility
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
            if (currStart < prevEnd) continue; // overlap handled above
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
            break; // restart the improvement loop
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

    log(`Phase 9 done — schedule built. Sending ${allRecs.length} recs. Total time: ${Date.now() - t0}ms`);

    const response = NextResponse.json({
      recommendations: allRecs,
      optimizedSchedule,
      totalMatched: allRecs.filter((r) => r.matchType === "direct").length,
      totalDiscovery: allRecs.filter(
        (r) => r.matchType === "genre" || r.matchType === "related"
      ).length,
      totalArtists: allRecs.length,
      userGenres: [...genreProfile.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([genre, weight]) => ({ genre, weight })),
    });

    if (session.refreshed) {
      response.cookies.set("sp_access", session.accessToken, SPOTIFY_COOKIE_OPTS);
      response.cookies.set("sp_refresh", session.refreshToken, SPOTIFY_COOKIE_OPTS);
      response.cookies.set("sp_expires", String(session.expiresAt), SPOTIFY_COOKIE_OPTS);
      response.cookies.set("sp_scope", session.scope, SPOTIFY_COOKIE_OPTS);
    }

    return response;
  } catch (error) {
    console.error("Recommendation error:", error);
    const msg = error instanceof Error ? error.message : "";
    if (error instanceof SpotifyScopeError) {
      const response = NextResponse.json(
        { error: "Reauthentication required", code: "insufficient_scope" },
        { status: 401 }
      );
      clearSpotifySessionCookies(response);
      return response;
    }
    if (error instanceof SpotifyForbiddenError) {
      console.error("Spotify denied recommendation access:", error.detail || error.message);
      const response = NextResponse.json(
        { error: "Spotify access denied", code: "spotify_access_denied" },
        { status: 401 }
      );
      clearSpotifySessionCookies(response);
      return response;
    }
    const rateLimited =
      msg.includes("rate limit") || msg.includes("429");
    return NextResponse.json(
      {
        error: rateLimited
          ? "Spotify is rate-limiting requests — please try again in a few minutes"
          : "Failed to generate recommendations",
      },
      { status: rateLimited ? 503 : 500 }
    );
  }
}
