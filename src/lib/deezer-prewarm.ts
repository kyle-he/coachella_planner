// Pre-warm the Deezer API cache with all Coachella artist searches + top tracks.
// Called once at server startup via instrumentation.ts so individual users
// don't have to wait for hundreds of cold API calls.

import { SCHEDULE } from "./coachella-data";
import {
  searchArtist,
  getArtistTopTracks,
  type DeezerArtist,
} from "./deezer";

function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function prewarmDeezerCache() {
  console.log("[deezer-prewarm] Starting cache pre-warm for Coachella lineup…");
  const start = Date.now();

  // ── Step 1: Search every artist on the lineup ──────────────────────
  const searchNames = SCHEDULE.map((st) => st.artist.spotifyName || st.artist.name);
  const unique = [...new Set(searchNames)];

  const matched: { name: string; artist: DeezerArtist }[] = [];
  const BATCH = 8;
  const DELAY = 100; // ms between batches to stay under rate limits

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (name) => {
        try {
          const res = await searchArtist(name, 5);
          const normalized = normalizeArtistName(name);
          const exact = (res.data || []).find(
            (a) => normalizeArtistName(a.name) === normalized
          );
          const best = exact || res.data?.[0] || null;
          return best ? { name, artist: best } : null;
        } catch {
          return null;
        }
      })
    );
    for (const r of results) {
      if (r) matched.push(r);
    }
    if (i + BATCH < unique.length) {
      await new Promise((r) => setTimeout(r, DELAY));
    }
  }

  console.log(
    `[deezer-prewarm] Searched ${unique.length} artists, matched ${matched.length} on Deezer.`
  );

  // ── Step 2: Fetch top 5 tracks for each matched artist ─────────────
  let tracksFetched = 0;
  for (let i = 0; i < matched.length; i += BATCH) {
    const batch = matched.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async ({ artist }) => {
        try {
          const data = await getArtistTopTracks(artist.id, 5);
          return (data.data || []).length;
        } catch {
          return 0;
        }
      })
    );
    tracksFetched += results.reduce((a, b) => a + b, 0);
    if (i + BATCH < matched.length) {
      await new Promise((r) => setTimeout(r, DELAY));
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[deezer-prewarm] Done in ${elapsed}s — ${matched.length} artists, ${tracksFetched} tracks cached.`
  );
}
